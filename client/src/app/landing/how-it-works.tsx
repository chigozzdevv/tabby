"use client";

import { motion } from "framer-motion";
import { fadeUp } from "./animations";
import { howItWorksItems } from "./data";
import { DiagramOne, DiagramThree, DiagramTwo } from "./diagrams";

export default function HowItWorksSection() {
  const highlight = "OpenClaw Tabby Borrower skill";
  return (
    <section
      id="how-it-works"
      className="relative z-10 -mt-[100vh] min-h-screen w-full bg-[#e7e6df] pb-24 pt-28 text-neutral-900"
    >
      <div className="mx-auto w-full max-w-[1440px] px-6">
        <div className="mb-12">
          <p className="text-xs uppercase tracking-[0.4em] text-neutral-500">How it works</p>
          <h2 className="mt-4 text-3xl font-semibold text-neutral-900 sm:text-4xl">
            Guardrails first. Liquidity second.
          </h2>
        </div>
        <div className="grid gap-12 md:grid-cols-3">
          {howItWorksItems.map((item, index) => (
            <motion.div
              key={item.title}
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.6, delay: index * 0.08 }}
              className="flex flex-col"
            >
              <div className="text-sm font-medium text-neutral-500">0{index + 1}</div>
              <h3 className="mt-3 text-2xl font-semibold">{item.title}</h3>
              <div className="mt-3 h-px w-full bg-neutral-500/60" />
              <p className="mt-6 text-base leading-relaxed text-neutral-700">
                {item.text.includes("{{tabbyBorrower}}") ? (
                  <>
                    {item.text.split("{{tabbyBorrower}}")[0]}
                    {item.title === "Repay. Report. Improve." ? (
                      <span className="font-semibold text-neutral-800">{highlight}</span>
                    ) : (
                      <span className="font-semibold text-orange-600">{highlight}</span>
                    )}
                    {item.text.split("{{tabbyBorrower}}")[1]}
                  </>
                ) : (
                  item.text
                )}
              </p>
              <div className="mt-12 flex min-h-[260px] items-center justify-start">
                {index === 0 && <DiagramOne delay={index * 0.2} />}
                {index === 1 && <DiagramTwo delay={index * 0.2} />}
                {index === 2 && <DiagramThree delay={index * 0.2} />}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
