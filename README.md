# Tabby.cash

Tabby.cash is a policy gated liquidity rail for autonomous agents on Monad. Agents borrow using the `tabby-borrower` OpenClaw skill and repay on chain when due.

## What it does

- Agents can borrow gas loans to pay for on chain actions.
- Agents can borrow secured loans using oracle verified ERC20 collateral.
- Liquidity providers earn interest, with optional $TABBY rewards.

## Repository layout

- `contracts/` smart contracts for pools, loan managers, policy, oracle, risk, and rewards
- `server/` Fastify API for identity verification, offers, execution, monitoring, and pool snapshots
- `skills/` OpenClaw skills including `skills/tabby-borrower/`
- `client/` web client

## Integrations

- OpenClaw for agent execution and skills
- Moltbook for agent identity verification
- Monad for lending and repayment
- Chainlink style feeds for secured loan pricing
- Foundry for contract build and deployment
- Fastify and MongoDB for the server

## Architecture

### On chain

- Pools
  - `NativeLiquidityPool` for MON deposits and gas loans
  - `LiquidityPool` for WMON deposits and secured loans
- Loan modules
  - `AgentLoanManager` for gas loans and EIP 712 offers
  - `LoanManager` and `PositionManager` for secured loans
- Risk and policy
  - `BorrowerPolicyRegistry` for per borrower gas loan policy
  - `PolicyEngine` for collateral parameters
  - `ChainlinkPriceOracle` for feed prices
  - `RiskEngine` and `LiquidationEngine` for liquidation flow
- Rewards
  - `PoolShareRewards` for staking pool shares and earning $TABBY

### Off chain

- `server/` validates Moltbook identity tokens, issues gas loan offers, executes loans, and exposes monitoring plus pool data
- `skills/tabby-borrower/` requests offers, signs, executes, and repays

## Loan flows

### Gas loans

1. Borrower authenticates with a Moltbook identity token.
2. Borrower requests an offer at `POST /loans/gas/offer`.
3. Borrower signs the offer using EIP 712.
4. Tabby executes `AgentLoanManager.executeLoan(...)` on chain and pays gas.
5. Borrower repays via `AgentLoanManager.repay(loanId)` before `dueAt`.

Notes:

- One active gas loan per borrower by default.
- `action=255` is reserved for repay gas topups.
- Defaults can be written on chain after `dueAt + gracePeriodSeconds`.

### Secured loans

1. Borrower opens a position and locks ERC20 collateral.
2. Borrower borrows WMON from the secured pool.
3. Interest accrues until `dueAt`.
4. Borrower repays principal plus interest.
5. If the position is unhealthy, liquidators can repay and seize collateral.

Collateral must be enabled in `PolicyEngine` and have a valid oracle feed in `ChainlinkPriceOracle`.

## Liquidity providers

Deposits and withdrawals:

- MON pool: `NativeLiquidityPool.deposit()` and `NativeLiquidityPool.withdraw(shares)`
- WMON pool: approve WMON then `LiquidityPool.deposit(amount)` and `LiquidityPool.withdraw(shares)`

### Fees and rewards

- Pools take protocol fees on interest only by minting pool shares to fee recipients.
- Default fees are 2 percent to rewards and 3 percent to reserve ops.
- `PoolShareRewards` is deployed only when `TABBY_TOKEN` is non zero.
- Rewards are distributed by transferring $TABBY into `PoolShareRewards` and calling `notifyRewardAmount(amount)`.

## Monitoring

Public endpoints:

- `GET /public/monitoring/gas-loans/:loanId`
- `GET /public/activity?loanId=:loanId`
- `GET /public/config`
- `GET /liquidity/pools`

Activity indexing uses `ACTIVITY_SYNC_ENABLED` and `ACTIVITY_START_BLOCK`.

## Admin model

Pools are intended to be adminless after bootstrap:

- Grant pool roles to audited loan modules.
- Set fee configuration and fee recipients.
- Assign risk roles.
- Revoke pool admin role after setup.

Other components such as policy and oracle configuration remain governance sensitive unless locked down.

## Deployed addresses

Fill these after deployment:

- `TABBY_TOKEN`
- `AGENT_LOAN_MANAGER`
- `NATIVE_LIQUIDITY_POOL`
- `SECURED_LIQUIDITY_POOL`
- `POOL_SHARE_REWARDS_NATIVE`
- `POOL_SHARE_REWARDS_SECURED`

## Requirements

- Node.js 18+
- Foundry
- MongoDB

## Local development

### Contracts

```bash
cd contracts
forge test
```

### Server

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

### Borrower skill

```bash
cd skills/tabby-borrower
npm install
cp .env.example .env

tabby-borrower init-wallet
tabby-borrower request-gas-loan --principal-wei 5000000000000000 --interest-bps 500 --duration-seconds 3600 --action 1
tabby-borrower repay-gas-loan --loan-id 1
```

See `skills/tabby-borrower/SKILL.md` for full workflow.

### Client

```bash
cd client
npm install
npm run dev
```

## Deployment

Deploy script: `contracts/script/DeployTabby.s.sol`.

Dry run:

```bash
cd contracts
PRIVATE_KEY=... TABBY_SIGNER=0x... forge script script/DeployTabby.s.sol:DeployTabby \
  --fork-url https://rpc.monad.xyz --sig "run()" -vvv
```

Broadcast:

```bash
cd contracts
PRIVATE_KEY=... TABBY_SIGNER=0x... forge script script/DeployTabby.s.sol:DeployTabby \
  --rpc-url https://rpc.monad.xyz --broadcast --sig "run()"
```

Common deploy env vars:

- `PRIVATE_KEY`
- `TABBY_SIGNER` (must match server `TABBY_PRIVATE_KEY` address)
- `TABBY_TOKEN` (deploys `PoolShareRewards` if non zero)
- `GOVERNANCE`
- `POOL_REWARDS_FEE_BPS`
- `POOL_RESERVE_FEE_BPS`
- `POOL_REWARDS_FEE_RECIPIENT`
- `POOL_RESERVE_FEE_RECIPIENT`
- `WMON_FEED`, `COLLATERAL_ASSET`, `COLLATERAL_FEED` for secured loan policy setup

## Operations

- Fund pools
  - MON pool `NativeLiquidityPool.deposit()`
  - WMON pool `LiquidityPool.deposit(amount)`
- Configure borrower policy in `BorrowerPolicyRegistry`
- Configure collateral policy and feeds in `PolicyEngine` and `ChainlinkPriceOracle`
- Fund rewards by calling `PoolShareRewards.notifyRewardAmount(amount)`

