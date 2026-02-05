"use client";

import { motion } from "framer-motion";
import { fadeUp } from "./animations";
import { securityItems } from "./data";
import { SecurityDiagram } from "./diagrams";

export default function SecuritySection() {
  return (
    <section id="security" className="w-full bg-neutral-950 py-24 text-neutral-100">
      <div className="mx-auto w-full max-w-[1440px] px-6">
        <div className="grid gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6 }}
            className="space-y-6"
          >
            <p className="text-xs uppercase tracking-[0.35em] text-neutral-400">Security</p>
            <h2 className="text-3xl font-semibold text-white sm:text-4xl">Built for production safeguards.</h2>
            <p className="text-sm text-neutral-300">
              Every loan is policy-checked, time-bounded, and fully traceable — so pools can scale without compromising
              safety.
            </p>
            <div className="pt-4">
              <SecurityDiagram delay={0.2} className="h-48 w-48 text-neutral-200" />
            </div>
          </motion.div>

          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="rounded-3xl border border-white/10 bg-white/5 p-8"
          >
            <div className="space-y-6">
              {securityItems.map((item, index) => (
                <div key={item} className="flex items-start gap-4">
                  <div className="text-xs font-semibold text-neutral-400">{`0${index + 1}`}</div>
                  <div className="flex-1 border-b border-white/10 pb-6 text-sm text-neutral-300">{item}</div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
