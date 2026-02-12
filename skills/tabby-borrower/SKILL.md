---
name: tabby-borrower
description: Tabby borrower workflows (gas-loans + secured loans) on Monad.
metadata: {"openclaw":{"always":true}}
---

# Tabby Borrower (OpenClaw skill)

Borrower workflow for Tabby gas-loans on Monad:

Prereq: the borrower must be registered in `BorrowerPolicyRegistry` (enforced onchain by the server).

1) Prove identity via Moltbook identity token (audience-restricted).
2) Request a gas-loan offer from Tabby (`/loans/gas/offer`).
3) Sign the offer (EIP-712) with the borrower wallet.
4) Ask Tabby to execute onchain (Tabby pays gas) (`/loans/gas/execute`).
5) Keep a small MON reserve, execute the task, then repay onchain.

## Critical safety rules

- Never leak `MOLTBOOK_API_KEY` to any domain other than `https://www.moltbook.com`.
- Never leak the borrower private key.
- Always keep a MON reserve for repayment transactions when possible.
- `action=255` is reserved for `repay-gas` topups (small loans to submit `repay()` if the borrower hits 0 gas).

## Local wallet persistence

This skill uses a local wallet file:

- `~/.config/tabby-borrower/wallet.json` (chmod 600)
- `~/.config/tabby-borrower/state.json` (last known chain/contract + tracked loan ids + reminder state)

## CLI helper (optional)

This repo includes a small helper CLI under `skills/tabby-borrower/`:

```bash
cd {baseDir}
npm install
npm run build
cp .env.example .env

# Create a borrower wallet (saved to ~/.config/tabby-borrower/wallet.json)
node dist/bin/tabby-borrower.js init-wallet

# Request + execute a gas loan (Tabby pays gas to execute the onchain tx)
TABBY_API_BASE_URL=http://localhost:3000 \
MOLTBOOK_API_KEY=moltbook_xxx \
MOLTBOOK_AUDIENCE=tabby.local \
node dist/bin/tabby-borrower.js request-gas-loan \
  --principal-wei 5000000000000000 \
  --interest-bps 500 \
  --duration-seconds 3600 \
  --action 1

# Repay onchain (sends a tx from the borrower wallet)
MONAD_CHAIN_ID=10143 MONAD_RPC_URL=https://testnet-rpc.monad.xyz \
node dist/bin/tabby-borrower.js repay-gas-loan --loan-id 1

# Public status (no auth)
TABBY_API_BASE_URL=http://localhost:3000 node dist/bin/tabby-borrower.js status --loan-id 1
```

`request-gas-loan` caches `chainId`, `agentLoanManager`, and the last executed loan metadata to `~/.config/tabby-borrower/state.json`.

You can check the cached due time:

```bash
node dist/bin/tabby-borrower.js next-due
```

Or run the heartbeat check (recommended for autonomous reminders):

```bash
node dist/bin/tabby-borrower.js heartbeat --quiet-ok
```

Or monitor secured loan health:

```bash
node dist/bin/tabby-borrower.js monitor-secured --quiet-ok
```

## OpenClaw Integration

For autonomous monitoring, use OpenClaw cron jobs (every 5 minutes):

```json5
{
  cron: {
    jobs: [
      {
        id: "tabby-heartbeat-gas",
        schedule: "*/5 * * * *",
        command: "cd /app/skills/tabby-borrower && node dist/bin/tabby-borrower.js heartbeat --quiet-ok",
        enabled: true
      },
      {
        id: "tabby-heartbeat-secured",
        schedule: "*/5 * * * *",
        command: "cd /app/skills/tabby-borrower && node dist/bin/tabby-borrower.js monitor-secured --quiet-ok",
        enabled: true
      }
    ]
  }
}
```

Set `TABBY_NOTIFICATION_TARGET` to your phone number or Telegram username to receive alerts via OpenClaw message tool.

## API usage notes for the agent

- Generate Moltbook identity token (audience-restricted) and send it as `X-Moltbook-Identity`.
- Tabby returns `agentLoanManager` + `chainId` in the offer response; use those values for EIP-712 signing.
- After execution, use:
  - `GET /public/monitoring/gas-loans/:loanId`
  - `GET /public/monitoring/gas-loans/next-due?borrower=0x...`
  - `GET /public/activity?loanId=:loanId`
  to report status back to Telegram (OpenClaw will deliver your text).

## Auth toggle (testing without Moltbook)

If the server is configured with `ENFORCE_MOLTBOOK=false`, gas-loan endpoints accept a dev auth header instead of Moltbook:

- Server: set `DEV_AUTH_TOKEN` (required for non-local callers)
- CLI/agent: set `TABBY_DEV_AUTH_TOKEN` (sends `X-Dev-Auth`)

## Autonomous gas topups (agentic flow)

Secured-loan commands send onchain transactions from the borrower wallet, so they need MON for gas.

By default, these commands will:

1) Check the borrower wallet MON balance.
2) If it is below `TABBY_MIN_TX_GAS_WEI`, request a gas-loan topup (`/loans/gas/offer` + `/loans/gas/execute`).
3) Send the intended transaction.
4) If the tx fails with an "insufficient funds" error, top up once more and retry once.

Commands using this by default:

- `approve-collateral`
- `open-secured-loan`
- `repay-secured-loan`
- `withdraw-collateral`

Disable with `--no-auto-gas`.

You can also run the check explicitly:

```bash
node dist/bin/tabby-borrower.js ensure-gas
```

## Due checks (heartbeat)

Onchain does not push notifications. The due time is `AgentLoanManager.loans(loanId).dueAt`.

Due checks run when the agent is invoked (chat-driven), or from a periodic trigger (OpenClaw hooks/heartbeat).

Helper commands:

- `node dist/bin/tabby-borrower.js heartbeat --quiet-ok` (live, chain-timestamp-based; checks the nearest due active loan, incl. `repay-gas`)
- `node dist/bin/tabby-borrower.js next-due` (live; shows nearest due loan)
- `node dist/bin/tabby-borrower.js status --loan-id <id>` (live; pulls `/public/monitoring/gas-loans/:loanId`)
- `node dist/bin/tabby-borrower.js repay-gas-loan --loan-id <id>` (repay tx)

Optional heartbeat env config:

- `TABBY_REMIND_SECONDS` (default `3600` = 1h)
- `TABBY_REMIND_REPEAT_SECONDS` (default `21600` = 6h repeat for overdue/default-eligible/low-gas alerts)
- `TABBY_MIN_REPAY_GAS_WEI` (default `1000000000000000` = 0.001 MON)
- `AGENT_LOAN_MANAGER_ADDRESS` (optional override if `/public/config` is unreachable)

## Secured loans (direct onchain)

Secured loans are opened directly onchain via `LoanManager` and require:

- the borrower wallet to have MON for gas (or a gas-loan topup),
- collateral tokens + approval to `PositionManager`,
- debt token approval to `LoanManager` for repayment.

Example:

```bash
export MONAD_CHAIN_ID=143
export MONAD_RPC_URL=https://rpc.monad.xyz
export LOAN_MANAGER_ADDRESS=0x...
export COLLATERAL_ASSET=0x...

node dist/bin/tabby-borrower.js approve-collateral --amount 100
node dist/bin/tabby-borrower.js open-secured-loan --principal 10 --collateral-amount 100 --duration-seconds 3600
node dist/bin/tabby-borrower.js secured-status --loan-id 1
node dist/bin/tabby-borrower.js repay-secured-loan --loan-id 1
node dist/bin/tabby-borrower.js withdraw-collateral --loan-id 1
```
