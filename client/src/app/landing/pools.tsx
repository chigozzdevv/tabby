"use client";

import { motion } from "framer-motion";
import { fadeUp } from "./animations";
import { poolCards } from "./data";

export default function PoolsSection() {
  return (
    <section id="pools" className="w-full bg-[#e7e6df] py-20 text-neutral-900">
      <div className="mx-auto w-full max-w-[1440px] px-6">
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.6 }}
          className="flex flex-wrap items-end justify-between gap-6"
        >
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">Pools</p>
            <h2 className="mt-4 text-3xl font-semibold text-neutral-900 sm:text-4xl">Two rails, one system.</h2>
          </div>
          <div className="max-w-md text-sm text-neutral-500" />
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
              className={`rounded-2xl border bg-transparent p-8 transition duration-300 ${
                index === 0 ? "border-neutral-400" : "border-neutral-300/70 hover:border-neutral-400"
              }`}
              whileHover={{ y: -2 }}
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">{`Pool 0${index + 1}`}</p>
                  <h3 className="mt-3 text-2xl font-semibold text-neutral-900">{pool.title}</h3>
                </div>
                <span className="rounded-full border border-neutral-300/70 px-3 py-1 text-xs text-neutral-600">
                  {pool.status}
                </span>
              </div>
              <p className="mt-4 text-sm text-neutral-700">{pool.description}</p>

              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                {pool.metrics.map((metric) => (
                  <div key={metric.label}>
                    <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">{metric.label}</p>
                    <p className="mt-2 text-sm font-semibold text-neutral-900">{metric.value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-6">
                <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Controls</p>
                <ul className="mt-3 space-y-2 text-sm text-neutral-700">
                  {pool.controls.map((control) => (
                    <li key={control} className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-neutral-500" />
                      <span>{control}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
