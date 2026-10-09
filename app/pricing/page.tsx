import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { CIRKITRA_PLANS, formatMonthlyPrice } from "../../lib/billing/plans";
import { getPayPalPublicConfig } from "../../lib/billing/paypal-config";
import { PayPalSubscription } from "./paypal-subscription";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Cirkitra Free, Maker, and Pro plans: get 5, 50, or 200 successful AI circuit requests per rolling month.",
  alternates: { canonical: "/pricing" },
};

export const dynamic = "force-dynamic";

export default function PricingPage() {
  const free = CIRKITRA_PLANS.free;
  const maker = CIRKITRA_PLANS.maker;
  const pro = CIRKITRA_PLANS.pro;
  const paypalConfig = getPayPalPublicConfig();

  return (
    <main className="landing-shell pricing-page">
      <nav className="landing-nav" aria-label="Main navigation">
        <Link className="landing-brand" href="/" aria-label="Cirkitra home">
          <Image className="cirkitra-logo" src="/cirkitra-logo.png" alt="" width={38} height={38} priority />
          <span>Cirkitra<small>AI circuit design &amp; simulation</small></span>
        </Link>
        <div><Link href="/#features">Features</Link><Link href="/#how-it-works">How it works</Link><Link href="/pricing" aria-current="page">Pricing</Link></div>
        <Link className="landing-button landing-button-small" href="/studio">Open Cirkitra <span aria-hidden="true">→</span></Link>
      </nav>

      <section className="pricing-intro">
        <span>STRAIGHTFORWARD PRICING</span>
        <h1>Build for free.<br /><em>Get more AI when you need it.</em></h1>
        <p>{paypalConfig ? `PayPal ${paypalConfig.environment} checkout is available for configured plans. Free remains available.` : "Cirkitra is free while PayPal billing is being configured. No payment details are collected and no charges are made."}</p>
      </section>

      <section className="pricing-cards" aria-label="Pricing plans">
        <article className="pricing-card pricing-card-free">
          <div className="pricing-card-top"><div><span className="pricing-plan-kicker">START BUILDING</span><h2>{free.name}</h2></div><span className="pricing-badge pricing-badge-live">Available now</span></div>
          <p className="pricing-price">{formatMonthlyPrice(free.priceUsdCents)}<small> / month</small></p>
          <p className="pricing-description">{free.description}</p>
          <ul>
            <li>{free.monthlyAiRequests} AI circuit requests</li>
            <li>Manual circuit editing and board-compatible code</li>
            <li>Browser simulation and saved projects</li>
          </ul>
        </article>

        <article className="pricing-card pricing-card-maker">
          <div className="pricing-card-top"><div><span className="pricing-plan-kicker">FOR ACTIVE MAKERS</span><h2>{maker.name}</h2></div><span className="pricing-badge">{paypalConfig ? (paypalConfig.environment === "sandbox" ? "Sandbox" : "Available") : "Setup in progress"}</span></div>
          <p className="pricing-price">{formatMonthlyPrice(maker.priceUsdCents)}<small> / month</small></p>
          <p className="pricing-description">{maker.description}</p>
          <ul>
            <li>{maker.monthlyAiRequests} AI circuit requests</li>
            <li>Everything in Free</li>
          </ul>
          <PayPalSubscription config={paypalConfig} planId="maker" />
        </article>

        <article className="pricing-card pricing-card-pro">
          <div className="pricing-card-top"><div><span className="pricing-plan-kicker">FOR BIGGER BUILDS</span><h2>{pro.name}</h2></div><span className={`pricing-badge${paypalConfig?.planIds.pro ? " pricing-badge-live" : ""}`}>{paypalConfig?.planIds.pro ? (paypalConfig.environment === "sandbox" ? "Sandbox" : "Available") : "Setup in progress"}</span></div>
          <p className="pricing-price">{formatMonthlyPrice(pro.priceUsdCents)}<small> / month</small></p>
          <p className="pricing-description">{pro.description}</p>
          <ul>
            <li>{pro.monthlyAiRequests} AI circuit requests</li>
            <li>Everything in Maker</li>
          </ul>
          <PayPalSubscription config={paypalConfig} planId="pro" />
        </article>
      </section>

      <footer className="pricing-footer"><Link className="landing-brand" href="/" aria-label="Cirkitra home"><Image className="cirkitra-logo" src="/cirkitra-logo.png" alt="" width={34} height={34} /><span>Cirkitra<small>Design · Code · Simulate</small></span></Link><Link href="/">Back to Cirkitra</Link></footer>
    </main>
  );
}
