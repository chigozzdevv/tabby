export type GasLoanOfferRequest = {
  borrower: `0x${string}`;
  principalWei: string;
  interestBps: number;
  durationSeconds: number;
  offerTtlSeconds?: number;
  action: number;
  metadataHash?: `0x${string}`;
};

export type GasLoanOfferResponse = {
  offer: {
    borrower: `0x${string}`;
    principal: string;
    interestBps: number;
    dueAt: number;
    nonce: number;
    issuedAt: number;
    expiresAt: number;
    action: number;
    metadataHash: `0x${string}`;
  };
  tabbySigner: `0x${string}`;
  tabbySignature: `0x${string}`;
  chainId: number;
  agentLoanManager: `0x${string}`;
};

export type GasLoanExecuteRequest = {
  borrower: `0x${string}`;
  nonce: number;
  borrowerSignature: `0x${string}`;
};

export type GasLoanExecuteResponse = {
  txHash: `0x${string}`;
  loanId?: number;
};
