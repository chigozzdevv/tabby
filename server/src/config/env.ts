import "dotenv/config";
import { z } from "zod";

const booleanString = z.enum(["true", "false"]);

function emptyToUndefined(value: unknown) {
  if (typeof value !== "string") return value;
  return value.trim().length === 0 ? undefined : value;
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  CORS_ORIGIN: z.preprocess(emptyToUndefined, z.string().optional()),

  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().min(1).default("tabby"),

  ENFORCE_MOLTBOOK: booleanString.optional().default("true").transform((v) => v === "true"),
  DEV_AUTH_TOKEN: z.preprocess(emptyToUndefined, z.string().min(1).optional()),

  RPC_URL: z.string().url(),
  CHAIN_ID: z.coerce.number().int().positive().default(10143),
  AGENT_LOAN_MANAGER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  LOAN_MANAGER_ADDRESS: z.preprocess(emptyToUndefined, z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()),
  POSITION_MANAGER_ADDRESS: z.preprocess(emptyToUndefined, z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()),
  SECURED_POOL_ADDRESS: z.preprocess(emptyToUndefined, z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()),
  COLLATERAL_ASSET: z.preprocess(emptyToUndefined, z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()),
  TABBY_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  TABBY_TOKEN: z.preprocess(emptyToUndefined, z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()),
  TABBY_NATIVE_REWARDS_ADDRESS: z.preprocess(emptyToUndefined, z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()),
  TABBY_SECURED_REWARDS_ADDRESS: z.preprocess(emptyToUndefined, z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()),

  MOLTBOOK_BASE_URL: z
    .string()
    .url()
    .default("https://www.moltbook.com/api/v1")
    .transform((value) => {
      const url = new URL(value);
      if (url.hostname === "moltbook.com") url.hostname = "www.moltbook.com";
      return url.toString().replace(/\/$/, "");
    }),
  MOLTBOOK_APP_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  MOLTBOOK_AUDIENCE: z.preprocess(emptyToUndefined, z.string().optional()),

  GOVERNANCE: z.preprocess(emptyToUndefined, z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()),

  GAS_LOAN_ALLOW_MULTIPLE_ACTIVE: booleanString.optional().default("false").transform((v) => v === "true"),
  REPAY_GAS_ACTION_ID: z.coerce.number().int().min(0).max(255).default(255),
  REPAY_GAS_MAX_PRINCIPAL_WEI: z.string().regex(/^\d+$/).default("10000000000000000"),
  REPAY_GAS_MAX_DURATION_SECONDS: z.coerce.number().int().positive().default(3600),

  ACTIVITY_SYNC_ENABLED: booleanString.optional().default("true").transform((v) => v === "true"),
  ACTIVITY_START_BLOCK: z.preprocess(emptyToUndefined, z.coerce.number().int().nonnegative().optional()),
  ACTIVITY_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).max(300_000).default(15_000),
  ACTIVITY_CONFIRMATIONS: z.coerce.number().int().min(0).max(100).default(5),
  ACTIVITY_CHUNK_SIZE: z.coerce.number().int().min(100).max(200_000).default(10_000),
}).superRefine((value, ctx) => {
  if (value.ENFORCE_MOLTBOOK && !value.MOLTBOOK_APP_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "MOLTBOOK_APP_KEY is required when ENFORCE_MOLTBOOK=true",
      path: ["MOLTBOOK_APP_KEY"],
    });
  }

  if (value.NODE_ENV === "production" && value.ACTIVITY_SYNC_ENABLED && value.ACTIVITY_START_BLOCK === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ACTIVITY_START_BLOCK is required in production when activity sync is enabled",
      path: ["ACTIVITY_START_BLOCK"],
    });
  }
});

export const env = envSchema.parse(process.env);
