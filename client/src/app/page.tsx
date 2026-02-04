"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

import Image from "next/image";

const steps = [
  {
    title: "Policy-gated offers",
    text: "Borrower policy registry enforces caps, actions, and durations before any loan is issued.",
  },
  {
    title: "Dual-signature execution",
    text: "Tabby signs the offer, the borrower signs acceptance, and execution happens on-chain.",
  },
  {
    title: "Repay with interest",
    text: "Agents repay principal + interest, and pools accrue yield automatically.",
  },
];

const poolCards = [
  {
    title: "Native gas pool",
    text: "Short-duration MON liquidity for autonomous agent execution and repayment.",
    tags: ["Fast", "Low risk", "Policy-gated"],
  },
  {
    title: "Secured pool",
    text: "Collateral-backed loans with on-chain risk checks and liquidation safeguards.",
    tags: ["Collateralized", "Oracle-backed", "Liquidation ready"],
  },
];

const securityItems = [
  "Policy engine + borrower registry enforcement",
  "Grace period defaults and on-chain tracking",
  "Activity sync and audit trail events",
  "Oracle staleness protection and price validation",
  "Oracle protection and price validation",
];

const faqs = [
  {
    q: "Who approves loans?",
    a: "Borrower policies define strict caps and actions. Offers are issued only when those rules pass.",
  },
  {
    q: "Can agents borrow for any action?",
    a: "Only actions explicitly allowed by policy. Repay-gas topups are reserved for action 255.",
  },
  {
    q: "What happens on default?",
    a: "After due time + grace period, defaults are recorded on-chain and pools are protected.",
  },
];

const tokenAddress = "0x7abB71a5e2e6cD4b8cA3f2E9d1c0b4aF2f7c9a11";
const tokenExplorerUrl = `https://monadscan.com/address/${tokenAddress}`;

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
};

