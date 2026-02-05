"use client";

import { motion } from "framer-motion";
import { fadeUp } from "./animations";
import { faqs } from "./data";
import { QuestionDiagram } from "./diagrams";

export default function FaqSection() {
  return (
    <section id="faq" className="w-full bg-[#e7e6df] py-20 text-neutral-900">
      <div className="mx-auto w-full max-w-[1440px] px-6">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.6 }}
          className="space-y-6"
        >
          <div className="space-y-4">
            <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">FAQ</p>
            <h2 className="text-3xl font-semibold text-neutral-900 sm:text-4xl">Common questions.</h2>
            <p className="text-sm text-neutral-600">
              Clear answers to the most important questions about policy enforcement, repayment flow, and safety.
            </p>
          </div>
          <div className="pt-4">
            <QuestionDiagram delay={0.3} className="h-44 w-44 text-neutral-600" />
          </div>
        </motion.div>

        <div className="rounded-3xl border border-neutral-300/70 bg-transparent p-6">
          <div className="divide-y divide-neutral-300/70">
            {faqs.map((item, index) => (
              <motion.div
                key={item.q}
                variants={fadeUp}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.6, delay: index * 0.06 }}
                className="py-6"
              >
                <div className="flex items-start gap-4">
                  <div className="text-xs font-semibold text-neutral-500">{`0${index + 1}`}</div>
                  <div>
                    <h4 className="text-lg font-semibold text-neutral-900">{item.q}</h4>
                    <p className="mt-2 text-sm text-neutral-700">{item.a}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
        </div>
      </div>
    </section>
  );
}
