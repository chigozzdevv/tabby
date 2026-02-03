// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {RoleManager} from "../access/role-manager.sol";
import {WalletRegistry} from "../access/wallet-registry.sol";
import {IERC20} from "../interfaces/i-erc20.sol";
import {SafeErc20} from "../libraries/safe-erc20.sol";

contract LiquidityPool is RoleManager {
    using SafeErc20 for address;

    error InvalidAmount();
    error WalletNotAllowed();
    error InvalidAsset();
    error InvalidReceiver();
    error InsufficientLiquidity();
    error InvalidPrincipal();
    error InvalidFeeBps();
    error InvalidAccount();
    error InsufficientUnlockedShares();

    address public immutable ASSET;
    address public walletRegistry;

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

    /// @dev Book value of principal currently lent out.
    uint256 public totalOutstandingPrincipal;

    event Deposited(address indexed account, uint256 assets, uint256 shares);
    event Withdrawn(address indexed account, uint256 assets, uint256 shares);
    event Borrowed(address indexed to, uint256 assets);
    event Repaid(address indexed from, uint256 principalRepaid, uint256 amount);
    event WrittenOff(uint256 principalAmount);
    event WalletRegistryUpdated(address indexed registry);
    event FeeConfigUpdated(uint16 rewardsFeeBps, uint16 reserveFeeBps);
    event FeeRecipientsUpdated(address indexed rewardsRecipient, address indexed reserveRecipient);
    event SharesLocked(address indexed account, uint256 shares);
    event SharesUnlocked(address indexed account, uint256 shares);
    event FeeSharesMinted(uint256 interestAssets, uint256 feeAssets, uint256 feeShares, uint256 rewardsShares, uint256 reserveShares);

    constructor(address admin, address asset_) RoleManager(admin) {
        if (asset_ == address(0)) revert InvalidAsset();
        ASSET = asset_;
    }

    function setWalletRegistry(address registry) external onlyRole(ADMIN_ROLE) {
        walletRegistry = registry;
        emit WalletRegistryUpdated(registry);
    }

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
        return IERC20(ASSET).balanceOf(address(this)) + totalOutstandingPrincipal;
    }

    function deposit(uint256 amount) external returns (uint256 shares) {
        _checkWallet(msg.sender);
        if (amount == 0) revert InvalidAmount();
        uint256 assetsBefore = totalAssets();
        if (totalShares == 0 || assetsBefore == 0) {
            shares = amount;
        } else {
            shares = (amount * totalShares) / assetsBefore;
        }
        if (shares == 0) revert InvalidAmount();
        totalShares += shares;
        balanceOf[msg.sender] += shares;
        ASSET.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount, shares);
    }

    function withdraw(uint256 shares) external returns (uint256 assets) {
        uint256 available = balanceOf[msg.sender] - lockedShares[msg.sender];
        if (shares == 0 || shares > available) revert InvalidAmount();
        assets = (shares * totalAssets()) / totalShares;
        if (assets == 0) revert InvalidAmount();
        if (assets > IERC20(ASSET).balanceOf(address(this))) revert InsufficientLiquidity();
        balanceOf[msg.sender] -= shares;
        totalShares -= shares;
        ASSET.safeTransfer(msg.sender, assets);
        emit Withdrawn(msg.sender, assets, shares);
    }

    function borrow(uint256 amount, address to) external onlyRole(BORROW_ROLE) {
        if (amount == 0) revert InvalidAmount();
        if (to == address(0)) revert InvalidReceiver();
        if (amount > IERC20(ASSET).balanceOf(address(this))) revert InsufficientLiquidity();

        totalOutstandingPrincipal += amount;
        ASSET.safeTransfer(to, amount);
        emit Borrowed(to, amount);
    }

    function repay(uint256 principalRepaid, uint256 amount) external onlyRole(REPAY_ROLE) {
        if (amount == 0) revert InvalidAmount();
        if (principalRepaid > amount) revert InvalidPrincipal();
        if (principalRepaid > totalOutstandingPrincipal) revert InvalidPrincipal();

        ASSET.safeTransferFrom(msg.sender, address(this), amount);
        totalOutstandingPrincipal -= principalRepaid;
        _mintFeeShares(amount - principalRepaid);
        emit Repaid(msg.sender, principalRepaid, amount);
    }

    function writeOff(uint256 principalAmount) external onlyRole(RISK_ROLE) {
        if (principalAmount == 0 || principalAmount > totalOutstandingPrincipal) revert InvalidPrincipal();
        totalOutstandingPrincipal -= principalAmount;
        emit WrittenOff(principalAmount);
    }

    function _checkWallet(address account) internal view {
        if (walletRegistry != address(0)) {
            if (!WalletRegistry(walletRegistry).isWalletAllowed(account)) revert WalletNotAllowed();
        }
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
}
