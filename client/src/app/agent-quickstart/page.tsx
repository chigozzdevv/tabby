"use client";

import { motion } from "framer-motion";
import LandingHeader from "../landing/header";
import LandingFooter from "../landing/footer";
import { fadeUp } from "../landing/animations";

const quickstartSteps = [
  {
    title: "Register",
    text: "Create a borrower profile, link a wallet, and confirm policy access.",
    tag: "01",
  },
  {
    title: "Request",
    text: "Use the OpenClaw Tabby Borrower skill inside allowed actions and caps.",
    tag: "02",
  },
  {
    title: "Sign + execute",
    text: "Sign EIP‑712, execute on‑chain, and receive funds instantly.",
    tag: "03",
  },
  {
    title: "Repay",
    text: "Repay principal + interest and keep the activity record clean.",
    tag: "04",
  },
];

const requirements = [
  "Borrower policy approved",
  "Oracle freshness checks passing",
  "Action allowlist configured",
  "Repayment account funded",
];

export default function AgentQuickstartPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <LandingHeader />
      <main>
        <section className="mx-auto w-full max-w-[1440px] px-6 pb-12 pt-20">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            transition={{ duration: 0.6 }}
            className="max-w-4xl space-y-6"
          >
            <h1 className="text-4xl font-semibold text-white sm:text-5xl">
              OpenClaw <span className="text-orange-400">Tabby Borrower</span> skill.
            </h1>
            <p className="text-sm text-neutral-400">
              Use the skill to request offers, sign EIP‑712, execute on‑chain, and repay — all within policy.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <a
                href="#install"
                className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200"
              >
                Install Skill
              </a>
              <a
                href="https://github.com/chigozzdevv/tabby"
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-white/20 px-6 py-3 text-sm font-medium text-white transition hover:border-white/50"
              >
                View GitHub ↗
              </a>
            </div>
          </motion.div>
        </section>

        <section className="mx-auto w-full max-w-[1440px] px-6 pb-16">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6 }}
            className="rounded-3xl border border-white/10 bg-white/5 p-6 sm:p-8"
          >
            <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-400">Flow</p>
                <div className="mt-6 space-y-6">
                  {quickstartSteps.map((step) => (
                    <div key={step.title} className="flex gap-5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-xs font-semibold text-neutral-300">
                        {step.tag}
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-white">{step.title}</h3>
                        <p className="mt-2 text-sm text-neutral-300">{step.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Install</p>
                  <pre className="mt-3 whitespace-pre-wrap rounded-2xl border border-white/10 bg-neutral-950/60 p-4 text-xs text-neutral-300">
                    {`git clone https://github.com/chigozzdevv/tabby.git
cd tabby/skills/tabby-borrower
npm install
npm run build
cp .env.example .env`}
                  </pre>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Request</p>
                  <pre className="mt-3 whitespace-pre-wrap rounded-2xl border border-white/10 bg-neutral-950/60 p-4 text-xs text-neutral-300">
                    {`tabby-borrower init-wallet
TABBY_API_BASE_URL=http://localhost:3000 \\
MOLTBOOK_API_KEY=moltbook_xxx \\
MOLTBOOK_AUDIENCE=tabby.local \\
tabby-borrower request-gas-loan \\
  --principal-wei 5000000000000000 \\
  --interest-bps 500 \\
  --duration-seconds 3600 \\
  --action 1`}
                  </pre>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Repay</p>
                  <pre className="mt-3 whitespace-pre-wrap rounded-2xl border border-white/10 bg-neutral-950/60 p-4 text-xs text-neutral-300">
                    {`tabby-borrower repay-gas-loan --loan-id 1`}
                  </pre>
                </div>
                <div className="rounded-2xl border border-white/10 bg-neutral-950/60 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Readiness</p>
                  <ul className="mt-4 space-y-3 text-sm text-neutral-300">
                    {requirements.map((item) => (
                      <li key={item} className="flex items-start gap-3">
                        <span className="mt-1 h-2 w-2 rounded-full bg-emerald-400" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </motion.div>
        </section>

      </main>
      <LandingFooter />
    </div>
  );
}
