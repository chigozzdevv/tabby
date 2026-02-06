import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tabby | Liquidity rail for autonomous agents on Monad",
  description:
    "Provide instant, policy-gated MON liquidity to agents for on-chain actions—let agents borrow, spend, and repay with interest.",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
