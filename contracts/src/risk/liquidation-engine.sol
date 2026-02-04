// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {RoleManager} from "../access/role-manager.sol";
import {SafeErc20} from "../libraries/safe-erc20.sol";
import {IPriceOracle} from "../oracle/i-price-oracle.sol";
import {PolicyEngine} from "../policy/policy-engine.sol";
import {RiskEngine} from "../risk/risk-engine.sol";
import {PositionManager} from "../core/position-manager.sol";
import {LoanManager} from "../core/loan-manager.sol";
import {LiquidityPool} from "../core/liquidity-pool.sol";
import {IERC20} from "../interfaces/i-erc20.sol";

contract LiquidationEngine is RoleManager {
    using SafeErc20 for address;

    error EngineNotSet();
    error PositionNotFound();
    error PositionHealthy();
    error PriceUnavailable();
    error InvalidDebtAsset();
    error NoDebt();
    error InvalidTreasury();

    address public positionManager;
    address public policyEngine;
    address public priceOracle;
    address public riskEngine;
    address public loanManager;
    address public treasury;

    event LiquidationExecuted(uint256 indexed positionId, address indexed liquidator, uint256 debtRepaid, uint256 collateralSeized);
    event EnginesUpdated(address indexed positionManager, address indexed policyEngine, address indexed priceOracle, address riskEngine, address loanManager, address treasury);

    constructor(address admin) RoleManager(admin) {}

    function setEngines(
        address positionManager_,
        address policyEngine_,
        address priceOracle_,
        address riskEngine_,
        address loanManager_,
        address treasury_
    ) external onlyRole(ADMIN_ROLE) {
        positionManager = positionManager_;
        policyEngine = policyEngine_;
        priceOracle = priceOracle_;
        riskEngine = riskEngine_;
        loanManager = loanManager_;
        treasury = treasury_;
        emit EnginesUpdated(positionManager_, policyEngine_, priceOracle_, riskEngine_, loanManager_, treasury_);
    }

    function liquidate(uint256 positionId) external {
        if (positionManager == address(0) || policyEngine == address(0) || priceOracle == address(0) || riskEngine == address(0)) {
            revert EngineNotSet();
        }
        if (treasury == address(0)) revert InvalidTreasury();

        (
            address owner,
            address collateralAsset,
            uint256 collateralAmount,
            address debtAsset,
            uint256 debt,
            bool liquidated
        ) = PositionManager(positionManager).positions(positionId);
        if (owner == address(0)) revert PositionNotFound();
        if (liquidated) revert PositionHealthy();
        if (debt == 0) revert NoDebt();
        if (debtAsset == address(0)) revert InvalidDebtAsset();

        uint256 loanId = 0;
        uint256 principalToRepay = debt;
        uint256 debtToRepay = debt;
        if (loanManager != address(0)) {
            loanId = LoanManager(loanManager).positionLoans(positionId);
            if (loanId != 0) {
                (, address loanAsset, uint256 principal, , , , , , , , bool closed) = LoanManager(loanManager).loans(loanId);
                if (loanAsset != address(0) && loanAsset != debtAsset) revert InvalidDebtAsset();
                if (!closed) {
                    uint256 outstanding = LoanManager(loanManager).outstanding(loanId);
                    if (outstanding > 0) {
                        debtToRepay = outstanding;
                        principalToRepay = principal;
                    }
                }
            }
        }
        if (principalToRepay > debtToRepay) principalToRepay = debtToRepay;

        uint256 collateralPrice = IPriceOracle(priceOracle).getPrice(collateralAsset);
        uint256 debtPrice = IPriceOracle(priceOracle).getPrice(debtAsset);
        if (collateralPrice == 0 || debtPrice == 0) revert PriceUnavailable();

        (, uint256 liquidationThresholdBps, , bool policyEnabled) = PolicyEngine(policyEngine).policies(collateralAsset);
        if (!policyEnabled) revert PositionHealthy();

        uint8 collateralDecimals = IERC20(collateralAsset).decimals();
        uint8 debtDecimals = IERC20(debtAsset).decimals();
        uint256 collateralValue = (collateralAmount * collateralPrice) / (10 ** collateralDecimals);
        uint256 debtValue = (debtToRepay * debtPrice) / (10 ** debtDecimals);
        bool healthy = RiskEngine(riskEngine).isHealthy(collateralValue, debtValue, liquidationThresholdBps);
        if (healthy) revert PositionHealthy();

        // Collect repayment from liquidator.
        debtAsset.safeTransferFrom(msg.sender, address(this), debtToRepay);

        if (treasury != address(0)) {
            try LiquidityPool(treasury).ASSET() returns (address poolAsset) {
                if (poolAsset == debtAsset) {
                    _ensureAllowance(debtAsset, treasury, debtToRepay);
                    LiquidityPool(treasury).repay(principalToRepay, debtToRepay);
                } else {
                    debtAsset.safeTransfer(treasury, debtToRepay);
                }
            } catch {
                debtAsset.safeTransfer(treasury, debtToRepay);
            }
        }
        PositionManager(positionManager).clearDebt(positionId);
        uint256 seized = PositionManager(positionManager).seizeCollateral(positionId, msg.sender);

        if (loanManager != address(0)) {
            if (loanId != 0) {
                LoanManager(loanManager).markLiquidated(loanId, msg.sender);
            }
        }

        emit LiquidationExecuted(positionId, msg.sender, debtToRepay, seized);
    }

    function _ensureAllowance(address asset, address spender, uint256 required) internal {
        uint256 current = IERC20(asset).allowance(address(this), spender);
        if (current >= required) return;

        if (current != 0) {
            asset.safeApprove(spender, 0);
        }
        asset.safeApprove(spender, type(uint256).max);
    }
}
