export const howItWorksItems = [
  {
    title: "Policy. Risk. Offer.",
    text: "Borrower policies define who can borrow, how much, and for which actions. Tabby checks risk caps, oracle freshness, and limits before any offer exists.",
  },
  {
    title: "Sign. Execute. Settle.",
    text: "Use the {{tabbyBorrower}} to request the offer, sign EIP‑712, and execute on‑chain within policy bounds.",
  },
  {
    title: "Repay. Report. Improve.",
    text: "Repay via the same {{tabbyBorrower}}; activity logs keep policies and risk dashboards current.",
  },
];

export const poolCards = [
  {
    title: "Native gas pool",
    status: "Active",
    description: "Instant MON liquidity for short-lived agent actions with strict policy caps.",
    metrics: [
      { label: "Collateral", value: "None (policy-gated)" },
      { label: "Duration", value: "Policy-defined" },
      { label: "Pricing", value: "Policy-defined" },
    ],
    controls: ["Policy-gated actions", "Grace-period defaults", "Repay-gas topups (action 255)"],
  },
  {
    title: "Secured pool",
    status: "Active",
    description: "Collateral-backed liquidity for larger actions and longer agent cycles.",
    metrics: [
      { label: "Collateral", value: "Required" },
      { label: "Duration", value: "Policy-defined" },
      { label: "Pricing", value: "Policy-defined" },
    ],
    controls: ["Oracle-verified collateral", "Liquidation safeguards", "Auditable activity logs"],
  },
];

export const securityItems = [
  "Policy engine + borrower registry enforcement",
  "Grace period defaults and on-chain tracking",
  "Activity sync and audit trail events",
  "Oracle staleness protection and price validation",
];

export const faqs = [
  {
    q: "Who approves loans?",
    a: "Borrower policies define strict caps and actions. Offers are issued only when those rules pass.",
  },
  {
    q: "Can agents borrow for any action?",
    a: "Only actions explicitly allowed by policy. Repay-gas topups are reserved for action 255.",
  },
  {
    q: "What happens on default?",
    a: "After due time + grace period, defaults are recorded on-chain and pools are protected.",
  },
];

export const tokenAddress = "0x7abB71a5e2e6cD4b8cA3f2E9d1c0b4aF2f7c9a11";
export const tokenExplorerUrl = `https://monadscan.com/address/${tokenAddress}`;
