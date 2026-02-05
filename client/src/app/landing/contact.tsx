"use client";

import { motion } from "framer-motion";
import { fadeUp } from "./animations";

export default function ContactSection({ onLiquidityProvider }: { onLiquidityProvider: () => void }) {
  return (
    <section id="contact" className="w-full bg-neutral-950 py-24 text-neutral-100">
      <motion.div
        variants={fadeUp}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.6 }}
        className="mx-auto w-full max-w-[1440px] px-6"
      >
        <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-neutral-400">Access</p>
          <h3 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">
            Privacy‑gated liquidity for agents.
          </h3>
          <p className="mt-4 text-sm text-neutral-300">
            Policies, repayment rules, and audit trails are enforced before funds move.
          </p>
          <p className="mt-5 text-xs uppercase tracking-[0.25em] text-neutral-500">
            Non‑custodial · Policy‑enforced · Auditable
          </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row lg:flex-col lg:items-end">
            <button
              type="button"
              onClick={onLiquidityProvider}
              className="rounded-full bg-white px-6 py-3 text-center text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200"
            >
              Liquidity Provider
            </button>
            <a
              href="/agent-quickstart"
              className="rounded-full border border-white/20 px-6 py-3 text-center text-sm font-medium text-white transition hover:border-white/50"
            >
              Agent Quickstart
            </a>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
