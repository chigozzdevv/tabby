// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {AgentLoanManager} from "../src/core/agent-loan-manager.sol";
import {NativeLiquidityPool} from "../src/core/native-liquidity-pool.sol";
import {BorrowerPolicyRegistry} from "../src/policy/borrower-policy-registry.sol";

import {LiquidityPool} from "../src/core/liquidity-pool.sol";
import {LoanManager} from "../src/core/loan-manager.sol";
import {PositionManager} from "../src/core/position-manager.sol";
import {PolicyEngine} from "../src/policy/policy-engine.sol";
import {ChainlinkPriceOracle} from "../src/oracle/chainlink-price-oracle.sol";
import {RoleManager} from "../src/access/role-manager.sol";
import {RiskEngine} from "../src/risk/risk-engine.sol";
import {LiquidationEngine} from "../src/risk/liquidation-engine.sol";
import {PoolShareRewards} from "../src/rewards/pool-share-rewards.sol";

import {MockERC20} from "./mocks/MockERC20.sol";
import {MockChainlinkAggregatorV3} from "./mocks/MockChainlinkAggregatorV3.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function deal(address who, uint256 newBalance) external;
    function prank(address msgSender) external;
    function startPrank(address msgSender) external;
    function stopPrank() external;
    function warp(uint256 newTimestamp) external;
    function expectRevert(bytes4 selector) external;
}

abstract contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertEq(uint256 a, uint256 b, string memory message) internal pure {
        require(a == b, message);
    }

    function assertEq(uint256 a, uint256 b) internal pure {
        require(a == b, "assertEq");
    }

    function assertTrue(bool ok, string memory message) internal pure {
        require(ok, message);
    }
}

