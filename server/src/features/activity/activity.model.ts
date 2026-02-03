export type ActivityEventType =
  | "gas-loan.offer-created"
  | "gas-loan.offer-expired"
  | "gas-loan.offer-canceled"
  | "gas-loan.executed"
  | "gas-loan.repaid"
  | "gas-loan.defaulted";

export type ActivityEventDoc = {
  chainId: number;
  type: ActivityEventType;
  dedupeKey: string;
  agentId?: string;
  borrower?: string;
  loanId?: number;
  txHash?: string;
  blockNumber?: number;
  logIndex?: number;
  payload: Record<string, unknown>;
  createdAt: Date;
};

export type ActivityCursorDoc = {
  key: string;
  lastProcessedBlock: number;
  updatedAt: Date;
};

