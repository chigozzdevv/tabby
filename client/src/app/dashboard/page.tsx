"use client";

import { useEffect, useMemo, useState } from "react";
import LandingHeader from "../landing/header";
import LandingFooter from "../landing/footer";

const API_BASE_URL = (process.env.NEXT_PUBLIC_TABBY_API_BASE_URL ?? "https://api.tabby.cash").replace(/\/$/, "");
const MONADSCAN_BASE = (process.env.NEXT_PUBLIC_MONADSCAN_BASE_URL ?? "https://monadscan.com").replace(/\/$/, "");
const MAX_GAS_LOAN_LOOKUP = 50;
const MAX_SECURED_LOAN_LOOKUP = 50;

type ActivityEvent = {
  agentId?: string;
  borrower?: `0x${string}`;
  type: string;
  loanId?: number;
  txHash?: `0x${string}`;
  createdAt: string;
};

type PublicGasLoanDetails = {
  offer?: {
    txHash?: `0x${string}`;
  };
  onchain: {
    borrower: `0x${string}`;
    principalWei: string;
    rateBps: number;
    openedAt: number;
    dueAt: number;
    lastAccruedAt: number;
    accruedInterestWei: string;
    totalRepaidWei: string;
    closed: boolean;
    defaulted: boolean;
    outstandingWei: string;
  };
};

type PublicSecuredLoanDetails = {
  onchain: {
    loanId: number;
    positionId?: number;
    borrower: `0x${string}`;
    asset: `0x${string}`;
    principalWei: string;
    interestBps: number;
    collateralAsset: `0x${string}`;
    collateralAmountWei: string;
    openedAt: number;
    dueAt: number;
    lastAccruedAt: number;
    accruedInterestWei: string;
    closed: boolean;
    outstandingWei: string;
  };
};

type LoanStatus = "active" | "overdue" | "defaulted" | "closed";

type DashboardLoan = {
  key: string;
  kind: "gas" | "secured";
  loanId: number;
  borrower: `0x${string}`;
  dueAt: number;
  outstandingWei: string;
  status: LoanStatus;
  txHash?: `0x${string}`;
};

const EVENT_LABELS: Record<string, string> = {
  "borrower-policy.registered": "Policy registered",
  "gas-loan.offer-created": "Gas offer created",
  "gas-loan.offer-expired": "Gas offer expired",
  "gas-loan.offer-canceled": "Gas offer canceled",
  "gas-loan.executed": "Gas loan executed",
  "gas-loan.repaid": "Gas loan repaid",
  "gas-loan.defaulted": "Gas loan defaulted",
  "secured-loan.opened": "Secured loan opened",
  "secured-loan.repaid": "Secured loan repaid",
  "secured-loan.collateral-withdrawn": "Collateral withdrawn",
};

