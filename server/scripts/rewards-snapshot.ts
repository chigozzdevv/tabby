import "dotenv/config";
import { createPublicClient, http, type Abi, type Address } from "viem";

function requiredEnv<T>(value: T | undefined, name: string): T {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const rpcUrl = requiredEnv(process.env.RPC_URL, "RPC_URL");
const chainId = Number(process.env.CHAIN_ID ?? "143");
const agentLoanManager = requiredEnv(process.env.AGENT_LOAN_MANAGER_ADDRESS as Address | undefined, "AGENT_LOAN_MANAGER_ADDRESS");
const securedPool = process.env.SECURED_POOL_ADDRESS as Address | undefined;
const nativeRewards = process.env.TABBY_NATIVE_REWARDS_ADDRESS as Address | undefined;
const securedRewards = process.env.TABBY_SECURED_REWARDS_ADDRESS as Address | undefined;

const client = createPublicClient({
  chain: {
    id: chainId,
    name: chainId === 143 ? "Monad Mainnet" : "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  },
  transport: http(rpcUrl),
});

const agentLoanManagerAbi = [
  { type: "function", name: "pool", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

const poolAbi = [
  { type: "function", name: "rewardsFeeRecipient", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "reserveFeeRecipient", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  {
    type: "event",
    name: "FeeSharesMinted",
    inputs: [
      { indexed: false, name: "interestAssets", type: "uint256" },
      { indexed: false, name: "feeAssets", type: "uint256" },
      { indexed: false, name: "feeShares", type: "uint256" },
      { indexed: false, name: "rewardsShares", type: "uint256" },
      { indexed: false, name: "reserveShares", type: "uint256" },
    ],
  },
] as const;

const rewardsAbi = [
  { type: "event", name: "Staked", inputs: [{ indexed: true, name: "account", type: "address" }, { indexed: false, name: "shares", type: "uint256" }] },
  { type: "event", name: "Unstaked", inputs: [{ indexed: true, name: "account", type: "address" }, { indexed: false, name: "shares", type: "uint256" }] },
  { type: "function", name: "totalStakedShares", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

function getArg(name: string) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function fetchEventsInChunks<T extends { args?: Record<string, unknown> }>({
  address,
  abi,
  eventName,
  fromBlock,
  toBlock,
}: {
  address: Address;
  abi: Abi;
  eventName: string;
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<T[]> {
  const chunkSize = BigInt(process.env.EVENT_CHUNK_SIZE ?? "10000");
  const events: T[] = [];
  let start = fromBlock;
  while (start <= toBlock) {
    const end = start + chunkSize > toBlock ? toBlock : start + chunkSize;
    const chunk = await client.getContractEvents({
      address,
      abi,
      eventName,
      fromBlock: start,
      toBlock: end,
    });
    events.push(...(chunk as unknown as T[]));
    start = end + BigInt(1);
  }
  return events;
}

function formatBigint(value: bigint) {
  return value.toString();
}

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  return 0n;
}

type FeeSharesMintedEvent = {
  args?: {
    rewardsShares?: unknown;
    reserveShares?: unknown;
  };
};

async function snapshotPool(label: string, pool: Address, fromBlock: bigint, toBlock: bigint) {
  const rewardsFeeRecipient = await client.readContract({ address: pool, abi: poolAbi, functionName: "rewardsFeeRecipient" });
  const reserveFeeRecipient = await client.readContract({ address: pool, abi: poolAbi, functionName: "reserveFeeRecipient" });

  const feeEvents = await fetchEventsInChunks<FeeSharesMintedEvent>({ address: pool, abi: poolAbi, eventName: "FeeSharesMinted", fromBlock, toBlock });

  let rewardsShares = BigInt(0);
  let reserveShares = BigInt(0);
  for (const event of feeEvents) {
    rewardsShares += toBigInt(event.args?.rewardsShares);
    reserveShares += toBigInt(event.args?.reserveShares);
  }

  const rewardsBalance = await client.readContract({ address: pool, abi: poolAbi, functionName: "balanceOf", args: [rewardsFeeRecipient] });
  const reserveBalance = await client.readContract({ address: pool, abi: poolAbi, functionName: "balanceOf", args: [reserveFeeRecipient] });

  console.log(`\n${label} pool: ${pool}`);
  console.log(`rewardsFeeRecipient: ${rewardsFeeRecipient}`);
  console.log(`reserveFeeRecipient: ${reserveFeeRecipient}`);
  console.log(`FeeSharesMinted rewardsShares: ${formatBigint(rewardsShares)}`);
  console.log(`FeeSharesMinted reserveShares: ${formatBigint(reserveShares)}`);
  console.log(`Current rewards recipient balance: ${formatBigint(rewardsBalance)}`);
  console.log(`Current reserve recipient balance: ${formatBigint(reserveBalance)}`);
}

type StakeEvent = {
  args?: {
    account?: unknown;
    shares?: unknown;
  };
};

async function snapshotRewards(label: string, rewards: Address, fromBlock: bigint, toBlock: bigint) {
  const totalStaked = await client.readContract({ address: rewards, abi: rewardsAbi, functionName: "totalStakedShares" });

  const stakedEvents = await fetchEventsInChunks<StakeEvent>({ address: rewards, abi: rewardsAbi, eventName: "Staked", fromBlock, toBlock });
  const unstakedEvents = await fetchEventsInChunks<StakeEvent>({ address: rewards, abi: rewardsAbi, eventName: "Unstaked", fromBlock, toBlock });

  const balances = new Map<string, bigint>();
  for (const event of stakedEvents) {
    const account = event.args?.account;
    if (typeof account !== "string") continue;
    const shares = toBigInt(event.args?.shares);
    balances.set(account, (balances.get(account) ?? BigInt(0)) + shares);
  }
  for (const event of unstakedEvents) {
    const account = event.args?.account;
    if (typeof account !== "string") continue;
    const shares = toBigInt(event.args?.shares);
    balances.set(account, (balances.get(account) ?? BigInt(0)) - shares);
  }

  const entries = Array.from(balances.entries())
    .map(([account, shares]) => ({ account, shares }))
    .filter((entry) => entry.shares > BigInt(0))
    .sort((a, b) => (a.shares > b.shares ? -1 : 1));

  console.log(`\n${label} rewards: ${rewards}`);
  console.log(`Total staked shares: ${formatBigint(totalStaked)}`);
  console.log(`Active stakers: ${entries.length}`);
  for (const entry of entries) {
    console.log(`- ${entry.account} : ${formatBigint(entry.shares)}`);
  }
}

async function main() {
  const fromBlockArg = getArg("--from-block");
  const toBlockArg = getArg("--to-block");
  const fromBlock = BigInt(fromBlockArg ?? process.env.FEE_FROM_BLOCK ?? "0");
  const toBlock = BigInt(toBlockArg ?? (await client.getBlockNumber()).toString());

  const nativePool = await client.readContract({ address: agentLoanManager, abi: agentLoanManagerAbi, functionName: "pool" });

  await snapshotPool("Native", nativePool, fromBlock, toBlock);
  if (securedPool && securedPool !== "0x0000000000000000000000000000000000000000") {
    await snapshotPool("Secured", securedPool, fromBlock, toBlock);
  }

  if (nativeRewards) {
    await snapshotRewards("Native", nativeRewards, fromBlock, toBlock);
  }
  if (securedRewards) {
    await snapshotRewards("Secured", securedRewards, fromBlock, toBlock);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
