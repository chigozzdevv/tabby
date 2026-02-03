import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "@/config/env.js";

export const chain = {
  id: env.CHAIN_ID,
  name: env.CHAIN_ID === 143 ? "Monad Mainnet" : "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [env.RPC_URL] } },
} as const;

export const tabbyAccount = privateKeyToAccount(env.TABBY_PRIVATE_KEY as Hex);

export const publicClient = createPublicClient({
  chain,
  transport: http(env.RPC_URL),
});

export const walletClient = createWalletClient({
  account: tabbyAccount,
  chain,
  transport: http(env.RPC_URL),
});

export function asAddress(value: string): Address {
  return value as Address;
}
