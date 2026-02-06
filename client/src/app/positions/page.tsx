import { Suspense } from "react";
import PositionsClient from "./PositionsClient";

export default function PositionsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-neutral-950 text-neutral-100">
          <main className="mx-auto w-full max-w-[1440px] px-6 pb-20 pt-14">
            <p className="text-sm text-neutral-400">Loading positions…</p>
          </main>
        </div>
      }
    >
      <PositionsClient />
    </Suspense>
  );
}

