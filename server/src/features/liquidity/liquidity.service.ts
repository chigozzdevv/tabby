import { env } from "@/config/env.js";
import { asAddress, publicClient } from "@/shared/viem.js";
import type { PoolSnapshot } from "@/features/liquidity/liquidity.types.js";

const agentLoanManagerAbi = [
  {
    type: "function",
    name: "pool",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

const nativeLiquidityPoolAbi = [
  {
    type: "function",
    name: "totalAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalOutstandingPrincipal",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export async function getNativePoolSnapshot(): Promise<PoolSnapshot> {
  const agentLoanManager = asAddress(env.AGENT_LOAN_MANAGER_ADDRESS);
  const pool = await publicClient.readContract({ address: agentLoanManager, abi: agentLoanManagerAbi, functionName: "pool" });
  const [totalAssets, totalOutstandingPrincipal, poolBalance] = await Promise.all([
    publicClient.readContract({ address: pool, abi: nativeLiquidityPoolAbi, functionName: "totalAssets" }),
    publicClient.readContract({ address: pool, abi: nativeLiquidityPoolAbi, functionName: "totalOutstandingPrincipal" }),
    publicClient.getBalance({ address: pool }),
  ]);

  return {
    address: pool,
    totalAssetsWei: totalAssets.toString(),
    totalOutstandingPrincipalWei: totalOutstandingPrincipal.toString(),
    poolBalanceWei: poolBalance.toString(),
  };
}
