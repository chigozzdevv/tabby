import { MongoClient, type Db } from "mongodb";
import { env } from "@/config/env.js";
import { logger } from "@/config/logger.js";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectMongo(): Promise<Db> {
  if (db) return db;

  client = new MongoClient(env.MONGODB_URI);
  await client.connect();
  db = client.db(env.MONGODB_DB);
  await Promise.all([
    db.collection("nonce-counters").createIndex({ borrower: 1 }, { unique: true }),
    db.collection("gas-loan-offers").createIndex({ borrower: 1, nonce: 1 }, { unique: true }),
    db.collection("gas-loan-offers").createIndex({ agentId: 1, createdAt: -1 }),
    db.collection("activity-events").createIndex({ dedupeKey: 1 }, { unique: true }),
    db.collection("activity-events").createIndex({ agentId: 1, createdAt: -1 }),
    db.collection("activity-events").createIndex({ borrower: 1, createdAt: -1 }),
    db.collection("activity-events").createIndex({ loanId: 1, createdAt: -1 }),
    db.collection("activity-cursors").createIndex({ key: 1 }, { unique: true }),
  ]);
  logger.info({ db: env.MONGODB_DB }, "mongodb-connected");
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error("mongodb-not-connected");
  return db;
}
