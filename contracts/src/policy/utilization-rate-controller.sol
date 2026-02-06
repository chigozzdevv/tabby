// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {RoleManager} from "../access/role-manager.sol";
import {PolicyEngine} from "./policy-engine.sol";

interface UtilizationPoolLike {
    function totalAssets() external view returns (uint256);
    function totalOutstandingPrincipal() external view returns (uint256);
}

/// @notice Updates PolicyEngine `interestRateBps` based on secured-pool utilization.
/// @dev Must have `ADMIN_ROLE` on the PolicyEngine.
contract UtilizationRateController is RoleManager {
    error InvalidAddress();
    error InvalidParams();
    error PolicyNotEnabled();

    event ParamsUpdated(
        uint256 baseRateBps,
        uint256 kinkUtilizationBps,
        uint256 slope1Bps,
        uint256 slope2Bps,
        uint256 minRateBps,
        uint256 maxRateBps
    );

    event PolicyRateUpdated(
        address indexed collateralAsset,
        uint256 utilizationBps,
        uint256 oldRateBps,
        uint256 newRateBps
    );

    PolicyEngine public immutable policyEngine;
    UtilizationPoolLike public immutable pool;

    // APR params (bps).
    uint256 public baseRateBps;
    uint256 public kinkUtilizationBps;
    uint256 public slope1Bps;
    uint256 public slope2Bps;
    uint256 public minRateBps;
    uint256 public maxRateBps;

    constructor(address admin, address policyEngine_, address pool_) RoleManager(admin) {
        if (policyEngine_ == address(0) || pool_ == address(0)) revert InvalidAddress();
        policyEngine = PolicyEngine(policyEngine_);
        pool = UtilizationPoolLike(pool_);

        _setParams(200, 8000, 800, 2000, 50, 5000);
    }

    function setParams(
        uint256 baseRateBps_,
        uint256 kinkUtilizationBps_,
        uint256 slope1Bps_,
        uint256 slope2Bps_,
        uint256 minRateBps_,
        uint256 maxRateBps_
    ) external onlyRole(ADMIN_ROLE) {
        _setParams(baseRateBps_, kinkUtilizationBps_, slope1Bps_, slope2Bps_, minRateBps_, maxRateBps_);
    }

    function utilizationBps() public view returns (uint256) {
        uint256 assets = pool.totalAssets();
        if (assets == 0) return 0;
        uint256 outstanding = pool.totalOutstandingPrincipal();
        if (outstanding >= assets) return 10000;
        return (outstanding * 10000) / assets;
    }

    function computeRateBps(uint256 utilBps) public view returns (uint256 rateBps) {
        if (utilBps > 10000) utilBps = 10000;

        uint256 kink = kinkUtilizationBps;
        if (kink == 0 || kink > 10000) revert InvalidParams();

        rateBps = baseRateBps;

        if (utilBps <= kink) {
            rateBps += (slope1Bps * utilBps) / kink;
        } else {
            rateBps += slope1Bps;
            uint256 over = utilBps - kink;
            uint256 denom = 10000 - kink;
            if (denom > 0) rateBps += (slope2Bps * over) / denom;
        }

        uint256 minRate = minRateBps;
        if (minRate != 0 && rateBps < minRate) rateBps = minRate;
        uint256 maxRate = maxRateBps;
        if (maxRate != 0 && rateBps > maxRate) rateBps = maxRate;
    }

    /// @notice Updates the given collateral policy's `interestRateBps`.
    function updatePolicyRate(address collateralAsset) external returns (uint256 newRateBps) {
        (uint256 maxLtvBps, uint256 liqThresholdBps, uint256 oldRateBps, bool enabled) = policyEngine.policies(
            collateralAsset
        );
        if (!enabled) revert PolicyNotEnabled();

        uint256 utilBps = utilizationBps();
        newRateBps = computeRateBps(utilBps);

        if (newRateBps == oldRateBps) return newRateBps;

        policyEngine.setPolicy(
            collateralAsset,
            PolicyEngine.Policy({
                maxLtvBps: maxLtvBps,
                liquidationThresholdBps: liqThresholdBps,
                interestRateBps: newRateBps,
                enabled: enabled
            })
        );

        emit PolicyRateUpdated(collateralAsset, utilBps, oldRateBps, newRateBps);
    }

    function _setParams(
        uint256 baseRateBps_,
        uint256 kinkUtilizationBps_,
        uint256 slope1Bps_,
        uint256 slope2Bps_,
        uint256 minRateBps_,
        uint256 maxRateBps_
    ) internal {
        if (kinkUtilizationBps_ == 0 || kinkUtilizationBps_ > 10000) revert InvalidParams();
        if (maxRateBps_ != 0 && minRateBps_ != 0 && maxRateBps_ < minRateBps_) revert InvalidParams();

        baseRateBps = baseRateBps_;
        kinkUtilizationBps = kinkUtilizationBps_;
        slope1Bps = slope1Bps_;
        slope2Bps = slope2Bps_;
        minRateBps = minRateBps_;
        maxRateBps = maxRateBps_;

        emit ParamsUpdated(baseRateBps_, kinkUtilizationBps_, slope1Bps_, slope2Bps_, minRateBps_, maxRateBps_);
    }
}
