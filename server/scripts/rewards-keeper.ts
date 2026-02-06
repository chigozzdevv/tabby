import "dotenv/config";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const rpcUrl = process.env.RPC_URL;
const chainId = Number(process.env.CHAIN_ID ?? "143");
const agentLoanManager = process.env.AGENT_LOAN_MANAGER_ADDRESS as Address | undefined;
const securedPool = process.env.SECURED_POOL_ADDRESS as Address | undefined;
const nativeRewards = process.env.TABBY_NATIVE_REWARDS_ADDRESS as Address | undefined;
const securedRewards = process.env.TABBY_SECURED_REWARDS_ADDRESS as Address | undefined;
const tabbyToken = process.env.TABBY_TOKEN as Address | undefined;
const treasuryPrivateKey = process.env.TREASURY_PRIVATE_KEY as Hex | undefined;

if (!rpcUrl) throw new Error("RPC_URL is required");
if (!agentLoanManager) throw new Error("AGENT_LOAN_MANAGER_ADDRESS is required");
if (!tabbyToken) throw new Error("TABBY_TOKEN is required");
if (!treasuryPrivateKey) throw new Error("TREASURY_PRIVATE_KEY is required");

const client = createPublicClient({
  chain: {
    id: chainId,
    name: chainId === 143 ? "Monad Mainnet" : "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  },
  transport: http(rpcUrl),
});

const account = privateKeyToAccount(treasuryPrivateKey);
const walletClient = createWalletClient({ account, chain: client.chain, transport: http(rpcUrl) });

const agentLoanManagerAbi = [
  { type: "function", name: "pool", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

const poolAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalShares", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "previewWithdraw", stateMutability: "view", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

const rewardsAbi = [
  { type: "function", name: "notifyRewardAmount", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
] as const;

const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

function getArg(name: string) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function main() {
  const poolFlag = getArg("--pool") ?? process.env.REWARDS_POOL;
  if (!poolFlag || (poolFlag !== "native" && poolFlag !== "secured")) {
    throw new Error("--pool must be 'native' or 'secured'");
  }

  const nativePool = await client.readContract({ address: agentLoanManager, abi: agentLoanManagerAbi, functionName: "pool" });
  const targetPool = poolFlag === "native" ? nativePool : securedPool;
  const rewardsAddress = poolFlag === "native" ? nativeRewards : securedRewards;
  if (!targetPool) throw new Error("Target pool not configured");
  if (!rewardsAddress) throw new Error("Rewards contract not configured");

  const sharesArg = getArg("--shares");
  const sharesToWithdraw = sharesArg
    ? BigInt(sharesArg)
    : await client.readContract({ address: targetPool, abi: poolAbi, functionName: "balanceOf", args: [account.address] });

  if (sharesToWithdraw === BigInt(0)) {
    console.log("No shares to withdraw.");
    return;
  }

  let withdrawAssets = BigInt(0);
  if (poolFlag === "native") {
    withdrawAssets = await client.readContract({ address: targetPool, abi: poolAbi, functionName: "previewWithdraw", args: [sharesToWithdraw] });
  } else {
    const [totalAssets, totalShares] = await Promise.all([
      client.readContract({ address: targetPool, abi: poolAbi, functionName: "totalAssets" }),
      client.readContract({ address: targetPool, abi: poolAbi, functionName: "totalShares" }),
    ]);
    withdrawAssets = totalShares === BigInt(0) ? BigInt(0) : (sharesToWithdraw * totalAssets) / totalShares;
  }

  console.log(`Withdrawing ${sharesToWithdraw.toString()} shares from ${poolFlag} pool...`);
  const withdrawHash = await walletClient.writeContract({
    address: targetPool,
    abi: poolAbi,
    functionName: "withdraw",
    args: [sharesToWithdraw],
    account,
  });
  console.log(`Withdraw tx: ${withdrawHash}`);
  console.log(`Estimated assets received: ${withdrawAssets.toString()}`);

  const swapTo = process.env.SWAP_TO as Address | undefined;
  const swapData = process.env.SWAP_DATA as Hex | undefined;
  const swapValue = process.env.SWAP_VALUE_WEI ? BigInt(process.env.SWAP_VALUE_WEI) : undefined;
  const swapTokenIn = process.env.SWAP_TOKEN_IN as Address | undefined;

  if (swapTo && swapData) {
    if (swapTokenIn) {
      await walletClient.writeContract({
        address: swapTokenIn,
        abi: erc20Abi,
        functionName: "approve",
        args: [swapTo, withdrawAssets],
        account,
      });
    }
    const swapHash = await walletClient.sendTransaction({
      account,
      to: swapTo,
      data: swapData,
      value: swapValue,
    });
    console.log(`Swap tx: ${swapHash}`);
  } else {
    console.log("Swap step skipped (set SWAP_TO and SWAP_DATA to execute swap)." );
  }

  const notifyAmountArg = getArg("--notify") ?? process.env.TABBY_NOTIFY_AMOUNT_WEI;
  if (!notifyAmountArg) {
    console.log("No TABBY_NOTIFY_AMOUNT_WEI provided. Skipping notifyRewardAmount.");
    return;
  }

  const notifyAmount = BigInt(notifyAmountArg);
  const tabbyBalance = await client.readContract({ address: tabbyToken, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  if (tabbyBalance < notifyAmount) {
    throw new Error(`Treasury TABBY balance too low: ${tabbyBalance.toString()}`);
  }

  await walletClient.writeContract({
    address: tabbyToken,
    abi: erc20Abi,
    functionName: "approve",
    args: [rewardsAddress, notifyAmount],
    account,
  });

  const notifyHash = await walletClient.writeContract({
    address: rewardsAddress,
    abi: rewardsAbi,
    functionName: "notifyRewardAmount",
    args: [notifyAmount],
    account,
  });
  console.log(`notifyRewardAmount tx: ${notifyHash}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
