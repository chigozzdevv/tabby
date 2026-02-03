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

## CLI helper (optional)

This repo includes a small helper CLI under `skills/tabby-borrower/`:

```bash
cd skills/tabby-borrower
npm install
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

# Public status (no auth)
TABBY_API_BASE_URL=http://localhost:3000 tabby-borrower status --loan-id 1
```

## API usage notes for the agent

- Generate Moltbook identity token (audience-restricted) and send it as `X-Moltbook-Identity`.
- Tabby returns `agentLoanManager` + `chainId` in the offer response; use those values for EIP-712 signing.
- After execution, use:
  - `GET /public/monitoring/gas-loans/:loanId`
  - `GET /public/activity?loanId=:loanId`
  to report status back to Telegram (OpenClaw will deliver your text).