contract TabbyAgentLoansTest is TestBase {
    function test_agentGasLoans_executeRepay_andNonceReplayProtection() external {
        uint256 tabbyPk = 0xA11CE;
        uint256 borrowerPk = 0xB0B0;
        uint256 ownerPk = 0x0B0B;

        address tabbySigner = vm.addr(tabbyPk);
        address borrower = vm.addr(borrowerPk);
        address owner = vm.addr(ownerPk);

        BorrowerPolicyRegistry registry = new BorrowerPolicyRegistry();
        NativeLiquidityPool pool = new NativeLiquidityPool(address(this));

        AgentLoanManager loanManager = new AgentLoanManager(address(this), address(pool), address(registry), tabbySigner);
        pool.grantRole(pool.BORROW_ROLE(), address(loanManager));
        pool.grantRole(pool.REPAY_ROLE(), address(loanManager));
        pool.grantRole(pool.RISK_ROLE(), address(loanManager));

        uint256 allowedActions = uint256(1) << 1;
        vm.prank(owner);
        registry.registerBorrower(borrower, 2 ether, 20000, 400 days, allowedActions);

        address lp = address(0x1111);
        vm.deal(lp, 100 ether);
        vm.prank(lp);
        pool.deposit{value: 100 ether}();
        assertEq(pool.totalShares(), 100 ether, "shares minted");

        AgentLoanManager.LoanOffer memory offer = AgentLoanManager.LoanOffer({
            borrower: borrower,
            principal: 1 ether,
            interestBps: 10000,
            dueAt: block.timestamp + 365 days,
            nonce: 1,
            issuedAt: block.timestamp,
            expiresAt: block.timestamp + 1 hours,
            action: 1,
            metadataHash: keccak256("deploy")
        });

        bytes32 digest = loanManager.offerDigest(offer);
        (uint8 vTabby, bytes32 rTabby, bytes32 sTabby) = vm.sign(tabbyPk, digest);
        (uint8 vBorrower, bytes32 rBorrower, bytes32 sBorrower) = vm.sign(borrowerPk, digest);
        bytes memory tabbySig = abi.encodePacked(rTabby, sTabby, vTabby);
        bytes memory borrowerSig = abi.encodePacked(rBorrower, sBorrower, vBorrower);

        vm.deal(borrower, 0);
        uint256 loanId = loanManager.executeLoan(offer, tabbySig, borrowerSig);
        assertEq(loanId, 1, "loan id");
        assertEq(borrower.balance, 1 ether, "borrower received principal");
        assertEq(pool.totalOutstandingPrincipal(), 1 ether, "pool outstanding principal");

        vm.expectRevert(AgentLoanManager.NonceAlreadyUsed.selector);
        loanManager.executeLoan(offer, tabbySig, borrowerSig);

        vm.warp(block.timestamp + 365 days);
        vm.deal(borrower, 2 ether);
        vm.prank(borrower);
        loanManager.repay{value: 2 ether}(loanId);
        assertEq(pool.totalOutstandingPrincipal(), 0, "outstanding cleared");
        assertEq(pool.totalAssets(), 101 ether, "pool earned interest");
    }

    function test_agentGasLoans_policyViolation_reverts() external {
        uint256 tabbyPk = 0xA11CE;
        uint256 borrowerPk = 0xB0B0;
        uint256 ownerPk = 0x0B0B;

        address tabbySigner = vm.addr(tabbyPk);
        address borrower = vm.addr(borrowerPk);
        address owner = vm.addr(ownerPk);

        BorrowerPolicyRegistry registry = new BorrowerPolicyRegistry();
        NativeLiquidityPool pool = new NativeLiquidityPool(address(this));
        AgentLoanManager loanManager = new AgentLoanManager(address(this), address(pool), address(registry), tabbySigner);
        pool.grantRole(pool.BORROW_ROLE(), address(loanManager));
        pool.grantRole(pool.REPAY_ROLE(), address(loanManager));
        pool.grantRole(pool.RISK_ROLE(), address(loanManager));

        vm.prank(owner);
        registry.registerBorrower(borrower, 1 ether, 10000, 30 days, 0);

        address lp = address(0x2222);
        vm.deal(lp, 10 ether);
        vm.prank(lp);
        pool.deposit{value: 10 ether}();

        AgentLoanManager.LoanOffer memory offer = AgentLoanManager.LoanOffer({
            borrower: borrower,
            principal: 1 ether,
            interestBps: 10000,
            dueAt: block.timestamp + 1 days,
            nonce: 1,
            issuedAt: block.timestamp,
            expiresAt: block.timestamp + 1 hours,
            action: 1,
            metadataHash: bytes32(0)
        });

        bytes32 digest = loanManager.offerDigest(offer);
        (uint8 vTabby, bytes32 rTabby, bytes32 sTabby) = vm.sign(tabbyPk, digest);
        (uint8 vBorrower, bytes32 rBorrower, bytes32 sBorrower) = vm.sign(borrowerPk, digest);
        bytes memory tabbySig = abi.encodePacked(rTabby, sTabby, vTabby);
        bytes memory borrowerSig = abi.encodePacked(rBorrower, sBorrower, vBorrower);

        vm.prank(owner);
        registry.setPolicy(borrower, 1 ether, 10000, 30 days, uint256(1) << 0, true);

        vm.expectRevert(AgentLoanManager.PolicyViolation.selector);
        loanManager.executeLoan(offer, tabbySig, borrowerSig);
    }

    function test_agentGasLoans_markDefault_writesOffPrincipal() external {
        uint256 tabbyPk = 0xA11CE;
        uint256 borrowerPk = 0xB0B0;
        uint256 ownerPk = 0x0B0B;

        address tabbySigner = vm.addr(tabbyPk);
        address borrower = vm.addr(borrowerPk);
        address owner = vm.addr(ownerPk);

        BorrowerPolicyRegistry registry = new BorrowerPolicyRegistry();
        NativeLiquidityPool pool = new NativeLiquidityPool(address(this));
        AgentLoanManager loanManager = new AgentLoanManager(address(this), address(pool), address(registry), tabbySigner);
        pool.grantRole(pool.BORROW_ROLE(), address(loanManager));
        pool.grantRole(pool.REPAY_ROLE(), address(loanManager));
        pool.grantRole(pool.RISK_ROLE(), address(loanManager));

        vm.prank(owner);
        registry.registerBorrower(borrower, 1 ether, 10000, 30 days, uint256(1) << 1);

        address lp = address(0x4444);
        vm.deal(lp, 10 ether);
        vm.prank(lp);
        pool.deposit{value: 10 ether}();

        uint256 dueAt = block.timestamp + 1 days;
        AgentLoanManager.LoanOffer memory offer = AgentLoanManager.LoanOffer({
            borrower: borrower,
            principal: 1 ether,
            interestBps: 10000,
            dueAt: dueAt,
            nonce: 1,
            issuedAt: block.timestamp,
            expiresAt: block.timestamp + 1 hours,
            action: 1,
            metadataHash: bytes32(0)
        });

        bytes32 digest = loanManager.offerDigest(offer);
        (uint8 vTabby, bytes32 rTabby, bytes32 sTabby) = vm.sign(tabbyPk, digest);
        (uint8 vBorrower, bytes32 rBorrower, bytes32 sBorrower) = vm.sign(borrowerPk, digest);
        bytes memory tabbySig = abi.encodePacked(rTabby, sTabby, vTabby);
        bytes memory borrowerSig = abi.encodePacked(rBorrower, sBorrower, vBorrower);

        uint256 loanId = loanManager.executeLoan(offer, tabbySig, borrowerSig);
        assertEq(pool.totalAssets(), 10 ether, "book value");

        vm.warp(dueAt + 1);
        loanManager.markDefault(loanId);

        assertEq(pool.totalOutstandingPrincipal(), 0, "outstanding cleared");
        assertEq(pool.totalAssets(), 9 ether, "lp loss realized");

        (, uint256 principal, , , , , uint256 accruedInterest, , bool closed, bool defaulted) = loanManager.loans(loanId);
        assertEq(principal, 0, "principal zero");
        assertEq(accruedInterest, 0, "interest zero");
        assertTrue(closed, "closed");
        assertTrue(defaulted, "defaulted");
    }
}

