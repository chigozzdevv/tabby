"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { fadeUp } from "./animations";

const API_BASE_URL = process.env.NEXT_PUBLIC_TABBY_API_BASE_URL ?? "https://api.tabby.cash";

type ActivityEvent = {
  agentId?: string;
  borrower?: `0x${string}`;
  type: string;
  loanId?: number;
  txHash?: `0x${string}`;
  createdAt: string;
};

function shortHex(value: string) {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
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

function AgentTerminalCard() {
  const [events, setEvents] = useState<ActivityEvent[] | undefined>(undefined);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const urls = useMemo(() => {
    const base = API_BASE_URL.replace(/\/$/, "");
    return {
      eventsUrl: `${base}/public/activity?limit=12`,
    };
  }, []);

  useEffect(() => {
    if (!urls) return;
    const { eventsUrl } = urls;
    let cancelled = false;

    async function load() {
      try {
        setError(undefined);
        const evts = await fetchJson<ActivityEvent[]>(eventsUrl);
        if (cancelled) return;
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
  }, [urls]);

  const statusDotClass = error
    ? "bg-red-400"
    : events !== undefined
      ? "bg-emerald-300"
      : "bg-neutral-500";

  const borrowersSeen = new Set<string>();
  const agentsSeen = new Set<string>();
  for (const e of events ?? []) {
    if (e.borrower) borrowersSeen.add(e.borrower.toLowerCase());
    if (e.agentId) agentsSeen.add(e.agentId);
  }

  const lines: string[] = [];
  lines.push("$ tabby agent feed");
  if (events === undefined && !error) lines.push("connecting...");
  if (error) lines.push(`error: ${error}`);
  if (events !== undefined && !error) {
    lines.push(`agents_seen=${agentsSeen.size} borrowers_seen=${borrowersSeen.size}`);
    lines.push("");

    if (events.length === 0) {
      lines.push("waiting for activity...");
    } else {
      lines.push("recent:");
      for (const e of events.slice(0, 8)) {
        const ts = new Date(e.createdAt).toLocaleTimeString();
        const who = e.borrower ? ` borrower=${shortHex(e.borrower)}` : e.agentId ? ` agent=${e.agentId}` : "";
        const loan = typeof e.loanId === "number" ? ` loan#${e.loanId}` : "";
        const tx = e.txHash ? ` tx=${shortHex(e.txHash)}` : "";
        lines.push(`- [${ts}] ${e.type}${who}${loan}${tx}`);
      }
    }
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-300/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-300/80" />
          </div>
          <span className="text-xs font-semibold uppercase tracking-[0.3em] text-neutral-300">Agent feed</span>
          <span className={`h-2 w-2 rounded-full ${statusDotClass}`} />
        </div>
        <span className="text-[11px] text-neutral-500">
          {lastUpdatedAt ? `Updated ${new Date(lastUpdatedAt).toLocaleTimeString()}` : "Connecting"}
        </span>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-[#080b10]">
        <pre className="max-h-[340px] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed text-emerald-50/90">
          {lines.join("\n")}
        </pre>
      </div>
    </div>
  );
}

export default function LandingHero({
  onLiquidityProvider,
  ctaLabel,
}: {
  onLiquidityProvider: () => void;
  ctaLabel: string;
}) {
  return (
    <div className="relative h-[200vh]">
      <section id="about" className="sticky top-0 z-0 overflow-hidden pt-6">
        <div className="absolute inset-0 bg-neutral-950" />
        <svg className="absolute h-0 w-0" aria-hidden="true" focusable="false">
          <filter id="wavy-stripes">
            <feTurbulence type="fractalNoise" baseFrequency="0.01 0.015" numOctaves="1" seed="2">
              <animate
                attributeName="baseFrequency"
                dur="10s"
                values="0.01 0.015;0.015 0.01;0.01 0.015"
                repeatCount="indefinite"
              />
            </feTurbulence>
            <feDisplacementMap in="SourceGraphic" scale="12" />
          </filter>
        </svg>
        <div
          className="absolute inset-x-0 bottom-0 h-[60vh]"
          style={{
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent 0%, transparent 18%, rgba(0,0,0,1) 38%, rgba(0,0,0,1) 100%)",
            maskImage:
              "linear-gradient(to bottom, transparent 0%, transparent 18%, rgba(0,0,0,1) 38%, rgba(0,0,0,1) 100%)",
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#c9c9bd]/70 to-[#d8d8cd]" />
          <div
            className="absolute inset-0 bg-[repeating-linear-gradient(180deg,rgba(0,0,0,0.65)_0px,rgba(0,0,0,0.65)_2px,rgba(0,0,0,0)_2px,rgba(0,0,0,0)_16px)]"
            style={{ filter: "url(#wavy-stripes)" }}
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_65%,rgba(255,255,255,0.22)_0px,rgba(255,255,255,0.16)_140px,rgba(255,255,255,0)_280px)]" />
        </div>
        <div className="absolute inset-x-0 bottom-0 h-[60vh] bg-gradient-to-b from-neutral-950/85 via-neutral-950/45 to-transparent backdrop-blur-[2px]" />
        <div className="relative z-10 mx-auto grid min-h-screen w-full max-w-[1440px] items-start gap-10 px-6 pb-28 pt-10 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="min-w-0">
            <motion.h1
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              transition={{ duration: 0.7, delay: 0.05 }}
              className="mt-12 max-w-3xl text-4xl font-semibold leading-tight text-white sm:text-6xl"
            >
              Liquidity rail for
              <span className="block">
                <span className="text-orange-600">OpenClaw</span> agents
              </span>
            </motion.h1>
            <motion.p
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              transition={{ duration: 0.7, delay: 0.1 }}
              className="mt-5 max-w-2xl text-lg text-neutral-300"
            >
              Provide instant, policy-gated MON liquidity to agents for on-chain actions—let agents borrow, spend, and
              repay with interest.
            </motion.p>

            <motion.div
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              transition={{ duration: 0.6, delay: 0.15 }}
              className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4"
            >
              <button
                type="button"
                onClick={onLiquidityProvider}
                className="w-full rounded-full bg-white px-6 py-3 text-center text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200 sm:w-auto"
              >
                {ctaLabel}
              </button>
              <a
                href="/agent-quickstart"
                className="inline-flex w-full items-center justify-center rounded-full border border-white/20 px-6 py-3 text-sm font-medium text-white transition hover:border-white/50 sm:w-auto"
              >
                Agent Quickstart
              </a>
            </motion.div>
          </div>

          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            transition={{ duration: 0.7, delay: 0.2 }}
            className="lg:mt-24"
          >
            <AgentTerminalCard />
          </motion.div>
        </div>
      </section>
    </div>
  );
}
