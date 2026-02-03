export type GasLoanOfferSummary = {
  borrower: `0x${string}`;
  nonce: number;
  principalWei: string;
  interestBps: number;
  dueAt: number;
  issuedAt: number;
  expiresAt: number;
  action: number;
  metadataHash: `0x${string}`;
  status: "issued" | "expired" | "executed" | "canceled";
  txHash?: `0x${string}`;
  loanId?: number;
  createdAt: string;
};

export type GasLoanDetails = {
  offer: GasLoanOfferSummary;
  onchain?: {
    borrower: `0x${string}`;
    principalWei: string;
    rateBps: number;
    openedAt: number;
    dueAt: number;
    lastAccruedAt: number;
    accruedInterestWei: string;
    totalRepaidWei: string;
    closed: boolean;
    defaulted: boolean;
    outstandingWei: string;
  };
};

