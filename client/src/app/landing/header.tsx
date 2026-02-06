"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { tokenAddress, tokenExplorerUrl } from "./data";

export default function LandingHeader() {
  const [isScrolled, setIsScrolled] = useState(false);

  const shortTokenAddress =
    tokenAddress.length > 12 ? `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}` : tokenAddress;

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 8);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition ${
        isScrolled ? "border-b border-white/10 bg-neutral-950/90 backdrop-blur-md" : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex w-full max-w-[1440px] items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center">
          <Image
            src="/tabby-logo.png"
            alt="Tabby"
            width={160}
            height={32}
            style={{ objectFit: "contain" }}
            className="h-8 w-auto brightness-0 invert"
            priority
          />
        </Link>
        <div className="flex min-w-0 items-center gap-3 text-xs text-neutral-300">
          <span className="hidden uppercase tracking-[0.2em] text-neutral-400 sm:inline">$Tabby</span>
          <a
            href={tokenExplorerUrl}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex min-w-0 items-center gap-2 rounded-full border border-white/10 px-3 py-1 font-mono text-[11px] text-neutral-200 transition hover:border-white/40 hover:text-white"
            aria-label="View $TABBY token on explorer"
          >
            <span className="truncate sm:hidden">{shortTokenAddress}</span>
            <span className="hidden sm:inline">{tokenAddress}</span>
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
  );
}
