# Tabby Borrower (OpenClaw skill)

Borrower workflow for Tabby gas-loans on Monad:

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
cd skills/tabby-borrower
npm install
npm run build
cp .env.example .env

# Create a borrower wallet (saved to ~/.config/tabby-borrower/wallet.json)
tabby-borrower init-wallet

# Request + execute a gas loan (Tabby pays gas to execute the onchain tx)
TABBY_API_BASE_URL=http://localhost:3000 \
MOLTBOOK_API_KEY=moltbook_xxx \
MOLTBOOK_AUDIENCE=tabby.local \
tabby-borrower request-gas-loan \
  --principal-wei 5000000000000000 \
  --interest-bps 500 \
  --duration-seconds 3600 \
  --action 1

# Repay onchain (sends a tx from the borrower wallet)
MONAD_CHAIN_ID=10143 MONAD_RPC_URL=https://testnet-rpc.monad.xyz \
tabby-borrower repay-gas-loan --loan-id 1

# Public status (no auth)
TABBY_API_BASE_URL=http://localhost:3000 tabby-borrower status --loan-id 1
```

`request-gas-loan` caches `chainId`, `agentLoanManager`, and the last executed loan metadata to `~/.config/tabby-borrower/state.json`.

You can check the cached due time:

```bash
tabby-borrower next-due
```

Or run the heartbeat check (recommended for autonomous reminders):

```bash
# Prints nothing unless something needs attention
tabby-borrower heartbeat --quiet-ok
```

## API usage notes for the agent

- Generate Moltbook identity token (audience-restricted) and send it as `X-Moltbook-Identity`.
- Tabby returns `agentLoanManager` + `chainId` in the offer response; use those values for EIP-712 signing.
- After execution, use:
  - `GET /public/monitoring/gas-loans/:loanId`
  - `GET /public/monitoring/gas-loans/next-due?borrower=0x...`
  - `GET /public/activity?loanId=:loanId`
  to report status back to Telegram (OpenClaw will deliver your text).

## Due checks (heartbeat)

Onchain does not push notifications. The due time is `AgentLoanManager.loans(loanId).dueAt`.

Due checks run when the agent is invoked (chat-driven), or from a periodic trigger (OpenClaw hooks/heartbeat).

Helper commands:

- `tabby-borrower heartbeat --quiet-ok` (live, chain-timestamp-based; checks the nearest due active loan, incl. `repay-gas`)
- `tabby-borrower next-due` (live; shows nearest due loan)
- `tabby-borrower status --loan-id <id>` (live; pulls `/public/monitoring/gas-loans/:loanId`)
- `tabby-borrower repay-gas-loan --loan-id <id>` (repay tx)

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

tabby-borrower approve-collateral --amount 100
tabby-borrower open-secured-loan --principal 10 --collateral-amount 100 --duration-seconds 3600
tabby-borrower secured-status --loan-id 1
tabby-borrower repay-secured-loan --loan-id 1
tabby-borrower withdraw-collateral --loan-id 1
```