contract TabbySecuredLoansTest is TestBase {
    function test_securedLoans_poolFunded_openLoan_repay_increasesPoolAssets() external {
        address admin = address(this);

        MockERC20 debt = new MockERC20("Wrapped MON", "WMON", 18);
        MockERC20 collateral = new MockERC20("Collateral", "COLL", 18);

        LiquidityPool pool = new LiquidityPool(admin, address(debt));
        address lp = address(0x3333);
        debt.mint(lp, 1000 ether);
        vm.startPrank(lp);
        debt.approve(address(pool), type(uint256).max);
        pool.deposit(1000 ether);
        vm.stopPrank();

        PolicyEngine policy = new PolicyEngine(admin);
        ChainlinkPriceOracle oracle = new ChainlinkPriceOracle(admin);
        MockChainlinkAggregatorV3 collateralFeed = new MockChainlinkAggregatorV3(8, 1e8);
        MockChainlinkAggregatorV3 debtFeed = new MockChainlinkAggregatorV3(8, 1e8);
        PositionManager positions = new PositionManager(admin);
        LoanManager loans = new LoanManager(admin);

        policy.setPolicy(address(collateral), PolicyEngine.Policy({maxLtvBps: 8000, liquidationThresholdBps: 8500, interestRateBps: 0, enabled: true}));
        oracle.setFeed(address(collateral), address(collateralFeed), 0, true);
        oracle.setFeed(address(debt), address(debtFeed), 0, true);
        positions.setEngines(address(policy), address(oracle));
        loans.setEngines(address(policy), address(oracle), address(positions));

        positions.grantRole(positions.ADMIN_ROLE(), address(loans));
        pool.grantRole(pool.BORROW_ROLE(), address(loans));
        pool.grantRole(pool.REPAY_ROLE(), address(loans));
        loans.setLiquidityPool(address(pool));

        address borrower = address(0xBEEF);
        collateral.mint(borrower, 200 ether);
        vm.startPrank(borrower);
        collateral.approve(address(positions), type(uint256).max);

        uint256 principal = 100 ether;
        uint256 dueAt = block.timestamp + 365 days;
        uint256 loanId = loans.openLoan(address(debt), principal, 10000, address(collateral), 200 ether, dueAt);
        assertEq(loanId, 1, "loan id");
        assertEq(debt.balanceOf(borrower), principal, "borrower received debt");
        assertEq(pool.totalOutstandingPrincipal(), principal, "pool outstanding");
        assertEq(pool.totalAssets(), 1000 ether, "pool assets unchanged by borrow");

        debt.mint(borrower, 100 ether);
        debt.approve(address(loans), type(uint256).max);
        vm.warp(block.timestamp + 365 days);
        loans.repay(loanId, 200 ether);
        vm.stopPrank();

        assertEq(pool.totalOutstandingPrincipal(), 0, "outstanding cleared");
        assertEq(pool.totalAssets(), 1100 ether, "pool earned interest");

        uint256 lpShares = pool.balanceOf(lp);
        vm.prank(lp);
        uint256 withdrawn = pool.withdraw(lpShares);
        assertEq(withdrawn, 1100 ether, "withdraw amount");
        assertEq(debt.balanceOf(lp), 1100 ether, "lp balance after withdraw");
    }
}

