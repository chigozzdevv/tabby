"use client";

import { useState } from "react";
import LandingHeader from "./landing/header";
import LandingHero from "./landing/hero";
import HowItWorksSection from "./landing/how-it-works";
import BorrowerSkillSection from "./landing/borrower-skill";
import PoolsSection from "./landing/pools";
import SecuritySection from "./landing/security";
import FaqSection from "./landing/faq";
import ContactSection from "./landing/contact";
import LandingFooter from "./landing/footer";
import LiquidityProviderModal from "./landing/liquidity-provider-modal";

export default function Home() {
  const [isLiquidityModalOpen, setLiquidityModalOpen] = useState(false);
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <LandingHeader />
      <main>
        <LandingHero onLiquidityProvider={() => setLiquidityModalOpen(true)} />
        <HowItWorksSection />
        <BorrowerSkillSection />
        <PoolsSection />
        <SecuritySection />
        <FaqSection />
        <ContactSection onLiquidityProvider={() => setLiquidityModalOpen(true)} />
      </main>
      <LandingFooter />
      <LiquidityProviderModal isOpen={isLiquidityModalOpen} onClose={() => setLiquidityModalOpen(false)} />
    </div>
  );
}
