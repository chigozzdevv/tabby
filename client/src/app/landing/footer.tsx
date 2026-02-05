"use client";

export default function LandingFooter() {
  return (
    <footer className="border-t border-white/5 py-10">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col items-start justify-between gap-4 px-6 text-sm text-neutral-500 md:flex-row md:items-center">
        <span>© 2026 Tabby. Built for Monad agents.</span>
        <div className="flex gap-6">
          <a href="#about" className="hover:text-neutral-300">
            About
          </a>
          <a href="#security" className="hover:text-neutral-300">
            Security
          </a>
          <a href="#contact" className="hover:text-neutral-300">
            Contact
          </a>
        </div>
      </div>
    </footer>
  );
}
