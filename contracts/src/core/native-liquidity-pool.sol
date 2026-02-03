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

    bytes32 public constant BORROW_ROLE = keccak256("BORROW_ROLE");
    bytes32 public constant REPAY_ROLE = keccak256("REPAY_ROLE");
    bytes32 public constant RISK_ROLE = keccak256("RISK_ROLE");

    uint256 public totalShares;
    mapping(address => uint256) public balanceOf;

    /// @dev Total principal currently lent out (book value).
    uint256 public totalOutstandingPrincipal;

    event Deposited(address indexed account, uint256 assets, uint256 shares);
    event Withdrawn(address indexed account, uint256 assets, uint256 shares);
    event Borrowed(address indexed to, uint256 assets);
    event Repaid(address indexed from, uint256 principalRepaid, uint256 amount);
    event WrittenOff(uint256 principalAmount);

    constructor(address admin) RoleManager(admin) {}

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
        if (shares == 0 || balanceOf[msg.sender] < shares) revert InvalidAmount();

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
        emit Repaid(msg.sender, principalRepaid, msg.value);
    }

    function writeOff(uint256 principalAmount) external onlyRole(RISK_ROLE) {
        if (principalAmount == 0 || principalAmount > totalOutstandingPrincipal) revert InvalidPrincipal();
        totalOutstandingPrincipal -= principalAmount;
        emit WrittenOff(principalAmount);
    }

    receive() external payable {}
}
