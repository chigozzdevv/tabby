import type { ActivityEventType } from "@/features/activity/activity.model.js";

export type ActivityEvent = {
  chainId: number;
  type: ActivityEventType;
  dedupeKey: string;
  agentId?: string;
  borrower?: `0x${string}`;
  loanId?: number;
  txHash?: `0x${string}`;
  blockNumber?: number;
  logIndex?: number;
  payload: Record<string, unknown>;
  createdAt: string;
};

