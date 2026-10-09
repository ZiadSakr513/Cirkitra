import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { isAccountAccessConfigured } from "../../../lib/auth/setup";
import { isCirkitraOwner } from "../../../lib/billing/ai-usage";
import { getFirebaseSession } from "../../../lib/firebase/session";
import { AdminPlanManager } from "./plan-manager";

export const metadata: Metadata = {
  title: "Plan and usage management",
  robots: { index: false, follow: false },
};

export default async function AdminPlansPage() {
  if (!isAccountAccessConfigured()) redirect("/auth?setup=1");
  const user = await getFirebaseSession();
  if (!user) redirect("/auth?next=%2Fadmin%2Fplans");
  if (!isCirkitraOwner(user.uid)) notFound();

  return <main className="admin-plans-shell">
    <header className="projects-header">
      <Link className="auth-brand" href="/">
        <Image className="brand-logo" src="/cirkitra-logo.png" alt="" width={38} height={38} priority />
        <span>Cirkitra<small>Owner tools</small></span>
      </Link>
      <nav className="admin-plans-nav" aria-label="Owner tools">
        <Link href="/projects">Projects</Link>
        <Link href="/pricing">Pricing</Link>
      </nav>
    </header>
    <section className="admin-plans-content">
      <span className="projects-eyebrow">OWNER TOOLS</span>
      <h1>Plan and usage management</h1>
      <p className="admin-plans-intro">Review account usage, reset AI circuit-generation limits, or grant complimentary plan access without creating a PayPal subscription.</p>
      <AdminPlanManager />
    </section>
  </main>;
}
