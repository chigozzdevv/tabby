"use client";

import { useEffect, useMemo, useState } from "react";
import LandingHeader from "../landing/header";
import LandingFooter from "../landing/footer";

const API_BASE = (process.env.NEXT_PUBLIC_TABBY_API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

type AgentProfile = {
  id: string;
  name: string;
  karma?: number;
};

type PoolSnapshot = {
  address: string;
  totalAssetsWei: string;
  totalOutstandingPrincipalWei: string;
  poolBalanceWei: string;
};

type SecuredPoolSnapshot = PoolSnapshot & {
  asset: string;
};

type PoolsResponse = {
  native: PoolSnapshot;
  secured: SecuredPoolSnapshot | null;
};

type PoolPosition = {
  account: string;
  shares: string;
  totalShares: string;
  totalAssetsWei: string;
  estimatedAssetsWei: string;
};

type RewardsSnapshot = {
  address: string;
  pool: string;
  rewardToken: string;
  totalStakedShares: string;
  rewardPerShareStored: string;
  pendingRewards: string;
  account?: string;
  stakedShares?: string;
  earned?: string;
};

type RewardsResponse = {
  native: RewardsSnapshot | null;
  secured: RewardsSnapshot | null;
};

function formatUnits(raw: string, decimals = 18, precision = 4) {
  const value = BigInt(raw);
  const base = BigInt(10) ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  const wholeString = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (precision === 0) return wholeString;
  const fractionString = fraction.toString().padStart(decimals, "0").slice(0, precision).replace(/0+$/, "");
  return fractionString.length ? `${wholeString}.${fractionString}` : wholeString;
}

function formatPercent(numerator: string, denominator: string) {
  const num = BigInt(numerator);
  const den = BigInt(denominator);
  if (den === BigInt(0)) return "0.00%";
  const bps = Number((num * BigInt(10000)) / den);
  return `${(bps / 100).toFixed(2)}%`;
}

function shortenAddress(address?: string) {
  if (!address) return "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

async function verifyIdentity(token: string): Promise<AgentProfile> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: { "X-Moltbook-Identity": token },
  });
  if (!res.ok) {
    throw new Error(`Auth failed (${res.status})`);
  }
  const json = (await res.json()) as { agent: AgentProfile };
  return json.agent;
}

async function fetchData<T>(path: string, token?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { "X-Moltbook-Identity": token } : undefined,
  });
  const json = await res.json();
  if (!res.ok || !json.ok) {
    const message = json?.error || json?.message || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return json.data as T;
}

