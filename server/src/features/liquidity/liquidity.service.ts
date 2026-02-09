import { env } from "@/config/env.js";
import { asAddress, publicClient } from "@/shared/viem.js";
import type {
  DepositQuote,
  Erc20PoolSnapshot,
  PoolPosition,
  PoolSnapshot,
  RewardsResponse,
  RewardsSnapshot,
  WithdrawQuote,
} from "@/features/liquidity/liquidity.types.js";

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

const erc20MetadataAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

const erc20BalanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const poolShareRewardsAbi = [
  {
    type: "function",
    name: "pool",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "rewardToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "totalStakedShares",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "rewardPerShareStored",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "pendingRewards",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "stakedShares",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "earned",
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

async function getErc20PoolSnapshot(pool: `0x${string}`): Promise<Erc20PoolSnapshot> {
  const asset = await publicClient.readContract({ address: pool, abi: liquidityPoolAbi, functionName: "ASSET" });

  const [totalAssets, totalOutstandingPrincipal, poolBalance, assetDecimals, assetSymbol] = await Promise.all([
    publicClient.readContract({ address: pool, abi: liquidityPoolAbi, functionName: "totalAssets" }),
    publicClient.readContract({ address: pool, abi: liquidityPoolAbi, functionName: "totalOutstandingPrincipal" }),
    publicClient.readContract({ address: asset, abi: erc20BalanceOfAbi, functionName: "balanceOf", args: [pool] }),
    publicClient.readContract({ address: asset, abi: erc20MetadataAbi, functionName: "decimals" }).catch(() => 18),
    publicClient.readContract({ address: asset, abi: erc20MetadataAbi, functionName: "symbol" }).catch(() => "TOKEN"),
  ]);

  return {
    address: pool,
    asset,
    assetDecimals: Number(assetDecimals),
    assetSymbol: String(assetSymbol),
    totalAssetsWei: totalAssets.toString(),
    totalOutstandingPrincipalWei: totalOutstandingPrincipal.toString(),
    poolBalanceWei: poolBalance.toString(),
  };
}

export async function getSecuredPoolSnapshot(): Promise<Erc20PoolSnapshot | null> {
  if (!env.SECURED_POOL_ADDRESS) return null;
  const pool = asAddress(env.SECURED_POOL_ADDRESS);
  return getErc20PoolSnapshot(pool);
}

export async function getUsdcPoolSnapshot(): Promise<Erc20PoolSnapshot | null> {
  if (!env.USDC_POOL_ADDRESS) return null;
  const pool = asAddress(env.USDC_POOL_ADDRESS);
  return getErc20PoolSnapshot(pool);
}

export async function getSecuredPosition(account: `0x${string}`): Promise<PoolPosition> {
  if (!env.SECURED_POOL_ADDRESS) throw new Error("secured-pool-not-configured");
  const pool = asAddress(env.SECURED_POOL_ADDRESS);
  return getErc20Position(pool, account);
}

export async function getUsdcPosition(account: `0x${string}`): Promise<PoolPosition> {
  if (!env.USDC_POOL_ADDRESS) throw new Error("usdc-pool-not-configured");
  const pool = asAddress(env.USDC_POOL_ADDRESS);
  return getErc20Position(pool, account);
}

async function getErc20Position(pool: `0x${string}`, account: `0x${string}`): Promise<PoolPosition> {
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
  return quoteErc20Deposit(pool, amountWei);
}

export async function quoteSecuredWithdraw(shares: bigint): Promise<WithdrawQuote> {
  if (!env.SECURED_POOL_ADDRESS) throw new Error("secured-pool-not-configured");
  const pool = asAddress(env.SECURED_POOL_ADDRESS);
  return quoteErc20Withdraw(pool, shares);
}

export async function quoteUsdcDeposit(amountWei: bigint): Promise<DepositQuote> {
  if (!env.USDC_POOL_ADDRESS) throw new Error("usdc-pool-not-configured");
  const pool = asAddress(env.USDC_POOL_ADDRESS);
  return quoteErc20Deposit(pool, amountWei);
}

export async function quoteUsdcWithdraw(shares: bigint): Promise<WithdrawQuote> {
  if (!env.USDC_POOL_ADDRESS) throw new Error("usdc-pool-not-configured");
  const pool = asAddress(env.USDC_POOL_ADDRESS);
  return quoteErc20Withdraw(pool, shares);
}

async function quoteErc20Deposit(pool: `0x${string}`, amountWei: bigint): Promise<DepositQuote> {
  const [totalShares, totalAssets] = await Promise.all([
    publicClient.readContract({ address: pool, abi: liquidityPoolAbi, functionName: "totalShares" }),
    publicClient.readContract({ address: pool, abi: liquidityPoolAbi, functionName: "totalAssets" }),
  ]);

  const shares = totalShares === 0n || totalAssets === 0n ? amountWei : (amountWei * totalShares) / totalAssets;
  return { amountWei: amountWei.toString(), shares: shares.toString() };
}

async function quoteErc20Withdraw(pool: `0x${string}`, shares: bigint): Promise<WithdrawQuote> {
  const [totalShares, totalAssets] = await Promise.all([
    publicClient.readContract({ address: pool, abi: liquidityPoolAbi, functionName: "totalShares" }),
    publicClient.readContract({ address: pool, abi: liquidityPoolAbi, functionName: "totalAssets" }),
  ]);

  const amountWei = totalShares === 0n ? 0n : (shares * totalAssets) / totalShares;
  return { shares: shares.toString(), amountWei: amountWei.toString() };
}

async function buildRewardsSnapshot(rewardsAddress: string, account?: `0x${string}`): Promise<RewardsSnapshot> {
  const rewards = asAddress(rewardsAddress);
  const [pool, rewardToken, totalStakedShares, rewardPerShareStored, pendingRewards] = await Promise.all([
    publicClient.readContract({ address: rewards, abi: poolShareRewardsAbi, functionName: "pool" }),
    publicClient.readContract({ address: rewards, abi: poolShareRewardsAbi, functionName: "rewardToken" }),
    publicClient.readContract({ address: rewards, abi: poolShareRewardsAbi, functionName: "totalStakedShares" }),
    publicClient.readContract({ address: rewards, abi: poolShareRewardsAbi, functionName: "rewardPerShareStored" }),
    publicClient.readContract({ address: rewards, abi: poolShareRewardsAbi, functionName: "pendingRewards" }),
  ]);

  const snapshot: RewardsSnapshot = {
    address: rewards,
    pool,
    rewardToken,
    totalStakedShares: totalStakedShares.toString(),
    rewardPerShareStored: rewardPerShareStored.toString(),
    pendingRewards: pendingRewards.toString(),
  };

  if (!account) return snapshot;

  const [stakedShares, earned] = await Promise.all([
    publicClient.readContract({ address: rewards, abi: poolShareRewardsAbi, functionName: "stakedShares", args: [account] }),
    publicClient.readContract({ address: rewards, abi: poolShareRewardsAbi, functionName: "earned", args: [account] }),
  ]);

  return {
    ...snapshot,
    account,
    stakedShares: stakedShares.toString(),
    earned: earned.toString(),
  };
}

export async function getRewardsSnapshots(account?: `0x${string}`): Promise<RewardsResponse> {
  const nativePromise = env.TABBY_NATIVE_REWARDS_ADDRESS
    ? buildRewardsSnapshot(env.TABBY_NATIVE_REWARDS_ADDRESS, account)
    : Promise.resolve(null);
  const securedPromise = env.TABBY_SECURED_REWARDS_ADDRESS
    ? buildRewardsSnapshot(env.TABBY_SECURED_REWARDS_ADDRESS, account)
    : Promise.resolve(null);
  const usdcPromise = env.TABBY_USDC_REWARDS_ADDRESS
    ? buildRewardsSnapshot(env.TABBY_USDC_REWARDS_ADDRESS, account)
    : Promise.resolve(null);

  const [native, secured, usdc] = await Promise.all([nativePromise, securedPromise, usdcPromise]);
  return { native, secured, usdc };
}
