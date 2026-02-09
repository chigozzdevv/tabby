export type PoolSnapshot = {
  address: `0x${string}`;
  totalAssetsWei: string;
  totalOutstandingPrincipalWei: string;
  poolBalanceWei: string;
};

export type Erc20PoolSnapshot = PoolSnapshot & {
  asset: `0x${string}`;
  assetDecimals: number;
  assetSymbol: string;
};

export type PoolPosition = {
  account: `0x${string}`;
  shares: string;
  totalShares: string;
  totalAssetsWei: string;
  estimatedAssetsWei: string;
};

export type RewardsSnapshot = {
  address: `0x${string}`;
  pool: `0x${string}`;
  rewardToken: `0x${string}`;
  totalStakedShares: string;
  rewardPerShareStored: string;
  pendingRewards: string;
  account?: `0x${string}`;
  stakedShares?: string;
  earned?: string;
};

export type RewardsResponse = {
  native: RewardsSnapshot | null;
  secured: RewardsSnapshot | null;
  usdc: RewardsSnapshot | null;
};

export type DepositQuote = {
  amountWei: string;
  shares: string;
};

export type WithdrawQuote = {
  shares: string;
  amountWei: string;
};
