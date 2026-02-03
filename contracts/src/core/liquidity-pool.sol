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

    address public immutable ASSET;
    address public walletRegistry;

    bytes32 public constant BORROW_ROLE = keccak256("BORROW_ROLE");
    bytes32 public constant REPAY_ROLE = keccak256("REPAY_ROLE");
    bytes32 public constant RISK_ROLE = keccak256("RISK_ROLE");

    uint256 public totalShares;
    mapping(address => uint256) public balanceOf;

    /// @dev Book value of principal currently lent out.
    uint256 public totalOutstandingPrincipal;

    event Deposited(address indexed account, uint256 assets, uint256 shares);
    event Withdrawn(address indexed account, uint256 assets, uint256 shares);
    event Borrowed(address indexed to, uint256 assets);
    event Repaid(address indexed from, uint256 principalRepaid, uint256 amount);
    event WrittenOff(uint256 principalAmount);
    event WalletRegistryUpdated(address indexed registry);

    constructor(address admin, address asset_) RoleManager(admin) {
        if (asset_ == address(0)) revert InvalidAsset();
        ASSET = asset_;
    }

    function setWalletRegistry(address registry) external onlyRole(ADMIN_ROLE) {
        walletRegistry = registry;
        emit WalletRegistryUpdated(registry);
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
        if (shares == 0 || balanceOf[msg.sender] < shares) revert InvalidAmount();
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
}
