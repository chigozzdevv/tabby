// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {WalletRegistry} from "../src/access/wallet-registry.sol";
import {BorrowerPolicyRegistry} from "../src/policy/borrower-policy-registry.sol";
import {NativeLiquidityPool} from "../src/core/native-liquidity-pool.sol";
import {AgentLoanManager} from "../src/core/agent-loan-manager.sol";

import {LiquidityPool} from "../src/core/liquidity-pool.sol";
import {PolicyEngine} from "../src/policy/policy-engine.sol";
import {ChainlinkPriceOracle} from "../src/oracle/chainlink-price-oracle.sol";
import {PositionManager} from "../src/core/position-manager.sol";
import {LoanManager} from "../src/core/loan-manager.sol";
import {RiskEngine} from "../src/risk/risk-engine.sol";
import {LiquidationEngine} from "../src/risk/liquidation-engine.sol";

import {PoolShareRewards} from "../src/rewards/pool-share-rewards.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function envAddress(string calldata name) external returns (address);
    function envUint(string calldata name) external returns (uint256);
    function envBool(string calldata name) external returns (bool);
    function envOr(string calldata name, address defaultValue) external returns (address);
    function envOr(string calldata name, uint256 defaultValue) external returns (uint256);
    function envOr(string calldata name, bool defaultValue) external returns (bool);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployTabby {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    error MaxAgeTooLarge();

    event Deployed(
        address walletRegistry,
        address borrowerPolicyRegistry,
        address nativePool,
        address agentLoanManager,
        address nativeShareRewards,
        address securedPool,
        address securedShareRewards,
        address policyEngine,
        address priceOracle,
        address positionManager,
        address loanManager,
        address riskEngine,
        address liquidationEngine
    );

    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);

        address governance = vm.envOr("GOVERNANCE", deployer);
        address tabbySigner = vm.envAddress("TABBY_SIGNER");

        bool adminlessSecuredPool = vm.envOr("ADMINLESS_SECURED_POOL", true);
        bool adminlessNativePool = vm.envOr("ADMINLESS_NATIVE_POOL", true);
        bool useWalletRegistry = vm.envOr("USE_WALLET_REGISTRY", false);
        address riskCommittee = vm.envOr("RISK_COMMITTEE", governance);

        uint16 rewardsFeeBps = _asUint16(vm.envOr("POOL_REWARDS_FEE_BPS", uint256(200)));
        uint16 reserveFeeBps = _asUint16(vm.envOr("POOL_RESERVE_FEE_BPS", uint256(300)));
        address rewardsFeeRecipient = vm.envOr("POOL_REWARDS_FEE_RECIPIENT", governance);
        address reserveFeeRecipient = vm.envOr("POOL_RESERVE_FEE_RECIPIENT", governance);
        address tabbyToken = vm.envOr("TABBY_TOKEN", address(0));

        address wmon = _resolveWmon();

        vm.startBroadcast(deployerPk);

        WalletRegistry walletRegistry = new WalletRegistry(deployer);
        if (useWalletRegistry) {
            walletRegistry.setWalletStatus(deployer, true);
            if (governance != deployer) walletRegistry.setWalletStatus(governance, true);
            address initialAllowed = vm.envOr("INITIAL_ALLOWED_WALLET", address(0));
            if (initialAllowed != address(0)) walletRegistry.setWalletStatus(initialAllowed, true);
        }

        BorrowerPolicyRegistry borrowerPolicyRegistry = new BorrowerPolicyRegistry();
        NativeLiquidityPool nativePool = new NativeLiquidityPool(deployer);
        AgentLoanManager agentLoanManager = new AgentLoanManager(deployer, address(nativePool), address(borrowerPolicyRegistry), tabbySigner);
        nativePool.grantRole(nativePool.BORROW_ROLE(), address(agentLoanManager));
        nativePool.grantRole(nativePool.REPAY_ROLE(), address(agentLoanManager));
        nativePool.grantRole(nativePool.RISK_ROLE(), address(agentLoanManager));

        nativePool.setFeeConfig(rewardsFeeBps, reserveFeeBps);
        nativePool.setFeeRecipients(rewardsFeeRecipient, reserveFeeRecipient);

        PoolShareRewards nativeShareRewards = tabbyToken == address(0)
            ? PoolShareRewards(address(0))
            : new PoolShareRewards(deployer, address(nativePool), tabbyToken);
        if (address(nativeShareRewards) != address(0)) {
            nativePool.grantRole(nativePool.STAKE_ROLE(), address(nativeShareRewards));
        }

        LiquidityPool securedPool = new LiquidityPool(deployer, wmon);
        securedPool.setFeeConfig(rewardsFeeBps, reserveFeeBps);
        securedPool.setFeeRecipients(rewardsFeeRecipient, reserveFeeRecipient);

        PoolShareRewards securedShareRewards = tabbyToken == address(0)
            ? PoolShareRewards(address(0))
            : new PoolShareRewards(deployer, address(securedPool), tabbyToken);
        if (address(securedShareRewards) != address(0)) {
            securedPool.grantRole(securedPool.STAKE_ROLE(), address(securedShareRewards));
        }

        PolicyEngine policyEngine = new PolicyEngine(deployer);
        ChainlinkPriceOracle priceOracle = new ChainlinkPriceOracle(deployer);
        PositionManager positionManager = new PositionManager(deployer);
        if (useWalletRegistry) {
            securedPool.setWalletRegistry(address(walletRegistry));
            positionManager.setWalletRegistry(address(walletRegistry));
        }
        LoanManager loanManager = new LoanManager(deployer);
        RiskEngine riskEngine = new RiskEngine();
        LiquidationEngine liquidationEngine = new LiquidationEngine(deployer);

        positionManager.setEngines(address(policyEngine), address(priceOracle));
        positionManager.setLoanManager(address(loanManager));
        loanManager.setEngines(address(policyEngine), address(priceOracle), address(positionManager));
        loanManager.setLiquidityPool(address(securedPool));

        positionManager.grantRole(positionManager.ADMIN_ROLE(), address(loanManager));
        securedPool.grantRole(securedPool.BORROW_ROLE(), address(loanManager));
        securedPool.grantRole(securedPool.REPAY_ROLE(), address(loanManager));
        if (riskCommittee != address(0)) securedPool.grantRole(securedPool.RISK_ROLE(), riskCommittee);

        liquidationEngine.setEngines(
            address(positionManager),
            address(policyEngine),
            address(priceOracle),
            address(riskEngine),
            address(loanManager),
            address(securedPool)
        );
        positionManager.grantRole(positionManager.ADMIN_ROLE(), address(liquidationEngine));
        positionManager.grantRole(positionManager.LIQUIDATION_ROLE(), address(liquidationEngine));
        loanManager.grantRole(loanManager.ADMIN_ROLE(), address(liquidationEngine));
        securedPool.grantRole(securedPool.REPAY_ROLE(), address(liquidationEngine));

        _configureFeedsAndPolicies(address(priceOracle), wmon, address(policyEngine));

        _handoffAdmin(address(walletRegistry), deployer, governance, false);
        _handoffAdmin(address(nativePool), deployer, governance, adminlessNativePool);
        _handoffAdmin(address(securedPool), deployer, governance, adminlessSecuredPool);

        _handoffAdmin(address(agentLoanManager), deployer, governance, false);
        _handoffAdmin(address(policyEngine), deployer, governance, false);
        _handoffAdmin(address(priceOracle), deployer, governance, false);
        _handoffAdmin(address(positionManager), deployer, governance, false);
        _handoffAdmin(address(loanManager), deployer, governance, false);
        _handoffAdmin(address(liquidationEngine), deployer, governance, false);

        vm.stopBroadcast();

        emit Deployed(
            address(walletRegistry),
            address(borrowerPolicyRegistry),
            address(nativePool),
            address(agentLoanManager),
            address(nativeShareRewards),
            address(securedPool),
            address(securedShareRewards),
            address(policyEngine),
            address(priceOracle),
            address(positionManager),
            address(loanManager),
            address(riskEngine),
            address(liquidationEngine)
        );
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

    function _configureFeedsAndPolicies(address priceOracle, address debtAsset, address policyEngine) internal {
        address wmonFeed = vm.envOr("WMON_FEED", address(0));
        uint256 wmonMaxAge = vm.envOr("WMON_MAX_AGE", uint256(0));
        if (wmonFeed != address(0)) {
            ChainlinkPriceOracle(priceOracle).setFeed(debtAsset, wmonFeed, _asUint48(wmonMaxAge), true);
        }

        address collateralAsset = vm.envOr("COLLATERAL_ASSET", address(0));
        address collateralFeed = vm.envOr("COLLATERAL_FEED", address(0));
        if (collateralAsset != address(0) && collateralFeed != address(0)) {
            uint256 maxLtvBps = vm.envOr("COLLATERAL_MAX_LTV_BPS", uint256(8000));
            uint256 liqThresholdBps = vm.envOr("COLLATERAL_LIQ_THRESHOLD_BPS", uint256(8500));
            // Non-zero by default; set COLLATERAL_INTEREST_BPS=0 only if you explicitly want borrower-provided rates.
            uint256 interestRateBps = vm.envOr("COLLATERAL_INTEREST_BPS", uint256(200));
            uint256 maxAge = vm.envOr("COLLATERAL_MAX_AGE", uint256(0));

            PolicyEngine(policyEngine).setPolicy(
                collateralAsset,
                PolicyEngine.Policy({
                    maxLtvBps: maxLtvBps,
                    liquidationThresholdBps: liqThresholdBps,
                    interestRateBps: interestRateBps,
                    enabled: true
                })
            );
            ChainlinkPriceOracle(priceOracle).setFeed(collateralAsset, collateralFeed, _asUint48(maxAge), true);
        }
    }

    function _asUint48(uint256 value) internal pure returns (uint48 out) {
        if (value > type(uint48).max) revert MaxAgeTooLarge();
        assembly {
            out := value
        }
    }

    function _asUint16(uint256 value) internal pure returns (uint16 out) {
        if (value > type(uint16).max) revert MaxAgeTooLarge();
        assembly {
            out := value
        }
    }

    function _resolveWmon() internal returns (address) {
        if (block.chainid == 10143) return 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541;
        if (block.chainid == 143) return 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;
        return vm.envAddress("WMON");
    }
}

interface RoleManagerLike {
    function ADMIN_ROLE() external view returns (bytes32);
    function grantRole(bytes32 role, address account) external;
    function revokeRole(bytes32 role, address account) external;
}
