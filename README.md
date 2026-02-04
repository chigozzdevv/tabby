# Tabby.cash

Tabby.cash is a liquidity rail for autonomous agents on Monad.

Agents borrow using the `tabby-borrower` OpenClaw skill and repay onchain when due.

Agents borrow to:

- pay gas for onchain actions (deployments, swaps, repayments)
- fund onchain payments (x402 payments after an HTTP 402 `Payment Required` response, swaps, and purchases)

Tabby offers two loan types:

- **Gas loans (native MON)**: short-duration, uncollateralized loans so agents can execute onchain actions when they have insufficient gas.
- **Secured loans (WMON debt, ERC20 collateral)**: collateralized loans where borrowers lock ERC20 collateral and borrow WMON.

## Repository layout

- `contracts/` — pools, loan managers, policies, oracle adapter, liquidation, rewards
- `server/` — Fastify API: Moltbook identity verification, gas-loan offers + execution, activity/monitoring, pool snapshots
- `skills/` — OpenClaw skills (includes `skills/tabby-borrower/`)
- `client/` — web client

## Integrations

- **OpenClaw**: runs the agent and loads skills.
- **Moltbook**: bot identity + claim status (identity token used for API auth).
- **Monad**: chain used for lending + repayments (MON and WMON).
- **nad.fun**: `TABBY` token launch (rewards token).
- **Chainlink-style feeds**: secured-lane oracle adapter expects `AggregatorV3Interface` feeds.
- **Foundry**: build/test/deploy for contracts.
- **Fastify + TypeScript**: server API.
- **MongoDB**: server storage (offers, activity log, monitoring cache).

## Architecture

### Onchain (contracts)

- **Pools**
  - `NativeLiquidityPool`: deposits/withdrawals in native MON.
  - `LiquidityPool`: deposits/withdrawals in WMON (ERC20).
- **Borrowing modules**
  - `AgentLoanManager`: gas-loan execution via EIP-712 offers (Tabby signs; borrower signs).
  - `LoanManager` + `PositionManager`: secured loans (ERC20 collateral, WMON debt).
- **Risk**
  - `BorrowerPolicyRegistry`: onchain per-borrower policy for gas loans.
  - `PolicyEngine`: per-collateral parameters (LTV, liquidation threshold, interest rate).
  - `ChainlinkPriceOracle`: reads prices from Chainlink-style aggregator feeds.
  - `RiskEngine` + `LiquidationEngine`: health checks and liquidation path.
- **Protocol fees + rewards**
  - Pools mint protocol fee shares on interest.
  - `PoolShareRewards`: stake pool shares (locks shares in the pool) and earn `TABBY`.

### Offchain (server + skill)

- `server/`: validates Moltbook identity tokens, issues gas-loan offers, executes loans onchain, and exposes monitoring + liquidity snapshots.
- `skills/tabby-borrower/`: OpenClaw borrower skill that requests/accepts gas loans and reports status (polls `activity`/`monitoring`).

## Liquidity providers (LPs)

LPs deposit directly into the pools:

- **MON gas pool**: `NativeLiquidityPool.deposit()` / `NativeLiquidityPool.withdraw(shares)`
- **WMON secured pool**: approve WMON, then `LiquidityPool.deposit(amount)` / `LiquidityPool.withdraw(shares)`

LP earnings come from interest paid by borrowers. Pool shares represent a pro‑rata claim on pool assets; interest increases pool value over time.

### Protocol fees (interest skim)

Pools take a protocol fee on **interest only** by minting additional pool shares to fee recipients (no asset transfers out of the pool).

Default configuration:

- **2% of interest** → rewards budget
- **3% of interest** → reserve/ops

### TABBY rewards

LPs stake pool shares into `PoolShareRewards` and earn `TABBY`.

Staking locks pool shares in the pool (`lockedShares`), so staked LP shares cannot be withdrawn until unstaked.

## Economics

### Lender yield

- Borrowers pay interest.
- Interest increases pool value for LPs (share price increases).

### Protocol revenue

- The pools skim a protocol fee on **interest only** by minting pool shares to fee recipients.
- Default fee is **5% of interest**:
  - **2% of interest** → rewards budget
  - **3% of interest** → reserve/ops

### Rewards funding (buyback-funded)

- The protocol earns revenue in the same asset as the pool (MON for the native pool, WMON for the secured pool).
- Fee recipients can redeem their pool shares for MON/WMON and buy `TABBY`.
- `TABBY` is distributed to stakers by transferring `TABBY` into `PoolShareRewards` via `notifyRewardAmount(amount)`.

## Borrowers

### Gas loans (native MON)

Gas loans are uncollateralized and short duration.

Interest is simple interest (APR in bps) and accrues until `dueAt`.
The rate and terms are set in the EIP-712 offer (`interestBps`, `dueAt`) and must pass the borrower’s onchain policy.

Flow:

1) Borrower authenticates to the server using a Moltbook identity token (audience-restricted).
2) Borrower requests an offer from Tabby (`POST /loans/gas/offer`).
3) Borrower signs the offer (EIP-712).
4) Tabby executes `AgentLoanManager.executeLoan(...)` onchain and pays gas for that transaction.
5) Borrower repays onchain via `AgentLoanManager.repay(loanId)` before `dueAt`.

The server enforces “one active loan per borrower” by default. `action=255` is reserved for `repay-gas` topups so the borrower can submit `repay()` even if they hit 0 gas.

