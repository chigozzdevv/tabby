"use client";

import { motion } from "framer-motion";

export function DiagramOne({ delay = 0 }: { delay?: number }) {
  return (
    <svg viewBox="0 0 280 280" className="h-60 w-60 text-neutral-800">
      <rect x="40" y="40" width="200" height="200" rx="20" stroke="currentColor" strokeWidth="1.6" fill="none" />
      <g transform="translate(0,6)">
        <motion.line
          x1="70"
          y1="75"
          x2="210"
          y2="75"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeDasharray="8 8"
          animate={{ strokeDashoffset: [0, -32] }}
          transition={{ duration: 6.5, repeat: Infinity, ease: "linear", delay }}
        />
        <motion.line
          x1="70"
          y1="105"
          x2="200"
          y2="105"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeDasharray="8 8"
          animate={{ strokeDashoffset: [0, -32] }}
          transition={{ duration: 6.5, repeat: Infinity, ease: "linear", delay: delay + 0.2 }}
        />
        <motion.line
          x1="70"
          y1="135"
          x2="190"
          y2="135"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeDasharray="8 8"
          animate={{ strokeDashoffset: [0, -32] }}
          transition={{ duration: 6.5, repeat: Infinity, ease: "linear", delay: delay + 0.4 }}
        />
        <motion.rect x="70" y="155" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.6" fill="none" />
        <motion.path
          d="M73 164l5 5 10-12"
          stroke="currentColor"
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          animate={{ pathLength: [0, 1, 1] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut", delay }}
        />
        <motion.rect
          x="70"
          y="185"
          width="120"
          height="12"
          rx="6"
          stroke="currentColor"
          strokeWidth="1.6"
          fill="#f7f6ef"
        />
        <motion.circle
          cx="120"
          cy="191"
          r="7"
          stroke="currentColor"
          strokeWidth="1.6"
          fill="#f7f6ef"
          animate={{ cx: [120, 170, 120] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay }}
        />
        <motion.circle
          cx="205"
          cy="190"
          r="16"
          stroke="currentColor"
          strokeWidth="1.6"
          fill="#f7f6ef"
          animate={{ r: [16, 18, 16] }}
          transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut", delay }}
        />
      </g>
    </svg>
  );
}

export function DiagramTwo({ delay = 0 }: { delay?: number }) {
  return (
    <svg viewBox="0 0 280 280" className="h-60 w-60 text-neutral-800">
      <motion.rect
        x="50"
        y="35"
        width="170"
        height="200"
        rx="18"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        animate={{ rotate: [0, 1.2, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay }}
        style={{ transformOrigin: "135px 135px" }}
      />
      <motion.rect
        x="30"
        y="55"
        width="170"
        height="200"
        rx="18"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        animate={{ rotate: [0, -1, 0] }}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut", delay: delay + 0.2 }}
        style={{ transformOrigin: "115px 155px" }}
      />
      <motion.path
        d="M70 110c18 12 34 12 52 0 14-10 30-8 44 4"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        animate={{ pathLength: [0, 1, 1] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", delay }}
      />
      <motion.path
        d="M70 140c20 14 38 14 58 0 16-12 34-10 50 5"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        animate={{ pathLength: [0, 1, 1] }}
        transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut", delay: delay + 0.2 }}
      />
      <motion.circle
        cx="95"
        cy="195"
        r="13"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="#f7f6ef"
        animate={{ r: [13, 15, 13] }}
        transition={{ duration: 4.6, repeat: Infinity, ease: "easeInOut", delay }}
      />
      <motion.circle
        cx="175"
        cy="195"
        r="13"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="#f7f6ef"
        animate={{ r: [13, 15, 13] }}
        transition={{ duration: 4.6, repeat: Infinity, ease: "easeInOut", delay: delay + 0.3 }}
      />
      <motion.path
        d="M89 195l6 6 12-14"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        animate={{ pathLength: [0, 1, 1] }}
        transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut", delay }}
      />
      <motion.path
        d="M169 195l6 6 12-14"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        animate={{ pathLength: [0, 1, 1] }}
        transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut", delay: delay + 0.2 }}
      />
      <motion.line
        x1="95"
        y1="195"
        x2="175"
        y2="195"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeDasharray="6 8"
        animate={{ strokeDashoffset: [0, -28] }}
        transition={{ duration: 6.5, repeat: Infinity, ease: "linear", delay }}
      />
    </svg>
  );
}

export function DiagramThree({ delay = 0 }: { delay?: number }) {
  return (
    <svg viewBox="0 0 320 320" className="h-64 w-64 text-neutral-800">
      <rect x="20" y="20" width="280" height="280" rx="22" stroke="currentColor" strokeWidth="1.6" fill="none" />

      <motion.g
        animate={{ y: [0, -2, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay }}
      >
        <circle cx="160" cy="84" r="30" stroke="currentColor" strokeWidth="1.8" fill="none" />
        <motion.circle
          cx="160"
          cy="84"
          r="13"
          stroke="currentColor"
          strokeWidth="1.8"
          fill="#f7f6ef"
          animate={{ r: [13, 16, 13] }}
          transition={{ duration: 4.2, repeat: Infinity, ease: "easeInOut", delay }}
        />
      </motion.g>

      <motion.line x1="160" y1="114" x2="160" y2="130" stroke="currentColor" strokeWidth="1.6" />
      <path d="M156 126l4 4 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" />

      <motion.g
        animate={{ y: [0, 2, 0] }}
        transition={{ duration: 6.8, repeat: Infinity, ease: "easeInOut", delay: delay + 0.1 }}
      >
        <rect x="120" y="135" width="80" height="62" rx="12" stroke="currentColor" strokeWidth="1.8" fill="none" />
        <motion.line x1="132" y1="154" x2="188" y2="154" stroke="currentColor" strokeWidth="1.6" />
        <motion.line x1="132" y1="170" x2="180" y2="170" stroke="currentColor" strokeWidth="1.6" />
        <motion.path
          d="M136 184l6 6 12-14"
          stroke="currentColor"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          animate={{ pathLength: [0, 1, 1] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut", delay }}
        />
      </motion.g>

      <motion.line x1="160" y1="197" x2="160" y2="213" stroke="currentColor" strokeWidth="1.6" />
      <path d="M156 209l4 4 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" />

      <motion.g
        animate={{ y: [0, -2, 0] }}
        transition={{ duration: 6.5, repeat: Infinity, ease: "easeInOut", delay: delay + 0.2 }}
      >
        <rect x="120" y="218" width="80" height="50" rx="12" stroke="currentColor" strokeWidth="1.8" fill="none" />
        <motion.path
          d="M132 256v-10M160 256v-18M188 256v-26"
          stroke="currentColor"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
          animate={{ pathLength: [0.6, 1, 0.6] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay }}
        />
      </motion.g>
    </svg>
  );
}

export function SecurityDiagram({
  delay = 0,
  className = "h-48 w-48 text-neutral-800",
}: {
  delay?: number;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 240 240" className={className}>
      <motion.path
        d="M120 40c28 0 50 12 50 12v40c0 46-34 76-50 88-16-12-50-42-50-88V52s22-12 50-12z"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        animate={{ y: [0, -3, 0] }}
        transition={{ duration: 6.5, repeat: Infinity, ease: "easeInOut", delay }}
      />
      <motion.path
        d="M96 110l16 16 32-34"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        animate={{ pathLength: [0, 1, 1] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut", delay }}
      />
    </svg>
  );
}

export function QuestionDiagram({
  delay = 0,
  className = "h-44 w-44 text-neutral-300",
}: {
  delay?: number;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 240 240" className={className}>
      <motion.circle
        cx="120"
        cy="120"
        r="74"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        animate={{ opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay }}
      />
      <motion.g
        animate={{ rotate: [0, 360] }}
        transition={{ duration: 18, repeat: Infinity, ease: "linear", delay }}
        style={{ transformOrigin: "120px 120px" }}
      >
        <circle cx="120" cy="44" r="4" fill="currentColor" />
        <circle cx="184" cy="120" r="3" fill="currentColor" />
        <circle cx="56" cy="120" r="3" fill="currentColor" />
      </motion.g>
      <motion.path
        d="M90 98c0-18 14-30 30-30 14 0 26 10 26 24 0 16-14 20-22 26-6 4-8 7-8 14"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        animate={{ pathLength: [0, 1, 1] }}
        transition={{ duration: 3.8, repeat: Infinity, ease: "easeInOut", delay }}
      />
      <motion.circle
        cx="116"
        cy="150"
        r="4"
        fill="currentColor"
        animate={{ scale: [1, 1.3, 1] }}
        transition={{ duration: 3.8, repeat: Infinity, ease: "easeInOut", delay: delay + 0.4 }}
      />
    </svg>
  );
}
