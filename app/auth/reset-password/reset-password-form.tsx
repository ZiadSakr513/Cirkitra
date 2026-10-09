"use client";

import Link from "next/link";

export function ResetPasswordForm({ resetComplete }: { resetComplete: boolean }) {
  return (
    <main className="auth-shell"><section className="auth-card">
      <Link className="auth-brand" href="/"><span className="auth-brand-mark">C</span><span>Cirkitra<small>AI circuit design & simulation</small></span></Link>
      <h1>{resetComplete ? "Password reset" : "Reset your password"}</h1>
      <p className="auth-intro">{resetComplete ? "If you completed the reset from your email, you can now sign in with your new password." : "Use the password reset link sent to your email. The secure reset page will let you choose a new password."}</p>
      <Link className="auth-submit" href="/auth">Return to sign in</Link>
    </section></main>
  );
}
