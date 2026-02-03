# Tabby server

Feature-based Fastify API for:

- Moltbook identity verification
- Gas-loan offers + onchain execution (Tabby pays gas to execute `AgentLoanManager.executeLoan`)
- Basic liquidity snapshots

## Dev

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

## Endpoints

- `GET /health`
- `GET /auth/me` (requires `X-Moltbook-Identity`)
- `GET /activity` (requires `X-Moltbook-Identity`)
- `GET /public/activity?borrower=0x...` (public)
- `GET /liquidity/pools`
- `GET /liquidity/native/position?account=0x...`
- `GET /liquidity/native/quote/deposit?amountWei=...`
- `GET /liquidity/native/quote/withdraw?shares=...`
- `GET /liquidity/secured/position?account=0x...` (requires `SECURED_POOL_ADDRESS`)
- `GET /liquidity/secured/quote/deposit?amountWei=...` (requires `SECURED_POOL_ADDRESS`)
- `GET /liquidity/secured/quote/withdraw?shares=...` (requires `SECURED_POOL_ADDRESS`)
- `POST /loans/gas/offer` (requires `X-Moltbook-Identity`)
- `POST /loans/gas/execute` (requires `X-Moltbook-Identity`)
- `GET /monitoring/gas-loans` (requires `X-Moltbook-Identity`)
- `GET /monitoring/gas-loans/:loanId` (requires `X-Moltbook-Identity`)
- `GET /public/monitoring/gas-loans?borrower=0x...` (public)
- `GET /public/monitoring/gas-loans/:loanId` (public)

## Gas-loan actions

`action` is an application-level integer (0-255) gated by the onchain borrower policy bitmask.

- `255`: reserved for `repay-gas` topups (small loans to ensure the borrower can submit a `repay()` transaction).
