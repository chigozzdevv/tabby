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
  status: "issued" | "expired" | "executing" | "executed" | "failed" | "canceled";
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

export type PublicGasLoanDetails = {
  offer?: GasLoanOfferSummary;
  onchain: {
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

export type PublicGasLoanNextDue = {
  loanId: number;
  dueAt: number;
  dueInSeconds: number;
  outstandingWei: string;
};

export type PublicSecuredLoanDetails = {
  onchain: {
    loanId: number;
    positionId?: number;
    borrower: `0x${string}`;
    asset: `0x${string}`;
    principalWei: string;
    interestBps: number;
    collateralAsset: `0x${string}`;
    collateralAmountWei: string;
    openedAt: number;
    dueAt: number;
    lastAccruedAt: number;
    accruedInterestWei: string;
    closed: boolean;
    outstandingWei: string;
  };
};
