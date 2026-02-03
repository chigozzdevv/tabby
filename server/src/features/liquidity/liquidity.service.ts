import { env } from "@/config/env.js";
import { asAddress, publicClient } from "@/shared/viem.js";
import type { DepositQuote, PoolPosition, PoolSnapshot, SecuredPoolSnapshot, WithdrawQuote } from "@/features/liquidity/liquidity.types.js";

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
  {
    type: "function",
    name: "previewDeposit",
    stateMutability: "view",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "previewWithdraw",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const liquidityPoolAbi = [
  {
    type: "function",
    name: "ASSET",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
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
  {
    type: "function",
    name: "totalShares",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export async function getNativePoolAddress(): Promise<`0x${string}`> {
  const agentLoanManager = asAddress(env.AGENT_LOAN_MANAGER_ADDRESS);
  return await publicClient.readContract({ address: agentLoanManager, abi: agentLoanManagerAbi, functionName: "pool" });
}

export async function getNativePoolSnapshot(): Promise<PoolSnapshot> {
  const pool = await getNativePoolAddress();
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

export async function getNativePosition(account: `0x${string}`): Promise<PoolPosition> {
  const pool = await getNativePoolAddress();
  const balanceAbi = [
    { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
    { type: "function", name: "totalShares", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
    { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  ] as const;

  const [shares, totalShares, totalAssets] = await Promise.all([
    publicClient.readContract({ address: pool, abi: balanceAbi, functionName: "balanceOf", args: [account] }),
    publicClient.readContract({ address: pool, abi: balanceAbi, functionName: "totalShares" }),
    publicClient.readContract({ address: pool, abi: balanceAbi, functionName: "totalAssets" }),
  ]);

  const estimatedAssets = totalShares === 0n ? 0n : (shares * totalAssets) / totalShares;

  return {
    account,
    shares: shares.toString(),
    totalShares: totalShares.toString(),
    totalAssetsWei: totalAssets.toString(),
    estimatedAssetsWei: estimatedAssets.toString(),
  };
}

export async function quoteNativeDeposit(amountWei: bigint): Promise<DepositQuote> {
  const pool = await getNativePoolAddress();
  const shares = await publicClient.readContract({ address: pool, abi: nativeLiquidityPoolAbi, functionName: "previewDeposit", args: [amountWei] });
  return { amountWei: amountWei.toString(), shares: shares.toString() };
}

export async function quoteNativeWithdraw(shares: bigint): Promise<WithdrawQuote> {
  const pool = await getNativePoolAddress();
  const amountWei = await publicClient.readContract({ address: pool, abi: nativeLiquidityPoolAbi, functionName: "previewWithdraw", args: [shares] });
  return { shares: shares.toString(), amountWei: amountWei.toString() };
}

export async function getSecuredPoolSnapshot(): Promise<SecuredPoolSnapshot | null> {
  if (!env.SECURED_POOL_ADDRESS) return null;
  const pool = asAddress(env.SECURED_POOL_ADDRESS);
  const erc20BalanceOfAbi = [
    {
      type: "function",
      name: "balanceOf",
      stateMutability: "view",
      inputs: [{ name: "account", type: "address" }],
      outputs: [{ type: "uint256" }],
    },
  ] as const;
  const asset = await publicClient.readContract({ address: pool, abi: liquidityPoolAbi, functionName: "ASSET" });
  const [totalAssets, totalOutstandingPrincipal, totalBalance] = await Promise.all([
    publicClient.readContract({ address: pool, abi: liquidityPoolAbi, functionName: "totalAssets" }),
    publicClient.readContract({ address: pool, abi: liquidityPoolAbi, functionName: "totalOutstandingPrincipal" }),
    publicClient.readContract({ address: asset, abi: erc20BalanceOfAbi, functionName: "balanceOf", args: [pool] }),
  ]);

  return {
    address: pool,
    asset,
    totalAssetsWei: totalAssets.toString(),
    totalOutstandingPrincipalWei: totalOutstandingPrincipal.toString(),
    poolBalanceWei: totalBalance.toString(),
  };
}

export async function getSecuredPosition(account: `0x${string}`): Promise<PoolPosition> {
  if (!env.SECURED_POOL_ADDRESS) throw new Error("secured-pool-not-configured");
  const pool = asAddress(env.SECURED_POOL_ADDRESS);

  const [shares, totalShares, totalAssets] = await Promise.all([
    publicClient.readContract({ address: pool, abi: liquidityPoolAbi, functionName: "balanceOf", args: [account] }),
    publicClient.readContract({ address: pool, abi: liquidityPoolAbi, functionName: "totalShares" }),
    publicClient.readContract({ address: pool, abi: liquidityPoolAbi, functionName: "totalAssets" }),
  ]);

  const estimatedAssets = totalShares === 0n ? 0n : (shares * totalAssets) / totalShares;

  return {
    account,
    shares: shares.toString(),
    totalShares: totalShares.toString(),
    totalAssetsWei: totalAssets.toString(),
    estimatedAssetsWei: estimatedAssets.toString(),
  };
}

export async function quoteSecuredDeposit(amountWei: bigint): Promise<DepositQuote> {
  if (!env.SECURED_POOL_ADDRESS) throw new Error("secured-pool-not-configured");
  const pool = asAddress(env.SECURED_POOL_ADDRESS);

  const [totalShares, totalAssets] = await Promise.all([
    publicClient.readContract({ address: pool, abi: liquidityPoolAbi, functionName: "totalShares" }),
    publicClient.readContract({ address: pool, abi: liquidityPoolAbi, functionName: "totalAssets" }),
  ]);

  const shares = totalShares === 0n || totalAssets === 0n ? amountWei : (amountWei * totalShares) / totalAssets;
  return { amountWei: amountWei.toString(), shares: shares.toString() };
}

export async function quoteSecuredWithdraw(shares: bigint): Promise<WithdrawQuote> {
  if (!env.SECURED_POOL_ADDRESS) throw new Error("secured-pool-not-configured");
  const pool = asAddress(env.SECURED_POOL_ADDRESS);

  const [totalShares, totalAssets] = await Promise.all([
    publicClient.readContract({ address: pool, abi: liquidityPoolAbi, functionName: "totalShares" }),
    publicClient.readContract({ address: pool, abi: liquidityPoolAbi, functionName: "totalAssets" }),
  ]);

  const amountWei = totalShares === 0n ? 0n : (shares * totalAssets) / totalShares;
  return { shares: shares.toString(), amountWei: amountWei.toString() };
}
