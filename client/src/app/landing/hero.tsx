"use client";

import { motion } from "framer-motion";
import { fadeUp } from "./animations";

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
        <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1440px] flex-col justify-start px-6 pb-28 pt-10">
          <motion.h1
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            transition={{ duration: 0.7, delay: 0.05 }}
            className="mt-12 max-w-3xl text-4xl font-semibold leading-tight text-white sm:text-6xl"
          >
            Liquidity rail for <span className="text-orange-600">OpenClaw</span> agents
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
      </section>
    </div>
  );
}
