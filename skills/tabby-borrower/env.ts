import { z } from "zod";

const envSchema = z
  .object({
    TABBY_API_BASE_URL: z.string().url().default("http://localhost:3000"),
    MOLTBOOK_API_KEY: z.string().min(1).optional(),
    MOLTBOOK_AUDIENCE: z.string().optional(),
    MONAD_CHAIN_ID: z.coerce.number().int().positive().optional(),
    CHAIN_ID: z.coerce.number().int().positive().optional(),
    MONAD_RPC_URL: z.string().url().optional(),
    RPC_URL: z.string().url().optional(),
    AGENT_LOAN_MANAGER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
    TABBY_REMIND_SECONDS: z.coerce.number().int().positive().optional(),
    TABBY_REMIND_REPEAT_SECONDS: z.coerce.number().int().positive().optional(),
    TABBY_MIN_REPAY_GAS_WEI: z.string().regex(/^\d+$/).optional(),
  })
  .passthrough();

export type BorrowerEnv = z.infer<typeof envSchema>;

export function getEnv(): BorrowerEnv {
  return envSchema.parse(process.env);
}