contract TabbyAdminlessPoolTest is TestBase {
    function test_adminlessPool_cannotGrantRoles_afterRenounce() external {
        MockERC20 wmon = new MockERC20("Wrapped MON", "WMON", 18);
        LiquidityPool pool = new LiquidityPool(address(this), address(wmon));

        address lp = address(0x5555);
        wmon.mint(lp, 100 ether);
        vm.startPrank(lp);
        wmon.approve(address(pool), type(uint256).max);
        pool.deposit(100 ether);
        vm.stopPrank();

        address module = address(0x6666);
        pool.grantRole(pool.BORROW_ROLE(), module);
        pool.grantRole(pool.REPAY_ROLE(), module);

        pool.revokeRole(pool.ADMIN_ROLE(), address(this));

        bytes32 borrowRole = pool.BORROW_ROLE();
        vm.expectRevert(RoleManager.Unauthorized.selector);
        pool.grantRole(borrowRole, address(0x7777));

        vm.expectRevert(RoleManager.Unauthorized.selector);
        pool.setWalletRegistry(address(0x8888));

        vm.expectRevert(RoleManager.Unauthorized.selector);
        pool.setFeeConfig(200, 300);

        vm.expectRevert(RoleManager.Unauthorized.selector);
        pool.setFeeRecipients(address(0x9991), address(0x9992));

        bytes32 stakeRole = pool.STAKE_ROLE();
        vm.expectRevert(RoleManager.Unauthorized.selector);
        pool.grantRole(stakeRole, address(0x9993));
    }
}

contract TabbyFeesAndRewardsTest is TestBase {
    function test_securedPool_feeSharesMinted_onRepay_dilutesLp() external {
        MockERC20 debt = new MockERC20("Wrapped MON", "WMON", 18);
        LiquidityPool pool = new LiquidityPool(address(this), address(debt));

        address lp = address(0x1111);
        debt.mint(lp, 1000 ether);
        vm.startPrank(lp);
        debt.approve(address(pool), type(uint256).max);
        pool.deposit(1000 ether);
        vm.stopPrank();

        pool.setFeeConfig(200, 300);
        address rewardsRecipient = address(0xAAAA);
        address reserveRecipient = address(0xBBBB);
        pool.setFeeRecipients(rewardsRecipient, reserveRecipient);

        pool.grantRole(pool.BORROW_ROLE(), address(this));
        pool.grantRole(pool.REPAY_ROLE(), address(this));

        address borrower = address(0x2222);
        pool.borrow(100 ether, borrower);
        assertEq(pool.totalOutstandingPrincipal(), 100 ether, "outstanding principal");

        debt.mint(address(this), 200 ether);
        debt.approve(address(pool), type(uint256).max);

        uint256 sharesBefore = pool.totalShares();
        uint256 assetsBefore = pool.totalAssets();
        assertEq(sharesBefore, 1000 ether, "shares before");
        assertEq(assetsBefore, 1000 ether, "assets before");

        pool.repay(100 ether, 200 ether);

        uint256 assetsAfter = pool.totalAssets();
        assertEq(assetsAfter, 1100 ether, "assets after");

        uint256 interest = 100 ether;
        uint256 feeAssets = (interest * 500) / 10000;
        uint256 expectedFeeShares = (feeAssets * sharesBefore) / (assetsAfter - feeAssets);
        uint256 expectedRewardsShares = (expectedFeeShares * 200) / 500;
        uint256 expectedReserveShares = expectedFeeShares - expectedRewardsShares;

        assertEq(pool.totalShares(), sharesBefore + expectedFeeShares, "fee shares minted");
        assertEq(pool.balanceOf(rewardsRecipient), expectedRewardsShares, "rewards shares");
        assertEq(pool.balanceOf(reserveRecipient), expectedReserveShares, "reserve shares");

        vm.startPrank(lp);
        uint256 lpWithdrawn = pool.withdraw(pool.balanceOf(lp));
        vm.stopPrank();

        uint256 expectedLpWithdrawn = (sharesBefore * assetsAfter) / (sharesBefore + expectedFeeShares);
        assertEq(lpWithdrawn, expectedLpWithdrawn, "lp withdraw");
    }

    function test_poolShareRewards_locksShares_and_paysRewards() external {
        MockERC20 asset = new MockERC20("Wrapped MON", "WMON", 18);
        MockERC20 tabby = new MockERC20("Tabby", "TABBY", 18);

        LiquidityPool pool = new LiquidityPool(address(this), address(asset));
        PoolShareRewards rewards = new PoolShareRewards(address(this), address(pool), address(tabby));
        pool.grantRole(pool.STAKE_ROLE(), address(rewards));

        address lp = address(0x3333);
        asset.mint(lp, 1000 ether);
        vm.startPrank(lp);
        asset.approve(address(pool), type(uint256).max);
        pool.deposit(1000 ether);

        rewards.stake(400 ether);

        vm.expectRevert(LiquidityPool.InvalidAmount.selector);
        pool.withdraw(700 ether);

        vm.stopPrank();

        tabby.mint(address(this), 100 ether);
        tabby.approve(address(rewards), type(uint256).max);
        rewards.notifyRewardAmount(100 ether);

        vm.startPrank(lp);

        uint256 claimed = rewards.claim();
        assertEq(claimed, 100 ether, "claimed");
        assertEq(tabby.balanceOf(lp), 100 ether, "tabby balance");

        rewards.unstake(400 ether);
        pool.withdraw(600 ether);
        vm.stopPrank();
    }
}

