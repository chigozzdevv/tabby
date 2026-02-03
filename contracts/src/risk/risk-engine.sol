// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

contract RiskEngine {
    function healthFactor(uint256 collateralValue, uint256 debtValue, uint256 liquidationThresholdBps) public pure returns (uint256) {
        if (debtValue == 0) return type(uint256).max;
        return (collateralValue * liquidationThresholdBps * 1e18) / (debtValue * 10000);
    }

    function isHealthy(uint256 collateralValue, uint256 debtValue, uint256 liquidationThresholdBps) external pure returns (bool) {
        return healthFactor(collateralValue, debtValue, liquidationThresholdBps) >= 1e18;
    }
}
