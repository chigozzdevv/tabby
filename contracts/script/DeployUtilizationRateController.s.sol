// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {PolicyEngine} from "../src/policy/policy-engine.sol";
import {UtilizationRateController} from "../src/policy/utilization-rate-controller.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function envAddress(string calldata name) external returns (address);
    function envUint(string calldata name) external returns (uint256);
    function envOr(string calldata name, address defaultValue) external returns (address);
    function envOr(string calldata name, uint256 defaultValue) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys a utilization-based interest controller and grants it PolicyEngine ADMIN_ROLE.
/// @dev Required env: PRIVATE_KEY, POLICY_ENGINE, SECURED_POOL.
contract DeployUtilizationRateController {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    event Deployed(address controller);

    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);

        address governance = vm.envOr("GOVERNANCE", deployer);
        address policyEngine = vm.envAddress("POLICY_ENGINE");
        address securedPool = vm.envAddress("SECURED_POOL");

        uint256 baseBps = vm.envOr("RATE_BASE_BPS", uint256(200));
        uint256 kinkUtilBps = vm.envOr("RATE_KINK_UTIL_BPS", uint256(8000));
        uint256 slope1Bps = vm.envOr("RATE_SLOPE1_BPS", uint256(800));
        uint256 slope2Bps = vm.envOr("RATE_SLOPE2_BPS", uint256(2000));
        uint256 minBps = vm.envOr("RATE_MIN_BPS", uint256(50));
        uint256 maxBps = vm.envOr("RATE_MAX_BPS", uint256(5000));

        address collateralAsset = vm.envOr("COLLATERAL_ASSET", address(0));

        vm.startBroadcast(deployerPk);

        // Deploy as `deployer` so this script can configure params in the same tx batch.
        UtilizationRateController controller = new UtilizationRateController(deployer, policyEngine, securedPool);
        controller.setParams(baseBps, kinkUtilBps, slope1Bps, slope2Bps, minBps, maxBps);

        // Allow the controller to update PolicyEngine policy interest rates.
        PolicyEngine(policyEngine).grantRole(PolicyEngine(policyEngine).ADMIN_ROLE(), address(controller));

        if (governance != deployer) {
            bytes32 adminRole = controller.ADMIN_ROLE();
            controller.grantRole(adminRole, governance);
            controller.revokeRole(adminRole, deployer);
        }

        if (collateralAsset != address(0)) {
            controller.updatePolicyRate(collateralAsset);
        }

        vm.stopBroadcast();

        emit Deployed(address(controller));
    }
}
