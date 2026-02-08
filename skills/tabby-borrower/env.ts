import { z } from "zod";

function emptyToUndefined(value: unknown) {
  if (typeof value !== "string") return value;
  return value.trim().length === 0 ? undefined : value;
}

const envSchema = z
  .object({
    TABBY_API_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().default("https://api.tabby.cash")),
    TABBY_DEV_AUTH_TOKEN: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    MOLTBOOK_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    MOLTBOOK_AUDIENCE: z.preprocess(emptyToUndefined, z.string().optional()),
    TABBY_MIN_TX_GAS_WEI: z.preprocess(emptyToUndefined, z.string().regex(/^\d+$/).optional()),
    TABBY_GAS_TOPUP_WEI: z.preprocess(emptyToUndefined, z.string().regex(/^\d+$/).optional()),
    TABBY_GAS_TOPUP_INTEREST_BPS: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).optional()),
    TABBY_GAS_TOPUP_DURATION_SECONDS: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
    TABBY_GAS_TOPUP_ACTION: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(255).optional()),
    MONAD_CHAIN_ID: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
    CHAIN_ID: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
    MONAD_RPC_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    RPC_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    AGENT_LOAN_MANAGER_ADDRESS: z.preprocess(emptyToUndefined, z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()),
    LOAN_MANAGER_ADDRESS: z.preprocess(emptyToUndefined, z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()),
    POSITION_MANAGER_ADDRESS: z.preprocess(emptyToUndefined, z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()),
    SECURED_POOL_ADDRESS: z.preprocess(emptyToUndefined, z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()),
    COLLATERAL_ASSET: z.preprocess(emptyToUndefined, z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()),
    TABBY_REMIND_SECONDS: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
    TABBY_REMIND_REPEAT_SECONDS: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
    TABBY_MIN_REPAY_GAS_WEI: z.preprocess(emptyToUndefined, z.string().regex(/^\d+$/).optional()),
  })
  .passthrough();

export type BorrowerEnv = z.infer<typeof envSchema>;

export function getEnv(): BorrowerEnv {
  return envSchema.parse(process.env);
}
