import "dotenv/config";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

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
const tabbyToken = requiredEnv(process.env.TABBY_TOKEN as Address | undefined, "TABBY_TOKEN");
const treasuryPrivateKey = requiredEnv(process.env.TREASURY_PRIVATE_KEY as Hex | undefined, "TREASURY_PRIVATE_KEY");

const SWAP_PROVIDER = (process.env.SWAP_PROVIDER ?? "").trim().toLowerCase();
const ZEROX_API_KEY = (process.env.ZEROX_API_KEY ?? "").trim();
const SWAP_SLIPPAGE_BPS = Number(process.env.SWAP_SLIPPAGE_BPS ?? "100"); // 1% default (0x API default)
const SWAP_NATIVE_GAS_BUFFER_WEI = process.env.SWAP_NATIVE_GAS_BUFFER_WEI ? BigInt(process.env.SWAP_NATIVE_GAS_BUFFER_WEI) : 0n;

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

const NATIVE_TOKEN_PLACEHOLDER = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;

const agentLoanManagerAbi = [
  { type: "function", name: "pool", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

const poolAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "ASSET", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
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

type ZeroExAllowanceHolderQuote = {
  allowanceTarget: Address;
  buyAmount: string;
  minBuyAmount: string;
  liquidityAvailable: boolean;
  transaction: {
    to: Address;
    data: Hex;
    value: string;
  };
};

async function get0xQuote({
  sellToken,
  buyToken,
  sellAmount,
  taker,
}: {
  sellToken: Address;
  buyToken: Address;
  sellAmount: bigint;
  taker: Address;
}): Promise<ZeroExAllowanceHolderQuote> {
  if (!ZEROX_API_KEY) {
    throw new Error("ZEROX_API_KEY is required when SWAP_PROVIDER=0x (get it from https://dashboard.0x.org)");
  }
  if (!Number.isFinite(SWAP_SLIPPAGE_BPS) || SWAP_SLIPPAGE_BPS < 0 || SWAP_SLIPPAGE_BPS > 10_000) {
    throw new Error("SWAP_SLIPPAGE_BPS must be between 0 and 10000");
  }

  const url = new URL("https://api.0x.org/swap/allowance-holder/quote");
  url.searchParams.set("chainId", String(chainId));
  url.searchParams.set("sellToken", sellToken);
  url.searchParams.set("buyToken", buyToken);
  url.searchParams.set("sellAmount", sellAmount.toString());
  url.searchParams.set("taker", taker);
  url.searchParams.set("slippageBps", String(SWAP_SLIPPAGE_BPS));

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "0x-api-key": ZEROX_API_KEY,
      "0x-version": "v2",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`0x quote failed (${res.status} ${res.statusText}): ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as Partial<ZeroExAllowanceHolderQuote>;
  if (!data || typeof data !== "object") throw new Error("0x quote returned invalid JSON");
  if (!data.allowanceTarget) throw new Error("0x quote missing allowanceTarget");
  if (!data.transaction?.to || !data.transaction?.data || data.transaction?.value === undefined) {
    throw new Error("0x quote missing transaction payload");
  }
  if (data.liquidityAvailable === false) throw new Error("0x quote reports no liquidity");

  return data as ZeroExAllowanceHolderQuote;
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
  let sharesToWithdraw = sharesArg
    ? BigInt(sharesArg)
    : await client.readContract({ address: targetPool, abi: poolAbi, functionName: "balanceOf", args: [account.address] });

  if (sharesToWithdraw === BigInt(0)) {
    console.log("No shares to withdraw.");
    return;
  }

  // Pools mint protocol fees as *shares*, but shares are claims on totalAssets (which includes outstanding principal).
  // If most of the pool is lent out, the pool may be illiquid and a full share-withdraw can revert. Clamp to what's liquid.
  const [totalAssets, totalShares] = await Promise.all([
    client.readContract({ address: targetPool, abi: poolAbi, functionName: "totalAssets" }),
    client.readContract({ address: targetPool, abi: poolAbi, functionName: "totalShares" }),
  ]);
  if (totalAssets === 0n || totalShares === 0n) {
    console.log("Pool has no assets or shares; skipping withdraw.");
    return;
  }

  let liquidAssets = 0n;
  if (poolFlag === "native") {
    liquidAssets = await client.getBalance({ address: targetPool });
  } else {
    const asset = await client.readContract({ address: targetPool, abi: poolAbi, functionName: "ASSET" });
    liquidAssets = await client.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [targetPool] });
  }

  const maxSharesByLiquidity = (liquidAssets * totalShares) / totalAssets;
  if (maxSharesByLiquidity === 0n) {
    console.log("Pool is currently illiquid (no withdrawable assets). Try again later.");
    return;
  }

  if (sharesToWithdraw > maxSharesByLiquidity) {
    console.log(
      `Clamping withdraw shares from ${sharesToWithdraw.toString()} to ${maxSharesByLiquidity.toString()} due to pool liquidity.`
    );
    sharesToWithdraw = maxSharesByLiquidity;
  }

  const withdrawAssets = (sharesToWithdraw * totalAssets) / totalShares;
  if (withdrawAssets === 0n) {
    console.log("Computed withdraw assets is 0; skipping withdraw.");
    return;
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
  await client.waitForTransactionReceipt({ hash: withdrawHash });

  const tabbyBeforeSwap = await client.readContract({ address: tabbyToken, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });

  if (SWAP_PROVIDER === "0x") {
    const sellToken =
      poolFlag === "native"
        ? (NATIVE_TOKEN_PLACEHOLDER as Address)
        : await client.readContract({ address: targetPool, abi: poolAbi, functionName: "ASSET" });

    let sellAmount = withdrawAssets;
    if (sellToken.toLowerCase() === NATIVE_TOKEN_PLACEHOLDER.toLowerCase() && SWAP_NATIVE_GAS_BUFFER_WEI > 0n) {
      sellAmount = sellAmount > SWAP_NATIVE_GAS_BUFFER_WEI ? sellAmount - SWAP_NATIVE_GAS_BUFFER_WEI : 0n;
    }

    if (sellAmount === 0n) {
      console.log("Swap step skipped (sellAmount is 0 after gas buffer).");
    } else {
      console.log(`Fetching 0x quote: sell ${sellAmount.toString()} of ${sellToken} for TABBY...`);
      const quote = await get0xQuote({
        sellToken,
        buyToken: tabbyToken,
        sellAmount,
        taker: account.address,
      });

      if (sellToken.toLowerCase() !== NATIVE_TOKEN_PLACEHOLDER.toLowerCase()) {
        const approveHash = await walletClient.writeContract({
          address: sellToken,
          abi: erc20Abi,
          functionName: "approve",
          args: [quote.allowanceTarget, sellAmount],
          account,
        });
        console.log(`Approve tx: ${approveHash}`);
        await client.waitForTransactionReceipt({ hash: approveHash });
      }

      const swapHash = await walletClient.sendTransaction({
        account,
        to: quote.transaction.to,
        data: quote.transaction.data,
        value: BigInt(quote.transaction.value),
      });
      console.log(`Swap tx: ${swapHash}`);
      await client.waitForTransactionReceipt({ hash: swapHash });
    }
  } else {
    const swapTo = process.env.SWAP_TO as Address | undefined;
    const swapData = process.env.SWAP_DATA as Hex | undefined;
    const swapValue = process.env.SWAP_VALUE_WEI ? BigInt(process.env.SWAP_VALUE_WEI) : undefined;
    const swapTokenIn = process.env.SWAP_TOKEN_IN as Address | undefined;
    const swapSpender = (process.env.SWAP_SPENDER as Address | undefined) ?? swapTo;

    if (swapTo && swapData) {
      if (swapTokenIn) {
        if (!swapSpender) throw new Error("SWAP_SPENDER (or SWAP_TO) is required when SWAP_TOKEN_IN is set");
        const approveHash = await walletClient.writeContract({
          address: swapTokenIn,
          abi: erc20Abi,
          functionName: "approve",
          args: [swapSpender, withdrawAssets],
          account,
        });
        console.log(`Approve tx: ${approveHash}`);
        await client.waitForTransactionReceipt({ hash: approveHash });
      }
      const swapHash = await walletClient.sendTransaction({
        account,
        to: swapTo,
        data: swapData,
        value: swapValue,
      });
      console.log(`Swap tx: ${swapHash}`);
      await client.waitForTransactionReceipt({ hash: swapHash });
    } else {
      console.log("Swap step skipped (set SWAP_PROVIDER=0x or set SWAP_TO and SWAP_DATA to execute swap).");
    }
  }

  const notifyAmountArg = getArg("--notify") ?? process.env.TABBY_NOTIFY_AMOUNT_WEI;
  const tabbyAfterSwap = await client.readContract({ address: tabbyToken, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const boughtTabby = tabbyAfterSwap > tabbyBeforeSwap ? tabbyAfterSwap - tabbyBeforeSwap : 0n;

  // If you don't provide an explicit notify amount, default to "whatever TABBY we just bought".
  const notifyAmount = notifyAmountArg ? BigInt(notifyAmountArg) : boughtTabby;
  if (notifyAmount === 0n) {
    console.log("No TABBY_NOTIFY_AMOUNT_WEI provided and no TABBY bought. Skipping notifyRewardAmount.");
    return;
  }
  if (tabbyAfterSwap < notifyAmount) throw new Error(`Treasury TABBY balance too low: ${tabbyAfterSwap.toString()}`);

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
  await client.waitForTransactionReceipt({ hash: notifyHash });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
