// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {RoleManager} from "../access/role-manager.sol";
import {NativeLiquidityPool} from "./native-liquidity-pool.sol";
import {BorrowerPolicyRegistry} from "../policy/borrower-policy-registry.sol";

/// @notice Native gas-loan manager for autonomous agents (double-signature: Tabby offer + borrower acceptance).
contract AgentLoanManager is RoleManager {
    error InvalidAddress();
    error InvalidAmount();
    error InvalidDueDate();
    error InvalidExpiry();
    error InvalidSignature();
    error NonceAlreadyUsed();
    error PolicyNotSet();
    error PolicyDisabled();
    error PolicyViolation();
    error LoanNotFound();
    error LoanClosed();
    error NotDue();
    error NothingToRepay();

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant OFFER_TYPEHASH =
        keccak256(
            "LoanOffer(address borrower,uint256 principal,uint256 interestBps,uint256 dueAt,uint256 nonce,uint256 issuedAt,uint256 expiresAt,uint256 action,bytes32 metadataHash)"
        );

    uint256 private constant SECP256K1N_HALF =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    struct LoanOffer {
        address borrower;
        uint256 principal;
        uint256 interestBps; // APR in bps
        uint256 dueAt;
        uint256 nonce;
        uint256 issuedAt;
        uint256 expiresAt;
        uint256 action; // action type enum index
        bytes32 metadataHash; // optional: hash of purpose/params
    }

    struct LoanState {
        address borrower;
        uint256 principal;
        uint256 rateBps;
        uint256 openedAt;
        uint256 dueAt;
        uint256 lastAccruedAt;
        uint256 accruedInterest;
        uint256 totalRepaid;
        bool closed;
        bool defaulted;
    }

    uint256 public nextLoanId;
    mapping(uint256 => LoanState) public loans;
    mapping(address => mapping(uint256 => bool)) public usedNonces;

    NativeLiquidityPool public immutable pool;
    BorrowerPolicyRegistry public immutable policyRegistry;
    address public tabbySigner;

    uint256 public gracePeriodSeconds;

    uint256 private immutable _domainChainId;
    bytes32 private immutable _domainSeparator;

    event TabbySignerUpdated(address indexed signer);
    event GracePeriodUpdated(uint256 seconds_);
    event LoanExecuted(uint256 indexed loanId, address indexed borrower, uint256 principal, uint256 rateBps, uint256 dueAt, uint256 action);
    event LoanRepaid(uint256 indexed loanId, address indexed payer, uint256 amount, uint256 principalPaid, uint256 interestPaid);
    event LoanDefaulted(uint256 indexed loanId, uint256 principalWrittenOff);

    constructor(address admin, address pool_, address policyRegistry_, address tabbySigner_) RoleManager(admin) {
        if (pool_ == address(0) || policyRegistry_ == address(0) || tabbySigner_ == address(0)) revert InvalidAddress();
        pool = NativeLiquidityPool(payable(pool_));
        policyRegistry = BorrowerPolicyRegistry(policyRegistry_);
        tabbySigner = tabbySigner_;

        nextLoanId = 1;

        _domainChainId = block.chainid;
        _domainSeparator = _buildDomainSeparator();
    }

    function setTabbySigner(address signer) external onlyRole(ADMIN_ROLE) {
        if (signer == address(0)) revert InvalidAddress();
        tabbySigner = signer;
        emit TabbySignerUpdated(signer);
    }

    function setGracePeriodSeconds(uint256 seconds_) external onlyRole(ADMIN_ROLE) {
        gracePeriodSeconds = seconds_;
        emit GracePeriodUpdated(seconds_);
    }

    function domainSeparator() public view returns (bytes32) {
        if (block.chainid == _domainChainId) return _domainSeparator;
        return _buildDomainSeparator();
    }

    function hashOffer(LoanOffer calldata offer) public pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    OFFER_TYPEHASH,
                    offer.borrower,
                    offer.principal,
                    offer.interestBps,
                    offer.dueAt,
                    offer.nonce,
                    offer.issuedAt,
                    offer.expiresAt,
                    offer.action,
                    offer.metadataHash
                )
            );
    }

    function offerDigest(LoanOffer calldata offer) external view returns (bytes32) {
        return _hashTypedData(hashOffer(offer));
    }

    function executeLoan(LoanOffer calldata offer, bytes calldata tabbySig, bytes calldata borrowerSig) external returns (uint256 loanId) {
        _validateOffer(offer);

        if (usedNonces[offer.borrower][offer.nonce]) revert NonceAlreadyUsed();

        bytes32 digest = _hashTypedData(hashOffer(offer));

        address recoveredTabby = _recover(digest, tabbySig);
        if (recoveredTabby != tabbySigner) revert InvalidSignature();

        address recoveredBorrower = _recover(digest, borrowerSig);
        if (recoveredBorrower != offer.borrower) revert InvalidSignature();

        _enforcePolicy(offer);

        usedNonces[offer.borrower][offer.nonce] = true;

        loanId = nextLoanId++;
        loans[loanId] = LoanState({
            borrower: offer.borrower,
            principal: offer.principal,
            rateBps: offer.interestBps,
            openedAt: block.timestamp,
            dueAt: offer.dueAt,
            lastAccruedAt: block.timestamp,
            accruedInterest: 0,
            totalRepaid: 0,
            closed: false,
            defaulted: false
        });

        pool.borrow(offer.principal, offer.borrower);
        emit LoanExecuted(loanId, offer.borrower, offer.principal, offer.interestBps, offer.dueAt, offer.action);
    }

    function outstanding(uint256 loanId) external view returns (uint256) {
        LoanState memory loan = loans[loanId];
        if (loan.borrower == address(0) || loan.closed) return 0;
        uint256 pending = _pendingInterest(loan);
        return loan.principal + loan.accruedInterest + pending;
    }

    function repay(uint256 loanId) external payable {
        if (msg.value == 0) revert InvalidAmount();
        LoanState storage loan = loans[loanId];
        if (loan.borrower == address(0)) revert LoanNotFound();
        if (loan.closed) revert LoanClosed();

        _accrueInterest(loan);

        uint256 outstandingAmount = loan.principal + loan.accruedInterest;
        if (outstandingAmount == 0) revert NothingToRepay();
        if (msg.value > outstandingAmount) revert InvalidAmount();

        uint256 remaining = msg.value;

        uint256 interestPaid = 0;
        if (loan.accruedInterest > 0) {
            interestPaid = remaining > loan.accruedInterest ? loan.accruedInterest : remaining;
            loan.accruedInterest -= interestPaid;
            remaining -= interestPaid;
        }

        uint256 principalPaid = 0;
        if (remaining > 0) {
            principalPaid = remaining > loan.principal ? loan.principal : remaining;
            loan.principal -= principalPaid;
            remaining -= principalPaid;
        }

        loan.totalRepaid += msg.value;

        pool.repay{value: msg.value}(principalPaid);

        emit LoanRepaid(loanId, msg.sender, msg.value, principalPaid, interestPaid);

        if (loan.principal == 0 && loan.accruedInterest == 0) {
            loan.closed = true;
        }
    }

    /// @notice Mark a loan defaulted after dueAt + gracePeriodSeconds and write off remaining principal from the pool.
    function markDefault(uint256 loanId) external {
        LoanState storage loan = loans[loanId];
        if (loan.borrower == address(0)) revert LoanNotFound();
        if (loan.closed) revert LoanClosed();

        if (block.timestamp <= loan.dueAt + gracePeriodSeconds) revert NotDue();

        _accrueInterest(loan);

        uint256 principalToWriteOff = loan.principal;
        loan.closed = true;
        loan.defaulted = true;
        loan.principal = 0;
        loan.accruedInterest = 0;

        if (principalToWriteOff > 0) {
            pool.writeOff(principalToWriteOff);
        }

        emit LoanDefaulted(loanId, principalToWriteOff);
    }

    function _validateOffer(LoanOffer calldata offer) internal view {
        if (offer.borrower == address(0)) revert InvalidAddress();
        if (offer.principal == 0) revert InvalidAmount();
        if (offer.dueAt <= block.timestamp) revert InvalidDueDate();
        if (offer.expiresAt < block.timestamp) revert InvalidExpiry();
        if (offer.issuedAt > block.timestamp) revert InvalidExpiry();
    }

    function _enforcePolicy(LoanOffer calldata offer) internal view {
        (
            address owner,
            uint256 maxPrincipal,
            uint256 maxInterestBps,
            uint256 maxDurationSeconds,
            uint256 allowedActions,
            bool enabled
        ) = policyRegistry.policies(offer.borrower);

        if (owner == address(0)) revert PolicyNotSet();
        if (!enabled) revert PolicyDisabled();

        if (maxPrincipal != 0 && offer.principal > maxPrincipal) revert PolicyViolation();
        if (maxInterestBps != 0 && offer.interestBps > maxInterestBps) revert PolicyViolation();

        uint256 duration = offer.dueAt > block.timestamp ? offer.dueAt - block.timestamp : 0;
        if (maxDurationSeconds != 0 && duration > maxDurationSeconds) revert PolicyViolation();

        if (allowedActions != 0) {
            if ((allowedActions & (uint256(1) << offer.action)) == 0) revert PolicyViolation();
        }
    }

    function _pendingInterest(LoanState memory loan) internal view returns (uint256) {
        uint256 end = block.timestamp < loan.dueAt ? block.timestamp : loan.dueAt;
        if (end <= loan.lastAccruedAt) return 0;
        uint256 elapsed = end - loan.lastAccruedAt;
        return (loan.principal * loan.rateBps * elapsed) / (10000 * 365 days);
    }

    function _accrueInterest(LoanState storage loan) internal {
        uint256 end = block.timestamp < loan.dueAt ? block.timestamp : loan.dueAt;
        if (end <= loan.lastAccruedAt) return;
        uint256 elapsed = end - loan.lastAccruedAt;
        uint256 interest = (loan.principal * loan.rateBps * elapsed) / (10000 * 365 days);
        loan.accruedInterest += interest;
        loan.lastAccruedAt = end;
    }

    function _hashTypedData(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function _buildDomainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes("TabbyAgentLoan")), keccak256(bytes("1")), block.chainid, address(this)));
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);

        bytes32 r;
        bytes32 s;
        uint8 v;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // bytes calldata `.offset` points to the first byte of the data (not the length word).
            // Signature is r (32) || s (32) || v (1).
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (uint256(s) > SECP256K1N_HALF) return address(0);
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