export default function LiquidityDashboard() {
  const [tokenInput, setTokenInput] = useState("");
  const [authAgent, setAuthAgent] = useState<AgentProfile | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  const [pools, setPools] = useState<PoolsResponse | null>(null);
  const [rewards, setRewards] = useState<RewardsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingPools, setLoadingPools] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [accountInput, setAccountInput] = useState("");
  const [account, setAccount] = useState<string | null>(null);
  const [positions, setPositions] = useState<{ native?: PoolPosition; secured?: PoolPosition | null } | null>(null);
  const [accountRewards, setAccountRewards] = useState<RewardsResponse | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);

  useEffect(() => {
    const stored = typeof window === "undefined" ? null : window.localStorage.getItem("tabby.moltbookToken");
    if (stored) {
      setTokenInput(stored);
      setAuthLoading(true);
      verifyIdentity(stored)
        .then((agent) => {
          setAuthAgent(agent);
          setAuthError(null);
        })
        .catch((error: unknown) => {
          setAuthAgent(null);
          setAuthError(error instanceof Error ? error.message : "Authentication failed");
        })
        .finally(() => setAuthLoading(false));
    }
  }, []);

  const loadPools = async (token: string) => {
    setLoadingPools(true);
    setLoadError(null);
    try {
      const [poolsData, rewardsData] = await Promise.all([
        fetchData<PoolsResponse>("/liquidity/pools", token),
        fetchData<RewardsResponse>("/liquidity/rewards", token),
      ]);
      setPools(poolsData);
      setRewards(rewardsData);
      setLastUpdated(new Date());
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : "Failed to load pool data");
    } finally {
      setLoadingPools(false);
    }
  };

  useEffect(() => {
    if (!authAgent) return;
    const token = tokenInput.trim();
    if (!token) return;
    void loadPools(token);
  }, [authAgent, tokenInput]);

  const handleVerify = async () => {
    const token = tokenInput.trim();
    if (!token) {
      setAuthError("Paste a Moltbook identity token first.");
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    try {
      const agent = await verifyIdentity(token);
      setAuthAgent(agent);
      window.localStorage.setItem("tabby.moltbookToken", token);
    } catch (error: unknown) {
      setAuthAgent(null);
      setAuthError(error instanceof Error ? error.message : "Authentication failed");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = () => {
    setAuthAgent(null);
    setPools(null);
    setRewards(null);
    setPositions(null);
    setAccount(null);
    setAccountRewards(null);
    setAccountInput("");
    setAuthError(null);
    setLoadError(null);
    setTokenInput("");
    window.localStorage.removeItem("tabby.moltbookToken");
  };

  const handleLoadAccount = async () => {
    const candidate = accountInput.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(candidate)) {
      setAccountError("Enter a valid 0x address.");
      return;
    }
    setAccountError(null);
    setAccountLoading(true);
    try {
      const [nativePosition, securedPosition, rewardsData] = await Promise.all([
        fetchData<PoolPosition>(`/liquidity/native/position?account=${candidate}`, tokenInput.trim()),
        pools?.secured ? fetchData<PoolPosition>(`/liquidity/secured/position?account=${candidate}`, tokenInput.trim()) : Promise.resolve(null),
        fetchData<RewardsResponse>(`/liquidity/rewards?account=${candidate}`, tokenInput.trim()),
      ]);
      setPositions({ native: nativePosition, secured: securedPosition });
      setAccountRewards(rewardsData);
      setAccount(candidate);
    } catch (error: unknown) {
      setAccountError(error instanceof Error ? error.message : "Failed to load account data");
    } finally {
      setAccountLoading(false);
    }
  };

  const utilization = useMemo(() => {
    if (!pools?.native) return "0.00%";
    return formatPercent(pools.native.totalOutstandingPrincipalWei, pools.native.totalAssetsWei);
  }, [pools]);
  const securedUtilization = useMemo(() => {
    if (!pools?.secured) return "0.00%";
    return formatPercent(pools.secured.totalOutstandingPrincipalWei, pools.secured.totalAssetsWei);
  }, [pools]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <LandingHeader />
      <main>
        <section className="mx-auto w-full max-w-[1440px] px-6 pb-10 pt-16">
          <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 via-neutral-900/60 to-neutral-950/80 p-8">
            <p className="text-xs uppercase tracking-[0.3em] text-neutral-400">Liquidity Console</p>
            <h1 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">Tabby Liquidity Dashboard</h1>
            <p className="mt-3 max-w-2xl text-sm text-neutral-300">
              Monitor pool health, liquidity utilization, and Tabby rewards. Access is gated by Moltbook identity tokens.
            </p>
          </div>
        </section>

        {!authAgent ? (
          <section className="mx-auto w-full max-w-[1440px] px-6 pb-16">
            <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6 sm:p-8">
                <p className="text-xs uppercase tracking-[0.3em] text-neutral-400">Authenticate</p>
                <h2 className="mt-4 text-2xl font-semibold text-white">Paste your Moltbook identity token</h2>
                <p className="mt-3 text-sm text-neutral-400">
                  Generate an identity token from your Moltbook agent, then paste it here to unlock the dashboard.
                </p>
                <div className="mt-6 space-y-3">
                  <input
                    value={tokenInput}
                    onChange={(event) => setTokenInput(event.target.value)}
                    placeholder="moltbook_identity_..."
                    className="w-full rounded-2xl border border-white/10 bg-neutral-950/70 px-4 py-3 text-sm text-neutral-100 focus:border-white/40 focus:outline-none"
                  />
                  {authError ? <p className="text-sm text-red-300">{authError}</p> : null}
                  <button
                    onClick={handleVerify}
                    disabled={authLoading}
                    className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {authLoading ? "Verifying..." : "Verify token"}
                  </button>
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-neutral-950/60 p-6 sm:p-8">
                <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">How to get a token</p>
                <div className="mt-6 space-y-4 text-sm text-neutral-300">
                  <p>1. Use your Moltbook API key to request an identity token.</p>
                  <pre className="whitespace-pre-wrap rounded-2xl border border-white/10 bg-neutral-950/70 p-4 text-xs text-neutral-300">
{`curl -X POST https://www.moltbook.com/api/v1/agents/me/identity-token \\
  -H "Authorization: Bearer MOLTBOOK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"audience":"tabby.cash"}'`}
                  </pre>
                  <p>2. Copy the identity token and paste it into the field.</p>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section className="mx-auto w-full max-w-[1440px] px-6 pb-16">
            <div className="flex flex-wrap items-center justify-between gap-6 rounded-3xl border border-white/10 bg-white/5 p-6 sm:p-8">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-neutral-400">Authenticated</p>
                <h2 className="mt-3 text-2xl font-semibold text-white">Welcome, {authAgent.name}</h2>
                <p className="mt-1 text-sm text-neutral-400">Karma {authAgent.karma ?? "-"}</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => void loadPools(tokenInput.trim())}
                  disabled={loadingPools}
                  className="rounded-full border border-white/10 px-5 py-2 text-sm text-neutral-200 transition hover:border-white/50"
                >
                  {loadingPools ? "Refreshing..." : "Refresh"}
                </button>
                <button
                  onClick={handleSignOut}
                  className="rounded-full border border-white/10 px-5 py-2 text-sm text-neutral-200 transition hover:border-white/50"
                >
                  Sign out
                </button>
              </div>
            </div>

            {loadError ? <p className="mt-4 text-sm text-red-300">{loadError}</p> : null}

            <div className="mt-10 grid gap-6 lg:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-neutral-950/60 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">Native Pool</p>
                    <h3 className="mt-2 text-xl font-semibold text-white">MON Liquidity</h3>
                  </div>
                  <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-neutral-400">Active</span>
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Total Assets</p>
                    <p className="mt-2 text-sm font-semibold text-white">
                      {pools ? `${formatUnits(pools.native.totalAssetsWei)} MON` : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Pool Balance</p>
                    <p className="mt-2 text-sm font-semibold text-white">
                      {pools ? `${formatUnits(pools.native.poolBalanceWei)} MON` : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Outstanding Principal</p>
                    <p className="mt-2 text-sm font-semibold text-white">
                      {pools ? `${formatUnits(pools.native.totalOutstandingPrincipalWei)} MON` : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Utilization</p>
                    <p className="mt-2 text-sm font-semibold text-white">{pools ? utilization : "-"}</p>
                  </div>
                </div>
                <p className="mt-6 text-xs text-neutral-500">Pool address {shortenAddress(pools?.native.address)}</p>
              </div>

              <div className="rounded-3xl border border-white/10 bg-neutral-950/60 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">Secured Pool</p>
                    <h3 className="mt-2 text-xl font-semibold text-white">ERC20 Liquidity</h3>
                  </div>
                  <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-neutral-400">
                    {pools?.secured ? "Active" : "Not configured"}
                  </span>
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Total Assets</p>
                    <p className="mt-2 text-sm font-semibold text-white">
                      {pools?.secured ? `${formatUnits(pools.secured.totalAssetsWei)} Tokens` : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Pool Balance</p>
                    <p className="mt-2 text-sm font-semibold text-white">
                      {pools?.secured ? `${formatUnits(pools.secured.poolBalanceWei)} Tokens` : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Outstanding Principal</p>
                    <p className="mt-2 text-sm font-semibold text-white">
                      {pools?.secured ? `${formatUnits(pools.secured.totalOutstandingPrincipalWei)} Tokens` : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Utilization</p>
                    <p className="mt-2 text-sm font-semibold text-white">{pools?.secured ? securedUtilization : "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Asset</p>
                    <p className="mt-2 text-sm font-semibold text-white">{shortenAddress(pools?.secured?.asset)}</p>
                  </div>
                </div>
                <p className="mt-6 text-xs text-neutral-500">Pool address {shortenAddress(pools?.secured?.address)}</p>
              </div>
            </div>

            <div className="mt-10 rounded-3xl border border-white/10 bg-white/5 p-6 sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">Rewards</p>
                  <h3 className="mt-2 text-xl font-semibold text-white">Tabby reward programs</h3>
                </div>
                <p className="text-xs text-neutral-500">Reward per share assumes 18 decimals.</p>
              </div>
              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                {[{ label: "Native", data: rewards?.native }, { label: "Secured", data: rewards?.secured }].map((entry) => (
                  <div key={entry.label} className="rounded-2xl border border-white/10 bg-neutral-950/60 p-5">
                    <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">{entry.label} Rewards</p>
                    {entry.data ? (
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Reward Token</p>
                          <p className="mt-2 text-sm font-semibold text-white">{shortenAddress(entry.data.rewardToken)}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Pending Rewards</p>
                          <p className="mt-2 text-sm font-semibold text-white">{formatUnits(entry.data.pendingRewards)}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Total Staked Shares</p>
                          <p className="mt-2 text-sm font-semibold text-white">{formatUnits(entry.data.totalStakedShares)}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Reward Per Share</p>
                          <p className="mt-2 text-sm font-semibold text-white">{formatUnits(entry.data.rewardPerShareStored)}</p>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-4 text-sm text-neutral-500">Not configured.</p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-10 rounded-3xl border border-white/10 bg-neutral-950/60 p-6 sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">Your Position</p>
                  <h3 className="mt-2 text-xl font-semibold text-white">Address-level snapshot</h3>
                </div>
                {lastUpdated ? (
                  <p className="text-xs text-neutral-500">Updated {lastUpdated.toLocaleTimeString()}</p>
                ) : null}
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <input
                  value={accountInput}
                  onChange={(event) => setAccountInput(event.target.value)}
                  placeholder="0xYourAddress"
                  className="min-w-[280px] flex-1 rounded-2xl border border-white/10 bg-neutral-950/70 px-4 py-3 text-sm text-neutral-100 focus:border-white/40 focus:outline-none"
                />
                <button
                  onClick={handleLoadAccount}
                  disabled={accountLoading}
                  className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {accountLoading ? "Loading..." : "Load position"}
                </button>
              </div>
              {account ? <p className="mt-3 text-xs text-neutral-500">Loaded for {shortenAddress(account)}</p> : null}
              {accountError ? <p className="mt-3 text-sm text-red-300">{accountError}</p> : null}

              {account && positions ? (
                <div className="mt-8 grid gap-6 lg:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-neutral-950/70 p-5">
                    <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">Native Pool</p>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Shares</p>
                        <p className="mt-2 text-sm font-semibold text-white">
                          {positions.native ? formatUnits(positions.native.shares) : "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Staked Shares</p>
                        <p className="mt-2 text-sm font-semibold text-white">
                          {accountRewards?.native?.stakedShares ? formatUnits(accountRewards.native.stakedShares) : "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Estimated Assets</p>
                        <p className="mt-2 text-sm font-semibold text-white">
                          {positions.native ? `${formatUnits(positions.native.estimatedAssetsWei)} MON` : "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Share of Pool</p>
                        <p className="mt-2 text-sm font-semibold text-white">
                          {positions.native ? formatPercent(positions.native.shares, positions.native.totalShares) : "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Earned Rewards</p>
                        <p className="mt-2 text-sm font-semibold text-white">
                          {accountRewards?.native?.earned ? formatUnits(accountRewards.native.earned) : "-"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-neutral-950/70 p-5">
                    <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">Secured Pool</p>
                    {positions.secured ? (
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Shares</p>
                          <p className="mt-2 text-sm font-semibold text-white">{formatUnits(positions.secured.shares)}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Staked Shares</p>
                          <p className="mt-2 text-sm font-semibold text-white">
                            {accountRewards?.secured?.stakedShares ? formatUnits(accountRewards.secured.stakedShares) : "-"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Estimated Assets</p>
                          <p className="mt-2 text-sm font-semibold text-white">{formatUnits(positions.secured.estimatedAssetsWei)}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Share of Pool</p>
                          <p className="mt-2 text-sm font-semibold text-white">
                            {formatPercent(positions.secured.shares, positions.secured.totalShares)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Earned Rewards</p>
                          <p className="mt-2 text-sm font-semibold text-white">
                            {accountRewards?.secured?.earned ? formatUnits(accountRewards.secured.earned) : "-"}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-4 text-sm text-neutral-500">Secured pool not configured.</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="mt-6 text-sm text-neutral-500">Enter a wallet address to load positions and rewards.</p>
              )}
            </div>
          </section>
        )}
      </main>
      <LandingFooter />
    </div>
  );
}
