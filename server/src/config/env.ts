import "dotenv/config";
import { z } from "zod";

const booleanString = z.enum(["true", "false"]);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  CORS_ORIGIN: z.string().optional(),

  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().min(1).default("tabby"),

  RPC_URL: z.string().url(),
  CHAIN_ID: z.coerce.number().int().positive().default(10143),
  AGENT_LOAN_MANAGER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  TABBY_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),

  MOLTBOOK_BASE_URL: z.string().url().default("https://www.moltbook.com/api/v1"),
  MOLTBOOK_AUDIENCE: z.string().optional(),

  GOVERNANCE: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),

  GAS_LOAN_ALLOW_MULTIPLE_ACTIVE: booleanString.optional().default("false").transform((v) => v === "true"),
  REPAY_GAS_ACTION_ID: z.coerce.number().int().min(0).max(255).default(255),
  REPAY_GAS_MAX_PRINCIPAL_WEI: z.string().regex(/^\d+$/).default("10000000000000000"),
  REPAY_GAS_MAX_DURATION_SECONDS: z.coerce.number().int().positive().default(3600),

  ACTIVITY_SYNC_ENABLED: booleanString.optional().default("true").transform((v) => v === "true"),
  ACTIVITY_START_BLOCK: z.coerce.number().int().nonnegative().optional(),
  ACTIVITY_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).max(300_000).default(15_000),
  ACTIVITY_CONFIRMATIONS: z.coerce.number().int().min(0).max(100).default(5),
});

export const env = envSchema.parse(process.env);
