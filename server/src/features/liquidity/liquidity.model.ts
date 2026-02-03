export type LiquiditySnapshotDoc = {
  kind: "native";
  pool: string;
  totalAssetsWei: string;
  totalOutstandingPrincipalWei: string;
  poolBalanceWei: string;
  createdAt: Date;
};

