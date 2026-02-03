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
- `GET /liquidity/pools`
- `POST /loans/gas/offer` (requires `X-Moltbook-Identity`)
- `POST /loans/gas/execute` (requires `X-Moltbook-Identity`)
- `GET /monitoring/gas-loans` (requires `X-Moltbook-Identity`)
- `GET /monitoring/gas-loans/:loanId` (requires `X-Moltbook-Identity`)
