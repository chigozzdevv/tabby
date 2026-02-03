// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {RoleManager} from "../access/role-manager.sol";

contract PolicyEngine is RoleManager {
    error PolicyDisabled();

    struct Policy {
        uint256 maxLtvBps;
        uint256 liquidationThresholdBps;
        uint256 interestRateBps;
        bool enabled;
    }

    mapping(address => Policy) public policies;

    event PolicyUpdated(address indexed asset, uint256 maxLtvBps, uint256 liquidationThresholdBps, uint256 interestRateBps, bool enabled);

    constructor(address admin) RoleManager(admin) {}

    function setPolicy(address asset, Policy calldata policy) external onlyRole(ADMIN_ROLE) {
        policies[asset] = policy;
        emit PolicyUpdated(asset, policy.maxLtvBps, policy.liquidationThresholdBps, policy.interestRateBps, policy.enabled);
    }

    function validateBorrow(address asset, uint256 collateralValue, uint256 debtValue) external view returns (bool) {
        Policy memory policy = policies[asset];
        if (!policy.enabled) revert PolicyDisabled();
        if (collateralValue == 0) return false;
        return debtValue * 10000 <= collateralValue * policy.maxLtvBps;
    }
}
