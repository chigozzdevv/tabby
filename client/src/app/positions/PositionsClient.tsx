"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  createWalletClient,
  custom,
  parseEther,
  parseUnits,
  type Address,
  type EIP1193Provider,
  type WalletClient,
} from "viem";
import LandingHeader from "../landing/header";
import LandingFooter from "../landing/footer";

const API_BASE = (process.env.NEXT_PUBLIC_TABBY_API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const RPC_URL = process.env.NEXT_PUBLIC_MONAD_RPC ?? "https://rpc.monad.xyz";
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_MONAD_CHAIN_ID ?? "143");
const CHAIN = {
  id: CHAIN_ID,
  name: CHAIN_ID === 143 ? "Monad Mainnet" : "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
} as const;

const nativePoolAbi = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

const securedPoolAbi = [
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

const rewardsAbi = [
  { type: "function", name: "stake", stateMutability: "nonpayable", inputs: [{ name: "shares", type: "uint256" }], outputs: [] },
  { type: "function", name: "unstake", stateMutability: "nonpayable", inputs: [{ name: "shares", type: "uint256" }], outputs: [] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

type PoolSnapshot = {
  address: string;
  totalAssetsWei: string;
  totalOutstandingPrincipalWei: string;
  poolBalanceWei: string;
  asset?: string;
};

type PoolsResponse = {
  ok: boolean;
  data: {
    native: PoolSnapshot | null;
    secured: PoolSnapshot | null;
  };
};

type PositionResponse = {
  ok: boolean;
  data: {
    shares: string;
    totalShares: string;
    totalAssetsWei: string;
    estimatedAssetsWei: string;
  };
};

type RewardsSnapshot = {
  address?: string;
  pool?: string;
  rewardToken: string;
  totalStakedShares: string;
  pendingRewards: string;
  stakedShares?: string;
  earned?: string;
};

type RewardsResponse = {
  ok: boolean;
  data: {
    native: RewardsSnapshot | null;
    secured: RewardsSnapshot | null;
  };
};

const formatWei = (value?: string, unit = "MON") => {
  if (!value) return "—";
  try {
    const wei = BigInt(value);
    const base = BigInt("1000000000000000000");
    const whole = wei / base;
    const fraction = wei % base;
    const fractionStr = fraction.toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
    const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${wholeStr}${fractionStr ? `.${fractionStr}` : ""} ${unit}`;
  } catch {
    return "—";
  }
};

const formatPercent = (numerator?: string, denominator?: string) => {
  if (!numerator || !denominator) return "—";
  try {
    const num = BigInt(numerator);
    const den = BigInt(denominator);
    if (den === BigInt(0)) return "0.00%";
    const bps = Number((num * BigInt(10000)) / den);
    return `${(bps / 100).toFixed(2)}%`;
  } catch {
    return "—";
  }
};

const shorten = (address?: string) => {
  if (!address) return "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
};

const toBigIntOrZero = (value?: string) => {
  if (!value) return BigInt(0);
  try {
    return BigInt(value);
  } catch {
    return BigInt(0);
  }
};

const describeTxError = (err: unknown) => {
  if (!(err instanceof Error)) return "Transaction failed";
  if (/user rejected|rejected the request|denied/i.test(err.message)) return "Request rejected in wallet.";
  if (/does not match the target chain|ChainMismatchError/i.test(err.message)) {
    return `Wrong network. Switch your wallet to ${CHAIN.name} (chainId ${CHAIN_ID}) and try again.`;
  }
  return err.message;
};

async function ensureTargetChain(walletClient: WalletClient) {
  const currentChainId = await walletClient.getChainId();
  if (currentChainId === CHAIN_ID) return;

  try {
    await walletClient.switchChain({ id: CHAIN_ID });
  } catch {
    // If chain isn't added, attempt to add then switch.
    await walletClient.addChain({ chain: CHAIN });
    await walletClient.switchChain({ id: CHAIN_ID });
  }
}

async function getWalletClient() {
  if (typeof window === "undefined" || !("ethereum" in window)) {
    throw new Error("No wallet detected. Install a wallet extension to continue.");
  }
  const ethereum = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  if (!ethereum) throw new Error("No wallet detected. Install a wallet extension to continue.");
  const existingAccounts = (await ethereum.request({ method: "eth_accounts" })) as string[];
  const accounts =
    existingAccounts?.length > 0
      ? existingAccounts
      : ((await ethereum.request({ method: "eth_requestAccounts" })) as string[]);
  const account = accounts?.[0];
  if (!account) throw new Error("No account returned");
  const walletClient = createWalletClient({ account: account as Address, chain: CHAIN, transport: custom(ethereum) });
  return { walletClient, account: account as Address };
}

export default function PositionsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [switchingChain, setSwitchingChain] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  const [poolData, setPoolData] = useState<PoolsResponse["data"] | null>(null);
  const [positionNative, setPositionNative] = useState<PositionResponse["data"] | null>(null);
  const [positionSecured, setPositionSecured] = useState<PositionResponse["data"] | null>(null);
  const [rewards, setRewards] = useState<RewardsResponse["data"] | null>(null);
  const [loadingPools, setLoadingPools] = useState(false);
  const [loadingPositions, setLoadingPositions] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [txMessage, setTxMessage] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [pendingTxLabel, setPendingTxLabel] = useState<string | null>(null);

  const [nativeDeposit, setNativeDeposit] = useState("");
  const [nativeWithdrawShares, setNativeWithdrawShares] = useState("");
  const [nativeStakeShares, setNativeStakeShares] = useState("");
  const [nativeUnstakeShares, setNativeUnstakeShares] = useState("");

  const [securedDeposit, setSecuredDeposit] = useState("");
  const [securedWithdrawShares, setSecuredWithdrawShares] = useState("");
  const [securedStakeShares, setSecuredStakeShares] = useState("");
  const [securedUnstakeShares, setSecuredUnstakeShares] = useState("");

  const accountParam = useMemo(() => searchParams.get("account"), [searchParams]);

  const isWrongChain = walletChainId !== null && walletChainId !== CHAIN_ID;
  const isBusy = connecting || switchingChain || pendingTxLabel !== null;

  useEffect(() => {
    if (accountParam && /^0x[a-fA-F0-9]{40}$/.test(accountParam)) {
      setWalletAddress(accountParam);
      if (typeof window !== "undefined") window.localStorage.setItem("tabby.walletAddress", accountParam);
      return;
    }
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("tabby.walletAddress");
    if (stored) setWalletAddress(stored);
  }, [accountParam]);

  useEffect(() => {
    if (typeof window === "undefined" || !("ethereum" in window)) return;
    const ethereum = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
    if (!ethereum) return;

    const syncChainId = async () => {
      try {
        const hex = (await ethereum.request({ method: "eth_chainId" })) as string;
        setWalletChainId(Number.parseInt(hex, 16));
      } catch {
        // ignore
      }
    };

    const handleChainChanged = (chainIdHex: string) => {
      setWalletChainId(Number.parseInt(chainIdHex, 16));
      // Clear tx state; likely user is in the middle of fixing a network mismatch.
      setTxError(null);
      setTxMessage(null);
    };

    const handleAccountsChanged = (accounts: Address[]) => {
      const account = accounts?.[0] ?? null;
      setWalletAddress(account);
      if (typeof window === "undefined") return;
      if (account) window.localStorage.setItem("tabby.walletAddress", account);
      else window.localStorage.removeItem("tabby.walletAddress");
    };

    void syncChainId();
    ethereum.on("chainChanged", handleChainChanged);
    ethereum.on("accountsChanged", handleAccountsChanged);
    return () => {
      ethereum.removeListener("chainChanged", handleChainChanged);
      ethereum.removeListener("accountsChanged", handleAccountsChanged);
    };
  }, []);

  useEffect(() => {
    setLoadingPools(true);
    setLoadError(null);
    fetch(`${API_BASE}/liquidity/pools`)
      .then((res) => res.json())
      .then((data: PoolsResponse) => {
        if (!data?.ok) throw new Error("Failed to load pools");
        setPoolData(data.data);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load pools"))
      .finally(() => setLoadingPools(false));
  }, []);

  useEffect(() => {
    if (!walletAddress) return;
    setLoadingPositions(true);
    setLoadError(null);
    Promise.all([
      fetch(`${API_BASE}/liquidity/native/position?account=${walletAddress}`).then((res) => res.json()),
      fetch(`${API_BASE}/liquidity/secured/position?account=${walletAddress}`).then((res) => res.json()).catch(() => null),
      fetch(`${API_BASE}/liquidity/rewards?account=${walletAddress}`).then((res) => res.json()),
    ])
      .then(([nativeRes, securedRes, rewardsRes]) => {
        if (nativeRes?.ok) setPositionNative(nativeRes.data);
        if (securedRes?.ok) setPositionSecured(securedRes.data);
        if (rewardsRes?.ok) setRewards(rewardsRes.data);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load positions"))
      .finally(() => setLoadingPositions(false));
  }, [walletAddress]);

  const connectWallet = async () => {
    setWalletError(null);
    if (typeof window === "undefined" || !("ethereum" in window)) {
      setWalletError("No wallet detected. Install a wallet extension to continue.");
      return;
    }
    try {
      setConnecting(true);
      const ethereum = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
      if (!ethereum) throw new Error("No wallet detected. Install a wallet extension to continue.");
      const accounts = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
      const account = accounts?.[0];
      if (!account) throw new Error("No account returned");
      setWalletAddress(account);
      window.localStorage.setItem("tabby.walletAddress", account);
      router.replace(`/positions?account=${account}`);
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : "Failed to connect wallet");
    } finally {
      setConnecting(false);
    }
  };

  const refreshPositions = async (account: string) => {
    setLoadingPositions(true);
    setLoadError(null);
    try {
      const [nativeRes, securedRes, rewardsRes] = await Promise.all([
        fetch(`${API_BASE}/liquidity/native/position?account=${account}`).then((res) => res.json()),
        fetch(`${API_BASE}/liquidity/secured/position?account=${account}`)
          .then((res) => res.json())
          .catch(() => null),
        fetch(`${API_BASE}/liquidity/rewards?account=${account}`).then((res) => res.json()),
      ]);
      setPositionNative(nativeRes?.ok ? nativeRes.data : null);
      setPositionSecured(securedRes?.ok ? securedRes.data : null);
      setRewards(rewardsRes?.ok ? rewardsRes.data : null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load positions");
    } finally {
      setLoadingPositions(false);
    }
  };

  const switchToTargetChain = async () => {
    setWalletError(null);
    setTxError(null);
    setTxMessage(null);
    if (typeof window === "undefined" || !("ethereum" in window)) {
      setWalletError("No wallet detected. Install a wallet extension to continue.");
      return;
    }

    const ethereum = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
    if (!ethereum) {
      setWalletError("No wallet detected. Install a wallet extension to continue.");
      return;
    }

    try {
      setSwitchingChain(true);
      const walletClient = createWalletClient({ chain: CHAIN, transport: custom(ethereum) });
      await ensureTargetChain(walletClient);
    } catch (err) {
      setWalletError(describeTxError(err));
    } finally {
      setSwitchingChain(false);
    }
  };

  const runTx = async (label: string, action: () => Promise<`0x${string}`>) => {
    setTxError(null);
    setTxMessage(`${label}: waiting for wallet...`);
    setPendingTxLabel(label);
    try {
      const hash = await action();
      setTxMessage(`${label} submitted: ${hash}`);
    } catch (err) {
      setTxMessage(null);
      setTxError(describeTxError(err));
    } finally {
      setPendingTxLabel(null);
    }
  };

  const handleNativeDeposit = async () => {
    const nativePool = poolData?.native;
    if (!nativePool) return;
    const amount = nativeDeposit.trim();
    if (!amount) return;
    await runTx("Native deposit", async () => {
      const { walletClient, account } = await getWalletClient();
      await ensureTargetChain(walletClient);
      const hash = await walletClient.writeContract({
        address: nativePool.address as Address,
        abi: nativePoolAbi,
        functionName: "deposit",
        account,
        value: parseEther(amount),
      });
      setWalletAddress(account);
      window.localStorage.setItem("tabby.walletAddress", account);
      void refreshPositions(account);
      return hash;
    });
  };

  const handleNativeWithdraw = async () => {
    const nativePool = poolData?.native;
    if (!nativePool) return;
    const sharesInput = nativeWithdrawShares.trim();
    if (!sharesInput) return;
    await runTx("Native withdraw", async () => {
      const { walletClient, account } = await getWalletClient();
      await ensureTargetChain(walletClient);
      const hash = await walletClient.writeContract({
        address: nativePool.address as Address,
        abi: nativePoolAbi,
        functionName: "withdraw",
        args: [parseUnits(sharesInput, 18)],
        account,
      });
      void refreshPositions(account);
      return hash;
    });
  };

  const handleNativeStake = async () => {
    const rewardsAddress = rewards?.native?.address;
    if (!rewardsAddress) return;
    const sharesInput = nativeStakeShares.trim();
    if (!sharesInput) return;
    await runTx("Stake native shares", async () => {
      const { walletClient, account } = await getWalletClient();
      await ensureTargetChain(walletClient);
      const hash = await walletClient.writeContract({
        address: rewardsAddress as Address,
        abi: rewardsAbi,
        functionName: "stake",
        args: [parseUnits(sharesInput, 18)],
        account,
      });
      void refreshPositions(account);
      return hash;
    });
  };

  const handleNativeUnstake = async () => {
    const rewardsAddress = rewards?.native?.address;
    if (!rewardsAddress) return;
    const sharesInput = nativeUnstakeShares.trim();
    if (!sharesInput) return;
    await runTx("Unstake native shares", async () => {
      const { walletClient, account } = await getWalletClient();
      await ensureTargetChain(walletClient);
      const hash = await walletClient.writeContract({
        address: rewardsAddress as Address,
        abi: rewardsAbi,
        functionName: "unstake",
        args: [parseUnits(sharesInput, 18)],
        account,
      });
      void refreshPositions(account);
      return hash;
    });
  };

  const handleNativeClaim = async () => {
    const rewardsAddress = rewards?.native?.address;
    if (!rewardsAddress) return;
    await runTx("Claim native rewards", async () => {
      const { walletClient, account } = await getWalletClient();
      await ensureTargetChain(walletClient);
      const hash = await walletClient.writeContract({
        address: rewardsAddress as Address,
        abi: rewardsAbi,
        functionName: "claim",
        account,
      });
      void refreshPositions(account);
      return hash;
    });
  };

  const handleSecuredDeposit = async () => {
    const securedPool = poolData?.secured;
    if (!securedPool?.asset) return;
    const amount = securedDeposit.trim();
    if (!amount) return;
    await runTx("Secured deposit", async () => {
      const { walletClient, account } = await getWalletClient();
      await ensureTargetChain(walletClient);
      const amountWei = parseUnits(amount, 18);
      await walletClient.writeContract({
        address: securedPool.asset as Address,
        abi: erc20Abi,
        functionName: "approve",
        args: [securedPool.address as Address, amountWei],
        account,
      });
      const hash = await walletClient.writeContract({
        address: securedPool.address as Address,
        abi: securedPoolAbi,
        functionName: "deposit",
        args: [amountWei],
        account,
      });
      setWalletAddress(account);
      window.localStorage.setItem("tabby.walletAddress", account);
      void refreshPositions(account);
      return hash;
    });
  };

  const handleSecuredWithdraw = async () => {
    const securedPool = poolData?.secured;
    if (!securedPool) return;
    const sharesInput = securedWithdrawShares.trim();
    if (!sharesInput) return;
    await runTx("Secured withdraw", async () => {
      const { walletClient, account } = await getWalletClient();
      await ensureTargetChain(walletClient);
      const hash = await walletClient.writeContract({
        address: securedPool.address as Address,
        abi: securedPoolAbi,
        functionName: "withdraw",
        args: [parseUnits(sharesInput, 18)],
        account,
      });
      void refreshPositions(account);
      return hash;
    });
  };

  const handleSecuredStake = async () => {
    const rewardsAddress = rewards?.secured?.address;
    if (!rewardsAddress) return;
    const sharesInput = securedStakeShares.trim();
    if (!sharesInput) return;
    await runTx("Stake secured shares", async () => {
      const { walletClient, account } = await getWalletClient();
      await ensureTargetChain(walletClient);
      const hash = await walletClient.writeContract({
        address: rewardsAddress as Address,
        abi: rewardsAbi,
        functionName: "stake",
        args: [parseUnits(sharesInput, 18)],
        account,
      });
      void refreshPositions(account);
      return hash;
    });
  };

  const handleSecuredUnstake = async () => {
    const rewardsAddress = rewards?.secured?.address;
    if (!rewardsAddress) return;
    const sharesInput = securedUnstakeShares.trim();
    if (!sharesInput) return;
    await runTx("Unstake secured shares", async () => {
      const { walletClient, account } = await getWalletClient();
      await ensureTargetChain(walletClient);
      const hash = await walletClient.writeContract({
        address: rewardsAddress as Address,
        abi: rewardsAbi,
        functionName: "unstake",
        args: [parseUnits(sharesInput, 18)],
        account,
      });
      void refreshPositions(account);
      return hash;
    });
  };

  const handleSecuredClaim = async () => {
    const rewardsAddress = rewards?.secured?.address;
    if (!rewardsAddress) return;
    await runTx("Claim secured rewards", async () => {
      const { walletClient, account } = await getWalletClient();
      await ensureTargetChain(walletClient);
      const hash = await walletClient.writeContract({
        address: rewardsAddress as Address,
        abi: rewardsAbi,
        functionName: "claim",
        account,
      });
      void refreshPositions(account);
      return hash;
    });
  };

  const utilization = formatPercent(poolData?.native?.totalOutstandingPrincipalWei, poolData?.native?.totalAssetsWei);
  const securedUtilization = formatPercent(
    poolData?.secured?.totalOutstandingPrincipalWei,
    poolData?.secured?.totalAssetsWei
  );

  const nativeShares = toBigIntOrZero(positionNative?.shares);
  const securedShares = toBigIntOrZero(positionSecured?.shares);
  const nativeStakedShares = toBigIntOrZero(rewards?.native?.stakedShares);
  const securedStakedShares = toBigIntOrZero(rewards?.secured?.stakedShares);
  const nativeEarned = toBigIntOrZero(rewards?.native?.earned);
  const securedEarned = toBigIntOrZero(rewards?.secured?.earned);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <LandingHeader />
      <main className="mx-auto w-full max-w-[1440px] px-6 pb-20 pt-14">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.3em] text-neutral-400">Liquidity positions</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={connectWallet}
              disabled={connecting || switchingChain}
              className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {walletAddress ? "Wallet connected" : connecting ? "Connecting..." : "Connect wallet"}
            </button>
            {walletAddress && isWrongChain ? (
              <button
                type="button"
                onClick={switchToTargetChain}
                disabled={switchingChain}
                className="rounded-full border border-amber-400/50 bg-amber-500/10 px-6 py-3 text-sm font-semibold text-amber-200 transition hover:border-amber-300 hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {switchingChain ? "Switching..." : `Switch to ${CHAIN.name}`}
              </button>
            ) : null}
            {walletAddress ? (
              <span className="text-xs text-neutral-400">Connected: {shorten(walletAddress)}</span>
            ) : null}
            {walletAddress && isWrongChain ? (
              <span className="text-xs text-amber-300">
                Wrong network (chain {walletChainId}). Expected {CHAIN_ID}.
              </span>
            ) : null}
            {walletError ? <span className="text-xs text-red-400">{walletError}</span> : null}
            {txMessage ? <span className="text-xs text-emerald-300">{txMessage}</span> : null}
            {txError ? <span className="text-xs text-red-400">{txError}</span> : null}
          </div>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-neutral-950/60 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">Native pool</p>
                <h2 className="mt-2 text-xl font-semibold text-white">MON liquidity</h2>
              </div>
              <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-neutral-400">Active</span>
            </div>
            {loadingPools ? (
              <p className="mt-4 text-sm text-neutral-400">Loading pool data…</p>
            ) : loadError ? (
              <p className="mt-4 text-sm text-red-400">{loadError}</p>
            ) : (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Total assets</p>
                  <p className="mt-2 text-sm font-semibold text-white">{formatWei(poolData?.native?.totalAssetsWei)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Pool balance</p>
                  <p className="mt-2 text-sm font-semibold text-white">{formatWei(poolData?.native?.poolBalanceWei)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Outstanding</p>
                  <p className="mt-2 text-sm font-semibold text-white">
                    {formatWei(poolData?.native?.totalOutstandingPrincipalWei)}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Utilization</p>
                  <p className="mt-2 text-sm font-semibold text-white">{utilization}</p>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-white/10 bg-neutral-950/60 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">Secured pool</p>
                <h2 className="mt-2 text-xl font-semibold text-white">ERC20 liquidity</h2>
              </div>
              <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-neutral-400">
                {poolData?.secured ? "Active" : "Not configured"}
              </span>
            </div>
            {loadingPools ? (
              <p className="mt-4 text-sm text-neutral-400">Loading pool data…</p>
            ) : poolData?.secured ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Total assets</p>
                  <p className="mt-2 text-sm font-semibold text-white">
                    {formatWei(poolData.secured.totalAssetsWei, "Tokens")}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Pool balance</p>
                  <p className="mt-2 text-sm font-semibold text-white">
                    {formatWei(poolData.secured.poolBalanceWei, "Tokens")}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Outstanding</p>
                  <p className="mt-2 text-sm font-semibold text-white">
                    {formatWei(poolData.secured.totalOutstandingPrincipalWei, "Tokens")}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Utilization</p>
                  <p className="mt-2 text-sm font-semibold text-white">{securedUtilization}</p>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-neutral-500">Secured pool not configured.</p>
            )}
          </div>
        </div>

        <div className="mt-10 rounded-3xl border border-white/10 bg-white/5 p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">Your positions</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Position overview</h2>
            </div>
            {loadingPositions ? <span className="text-xs text-neutral-400">Refreshing…</span> : null}
          </div>
          {walletAddress ? (
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-neutral-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">Native pool position</p>
                {positionNative ? (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Shares</p>
                      <p className="mt-2 text-sm font-semibold text-white">{positionNative.shares}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Estimated assets</p>
                      <p className="mt-2 text-sm font-semibold text-white">
                        {formatWei(positionNative.estimatedAssetsWei)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Share of pool</p>
                      <p className="mt-2 text-sm font-semibold text-white">
                        {formatPercent(positionNative.shares, positionNative.totalShares)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Earned rewards</p>
                      <p className="mt-2 text-sm font-semibold text-white">
                        {formatWei(rewards?.native?.earned, "TABBY")}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-neutral-500">No native position found.</p>
                )}

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Deposit MON</p>
                    <input
                      value={nativeDeposit}
                      onChange={(event) => setNativeDeposit(event.target.value)}
                      placeholder="0.0"
                      className="mt-2 w-full rounded-xl border border-white/10 bg-neutral-950/80 px-3 py-2 text-sm text-neutral-100 focus:border-white/40 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleNativeDeposit}
                      disabled={isBusy || isWrongChain}
                      className="mt-3 w-full rounded-full bg-white px-4 py-2 text-xs font-semibold text-neutral-900 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {pendingTxLabel === "Native deposit" ? "Processing..." : "Deposit"}
                    </button>
                  </div>
                  {nativeShares > BigInt(0) ? (
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Withdraw shares</p>
                      <input
                        value={nativeWithdrawShares}
                        onChange={(event) => setNativeWithdrawShares(event.target.value)}
                        placeholder="Shares"
                        className="mt-2 w-full rounded-xl border border-white/10 bg-neutral-950/80 px-3 py-2 text-sm text-neutral-100 focus:border-white/40 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleNativeWithdraw}
                        disabled={isBusy || isWrongChain}
                        className="mt-3 w-full rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-white transition hover:border-white/50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {pendingTxLabel === "Native withdraw" ? "Processing..." : "Withdraw"}
                      </button>
                    </div>
                  ) : null}
                </div>

                {rewards?.native?.address && (nativeShares > BigInt(0) || nativeStakedShares > BigInt(0) || nativeEarned > BigInt(0)) ? (
                  <div className="mt-6 grid gap-4 sm:grid-cols-3">
                    {nativeShares > BigInt(0) ? (
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Stake shares</p>
                        <input
                          value={nativeStakeShares}
                          onChange={(event) => setNativeStakeShares(event.target.value)}
                          placeholder="Shares"
                          className="mt-2 w-full rounded-xl border border-white/10 bg-neutral-950/80 px-3 py-2 text-sm text-neutral-100 focus:border-white/40 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={handleNativeStake}
                          disabled={isBusy || isWrongChain}
                          className="mt-3 w-full rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-white transition hover:border-white/50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {pendingTxLabel === "Stake native shares" ? "Processing..." : "Stake"}
                        </button>
                      </div>
                    ) : null}
                    {nativeStakedShares > BigInt(0) ? (
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Unstake shares</p>
                        <input
                          value={nativeUnstakeShares}
                          onChange={(event) => setNativeUnstakeShares(event.target.value)}
                          placeholder="Shares"
                          className="mt-2 w-full rounded-xl border border-white/10 bg-neutral-950/80 px-3 py-2 text-sm text-neutral-100 focus:border-white/40 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={handleNativeUnstake}
                          disabled={isBusy || isWrongChain}
                          className="mt-3 w-full rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-white transition hover:border-white/50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {pendingTxLabel === "Unstake native shares" ? "Processing..." : "Unstake"}
                        </button>
                      </div>
                    ) : null}
                    {nativeEarned > BigInt(0) ? (
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Claim TABBY</p>
                        <div className="mt-2 rounded-xl border border-white/10 bg-neutral-950/80 px-3 py-2 text-sm text-neutral-200">
                          {formatWei(rewards?.native?.earned, "TABBY")}
                        </div>
                        <button
                          type="button"
                          onClick={handleNativeClaim}
                          disabled={isBusy || isWrongChain}
                          className="mt-3 w-full rounded-full bg-white px-4 py-2 text-xs font-semibold text-neutral-900 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {pendingTxLabel === "Claim native rewards" ? "Processing..." : "Claim"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border border-white/10 bg-neutral-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">Secured pool position</p>
                {positionSecured ? (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Shares</p>
                      <p className="mt-2 text-sm font-semibold text-white">{positionSecured.shares}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Estimated assets</p>
                      <p className="mt-2 text-sm font-semibold text-white">
                        {formatWei(positionSecured.estimatedAssetsWei, "Tokens")}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Share of pool</p>
                      <p className="mt-2 text-sm font-semibold text-white">
                        {formatPercent(positionSecured.shares, positionSecured.totalShares)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Earned rewards</p>
                      <p className="mt-2 text-sm font-semibold text-white">
                        {formatWei(rewards?.secured?.earned, "TABBY")}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-neutral-500">No secured position found.</p>
                )}

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Deposit WMON</p>
                    <input
                      value={securedDeposit}
                      onChange={(event) => setSecuredDeposit(event.target.value)}
                      placeholder="0.0"
                      className="mt-2 w-full rounded-xl border border-white/10 bg-neutral-950/80 px-3 py-2 text-sm text-neutral-100 focus:border-white/40 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleSecuredDeposit}
                      disabled={!poolData?.secured?.asset || isBusy || isWrongChain}
                      className="mt-3 w-full rounded-full bg-white px-4 py-2 text-xs font-semibold text-neutral-900 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {pendingTxLabel === "Secured deposit" ? "Processing..." : "Approve + Deposit"}
                    </button>
                  </div>
                  {securedShares > BigInt(0) ? (
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Withdraw shares</p>
                      <input
                        value={securedWithdrawShares}
                        onChange={(event) => setSecuredWithdrawShares(event.target.value)}
                        placeholder="Shares"
                        className="mt-2 w-full rounded-xl border border-white/10 bg-neutral-950/80 px-3 py-2 text-sm text-neutral-100 focus:border-white/40 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleSecuredWithdraw}
                        disabled={isBusy || isWrongChain}
                        className="mt-3 w-full rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-white transition hover:border-white/50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {pendingTxLabel === "Secured withdraw" ? "Processing..." : "Withdraw"}
                      </button>
                    </div>
                  ) : null}
                </div>

                {rewards?.secured?.address && (securedShares > BigInt(0) || securedStakedShares > BigInt(0) || securedEarned > BigInt(0)) ? (
                  <div className="mt-6 grid gap-4 sm:grid-cols-3">
                    {securedShares > BigInt(0) ? (
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Stake shares</p>
                        <input
                          value={securedStakeShares}
                          onChange={(event) => setSecuredStakeShares(event.target.value)}
                          placeholder="Shares"
                          className="mt-2 w-full rounded-xl border border-white/10 bg-neutral-950/80 px-3 py-2 text-sm text-neutral-100 focus:border-white/40 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={handleSecuredStake}
                          disabled={isBusy || isWrongChain}
                          className="mt-3 w-full rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-white transition hover:border-white/50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {pendingTxLabel === "Stake secured shares" ? "Processing..." : "Stake"}
                        </button>
                      </div>
                    ) : null}
                    {securedStakedShares > BigInt(0) ? (
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Unstake shares</p>
                        <input
                          value={securedUnstakeShares}
                          onChange={(event) => setSecuredUnstakeShares(event.target.value)}
                          placeholder="Shares"
                          className="mt-2 w-full rounded-xl border border-white/10 bg-neutral-950/80 px-3 py-2 text-sm text-neutral-100 focus:border-white/40 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={handleSecuredUnstake}
                          disabled={isBusy || isWrongChain}
                          className="mt-3 w-full rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-white transition hover:border-white/50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {pendingTxLabel === "Unstake secured shares" ? "Processing..." : "Unstake"}
                        </button>
                      </div>
                    ) : null}
                    {securedEarned > BigInt(0) ? (
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Claim TABBY</p>
                        <div className="mt-2 rounded-xl border border-white/10 bg-neutral-950/80 px-3 py-2 text-sm text-neutral-200">
                          {formatWei(rewards?.secured?.earned, "TABBY")}
                        </div>
                        <button
                          type="button"
                          onClick={handleSecuredClaim}
                          disabled={isBusy || isWrongChain}
                          className="mt-3 w-full rounded-full bg-white px-4 py-2 text-xs font-semibold text-neutral-900 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {pendingTxLabel === "Claim secured rewards" ? "Processing..." : "Claim"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-neutral-500">Connect a wallet to view your positions.</p>
          )}
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