contract TabbyLiquidationEngineTest is TestBase {
    function test_liquidation_reducesPoolOutstanding() external {
        address admin = address(this);

        MockERC20 debt = new MockERC20("Wrapped MON", "WMON", 18);
        MockERC20 collateral = new MockERC20("Collateral", "COLL", 18);

        LiquidityPool pool = new LiquidityPool(admin, address(debt));
        address lp = address(0x9999);
        debt.mint(lp, 1000 ether);
        vm.startPrank(lp);
        debt.approve(address(pool), type(uint256).max);
        pool.deposit(1000 ether);
        vm.stopPrank();

        PolicyEngine policy = new PolicyEngine(admin);
        ChainlinkPriceOracle oracle = new ChainlinkPriceOracle(admin);
        MockChainlinkAggregatorV3 collateralFeed = new MockChainlinkAggregatorV3(8, 1e8);
        MockChainlinkAggregatorV3 debtFeed = new MockChainlinkAggregatorV3(8, 1e8);
        PositionManager positions = new PositionManager(admin);
        LoanManager loans = new LoanManager(admin);
        RiskEngine risk = new RiskEngine();
        LiquidationEngine liq = new LiquidationEngine(admin);

        policy.setPolicy(address(collateral), PolicyEngine.Policy({maxLtvBps: 8000, liquidationThresholdBps: 8500, interestRateBps: 0, enabled: true}));
        oracle.setFeed(address(collateral), address(collateralFeed), 0, true);
        oracle.setFeed(address(debt), address(debtFeed), 0, true);
        positions.setEngines(address(policy), address(oracle));
        loans.setEngines(address(policy), address(oracle), address(positions));

        positions.grantRole(positions.ADMIN_ROLE(), address(loans));
        pool.grantRole(pool.BORROW_ROLE(), address(loans));
        pool.grantRole(pool.REPAY_ROLE(), address(loans));
        loans.setLiquidityPool(address(pool));

        liq.setEngines(address(positions), address(policy), address(oracle), address(risk), address(loans), address(pool));
        positions.grantRole(positions.ADMIN_ROLE(), address(liq));
        loans.grantRole(loans.ADMIN_ROLE(), address(liq));
        pool.grantRole(pool.REPAY_ROLE(), address(liq));

        address borrower = address(0xBEEF);
        collateral.mint(borrower, 200 ether);
        vm.startPrank(borrower);
        collateral.approve(address(positions), type(uint256).max);
        uint256 dueAt = block.timestamp + 365 days;
        uint256 loanId = loans.openLoan(address(debt), 100 ether, 0, address(collateral), 200 ether, dueAt);
        vm.stopPrank();

        uint256 positionId = loans.loanPositions(loanId);
        assertEq(pool.totalOutstandingPrincipal(), 100 ether, "outstanding before");

        collateralFeed.setAnswer(4e7);

        address liquidator = address(0xCAFE);
        debt.mint(liquidator, 100 ether);
        vm.startPrank(liquidator);
        debt.approve(address(liq), type(uint256).max);
        liq.liquidate(positionId);
        vm.stopPrank();

        assertEq(pool.totalOutstandingPrincipal(), 0, "outstanding after");
        (,,,,, bool liquidated) = positions.positions(positionId);
        assertTrue(liquidated, "liquidated");
    }
}