Repayment is sent by the borrower wallet. The `tabby-borrower` skill includes `repay-gas-loan` to submit the onchain repayment transaction.

Due time can be read from the onchain loan state (or via `GET /public/monitoring/gas-loans/:loanId`). The `tabby-borrower` skill also caches the last loan metadata in `~/.config/tabby-borrower/state.json`.

If a loan is past `dueAt + gracePeriodSeconds`, anyone can call `AgentLoanManager.markDefault(loanId)` to write off remaining principal from the pool. The server should treat defaults as ineligible for future borrowing.

### Secured loans (WMON debt, ERC20 collateral)

Secured loans are collateralized and use WMON as the debt asset.

Interest is simple interest (APR in bps) and accrues until `dueAt`.
The default rate comes from `PolicyEngine` per collateral asset (and can override the caller-provided `interestBps`).

Flow:

1) Borrower opens a position and locks collateral (ERC20).
2) Borrower borrows the debt asset from the pool.
3) Interest accrues (simple interest) until `dueAt`.
4) Borrower repays principal + interest in the debt asset.
5) If the position becomes unhealthy, a liquidator can repay debt and seize collateral.

Collateral is any ERC20 that is explicitly enabled in `PolicyEngine` and has a real oracle feed configured in `ChainlinkPriceOracle`.

## Monitoring

- Gas loans (public):
  - `GET /public/monitoring/gas-loans/:loanId`
  - `GET /public/activity?loanId=:loanId`
- Public server config (used by the borrower skill):
  - `GET /public/config`
- Liquidity snapshots:
  - `GET /liquidity/pools`

### Activity indexing (server)

The server indexes `AgentLoanManager` events into MongoDB so it can:

- expose `/public/activity` and monitoring views, and
- block borrowers that have defaulted.

Activity indexing is controlled by `ACTIVITY_SYNC_ENABLED` and `ACTIVITY_START_BLOCK`.

## Token (nad.fun)

`TABBY` is Tabby’s rewards token.

- `TABBY` is launched through nad.fun on Monad mainnet.
- Lending assets remain **MON/WMON**.

## Admin model

The pools are designed to be **adminless after bootstrap**.

Bootstrap requirements:

- Grant pool `BORROW_ROLE` / `REPAY_ROLE` only to the audited loan modules.
- Configure fee settings and fee recipients.
- Configure `RISK_ROLE` (risk committee) and `STAKE_ROLE` (share staking contract).

Adminless pool (after bootstrap):

- Revoke `ADMIN_ROLE` from the pool so:
  - no new roles can be granted
  - fee settings and wallet registry cannot be changed
  - only pre-authorized modules can borrow/repay

Other components (oracle feeds, policy engine, signer keys) are still governance-sensitive unless you also lock them down.

`DeployTabby.s.sol` revokes pool `ADMIN_ROLE` by default (`ADMINLESS_NATIVE_POOL=true`, `ADMINLESS_SECURED_POOL=true`).

## Deployed addresses

Fill these after deployment:

- `TABBY_TOKEN` (rewards token): `0x...`
- `AGENT_LOAN_MANAGER` (gas-loan): `0x...`
- `NATIVE_LIQUIDITY_POOL` (MON pool): `0x...`
- `SECURED_LIQUIDITY_POOL` (WMON pool): `0x...`
- `POOL_SHARE_REWARDS_NATIVE`: `0x...`
- `POOL_SHARE_REWARDS_SECURED`: `0x...`

## Requirements

- Node.js 18+
- Foundry (`forge`, `cast`)
- MongoDB (server storage)

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

See `server/.env.example` for configuration (including `MOLTBOOK_APP_KEY` for Moltbook identity verification).

### Borrower skill (OpenClaw)

```bash
cd skills/tabby-borrower
npm install
cp .env.example .env

tabby-borrower init-wallet
tabby-borrower request-gas-loan --principal-wei 5000000000000000 --interest-bps 500 --duration-seconds 3600 --action 1
tabby-borrower repay-gas-loan --loan-id 1
```

See `skills/tabby-borrower/SKILL.md` for the full workflow.

## Deployment (contracts)

The deploy script is `contracts/script/DeployTabby.s.sol`.

Dry-run estimate on mainnet:

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

Common env vars for deployment:

- `PRIVATE_KEY` (deployer)
- `TABBY_SIGNER` (must match the server’s `TABBY_PRIVATE_KEY` address)
- `GOVERNANCE` (admin address for governance-controlled contracts)
- `TABBY_TOKEN` (TABBY token address; deploys `PoolShareRewards` contracts)
- `POOL_REWARDS_FEE_BPS` (default `200`)
- `POOL_RESERVE_FEE_BPS` (default `300`)
- `POOL_REWARDS_FEE_RECIPIENT`, `POOL_RESERVE_FEE_RECIPIENT`

## Operations

- Fund the pools:
  - MON pool: `NativeLiquidityPool.deposit()`
  - WMON pool: approve WMON then `LiquidityPool.deposit(amount)`
- Configure borrower gas-loan policy using `BorrowerPolicyRegistry`.
- Configure secured-lane collateral policies and oracle feeds (required before enabling collateral borrowing).
- Fund rewards (buyback flow):
  - buy `TABBY` with accumulated protocol fees offchain/onchain
  - call `PoolShareRewards.notifyRewardAmount(amount)`

## Security notes

- This code has not been audited.
- The `GOVERNANCE` address controls policy/oracle configuration.
