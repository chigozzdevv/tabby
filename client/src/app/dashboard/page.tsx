"use client";

import { useEffect, useMemo, useState } from "react";
import LandingHeader from "../landing/header";
import LandingFooter from "../landing/footer";

const API_BASE_URL = (process.env.NEXT_PUBLIC_TABBY_API_BASE_URL ?? "https://api.tabby.cash").replace(/\/$/, "");
const MONADSCAN_BASE = (process.env.NEXT_PUBLIC_MONADSCAN_BASE_URL ?? "https://monadscan.io").replace(/\/$/, "");
const MAX_GAS_LOAN_LOOKUP = 30;
const MAX_SECURED_LOAN_LOOKUP = 30;

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
  if (status === "defaulted" || status === "overdue") return "bg-orange-500/15 text-orange-200 ring-1 ring-orange-400/30";
  if (status === "closed") return "bg-neutral-700/40 text-neutral-200 ring-1 ring-neutral-500/40";
  return "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30";
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

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setError(null);
        const allEvents = await fetchJson<ActivityEvent[]>(`${API_BASE_URL}/public/activity?limit=200`);
        if (cancelled) return;

        const eventTxByTypeAndLoan = new Map<string, `0x${string}`>();
        const gasLoanIds: number[] = [];
        const securedLoanIds: number[] = [];

        for (const evt of allEvents) {
          if (typeof evt.loanId === "number" && evt.loanId > 0) {
            if (evt.type === "gas-loan.executed") gasLoanIds.push(evt.loanId);
            if (evt.type === "secured-loan.opened") securedLoanIds.push(evt.loanId);
          }
          if (evt.txHash && typeof evt.loanId === "number" && evt.loanId > 0) {
            eventTxByTypeAndLoan.set(`${evt.type}:${evt.loanId}`, evt.txHash);
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
                  txHash: eventTxByTypeAndLoan.get(`gas-loan.executed:${loanId}`),
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

    return rows
      .filter((row) => row.loanId > 0)
      .sort((a, b) => {
        if (a.status === "overdue" && b.status !== "overdue") return -1;
        if (b.status === "overdue" && a.status !== "overdue") return 1;
        return a.dueAt - b.dueAt;
      });
  }, [gasLoans, securedLoans]);

  const pendingLoans = loans.filter((l) => BigInt(l.outstandingWei) > BigInt(0) && l.status !== "closed");
  const overdueCount = pendingLoans.filter((l) => l.status === "overdue" || l.status === "defaulted").length;
  const activeCount = pendingLoans.filter((l) => l.status === "active").length;
  const gasOutstanding = pendingLoans.filter((l) => l.kind === "gas").length;
  const securedOutstanding = pendingLoans.filter((l) => l.kind === "secured").length;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <LandingHeader />
      <main className="relative mx-auto w-full max-w-[1440px] px-6 pb-20 pt-10">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[380px] bg-[radial-gradient(circle_at_15%_10%,rgba(249,115,22,0.22),transparent_45%),radial-gradient(circle_at_85%_0%,rgba(45,212,191,0.16),transparent_45%)]" />

        <section className="mb-8 overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-transparent p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-neutral-400">Tabby Monitor</p>
              <h1 className="mt-2 text-3xl font-semibold text-white sm:text-4xl">Loan Activity Dashboard</h1>
            </div>
            <div className="rounded-full border border-white/15 bg-black/30 px-4 py-2 text-xs text-neutral-300">
              {updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString()}` : "Connecting..."}
            </div>
          </div>
        </section>

        {error ? (
          <div className="mb-8 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-orange-400/30 bg-orange-500/10 p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-orange-100/80">Yet To Repay</p>
            <p className="mt-2 text-3xl font-semibold text-orange-100">{pendingLoans.length}</p>
          </div>
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-red-100/80">Overdue Risk</p>
            <p className="mt-2 text-3xl font-semibold text-red-100">{overdueCount}</p>
          </div>
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-emerald-100/80">Active Healthy</p>
            <p className="mt-2 text-3xl font-semibold text-emerald-100">{activeCount}</p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-neutral-300">Tracked Loan Mix</p>
            <p className="mt-2 text-lg font-semibold text-white">{gasOutstanding} gas / {securedOutstanding} secured</p>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
            <div className="border-b border-white/10 px-5 py-4">
              <h2 className="text-lg font-semibold text-white">Repayment Board</h2>
            </div>
            {loading ? (
              <p className="px-5 py-6 text-sm text-neutral-300">Loading loans...</p>
            ) : pendingLoans.length === 0 ? (
              <p className="px-5 py-6 text-sm text-neutral-300">No outstanding loans in current tracked set.</p>
            ) : (
              <div className="divide-y divide-white/10">
                {pendingLoans.map((loan) => (
                  <div key={loan.key} className="px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-black/30 px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-neutral-300">
                          {loan.kind}
                        </span>
                        <span className="font-mono text-sm text-white">Loan #{loan.loanId}</span>
                        <span className={`rounded-full px-2 py-1 text-[11px] ${statusTone(loan.status)}`}>{loan.status}</span>
                      </div>
                      {loan.txHash ? (
                        <a
                          href={`${MONADSCAN_BASE}/tx/${loan.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-xs text-neutral-300 underline decoration-white/20 underline-offset-4 hover:text-white hover:decoration-white/70"
                        >
                          tx {shortHex(loan.txHash)}
                        </a>
                      ) : null}
                    </div>
                    <div className="mt-3 grid gap-3 text-sm text-neutral-300 sm:grid-cols-3">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">Borrower</p>
                        <a
                          href={`${MONADSCAN_BASE}/address/${loan.borrower}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-neutral-100 underline decoration-white/20 underline-offset-4 hover:decoration-white/70"
                        >
                          {shortHex(loan.borrower)}
                        </a>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">Due</p>
                        <p>{formatDue(loan.dueAt)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">Outstanding</p>
                        <p className="font-mono text-neutral-100">{formatTokenAmount(loan.outstandingWei)} MON</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#080b10]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-300/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300/80" />
              </div>
              <h2 className="text-sm font-medium text-emerald-100/90">Activity Stream</h2>
            </div>
            {events.length === 0 ? (
              <p className="px-4 py-6 text-sm text-neutral-300">No activity yet.</p>
            ) : (
              <div className="max-h-[680px] overflow-auto p-3">
                <div className="space-y-2">
                  {events.slice(0, 40).map((event) => (
                    <div
                      key={`${event.createdAt}-${event.type}-${event.loanId ?? "x"}`}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-neutral-300"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-neutral-500">
                          {new Date(event.createdAt).toLocaleTimeString()}
                        </span>
                        {typeof event.loanId === "number" ? (
                          <span className="font-mono text-[11px] text-neutral-400">#{event.loanId}</span>
                        ) : null}
                      </div>
                      <p className="text-sm text-emerald-100">{EVENT_LABELS[event.type] ?? event.type}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                        {event.borrower ? (
                          <a
                            href={`${MONADSCAN_BASE}/address/${event.borrower}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-[11px] underline decoration-white/20 underline-offset-4 hover:text-white hover:decoration-white/70"
                          >
                            {shortHex(event.borrower)}
                          </a>
                        ) : null}
                        {event.txHash ? (
                          <a
                            href={`${MONADSCAN_BASE}/tx/${event.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-[11px] underline decoration-white/20 underline-offset-4 hover:text-white hover:decoration-white/70"
                          >
                            tx {shortHex(event.txHash)}
                          </a>
                        ) : null}
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
