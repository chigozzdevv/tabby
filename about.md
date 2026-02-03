Owner spins up OpenClaw bot (AWS/Telegram) and installs a borrower skill.
Borrower agent registers on Moltbook and gets claimed by the human owner (identity verification).
Owner configures borrower policy (max APR, max duration, allowed actions, lender URL = Tabby).
Borrower agent runs a task and detects a funding gap (insufficient MON for gas/action).
Borrower skill requests a quote from Tabby API (amount, duration, purpose).
Tabby verifies identity (Moltbook identity token), checks policy + any onchain/offchain limits.
If approved, Tabby sends loan terms + onchain disbursement address.
Borrower agent signs/accepts terms; Tabby disburses MON to borrower address.
Borrower agent executes the allowed onchain action (deploy, swap, x402 pay, etc.).
Borrower agent returns proof (tx hash + metadata) to Tabby.
Borrower agent repays (principal + interest) before due date.
Tabby updates repayment history/reputation (internal), closes the loan.
Who decides?

OpenClaw only runs the agent + skill.
Borrower decisions are constrained by owner policy + Tabby’s rules.
Moltbook gives identity + karma only (no lending reputation by itself).