function shortHex(value: string) {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatTokenAmount(wei: string, decimals = 18, maxFraction = 4) {
  try {
    const base = BigInt(10) ** BigInt(decimals);
    const raw = BigInt(wei);
    const whole = raw / base;
    const fraction = raw % base;
    const fractionStr = fraction.toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
    const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return fractionStr ? `${wholeStr}.${fractionStr}` : wholeStr;
  } catch {
    return "0";
  }
}

function formatDue(dueAt: number) {
  if (!Number.isFinite(dueAt) || dueAt <= 0) return "Unknown";
  const dueMs = dueAt * 1000;
  const nowMs = Date.now();
  const diffSec = Math.floor((dueMs - nowMs) / 1000);
  const abs = Math.abs(diffSec);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const rel = `${diffSec < 0 ? "-" : ""}${h}h ${m}m`;
  return `${new Date(dueMs).toLocaleString()} (${rel})`;
}

function statusTone(status: LoanStatus) {
  if (status === "defaulted" || status === "overdue") return "bg-red-500/10 text-red-200 border-red-400/30";
  if (status === "closed") return "bg-neutral-700/40 text-neutral-200 border-neutral-500/40";
  return "bg-emerald-500/10 text-emerald-200 border-emerald-400/30";
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = (await res.json()) as { ok?: boolean; message?: string; data?: T };
  if (!res.ok || !json.ok) {
    const msg = json?.message ? String(json.message) : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json.data as T;
}

async function fetchJsonSafe<T>(url: string): Promise<T | null> {
  try {
    return await fetchJson<T>(url);
  } catch {
    return null;
  }
}

export default function DashboardPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [gasLoans, setGasLoans] = useState<Array<{ loanId: number; detail: PublicGasLoanDetails }>>([]);
  const [securedLoans, setSecuredLoans] = useState<PublicSecuredLoanDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [activityFilter, setActivityFilter] = useState<"all" | "gas" | "secured">("all");
  const [borrowerFilter, setBorrowerFilter] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setError(null);
        const allEvents = await fetchJson<ActivityEvent[]>(`${API_BASE_URL}/public/activity?limit=200`);
        if (cancelled) return;

        const eventTxByTypeAndLoan = new Map<string, `0x${string}`>();
        const eventTxByLoan = new Map<number, `0x${string}`>();
        const gasLoanIds: number[] = [];
        const securedLoanIds: number[] = [];

        for (const evt of allEvents) {
          if (typeof evt.loanId === "number" && evt.loanId > 0) {
            if (evt.type.startsWith("gas-loan.")) gasLoanIds.push(evt.loanId);
            if (evt.type.startsWith("secured-loan.")) securedLoanIds.push(evt.loanId);
          }
          if (evt.txHash && typeof evt.loanId === "number" && evt.loanId > 0) {
            eventTxByTypeAndLoan.set(`${evt.type}:${evt.loanId}`, evt.txHash);
            if (!eventTxByLoan.has(evt.loanId)) {
              eventTxByLoan.set(evt.loanId, evt.txHash);
            }
          }
        }

        const uniqGasIds = Array.from(new Set(gasLoanIds)).slice(0, MAX_GAS_LOAN_LOOKUP);
        const uniqSecuredIds = Array.from(new Set(securedLoanIds)).slice(0, MAX_SECURED_LOAN_LOOKUP);

        const [gasDetailList, securedDetailList] = await Promise.all([
          Promise.all(
            uniqGasIds.map(async (loanId) => {
              const detail = await fetchJsonSafe<PublicGasLoanDetails>(`${API_BASE_URL}/public/monitoring/gas-loans/${loanId}`);
              if (!detail) return null;
              if (!detail.offer?.txHash) {
                detail.offer = {
                  ...(detail.offer ?? {}),
                  txHash: eventTxByTypeAndLoan.get(`gas-loan.executed:${loanId}`) ?? eventTxByLoan.get(loanId),
                };
              }
              return { loanId, detail };
            })
          ),
          Promise.all(
            uniqSecuredIds.map(async (loanId) => {
              const detail = await fetchJsonSafe<PublicSecuredLoanDetails>(`${API_BASE_URL}/public/monitoring/secured-loans/${loanId}`);
              return detail;
            })
          ),
        ]);

        if (cancelled) return;
        setEvents(allEvents);
        setGasLoans(gasDetailList.filter((x): x is { loanId: number; detail: PublicGasLoanDetails } => x !== null));
        setSecuredLoans(securedDetailList.filter((x): x is PublicSecuredLoanDetails => x !== null));
        setUpdatedAt(Date.now());
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load dashboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const timer = window.setInterval(load, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const loans = useMemo<DashboardLoan[]>(() => {
    const now = Math.floor(Date.now() / 1000);
    const rows: DashboardLoan[] = [];

    for (const loan of gasLoans) {
      const onchain = loan.detail.onchain;
      const outstanding = BigInt(onchain.outstandingWei);
      const status: LoanStatus = onchain.closed
        ? "closed"
        : onchain.defaulted
          ? "defaulted"
          : outstanding > BigInt(0) && onchain.dueAt < now
            ? "overdue"
            : "active";

      rows.push({
        key: `gas-${onchain.borrower}-${onchain.openedAt}-${onchain.dueAt}`,
        kind: "gas",
        loanId: loan.loanId,
        borrower: onchain.borrower,
        dueAt: onchain.dueAt,
        outstandingWei: onchain.outstandingWei,
        status,
        txHash: loan.detail.offer?.txHash,
      });
    }

    for (const loan of securedLoans) {
      const onchain = loan.onchain;
      const outstanding = BigInt(onchain.outstandingWei);
      const status: LoanStatus =
        onchain.closed || outstanding === BigInt(0) ? "closed" : onchain.dueAt < now ? "overdue" : "active";

      rows.push({
        key: `secured-${onchain.loanId}`,
        kind: "secured",
        loanId: onchain.loanId,
        borrower: onchain.borrower,
        dueAt: onchain.dueAt,
        outstandingWei: onchain.outstandingWei,
        status,
      });
    }

    return rows.filter((row) => row.loanId > 0);
  }, [gasLoans, securedLoans]);

  const allLoans = useMemo(() => {
    return loans.sort((a, b) => {
      if (a.status === "overdue" && b.status !== "overdue") return -1;
      if (b.status === "overdue" && a.status !== "overdue") return 1;
      return a.dueAt - b.dueAt;
    });
  }, [loans]);

  const pendingLoans = allLoans.filter((l) => BigInt(l.outstandingWei) > BigInt(0) && l.status !== "closed");
  const closedLoans = allLoans.filter((l) => l.status === "closed");
  const overdueCount = allLoans.filter((l) => l.status === "overdue" || l.status === "defaulted").length;
  const activeCount = allLoans.filter((l) => l.status === "active").length;
  const gasOutstanding = pendingLoans.filter((l) => l.kind === "gas").length;
  const securedOutstanding = pendingLoans.filter((l) => l.kind === "secured").length;

  const totalOutstandingMON = useMemo(() => {
    return pendingLoans.reduce((sum, loan) => sum + BigInt(loan.outstandingWei), BigInt(0));
  }, [pendingLoans]);

  const filteredEvents = useMemo(() => {
    let filtered = events;
    
    if (activityFilter === "gas") {
      filtered = filtered.filter((e) => e.type.startsWith("gas-loan."));
    } else if (activityFilter === "secured") {
      filtered = filtered.filter((e) => e.type.startsWith("secured-loan."));
    }
    
    if (borrowerFilter.trim()) {
      const search = borrowerFilter.toLowerCase().trim();
      filtered = filtered.filter((e) => e.borrower?.toLowerCase().includes(search));
    }
    
    return filtered;
  }, [events, activityFilter, borrowerFilter]);

  const trackedGasIds = new Set(
    events
      .filter((e) => typeof e.loanId === "number" && e.loanId > 0 && e.type.startsWith("gas-loan."))
      .map((e) => e.loanId as number)
  );
  const trackedSecuredIds = new Set(
    events
      .filter((e) => typeof e.loanId === "number" && e.loanId > 0 && e.type.startsWith("secured-loan."))
      .map((e) => e.loanId as number)
  );
  const trackedGasCount = trackedGasIds.size;
  const trackedSecuredCount = trackedSecuredIds.size;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <LandingHeader />
      <main className="relative mx-auto w-full max-w-[1440px] px-6 pb-20 pt-10">
        <section className="mb-10">
          <p className="text-sm text-neutral-400">
            {updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString()}` : "Loading..."}
          </p>
        </section>

        {error ? (
          <div className="mb-8 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-xs uppercase tracking-wider text-neutral-400">Total Loans</p>
            <p className="mt-2 text-3xl font-semibold text-white">{allLoans.length}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-xs uppercase tracking-wider text-neutral-400">Outstanding</p>
            <p className="mt-2 text-3xl font-semibold text-white">{pendingLoans.length}</p>
            <p className="mt-1 font-mono text-xs text-neutral-400">{formatTokenAmount(totalOutstandingMON.toString())} MON</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-xs uppercase tracking-wider text-neutral-400">Active</p>
            <p className="mt-2 text-3xl font-semibold text-white">{activeCount}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-xs uppercase tracking-wider text-neutral-400">Overdue</p>
            <p className="mt-2 text-3xl font-semibold text-white">{overdueCount}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-xs uppercase tracking-wider text-neutral-400">Repaid</p>
            <p className="mt-2 text-3xl font-semibold text-white">{closedLoans.length}</p>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
            <div className="border-b border-white/10 px-5 py-4">
              <h2 className="text-lg font-semibold text-white">Loan Distribution</h2>
            </div>
            {loading ? (
              <p className="px-5 py-6 text-sm text-neutral-300">Loading...</p>
            ) : allLoans.length === 0 ? (
              <p className="px-5 py-6 text-sm text-neutral-300">No loans yet.</p>
            ) : (
              <div className="p-6">
                <div className="mb-6 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <p className="text-xs uppercase tracking-wider text-neutral-400">Gas Loans</p>
                    <p className="mt-2 text-2xl font-semibold text-white">{allLoans.filter(l => l.kind === "gas").length}</p>
                    <div className="mt-3 space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-neutral-400">Active</span>
                        <span className="text-white">{allLoans.filter(l => l.kind === "gas" && l.status === "active").length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-400">Overdue</span>
                        <span className="text-white">{allLoans.filter(l => l.kind === "gas" && (l.status === "overdue" || l.status === "defaulted")).length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-400">Repaid</span>
                        <span className="text-white">{allLoans.filter(l => l.kind === "gas" && l.status === "closed").length}</span>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <p className="text-xs uppercase tracking-wider text-neutral-400">Secured Loans</p>
                    <p className="mt-2 text-2xl font-semibold text-white">{allLoans.filter(l => l.kind === "secured").length}</p>
                    <div className="mt-3 space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-neutral-400">Active</span>
                        <span className="text-white">{allLoans.filter(l => l.kind === "secured" && l.status === "active").length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-400">Overdue</span>
                        <span className="text-white">{allLoans.filter(l => l.kind === "secured" && (l.status === "overdue" || l.status === "defaulted")).length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-400">Repaid</span>
                        <span className="text-white">{allLoans.filter(l => l.kind === "secured" && l.status === "closed").length}</span>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <div>
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="text-neutral-400">Active</span>
                      <span className="text-white">{activeCount} / {allLoans.length}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div 
                        className="h-full bg-emerald-500/80"
                        style={{ width: `${allLoans.length > 0 ? (activeCount / allLoans.length) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                  
                  <div>
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="text-neutral-400">Overdue</span>
                      <span className="text-white">{overdueCount} / {allLoans.length}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div 
                        className="h-full bg-red-500/80"
                        style={{ width: `${allLoans.length > 0 ? (overdueCount / allLoans.length) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                  
                  <div>
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="text-neutral-400">Repaid</span>
                      <span className="text-white">{closedLoans.length} / {allLoans.length}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div 
                        className="h-full bg-neutral-500/80"
                        style={{ width: `${allLoans.length > 0 ? (closedLoans.length / allLoans.length) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#080b10]">
            <div className="border-b border-white/10 px-4 py-3">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-300/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-300/80" />
                </div>
                <h2 className="text-sm font-medium text-emerald-50/90">Activity</h2>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => setActivityFilter("all")}
                    className={`rounded-lg px-3 py-1.5 text-xs transition ${
                      activityFilter === "all"
                        ? "bg-white/10 text-white"
                        : "bg-white/5 text-neutral-400 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setActivityFilter("gas")}
                    className={`rounded-lg px-3 py-1.5 text-xs transition ${
                      activityFilter === "gas"
                        ? "bg-white/10 text-white"
                        : "bg-white/5 text-neutral-400 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    Gas
                  </button>
                  <button
                    onClick={() => setActivityFilter("secured")}
                    className={`rounded-lg px-3 py-1.5 text-xs transition ${
                      activityFilter === "secured"
                        ? "bg-white/10 text-white"
                        : "bg-white/5 text-neutral-400 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    Secured
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Filter by borrower address..."
                  value={borrowerFilter}
                  onChange={(e) => setBorrowerFilter(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white placeholder:text-neutral-500 focus:border-white/30 focus:outline-none"
                />
              </div>
            </div>
            {filteredEvents.length === 0 ? (
              <p className="px-4 py-6 text-sm text-neutral-300">No activity matching filters.</p>
            ) : (
              <div className="max-h-[680px] overflow-auto p-3">
                <div className="space-y-2">
                  {filteredEvents.slice(0, 40).map((event) => (
                    <div
                      key={`${event.createdAt}-${event.type}-${event.loanId ?? "x"}`}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-neutral-300"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-sm text-emerald-50/90">{EVENT_LABELS[event.type] ?? event.type}</p>
                        {typeof event.loanId === "number" ? (
                          <span className="font-mono text-[11px] text-neutral-400">#{event.loanId}</span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {event.borrower ? (
                          <a
                            href={`${MONADSCAN_BASE}/address/${event.borrower}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-[11px] underline decoration-emerald-200/30 underline-offset-4 hover:text-white hover:decoration-emerald-200"
                          >
                            borrower={shortHex(event.borrower)}
                          </a>
                        ) : null}
                        {event.txHash ? (
                          <a
                            href={`${MONADSCAN_BASE}/tx/${event.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-[11px] underline decoration-emerald-200/30 underline-offset-4 hover:text-white hover:decoration-emerald-200"
                          >
                            tx={shortHex(event.txHash)}
                          </a>
                        ) : null}
                        <span className="font-mono text-[11px] text-neutral-500">
                          {new Date(event.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
