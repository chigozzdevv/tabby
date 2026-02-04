export type NonceCounterDoc = {
  borrower: string;
  nextNonce: number;
  updatedAt: Date;
};

export type GasLoanOfferDoc = {
  borrower: string;
  agentId: string;
  nonce: number;
  principal: string;
  interestBps: number;
  dueAt: number;
  issuedAt: number;
  expiresAt: number;
  action: number;
  metadataHash: string;
  tabbySignature: string;
  txHash?: string;
  loanId?: number;
  executedAt?: Date;
  executingAt?: Date;
  failedAt?: Date;
  lastError?: string;
  status: "issued" | "expired" | "executing" | "executed" | "failed" | "canceled";
  createdAt: Date;
};
