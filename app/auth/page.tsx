import type { Metadata } from "next";

import { AuthForm } from "./auth-form";
import { isAccountAccessConfigured } from "../../lib/auth/setup";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Cirkitra to save and manage your circuit projects.",
  robots: { index: false, follow: false },
};

export default async function AuthPage({ searchParams }: { searchParams: Promise<{ next?: string; setup?: string; error?: string; verified?: string }> }) {
  const params = await searchParams;
  return <AuthForm nextPath={params.next} setupRequired={!isAccountAccessConfigured()} notice={params.error} verified={params.verified === "1"} />;
}
