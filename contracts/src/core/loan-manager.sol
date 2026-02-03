// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {RoleManager} from "../access/role-manager.sol";
import {SafeErc20} from "../libraries/safe-erc20.sol";
import {PriceOracle} from "../oracle/price-oracle.sol";
import {PolicyEngine} from "../policy/policy-engine.sol";
import {PositionManager} from "../core/position-manager.sol";
import {LiquidityPool} from "../core/liquidity-pool.sol";

contract LoanManager is RoleManager {
    using SafeErc20 for address;

    error InvalidAmount();
    error InvalidAsset();
    error InvalidDueDate();
    error LoanNotFound();
    error LoanAlreadyClosed();
    error PositionInUse();
    error EngineNotSet();
    error PriceUnavailable();
    error OutstandingBalance();

    struct Loan {
        address borrower;
        address asset;
        uint256 principal;
        uint256 interestBps;
        address collateralAsset;
        uint256 collateralAmount;
        uint256 openedAt;
        uint256 dueAt;
        uint256 lastAccruedAt;
        uint256 accruedInterest;
        bool closed;
    }

    uint256 public nextLoanId;
    mapping(uint256 => Loan) public loans;
    mapping(uint256 => uint256) public loanPositions;
    mapping(uint256 => uint256) public positionLoans;

    address public policyEngine;
    address public priceOracle;
    address public positionManager;
    address public treasury;
    address public liquidityPool;

    event LoanOpened(uint256 indexed loanId, uint256 indexed positionId, address indexed borrower, address asset, uint256 principal);
    event LoanRepaid(uint256 indexed loanId, address indexed payer, uint256 amount);
    event LoanClosed(uint256 indexed loanId, address indexed closer);
    event LoanLiquidated(uint256 indexed loanId, address indexed liquidator);
    event EnginesUpdated(address indexed policyEngine, address indexed priceOracle, address indexed positionManager);
    event TreasuryUpdated(address indexed treasury);
    event LiquidityPoolUpdated(address indexed liquidityPool);

    constructor(address admin) RoleManager(admin) {
        nextLoanId = 1;
    }

    function setEngines(address policyEngine_, address priceOracle_, address positionManager_) external onlyRole(ADMIN_ROLE) {
        policyEngine = policyEngine_;
        priceOracle = priceOracle_;
        positionManager = positionManager_;
        emit EnginesUpdated(policyEngine_, priceOracle_, positionManager_);
    }

    function setTreasury(address treasury_) external onlyRole(ADMIN_ROLE) {
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function setLiquidityPool(address liquidityPool_) external onlyRole(ADMIN_ROLE) {
        liquidityPool = liquidityPool_;
        emit LiquidityPoolUpdated(liquidityPool_);
    }

    function openLoan(
        address asset,
        uint256 principal,
        uint256 interestBps,
        address collateralAsset,
        uint256 collateralAmount,
        uint256 dueAt
    ) external returns (uint256 loanId) {
        _requireEngines();
        _validateOpenParams(asset, collateralAsset, principal, collateralAmount, dueAt);

        uint256 positionId = PositionManager(positionManager).openPositionFor(msg.sender, collateralAsset, collateralAmount);
        if (positionLoans[positionId] != 0) revert PositionInUse();

        interestBps = _resolveInterestRate(collateralAsset, interestBps);
        _validateBorrow(collateralAsset, asset, collateralAmount, principal);

        PositionManager(positionManager).increaseDebt(positionId, asset, principal);

        loanId = nextLoanId++;
        loans[loanId] = Loan({
            borrower: msg.sender,
            asset: asset,
            principal: principal,
            interestBps: interestBps,
            collateralAsset: collateralAsset,
            collateralAmount: collateralAmount,
            openedAt: block.timestamp,
            dueAt: dueAt,
            lastAccruedAt: block.timestamp,
            accruedInterest: 0,
            closed: false
        });
        loanPositions[loanId] = positionId;
        positionLoans[positionId] = loanId;

        if (liquidityPool != address(0)) {
            if (LiquidityPool(liquidityPool).ASSET() != asset) revert InvalidAsset();
            LiquidityPool(liquidityPool).borrow(principal, msg.sender);
        } else {
            asset.safeTransfer(msg.sender, principal);
        }
        emit LoanOpened(loanId, positionId, msg.sender, asset, principal);
    }

    function repay(uint256 loanId, uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        Loan storage loan = loans[loanId];
        if (loan.borrower == address(0)) revert LoanNotFound();
        if (loan.closed) revert LoanAlreadyClosed();

        _accrueInterest(loan);
        uint256 outstandingAmount = loan.principal + loan.accruedInterest;
        if (amount > outstandingAmount) revert InvalidAmount();

        loan.asset.safeTransferFrom(msg.sender, address(this), amount);

        uint256 remaining = amount;
        if (loan.accruedInterest > 0) {
            uint256 interestPaid = remaining > loan.accruedInterest ? loan.accruedInterest : remaining;
            loan.accruedInterest -= interestPaid;
            remaining -= interestPaid;
        }

        uint256 principalPaid = 0;
        if (remaining > 0) {
            principalPaid = remaining > loan.principal ? loan.principal : remaining;
            loan.principal -= principalPaid;
            remaining -= principalPaid;
            uint256 positionId = loanPositions[loanId];
            if (positionId != 0) {
                PositionManager(positionManager).decreaseDebt(positionId, principalPaid);
            }
        }

        if (liquidityPool != address(0)) {
            if (LiquidityPool(liquidityPool).ASSET() != loan.asset) revert InvalidAsset();
            loan.asset.safeApprove(liquidityPool, amount);
            LiquidityPool(liquidityPool).repay(principalPaid, amount);
        } else if (treasury != address(0)) {
            loan.asset.safeTransfer(treasury, amount);
        }

        emit LoanRepaid(loanId, msg.sender, amount);

        if (loan.principal == 0 && loan.accruedInterest == 0) {
            loan.closed = true;
            uint256 positionId = loanPositions[loanId];
            if (positionId != 0) {
                positionLoans[positionId] = 0;
                loanPositions[loanId] = 0;
            }
            emit LoanClosed(loanId, msg.sender);
        }
    }

    function closeLoan(uint256 loanId) external {
        Loan storage loan = loans[loanId];
        if (loan.borrower == address(0)) revert LoanNotFound();
        if (loan.closed) revert LoanAlreadyClosed();
        if (msg.sender != loan.borrower && !hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();

        _accrueInterest(loan);
        if (loan.principal != 0 || loan.accruedInterest != 0) revert OutstandingBalance();

        loan.closed = true;
        uint256 positionId = loanPositions[loanId];
        if (positionId != 0) {
            positionLoans[positionId] = 0;
            loanPositions[loanId] = 0;
        }
        emit LoanClosed(loanId, msg.sender);
    }

    function markLiquidated(uint256 loanId, address liquidator) external onlyRole(ADMIN_ROLE) {
        Loan storage loan = loans[loanId];
        if (loan.borrower == address(0)) revert LoanNotFound();
        if (loan.closed) return;

        loan.closed = true;
        loan.principal = 0;
        loan.accruedInterest = 0;

        uint256 positionId = loanPositions[loanId];
        if (positionId != 0) {
            positionLoans[positionId] = 0;
            loanPositions[loanId] = 0;
        }

        emit LoanLiquidated(loanId, liquidator);
    }

    function outstanding(uint256 loanId) external view returns (uint256) {
        Loan memory loan = loans[loanId];
        if (loan.borrower == address(0) || loan.closed) return 0;
        uint256 accruedInterest = loan.accruedInterest + _pendingInterest(loan);
        return loan.principal + accruedInterest;
    }

    function _valueOf(address asset, uint256 amount) internal view returns (uint256) {
        uint256 price = PriceOracle(priceOracle).getPrice(asset);
        if (price == 0) revert PriceUnavailable();
        return (amount * price) / 1e18;
    }

    function _validateOpenParams(
        address asset,
        address collateralAsset,
        uint256 principal,
        uint256 collateralAmount,
        uint256 dueAt
    ) internal view {
        if (asset == address(0) || collateralAsset == address(0)) revert InvalidAsset();
        if (principal == 0 || collateralAmount == 0) revert InvalidAmount();
        if (dueAt <= block.timestamp) revert InvalidDueDate();
    }

    function _requireEngines() internal view {
        if (policyEngine == address(0) || priceOracle == address(0) || positionManager == address(0)) revert EngineNotSet();
    }

    function _resolveInterestRate(address collateralAsset, uint256 interestBps) internal view returns (uint256) {
        (, , uint256 policyInterestRateBps, bool policyEnabled) = PolicyEngine(policyEngine).policies(collateralAsset);
        if (policyEnabled && policyInterestRateBps != 0) return policyInterestRateBps;
        return interestBps;
    }

    function _validateBorrow(address collateralAsset, address debtAsset, uint256 collateralAmount, uint256 principal) internal view {
        uint256 collateralValue = _valueOf(collateralAsset, collateralAmount);
        uint256 debtValue = _valueOf(debtAsset, principal);
        bool ok = PolicyEngine(policyEngine).validateBorrow(collateralAsset, collateralValue, debtValue);
        if (!ok) revert InvalidAmount();
    }

    function _pendingInterest(Loan memory loan) internal view returns (uint256) {
        uint256 end = block.timestamp < loan.dueAt ? block.timestamp : loan.dueAt;
        if (end <= loan.lastAccruedAt) return 0;
        uint256 elapsed = end - loan.lastAccruedAt;
        return (loan.principal * loan.interestBps * elapsed) / (10000 * 365 days);
    }

    function _accrueInterest(Loan storage loan) internal {
        uint256 end = block.timestamp < loan.dueAt ? block.timestamp : loan.dueAt;
        if (end <= loan.lastAccruedAt) return;
        uint256 elapsed = end - loan.lastAccruedAt;
        uint256 interest = (loan.principal * loan.interestBps * elapsed) / (10000 * 365 days);
        loan.accruedInterest += interest;
        loan.lastAccruedAt = end;
    }
}
