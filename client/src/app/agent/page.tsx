"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import LandingHeader from "../landing/header";
import LandingFooter from "../landing/footer";

const API_BASE_URL = process.env.NEXT_PUBLIC_TABBY_API_BASE_URL ?? "https://api.tabby.cash";
const DEMO_BORROWER = process.env.NEXT_PUBLIC_DEMO_BORROWER;

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const STORAGE_KEY = "tabby.demo.borrower";

type PublicGasLoanNextDue = {
  loanId: number;
  dueAt: number;
  dueInSeconds: number;
  outstandingWei: string;
};

type ActivityEvent = {
  chainId: number;
  type: string;
  agentId: string;
  borrower?: `0x${string}`;
  loanId?: number;
  txHash?: `0x${string}`;
  blockNumber?: number;
  payload?: unknown;
  createdAt: string;
};

function shortAddress(address: string) {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatDuration(seconds: number) {
  const abs = Math.abs(seconds);
  const sign = seconds < 0 ? "-" : "";
  if (abs < 60) return `${sign}${abs}s`;
  if (abs < 3600) return `${sign}${Math.floor(abs / 60)}m`;
  if (abs < 86400) return `${sign}${Math.floor(abs / 3600)}h`;
  return `${sign}${Math.floor(abs / 86400)}d`;
}

function formatDateTime(seconds: number) {
  const d = new Date(seconds * 1000);
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = (await res.json()) as any;
  if (!res.ok) {
    const msg = typeof json?.message === "string" ? json.message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (!json?.ok) throw new Error("Bad response");
  return json.data as T;
}

function AgentLiveContent() {
  const searchParams = useSearchParams();

  const queryBorrower = (searchParams.get("borrower") ?? "").trim();
  const [borrower, setBorrower] = useState<string | undefined>(undefined);
  const [nextDue, setNextDue] = useState<PublicGasLoanNextDue | null | undefined>(undefined);
  const [events, setEvents] = useState<ActivityEvent[] | undefined>(undefined);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const fromQuery = ADDRESS_RE.test(queryBorrower) ? queryBorrower : undefined;
    if (fromQuery) {
      window.localStorage.setItem(STORAGE_KEY, fromQuery);
      setBorrower(fromQuery);
      return;
    }

    const fromStorage = window.localStorage.getItem(STORAGE_KEY) ?? "";
    if (ADDRESS_RE.test(fromStorage)) {
      setBorrower(fromStorage);
      return;
    }

    if (DEMO_BORROWER && ADDRESS_RE.test(DEMO_BORROWER)) {
      setBorrower(DEMO_BORROWER);
      return;
    }
  }, [queryBorrower]);

  const urls = useMemo(() => {
    if (!borrower) return null;
    const base = API_BASE_URL.replace(/\/$/, "");
    const nextDueUrl = `${base}/public/monitoring/gas-loans/next-due?borrower=${encodeURIComponent(borrower)}`;
    const eventsUrl = `${base}/public/activity?borrower=${encodeURIComponent(borrower)}&limit=25`;
    return { nextDueUrl, eventsUrl };
  }, [borrower]);

  useEffect(() => {
    if (!urls || !borrower) return;
    let cancelled = false;
    const { nextDueUrl, eventsUrl } = urls;

    async function load() {
      try {
        setError(undefined);
        const [next, evts] = await Promise.all([
          fetchJson<PublicGasLoanNextDue | null>(nextDueUrl),
          fetchJson<ActivityEvent[]>(eventsUrl),
        ]);
        if (cancelled) return;
        setNextDue(next);
        setEvents(Array.isArray(evts) ? evts : []);
        setLastUpdatedAt(Date.now());
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    }

    load();
    const interval = window.setInterval(load, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [urls, borrower]);

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 pb-16 pt-16">
      <div className="max-w-3xl space-y-4">
        <h1 className="text-3xl font-semibold text-white sm:text-4xl">Live agent activity</h1>
        <p className="text-sm text-neutral-400">
          Real-time protocol events, powered by Tabby’s public API. Auto-refreshes every 5 seconds.
        </p>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        <section className="rounded-3xl border border-white/10 bg-white/5 p-6 lg:col-span-1">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-400">Borrower</p>
          {borrower ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-white/10 bg-neutral-950/50 p-4 font-mono text-xs text-neutral-200">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate sm:hidden">{shortAddress(borrower)}</span>
                  <span className="hidden sm:inline">{borrower}</span>
                  <button
                    type="button"
                    className="shrink-0 rounded-full border border-white/15 px-3 py-1 text-[11px] text-neutral-200 transition hover:border-white/40 hover:text-white"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(borrower);
                      } catch {
                        // ignore
                      }
                    }}
                  >
                    Copy
                  </button>
                </div>
              </div>
              <div className="text-xs text-neutral-400">
                Tip: your agent can share a link like <span className="font-mono">/agent?borrower=0x...</span> so you
                never paste this manually.
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-white/10 bg-neutral-950/50 p-4 text-sm text-neutral-300">
              Waiting for a borrower address.
              <div className="mt-2 text-xs text-neutral-400">
                Open the dashboard link your agent posts in Telegram (it should include{" "}
                <span className="font-mono">borrower=</span>).
              </div>
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6 lg:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-400">Gas-loan status</p>
            <div className="text-xs text-neutral-500">
              {lastUpdatedAt ? `Updated ${new Date(lastUpdatedAt).toLocaleTimeString()}` : "Not loaded yet"}
            </div>
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
              Failed to load: {error}
            </div>
          ) : borrower && nextDue === undefined ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-neutral-950/50 p-4 text-sm text-neutral-300">
              Loading…
            </div>
          ) : borrower && nextDue === null ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-neutral-950/50 p-4 text-sm text-neutral-300">
              No active gas-loans found for this borrower.
            </div>
          ) : borrower && nextDue ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-neutral-950/50 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Loan</p>
                <p className="mt-2 text-lg font-semibold text-white">#{nextDue.loanId}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-neutral-950/50 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Due</p>
                <p className="mt-2 text-sm font-semibold text-white">{formatDateTime(nextDue.dueAt)}</p>
                <p className="mt-1 text-xs text-neutral-400">
                  {nextDue.dueInSeconds >= 0 ? "in " : "overdue "}
                  {formatDuration(nextDue.dueInSeconds)}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-neutral-950/50 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Outstanding (wei)</p>
                <p className="mt-2 truncate font-mono text-xs text-white">{nextDue.outstandingWei}</p>
              </div>
            </div>
          ) : null}

          <div className="mt-8">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-400">Recent activity</p>
            <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
              <div className="max-h-[440px] overflow-auto bg-neutral-950/50">
                {events && events.length > 0 ? (
                  <ul className="divide-y divide-white/10">
                    {events.map((e) => (
                      <li key={`${e.createdAt}:${e.type}:${e.loanId ?? "0"}:${e.txHash ?? "0"}`} className="p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[11px] text-neutral-200">
                                {e.type}
                              </span>
                              {typeof e.loanId === "number" ? (
                                <span className="text-xs text-neutral-400">loanId #{e.loanId}</span>
                              ) : null}
                            </div>
                            {e.txHash ? (
                              <div className="mt-2 flex items-center gap-2 text-xs text-neutral-300">
                                <span className="font-mono">{shortAddress(e.txHash)}</span>
                                <button
                                  type="button"
                                  className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-neutral-200 transition hover:border-white/40 hover:text-white"
                                  onClick={async () => {
                                    try {
                                      await navigator.clipboard.writeText(e.txHash!);
                                    } catch {
                                      // ignore
                                    }
                                  }}
                                >
                                  Copy
                                </button>
                              </div>
                            ) : null}
                          </div>
                          <div className="text-xs text-neutral-500">{new Date(e.createdAt).toLocaleString()}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : borrower ? (
                  <div className="p-4 text-sm text-neutral-300">No events yet.</div>
                ) : (
                  <div className="p-4 text-sm text-neutral-300">Select a borrower to see events.</div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function AgentLivePage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <LandingHeader />
      <Suspense
        fallback={
          <main className="mx-auto w-full max-w-[1440px] px-6 pb-16 pt-16">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-sm text-neutral-300">Loading…</div>
          </main>
        }
      >
        <AgentLiveContent />
      </Suspense>
      <LandingFooter />
    </div>
  );
}
