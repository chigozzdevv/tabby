// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {LiquidityPool} from "../src/core/liquidity-pool.sol";
import {PoolShareRewards} from "../src/rewards/pool-share-rewards.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function envAddress(string calldata name) external returns (address);
    function envUint(string calldata name) external returns (uint256);
    function envOr(string calldata name, address defaultValue) external returns (address);
    function envOr(string calldata name, uint256 defaultValue) external returns (uint256);
    function envOr(string calldata name, bool defaultValue) external returns (bool);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployUsdcPool {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    error ValueTooLarge();

    event Deployed(address usdcPool, address usdcShareRewards);

    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);

        address governance = vm.envOr("GOVERNANCE", deployer);
        bool adminlessUsdcPool = vm.envOr("ADMINLESS_USDC_POOL", true);

        uint16 rewardsFeeBps = _asUint16(vm.envOr("POOL_REWARDS_FEE_BPS", uint256(200)));
        uint16 reserveFeeBps = _asUint16(vm.envOr("POOL_RESERVE_FEE_BPS", uint256(300)));
        address rewardsFeeRecipient = vm.envOr("POOL_REWARDS_FEE_RECIPIENT", governance);
        address reserveFeeRecipient = vm.envOr("POOL_RESERVE_FEE_RECIPIENT", governance);

        address tabbyToken = vm.envOr("TABBY_TOKEN", address(0));
        address usdcAsset = vm.envAddress("USDC_ASSET");

        vm.startBroadcast(deployerPk);

        LiquidityPool usdcPool = new LiquidityPool(deployer, usdcAsset);
        usdcPool.setFeeConfig(rewardsFeeBps, reserveFeeBps);
        usdcPool.setFeeRecipients(rewardsFeeRecipient, reserveFeeRecipient);

        PoolShareRewards usdcShareRewards = tabbyToken == address(0)
            ? PoolShareRewards(address(0))
            : new PoolShareRewards(deployer, address(usdcPool), tabbyToken);
        if (address(usdcShareRewards) != address(0)) {
            usdcPool.grantRole(usdcPool.STAKE_ROLE(), address(usdcShareRewards));
        }

        _handoffAdmin(address(usdcPool), deployer, governance, adminlessUsdcPool);
        if (address(usdcShareRewards) != address(0)) {
            _handoffAdmin(address(usdcShareRewards), deployer, governance, false);
        }

        vm.stopBroadcast();

        emit Deployed(address(usdcPool), address(usdcShareRewards));
    }

    function _handoffAdmin(address target, address deployer, address governance, bool revokeAllAdmins) internal {
        if (revokeAllAdmins) {
            if (governance != deployer) {
                RoleManagerLike(target).revokeRole(RoleManagerLike(target).ADMIN_ROLE(), governance);
            }
            RoleManagerLike(target).revokeRole(RoleManagerLike(target).ADMIN_ROLE(), deployer);
            return;
        }

        if (governance != address(0) && governance != deployer) {
            RoleManagerLike(target).grantRole(RoleManagerLike(target).ADMIN_ROLE(), governance);
            RoleManagerLike(target).revokeRole(RoleManagerLike(target).ADMIN_ROLE(), deployer);
        }
    }

    function _asUint16(uint256 value) internal pure returns (uint16 out) {
        if (value > type(uint16).max) revert ValueTooLarge();
        assembly {
            out := value
        }
    }
}

interface RoleManagerLike {
    function ADMIN_ROLE() external view returns (bytes32);
    function grantRole(bytes32 role, address account) external;
    function revokeRole(bytes32 role, address account) external;
}

