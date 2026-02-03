import "dotenv/config";
import { z } from "zod";

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
});

export const env = envSchema.parse(process.env);

