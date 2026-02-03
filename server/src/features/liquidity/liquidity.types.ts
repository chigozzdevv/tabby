export type PoolSnapshot = {
  address: `0x${string}`;
  totalAssetsWei: string;
  totalOutstandingPrincipalWei: string;
  poolBalanceWei: string;
};

export type SecuredPoolSnapshot = PoolSnapshot & {
  asset: `0x${string}`;
};

export type PoolPosition = {
  account: `0x${string}`;
  shares: string;
  totalShares: string;
  totalAssetsWei: string;
  estimatedAssetsWei: string;
};

export type DepositQuote = {
  amountWei: string;
  shares: string;
};

export type WithdrawQuote = {
  shares: string;
  amountWei: string;
};
