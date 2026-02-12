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
- `skills/tabby-borrower/` requests offers, signs, executes, and repays with autonomous monitoring

### Agent autonomy

The `tabby-borrower` skill provides:

- **Self-healing gas management**: Auto-topup when balance is low
- **Proactive monitoring**: Heartbeat checks every 5 minutes via OpenClaw cron
- **Secured loan health tracking**: LTV monitoring and liquidation risk alerts
- **Notifications**: Optional alerts via OpenClaw message tool (WhatsApp/Telegram)

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

Monad Mainnet (chainId `143`):

- RPC: `https://rpc.monad.xyz`
- Public API: `https://api.tabby.cash`

Token:

- `$TABBY` (`TABBY_TOKEN`): `0x93A7006bD345a7dFfF35910Da2DB97bA4Cb67777` ([nad.fun](https://nad.fun/tokens/0x93A7006bD345a7dFfF35910Da2DB97bA4Cb67777))

Core protocol:

| Component | Address |
| --- | --- |
| `WalletRegistry` | `0xC68924076331F54fDadA830CC5E3906C1D8Ba150` |
| `BorrowerPolicyRegistry` | `0x4ceB3C20e74Fae13eb3D2B58A349294832824E50` |
| `NativeLiquidityPool` (MON pool) | `0x345684fA5d58EC318A410eB6BC60623F92A3578f` |
| `AgentLoanManager` (gas loans) | `0x34eE5B23D8447518adCC3fdEBF1348E3794ff79f` |
| `PoolShareRewards` (native pool) | `0xE24EA1f075bA2BEd7197677C4AabBA079C992C8d` |
| `LiquidityPool` (secured / WMON pool) | `0xC289D5f03d0D2F57e1FE334b00288b7469D6DABe` |
| `PoolShareRewards` (secured pool) | `0x06921a98FE502e882FfA4a4618DCeD6e3Ac36F3C` |
| `PolicyEngine` | `0x602f296af2E5fEfc966100e30eE23f52D2ac0e29` |
| `ChainlinkPriceOracle` | `0x096e23478Cb6be028C5688834614A6C585B7caef` |
| `PositionManager` | `0xEB438D243A604DbBcD1324417E76Dbc0Fd2CF401` |
| `LoanManager` | `0xE6304a71Ec6f4BE1600C84BE0c027F8Fe7A921d0` |
| `RiskEngine` | `0xC207d8E9B50706956461bf50D24E1D5BC74fDCE4` |
| `LiquidationEngine` | `0xC53949dE6122D5819Dee90D6477De5ee2537794e` |

Oracles and collateral configuration:

- WMON: `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A`
- `WMON_FEED`: `0xBcD78f76005B7515837af6b50c7C52BCf73822fb`
- `COLLATERAL_ASSET`: `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`
- `COLLATERAL_FEED`: `0xf5F15f188AbCB0d165D1Edb7f37F7d6fA2fCebec`
- Collateral policy: `maxLtvBps=8000`, `liquidationThresholdBps=8500`, `maxAge=3600`

Interest rate controller (optional):

- `UtilizationRateController`: `0xe0D2b58D2E128e0084621eBFd78ca29E6B8105BB`
- Example params (currently set): `base=500`, `kinkUtil=8000`, `slope1=1000`, `slope2=3000`, `min=200`, `max=8000`

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
npm run build
cp .env.example .env

node dist/bin/tabby-borrower.js init-wallet
node dist/bin/tabby-borrower.js request-gas-loan --principal-wei 5000000000000000 --interest-bps 500 --duration-seconds 3600 --action 1
node dist/bin/tabby-borrower.js repay-gas-loan --loan-id 1
```

See `skills/tabby-borrower/SKILL.md` for full workflow.

#### OpenClaw autonomous monitoring

Add to OpenClaw config (`~/.openclaw/openclaw.json`):

```json5
{
  "cron": {
    "jobs": [
      {
        "id": "tabby-heartbeat-gas",
        "schedule": "*/5 * * * *",
        "command": "cd /path/to/skills/tabby-borrower && node dist/bin/tabby-borrower.js heartbeat --quiet-ok",
        "enabled": true
      },
      {
        "id": "tabby-heartbeat-secured",
        "schedule": "*/5 * * * *",
        "command": "cd /path/to/skills/tabby-borrower && node dist/bin/tabby-borrower.js monitor-secured --quiet-ok",
        "enabled": true
      }
    ]
  }
}
```

Set `TABBY_NOTIFICATION_TARGET` in `.env` to receive alerts (phone number or Telegram username).

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
  --rpc-url https://rpc.monad.xyz --sig "run()" -vvv
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
