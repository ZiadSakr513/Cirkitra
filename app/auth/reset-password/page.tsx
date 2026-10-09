import type { Metadata } from "next";

import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Reset password", robots: { index: false, follow: false } };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const params = await searchParams;
  return <ResetPasswordForm resetComplete={params.reset === "1"} />;
}
