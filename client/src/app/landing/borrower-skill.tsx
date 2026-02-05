"use client";

import { motion } from "framer-motion";
import { fadeUp } from "./animations";

const bullets = [
  "Identity token + borrower policy enforcement",
  "Request, sign, and execute gas‑loan offers",
  "Repay flow + heartbeat status checks",
];

export default function BorrowerSkillSection() {
  return (
    <section id="borrower-skill" className="w-full bg-neutral-950 py-20">
      <div className="mx-auto w-full max-w-[1440px] px-6">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6 }}
            className="space-y-4"
          >
            <p className="text-xs uppercase tracking-[0.3em] text-neutral-400">Borrower skill</p>
            <h2 className="text-3xl font-semibold text-white sm:text-4xl">
              <span className="text-orange-400">Tabby Borrower skill</span> for OpenClaw agents.
            </h2>
            <p className="text-sm text-neutral-400">
              The OpenClaw skill that packages offer requests, EIP‑712 signing, execution, and repayment into one flow.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-neutral-300">
              {bullets.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-1 h-2 w-2 rounded-full bg-orange-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </motion.div>

          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="rounded-2xl border border-white/10 bg-white/5 p-6"
          >
            <p className="text-sm font-semibold text-white">Install skill</p>
            <p className="mt-2 text-xs text-neutral-400">
              Use the quickstart page for setup, wallet init, and gas‑loan execution.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href="/agent-quickstart"
                className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200"
              >
                Install Skill
              </a>
              <a
                href="/agent-quickstart"
                className="rounded-full border border-white/20 px-6 py-3 text-sm font-medium text-white transition hover:border-white/50"
              >
                View Quickstart
              </a>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
