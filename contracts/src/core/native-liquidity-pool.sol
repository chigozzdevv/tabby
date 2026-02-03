// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {RoleManager} from "../access/role-manager.sol";

/// @notice Native (MON/ETH) liquidity pool with pro-rata shares and accounting for outstanding principal.
/// @dev totalAssets() includes current balance + totalOutstandingPrincipal to avoid share-price drops when lending.
contract NativeLiquidityPool is RoleManager {
    error InvalidAmount();
    error InvalidReceiver();
    error InsufficientLiquidity();
    error InvalidPrincipal();
    error InvalidFeeBps();
    error InvalidAccount();
    error InsufficientUnlockedShares();

    bytes32 public constant BORROW_ROLE = keccak256("BORROW_ROLE");
    bytes32 public constant REPAY_ROLE = keccak256("REPAY_ROLE");
    bytes32 public constant RISK_ROLE = keccak256("RISK_ROLE");
    bytes32 public constant STAKE_ROLE = keccak256("STAKE_ROLE");

    uint16 public constant MAX_PROTOCOL_FEE_BPS = 1000;

    uint16 public rewardsFeeBps;
    uint16 public reserveFeeBps;
    address public rewardsFeeRecipient;
    address public reserveFeeRecipient;

    uint256 public totalShares;
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public lockedShares;

    /// @dev Total principal currently lent out (book value).
    uint256 public totalOutstandingPrincipal;

    event Deposited(address indexed account, uint256 assets, uint256 shares);
    event Withdrawn(address indexed account, uint256 assets, uint256 shares);
    event Borrowed(address indexed to, uint256 assets);
    event Repaid(address indexed from, uint256 principalRepaid, uint256 amount);
    event WrittenOff(uint256 principalAmount);
    event FeeConfigUpdated(uint16 rewardsFeeBps, uint16 reserveFeeBps);
    event FeeRecipientsUpdated(address indexed rewardsRecipient, address indexed reserveRecipient);
    event SharesLocked(address indexed account, uint256 shares);
    event SharesUnlocked(address indexed account, uint256 shares);
    event FeeSharesMinted(uint256 interestAssets, uint256 feeAssets, uint256 feeShares, uint256 rewardsShares, uint256 reserveShares);

    constructor(address admin) RoleManager(admin) {}

    function setFeeConfig(uint16 rewardsFeeBps_, uint16 reserveFeeBps_) external onlyRole(ADMIN_ROLE) {
        if (uint256(rewardsFeeBps_) + uint256(reserveFeeBps_) > MAX_PROTOCOL_FEE_BPS) revert InvalidFeeBps();
        rewardsFeeBps = rewardsFeeBps_;
        reserveFeeBps = reserveFeeBps_;
        emit FeeConfigUpdated(rewardsFeeBps_, reserveFeeBps_);
    }

    function setFeeRecipients(address rewardsRecipient, address reserveRecipient) external onlyRole(ADMIN_ROLE) {
        rewardsFeeRecipient = rewardsRecipient;
        reserveFeeRecipient = reserveRecipient;
        emit FeeRecipientsUpdated(rewardsRecipient, reserveRecipient);
    }

    function lockShares(address account, uint256 shares) external onlyRole(STAKE_ROLE) {
        if (account == address(0)) revert InvalidAccount();
        if (shares == 0) revert InvalidAmount();
        uint256 available = balanceOf[account] - lockedShares[account];
        if (shares > available) revert InsufficientUnlockedShares();
        lockedShares[account] += shares;
        emit SharesLocked(account, shares);
    }

    function unlockShares(address account, uint256 shares) external onlyRole(STAKE_ROLE) {
        if (account == address(0)) revert InvalidAccount();
        if (shares == 0) revert InvalidAmount();
        uint256 locked = lockedShares[account];
        if (shares > locked) revert InsufficientUnlockedShares();
        lockedShares[account] = locked - shares;
        emit SharesUnlocked(account, shares);
    }

    function totalAssets() public view returns (uint256) {
        return address(this).balance + totalOutstandingPrincipal;
    }

    function previewDeposit(uint256 assets) external view returns (uint256 shares) {
        if (assets == 0) return 0;
        uint256 assetsBefore = totalAssets();
        if (totalShares == 0 || assetsBefore == 0) return assets;
        return (assets * totalShares) / assetsBefore;
    }

    function previewWithdraw(uint256 shares) external view returns (uint256 assets) {
        if (shares == 0 || totalShares == 0) return 0;
        return (shares * totalAssets()) / totalShares;
    }

    function deposit() external payable returns (uint256 shares) {
        if (msg.value == 0) revert InvalidAmount();

        uint256 assetsBefore = totalAssets() - msg.value;
        if (totalShares == 0 || assetsBefore == 0) {
            shares = msg.value;
        } else {
            shares = (msg.value * totalShares) / assetsBefore;
        }
        if (shares == 0) revert InvalidAmount();

        totalShares += shares;
        balanceOf[msg.sender] += shares;
        emit Deposited(msg.sender, msg.value, shares);
    }

    function withdraw(uint256 shares) external returns (uint256 assets) {
        uint256 available = balanceOf[msg.sender] - lockedShares[msg.sender];
        if (shares == 0 || shares > available) revert InvalidAmount();

        assets = (shares * totalAssets()) / totalShares;
        if (assets == 0) revert InvalidAmount();
        if (assets > address(this).balance) revert InsufficientLiquidity();

        balanceOf[msg.sender] -= shares;
        totalShares -= shares;

        (bool ok, ) = msg.sender.call{value: assets}("");
        if (!ok) revert InsufficientLiquidity();

        emit Withdrawn(msg.sender, assets, shares);
    }

    function borrow(uint256 amount, address to) external onlyRole(BORROW_ROLE) {
        if (amount == 0) revert InvalidAmount();
        if (to == address(0)) revert InvalidReceiver();
        if (amount > address(this).balance) revert InsufficientLiquidity();

        totalOutstandingPrincipal += amount;

        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert InsufficientLiquidity();

        emit Borrowed(to, amount);
    }

    function repay(uint256 principalRepaid) external payable onlyRole(REPAY_ROLE) {
        if (msg.value == 0) revert InvalidAmount();
        if (principalRepaid > msg.value) revert InvalidPrincipal();
        if (principalRepaid > totalOutstandingPrincipal) revert InvalidPrincipal();

        totalOutstandingPrincipal -= principalRepaid;
        _mintFeeShares(msg.value - principalRepaid);
        emit Repaid(msg.sender, principalRepaid, msg.value);
    }

    function writeOff(uint256 principalAmount) external onlyRole(RISK_ROLE) {
        if (principalAmount == 0 || principalAmount > totalOutstandingPrincipal) revert InvalidPrincipal();
        totalOutstandingPrincipal -= principalAmount;
        emit WrittenOff(principalAmount);
    }

    function _mintFeeShares(uint256 interestAssets) internal {
        if (interestAssets == 0 || totalShares == 0) return;

        address rewardsRecipient = rewardsFeeRecipient;
        address reserveRecipient = reserveFeeRecipient;

        uint256 rewardsBps = rewardsFeeBps;
        uint256 reserveBps = reserveFeeBps;

        if (rewardsRecipient == address(0)) {
            reserveBps += rewardsBps;
            rewardsBps = 0;
        }
        if (reserveRecipient == address(0)) {
            rewardsBps += reserveBps;
            reserveBps = 0;
        }

        uint256 totalBps = rewardsBps + reserveBps;
        if (totalBps == 0) return;

        uint256 feeAssets = (interestAssets * totalBps) / 10000;
        if (feeAssets == 0) return;

        uint256 assets = totalAssets();
        if (assets <= feeAssets) return;

        uint256 sharesBefore = totalShares;
        uint256 feeShares = (feeAssets * sharesBefore) / (assets - feeAssets);
        if (feeShares == 0) return;

        totalShares = sharesBefore + feeShares;

        uint256 rewardsShares = 0;
        if (rewardsBps > 0) {
            rewardsShares = (feeShares * rewardsBps) / totalBps;
            balanceOf[rewardsRecipient] += rewardsShares;
        }
        uint256 reserveShares = feeShares - rewardsShares;
        if (reserveShares > 0) {
            balanceOf[reserveRecipient] += reserveShares;
        }

        emit FeeSharesMinted(interestAssets, feeAssets, feeShares, rewardsShares, reserveShares);
    }

    receive() external payable {}
}
