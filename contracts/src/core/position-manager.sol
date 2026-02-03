// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {RoleManager} from "../access/role-manager.sol";
import {WalletRegistry} from "../access/wallet-registry.sol";
import {SafeErc20} from "../libraries/safe-erc20.sol";
import {PriceOracle} from "../oracle/price-oracle.sol";
import {PolicyEngine} from "../policy/policy-engine.sol";

contract PositionManager is RoleManager {
    using SafeErc20 for address;

    error InvalidAmount();
    error InvalidAsset();
    error PositionNotFound();
    error PositionAlreadyLiquidated();
    error DebtAssetMismatch();
    error EnginesNotSet();
    error PriceUnavailable();
    error CollateralTooLow();
    error WalletNotAllowed();

    struct Position {
        address owner;
        address collateralAsset;
        uint256 collateralAmount;
        address debtAsset;
        uint256 debt;
        bool liquidated;
    }

    uint256 public nextPositionId;
    mapping(uint256 => Position) public positions;

    address public walletRegistry;
    address public policyEngine;
    address public priceOracle;

    event PositionOpened(uint256 indexed positionId, address indexed owner, address indexed collateralAsset, uint256 amount);
    event CollateralAdded(uint256 indexed positionId, uint256 amount);
    event CollateralRemoved(uint256 indexed positionId, uint256 amount);
    event PositionLiquidated(uint256 indexed positionId, address indexed liquidator, uint256 collateralAmount);
    event DebtUpdated(uint256 indexed positionId, address indexed debtAsset, uint256 debt);
    event EnginesUpdated(address indexed policyEngine, address indexed priceOracle);
    event WalletRegistryUpdated(address indexed registry);

    constructor(address admin) RoleManager(admin) {
        nextPositionId = 1;
    }

    function setEngines(address policyEngine_, address priceOracle_) external onlyRole(ADMIN_ROLE) {
        policyEngine = policyEngine_;
        priceOracle = priceOracle_;
        emit EnginesUpdated(policyEngine_, priceOracle_);
    }

    function setWalletRegistry(address registry) external onlyRole(ADMIN_ROLE) {
        walletRegistry = registry;
        emit WalletRegistryUpdated(registry);
    }

    function openPosition(address collateralAsset, uint256 collateralAmount) external returns (uint256 positionId) {
        _checkWallet(msg.sender);
        if (collateralAsset == address(0)) revert InvalidAsset();
        if (collateralAmount == 0) revert InvalidAmount();

        positionId = nextPositionId++;
        positions[positionId] = Position({
            owner: msg.sender,
            collateralAsset: collateralAsset,
            collateralAmount: collateralAmount,
            debtAsset: address(0),
            debt: 0,
            liquidated: false
        });

        collateralAsset.safeTransferFrom(msg.sender, address(this), collateralAmount);
        emit PositionOpened(positionId, msg.sender, collateralAsset, collateralAmount);
    }

    function openPositionFor(address owner, address collateralAsset, uint256 collateralAmount) external onlyRole(ADMIN_ROLE) returns (uint256 positionId) {
        _checkWallet(owner);
        if (owner == address(0)) revert InvalidAsset();
        if (collateralAsset == address(0)) revert InvalidAsset();
        if (collateralAmount == 0) revert InvalidAmount();

        positionId = nextPositionId++;
        positions[positionId] = Position({
            owner: owner,
            collateralAsset: collateralAsset,
            collateralAmount: collateralAmount,
            debtAsset: address(0),
            debt: 0,
            liquidated: false
        });

        collateralAsset.safeTransferFrom(owner, address(this), collateralAmount);
        emit PositionOpened(positionId, owner, collateralAsset, collateralAmount);
    }

    function addCollateral(uint256 positionId, uint256 amount) external {
        _checkWallet(msg.sender);
        if (amount == 0) revert InvalidAmount();
        Position storage position = positions[positionId];
        if (position.owner == address(0)) revert PositionNotFound();
        if (position.liquidated) revert PositionAlreadyLiquidated();
        if (position.owner != msg.sender) revert Unauthorized();

        position.collateralAmount += amount;
        position.collateralAsset.safeTransferFrom(msg.sender, address(this), amount);
        emit CollateralAdded(positionId, amount);
    }

    function removeCollateral(uint256 positionId, uint256 amount) external {
        _checkWallet(msg.sender);
        if (amount == 0) revert InvalidAmount();
        Position storage position = positions[positionId];
        if (position.owner == address(0)) revert PositionNotFound();
        if (position.liquidated) revert PositionAlreadyLiquidated();
        if (position.owner != msg.sender) revert Unauthorized();
        if (amount > position.collateralAmount) revert InvalidAmount();

        uint256 newCollateralAmount = position.collateralAmount - amount;
        if (position.debt > 0) {
            _ensureHealthy(position, newCollateralAmount);
        }

        position.collateralAmount = newCollateralAmount;
        position.collateralAsset.safeTransfer(msg.sender, amount);
        emit CollateralRemoved(positionId, amount);
    }

    function increaseDebt(uint256 positionId, address debtAsset, uint256 amount) external onlyRole(ADMIN_ROLE) {
        if (amount == 0) revert InvalidAmount();
        Position storage position = positions[positionId];
        if (position.owner == address(0)) revert PositionNotFound();
        if (position.liquidated) revert PositionAlreadyLiquidated();
        if (position.debtAsset == address(0)) {
            position.debtAsset = debtAsset;
        } else if (position.debtAsset != debtAsset) {
            revert DebtAssetMismatch();
        }
        position.debt += amount;
        emit DebtUpdated(positionId, position.debtAsset, position.debt);
    }

    function decreaseDebt(uint256 positionId, uint256 amount) external onlyRole(ADMIN_ROLE) {
        if (amount == 0) revert InvalidAmount();
        Position storage position = positions[positionId];
        if (position.owner == address(0)) revert PositionNotFound();
        if (position.debt < amount) revert InvalidAmount();
        position.debt -= amount;
        if (position.debt == 0) {
            position.debtAsset = address(0);
        }
        emit DebtUpdated(positionId, position.debtAsset, position.debt);
    }

    function clearDebt(uint256 positionId) external onlyRole(ADMIN_ROLE) {
        Position storage position = positions[positionId];
        if (position.owner == address(0)) revert PositionNotFound();
        position.debt = 0;
        position.debtAsset = address(0);
        emit DebtUpdated(positionId, position.debtAsset, position.debt);
    }

    function seizeCollateral(uint256 positionId, address to) public onlyRole(ADMIN_ROLE) returns (uint256 amount) {
        Position storage position = positions[positionId];
        if (position.owner == address(0)) revert PositionNotFound();
        if (position.liquidated) revert PositionAlreadyLiquidated();

        amount = position.collateralAmount;
        position.collateralAmount = 0;
        position.liquidated = true;
        position.debt = 0;
        position.debtAsset = address(0);

        position.collateralAsset.safeTransfer(to, amount);
        emit PositionLiquidated(positionId, to, amount);
    }

    function liquidate(uint256 positionId) external onlyRole(ADMIN_ROLE) {
        seizeCollateral(positionId, msg.sender);
    }

    function _ensureHealthy(Position storage position, uint256 collateralAmount) internal view {
        if (policyEngine == address(0) || priceOracle == address(0)) revert EnginesNotSet();
        uint256 collateralPrice = PriceOracle(priceOracle).getPrice(position.collateralAsset);
        uint256 debtPrice = PriceOracle(priceOracle).getPrice(position.debtAsset);
        if (collateralPrice == 0 || debtPrice == 0) revert PriceUnavailable();

        uint256 collateralValue = (collateralAmount * collateralPrice) / 1e18;
        uint256 debtValue = (position.debt * debtPrice) / 1e18;
        bool ok = PolicyEngine(policyEngine).validateBorrow(position.collateralAsset, collateralValue, debtValue);
        if (!ok) revert CollateralTooLow();
    }

    function _checkWallet(address account) internal view {
        if (walletRegistry != address(0)) {
            if (!WalletRegistry(walletRegistry).isWalletAllowed(account)) revert WalletNotAllowed();
        }
    }
}
