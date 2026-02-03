import { z } from "zod";
import { getDb } from "@/db/mongodb.js";
import { env } from "@/config/env.js";
import type { ActivityCursorDoc, ActivityEventDoc, ActivityEventType } from "@/features/activity/activity.model.js";
import type { ActivityEvent } from "@/features/activity/activity.types.js";

export type ActivityListFilter = {
  agentId?: string;
  borrower?: string;
  loanId?: number;
  type?: ActivityEventType;
  limit?: number;
  before?: Date;
};

function isMongoDuplicateKeyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (!("code" in error)) return false;
  return (error as { code?: unknown }).code === 11000;
}

const listFilterSchema = z.object({
  agentId: z.string().min(1).optional(),
  borrower: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  loanId: z.coerce.number().int().positive().optional(),
  type: z
    .enum([
      "gas-loan.offer-created",
      "gas-loan.offer-expired",
      "gas-loan.offer-canceled",
      "gas-loan.executed",
      "gas-loan.repaid",
      "gas-loan.defaulted",
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.date().optional(),
});

function toApi(doc: ActivityEventDoc): ActivityEvent {
  return {
    chainId: doc.chainId,
    type: doc.type,
    dedupeKey: doc.dedupeKey,
    agentId: doc.agentId,
    borrower: (doc.borrower ?? undefined) as `0x${string}` | undefined,
    loanId: doc.loanId,
    txHash: (doc.txHash ?? undefined) as `0x${string}` | undefined,
    blockNumber: doc.blockNumber,
    logIndex: doc.logIndex,
    payload: doc.payload,
    createdAt: doc.createdAt.toISOString(),
  };
}

export async function recordActivityEvent(event: Omit<ActivityEventDoc, "chainId" | "createdAt"> & { createdAt?: Date }) {
  const db = getDb();
  const events = db.collection<ActivityEventDoc>("activity-events");

  const doc: ActivityEventDoc = {
    chainId: env.CHAIN_ID,
    createdAt: event.createdAt ?? new Date(),
    ...event,
  };

  try {
    await events.insertOne(doc);
  } catch (error: unknown) {
    if (isMongoDuplicateKeyError(error)) return;
    throw error;
  }
}

export async function listActivityEvents(filter: ActivityListFilter): Promise<ActivityEvent[]> {
  const parsed = listFilterSchema.parse({
    ...filter,
    borrower: filter.borrower ? filter.borrower : undefined,
  });

  const query: Record<string, unknown> = {};
  if (parsed.agentId) query.agentId = parsed.agentId;
  if (parsed.borrower) query.borrower = parsed.borrower.toLowerCase();
  if (parsed.loanId) query.loanId = parsed.loanId;
  if (parsed.type) query.type = parsed.type;
  if (parsed.before) query.createdAt = { $lt: parsed.before };

  const db = getDb();
  const events = db.collection<ActivityEventDoc>("activity-events");

  const docs = await events.find(query).sort({ createdAt: -1 }).limit(parsed.limit).toArray();
  return docs.map(toApi);
}

export async function getActivityCursor(key: string): Promise<ActivityCursorDoc | null> {
  const db = getDb();
  const cursors = db.collection<ActivityCursorDoc>("activity-cursors");
  return await cursors.findOne({ key });
}

export async function setActivityCursor(key: string, lastProcessedBlock: number): Promise<void> {
  const db = getDb();
  const cursors = db.collection<ActivityCursorDoc>("activity-cursors");
  await cursors.updateOne(
    { key },
    { $set: { lastProcessedBlock, updatedAt: new Date() }, $setOnInsert: { key } },
    { upsert: true }
  );
}
