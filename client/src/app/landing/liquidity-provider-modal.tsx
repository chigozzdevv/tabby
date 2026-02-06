"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type PoolSnapshot = {
  address: string;
  totalAssetsWei: string;
  totalOutstandingPrincipalWei: string;
  poolBalanceWei: string;
};

type PoolsResponse = {
  ok: boolean;
  data: {
    native: PoolSnapshot | null;
    secured: PoolSnapshot | null;
  };
};

const formatWei = (value?: string) => {
  if (!value) return "—";
  try {
    const wei = BigInt(value);
    const base = BigInt("1000000000000000000");
    const whole = wei / base;
    const fraction = wei % base;
    const fractionStr = fraction.toString().padStart(18, "0").slice(0, 4);
    return `${whole.toString()}.${fractionStr} MON`;
  } catch {
    return "—";
  }
};

export default function LiquidityProviderModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const apiBase = useMemo(
    () => (process.env.NEXT_PUBLIC_TABBY_API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    []
  );
  const [poolData, setPoolData] = useState<PoolsResponse["data"] | null>(null);
  const [loadingPools, setLoadingPools] = useState(false);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setPoolError(null);
    setLoadingPools(true);
    fetch(`${apiBase}/liquidity/pools`)
      .then((res) => res.json())
      .then((data: PoolsResponse) => {
        if (!data?.ok) throw new Error("Failed to load pools");
        setPoolData(data.data);
      })
      .catch((err) => {
        setPoolError(err instanceof Error ? err.message : "Failed to load pools");
      })
      .finally(() => setLoadingPools(false));
  }, [apiBase, isOpen]);

  const connectWallet = async () => {
    setWalletError(null);
    if (typeof window === "undefined" || !("ethereum" in window)) {
      setWalletError("No wallet detected. Install a wallet extension to continue.");
      return;
    }
    try {
      setConnecting(true);
      const ethereum = (window as any).ethereum;
      const accounts: string[] = await ethereum.request({ method: "eth_requestAccounts" });
      const account = accounts?.[0];
      if (!account) throw new Error("No account returned");
      setWalletAddress(account);
      window.localStorage.setItem("tabby.walletAddress", account);
      onClose();
      router.push(`/positions?account=${account}`);
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : "Failed to connect wallet");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="w-full max-w-2xl rounded-3xl border border-white/10 bg-neutral-950 p-6 text-neutral-100"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-neutral-400">Liquidity provider</p>
                <h3 className="mt-3 text-2xl font-semibold text-white">Provide liquidity to Tabby pools.</h3>
                <p className="mt-3 text-sm text-neutral-400">
                  Review pool status, connect a wallet, and access liquidity programs.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-white/10 px-3 py-1 text-xs text-neutral-300 hover:border-white/30"
              >
                Close
              </button>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Native gas pool</p>
                {loadingPools ? (
                  <p className="mt-3 text-sm text-neutral-400">Loading pool data...</p>
                ) : poolError ? (
                  <p className="mt-3 text-sm text-red-400">{poolError}</p>
                ) : (
                  <div className="mt-3 space-y-2 text-sm text-neutral-300">
                    <div className="flex items-center justify-between">
                      <span>Total assets</span>
                      <span className="text-white">{formatWei(poolData?.native?.totalAssetsWei)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Outstanding</span>
                      <span className="text-white">
                        {formatWei(poolData?.native?.totalOutstandingPrincipalWei)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Pool balance</span>
                      <span className="text-white">{formatWei(poolData?.native?.poolBalanceWei)}</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Your position</p>
                {walletAddress ? (
                  <div className="mt-3 space-y-2 text-sm text-neutral-300">
                    <div className="flex items-center justify-between">
                      <span>Wallet</span>
                      <span className="text-white">
                        {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Status</span>
                      <span className="text-white">Redirecting to positions</span>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-neutral-400">Connect a wallet to continue to your dashboard.</p>
                )}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={connectWallet}
                disabled={connecting}
                className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {walletAddress ? "Redirecting..." : connecting ? "Connecting..." : "Connect wallet"}
              </button>
              <a
                href="/agent-quickstart"
                className="rounded-full border border-white/20 px-6 py-3 text-sm font-medium text-white transition hover:border-white/50"
              >
                Agent Quickstart
              </a>
              {walletError && <span className="text-xs text-red-400">{walletError}</span>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