export default function Home() {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 8);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header
        className={`sticky top-0 z-50 transition ${
          isScrolled ? "border-b border-white/10 bg-neutral-950/90 backdrop-blur-md" : "border-b border-transparent"
        }`}
      >
        <div className="mx-auto flex w-full max-w-[1440px] items-center justify-between px-6 py-6">
          <div className="flex items-center">
            <Image
              src="/tabby-logo.png"
              alt="Tabby"
              width={160}
              height={32}
              style={{ objectFit: "contain" }}
              className="h-8 w-auto brightness-0 invert"
              priority
            />
          </div>
          <div className="flex items-center gap-3 text-xs text-neutral-300">
            <span className="uppercase tracking-[0.2em] text-neutral-400">$Tabby</span>
            <a
              href={tokenExplorerUrl}
              target="_blank"
              rel="noreferrer"
              className="group inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 font-mono text-[11px] text-neutral-200 transition hover:border-white/40 hover:text-white"
              aria-label="View $TABBY token on explorer"
            >
              {tokenAddress}
              <svg
                viewBox="0 0 20 20"
                className="h-3 w-3 text-neutral-400 transition group-hover:text-white"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 14L14 6" />
                <path d="M9 6h5v5" />
              </svg>
            </a>
          </div>
        </div>
      </header>

      <main>
        <section id="about" className="relative overflow-hidden pt-6">
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
          <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1440px] flex-col justify-start px-6 pb-28 pt-10">
            <motion.h1
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              transition={{ duration: 0.7, delay: 0.05 }}
              className="mt-12 max-w-3xl text-4xl font-semibold leading-tight text-white sm:text-6xl"
            >
              Liquidity rail for autonomous agents
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
              className="mt-6 flex flex-wrap items-center gap-4"
            >
              <a
                href="#contact"
                className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200"
              >
                Request Access
              </a>
              <a
                href="#agents"
                className="rounded-full border border-white/20 px-6 py-3 text-sm font-medium text-white transition hover:border-white/50"
              >
                Agent Quickstart
              </a>
            </motion.div>
          </div>
        </section>

        <section id="how-it-works" className="mx-auto w-full max-w-[1440px] px-6 py-20">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6 }}
            className="flex flex-col gap-4"
          >
            <p className="text-xs uppercase tracking-[0.3em] text-neutral-400">How it works</p>
            <h2 className="text-3xl font-semibold text-white sm:text-4xl">Guardrails first. Liquidity second.</h2>
          </motion.div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {steps.map((step, index) => (
              <motion.div
                key={step.title}
                variants={fadeUp}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.6, delay: index * 0.08 }}
                className="rounded-2xl border border-white/10 bg-white/5 p-6"
              >
                <div className="text-xs uppercase tracking-[0.25em] text-neutral-400">Step {index + 1}</div>
                <h3 className="mt-4 text-xl font-semibold text-white">{step.title}</h3>
                <p className="mt-3 text-sm text-neutral-300">{step.text}</p>
              </motion.div>
            ))}
          </div>
        </section>

        <section id="pools" className="mx-auto w-full max-w-[1440px] px-6 py-20">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6 }}
            className="flex flex-wrap items-end justify-between gap-6"
          >
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-neutral-400">Pools</p>
              <h2 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">Two rails, one system.</h2>
            </div>
            <p className="max-w-md text-sm text-neutral-400">
              Native and secured pools are optimized for fast agent actions and collateral-backed loans.
            </p>
          </motion.div>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {poolCards.map((pool, index) => (
              <motion.div
                key={pool.title}
                variants={fadeUp}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.6, delay: index * 0.08 }}
                className="rounded-3xl border border-white/10 bg-neutral-900/60 p-8"
              >
                <h3 className="text-2xl font-semibold text-white">{pool.title}</h3>
                <p className="mt-4 text-sm text-neutral-300">{pool.text}</p>
                <div className="mt-6 flex flex-wrap gap-2">
                  {pool.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-white/10 px-3 py-1 text-xs text-neutral-300"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        <section id="security" className="mx-auto w-full max-w-[1440px] px-6 py-20">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6 }}
            className="flex flex-col gap-4"
          >
            <p className="text-xs uppercase tracking-[0.3em] text-neutral-400">Security</p>
            <h2 className="text-3xl font-semibold text-white sm:text-4xl">Built for production safeguards.</h2>
          </motion.div>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {securityItems.map((item, index) => (
              <motion.div
                key={item}
                variants={fadeUp}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.6, delay: index * 0.05 }}
                className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-neutral-300"
              >
                {item}
              </motion.div>
            ))}
          </div>
        </section>

        <section id="agents" className="mx-auto w-full max-w-[1440px] px-6 py-20">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6 }}
            className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/5 to-transparent p-10"
          >
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-neutral-400">For agents</p>
                <h3 className="mt-4 text-2xl font-semibold text-white">
                  Plug into the liquidity rail with one signature flow.
                </h3>
                <p className="mt-3 max-w-xl text-sm text-neutral-300">
                  Agents request offers, sign, execute, and repay — all with a predictable policy envelope.
                </p>
              </div>
              <a
                href="#contact"
                className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200"
              >
                Get agent access
              </a>
            </div>
          </motion.div>
        </section>

        <section id="faq" className="mx-auto w-full max-w-[1440px] px-6 py-20">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6 }}
          >
            <p className="text-xs uppercase tracking-[0.3em] text-neutral-400">FAQ</p>
            <h2 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">Common questions.</h2>
          </motion.div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {faqs.map((item, index) => (
              <motion.div
                key={item.q}
                variants={fadeUp}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.6, delay: index * 0.06 }}
                className="rounded-2xl border border-white/10 bg-white/5 p-6"
              >
                <h4 className="text-lg font-semibold text-white">{item.q}</h4>
                <p className="mt-3 text-sm text-neutral-300">{item.a}</p>
              </motion.div>
            ))}
          </div>
        </section>

        <section id="contact" className="mx-auto w-full max-w-[1440px] px-6 pb-24 pt-12">
          <div className="rounded-3xl border border-white/10 bg-neutral-900/70 p-10">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-neutral-400">Get started</p>
                <h3 className="mt-4 text-2xl font-semibold text-white">Bring your agents on-chain with confidence.</h3>
                <p className="mt-3 text-sm text-neutral-300">
                  We’ll walk you through policy setup, pools, and integrations.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <a
                  href="mailto:hello@tabby.finance"
                  className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200"
                >
                  Request Access
                </a>
                <a
                  href="#agents"
                  className="rounded-full border border-white/20 px-6 py-3 text-sm font-medium text-white transition hover:border-white/50"
                >
                  Agent docs
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/5 py-10">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col items-start justify-between gap-4 px-6 text-sm text-neutral-500 md:flex-row md:items-center">
          <span>© 2026 Tabby. Built for Monad agents.</span>
          <div className="flex gap-6">
            <a href="#about" className="hover:text-neutral-300">
              About
            </a>
            <a href="#security" className="hover:text-neutral-300">
              Security
            </a>
            <a href="#contact" className="hover:text-neutral-300">
              Contact
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
