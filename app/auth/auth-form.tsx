"use client";

import { useState, type FormEvent } from "react";
import { GoogleAuthProvider, createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, updateProfile } from "firebase/auth";
import Link from "next/link";

import { safeNextPath } from "../../lib/auth/redirect";
import { AuthFlowTimeoutError, withTimeout } from "../../lib/auth/with-timeout";
import { EMAIL_DOMAIN_BLOCK_MESSAGE, isAllowedEmailAddress } from "../../functions/email-domain-policy.mjs";
import { getFirebaseAuth } from "../../lib/firebase/client";
import { clearFirebaseSession, FirebaseSessionError, signOutFromCirkitra, syncFirebaseSession } from "../../lib/firebase/session-client";

type AuthMode = "signin" | "signup" | "forgot";

function actionContinueUrl(path: string) {
  return new URL(path, window.location.origin).toString();
}

function errorMessage(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : "";
  if (error instanceof FirebaseSessionError && error.code === "EMAIL_NOT_VERIFIED") {
    return "Confirm your email address before signing in.";
  }
  if (error instanceof FirebaseSessionError && error.code === "EMAIL_DOMAIN_NOT_ALLOWED") {
    return EMAIL_DOMAIN_BLOCK_MESSAGE;
  }
  const firebaseMessage = error instanceof Error ? error.message.toLowerCase() : "";
  if (firebaseMessage.includes("cloud function") || firebaseMessage.includes("blocking function") || firebaseMessage.includes("email domain")) {
    return EMAIL_DOMAIN_BLOCK_MESSAGE;
  }
  if (code === "auth/internal-error") {
    return "Couldn’t sign in. Try again.";
  }
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"].includes(code)) return "That email and password don’t match.";
  if (code === "auth/email-already-in-use") return "An account with this email already exists. Sign in or reset your password.";
  if (code === "auth/weak-password") return "Choose a password with at least 8 characters.";
  if (code === "auth/too-many-requests") return "Too many attempts. Wait a little and try again.";
  if (code === "auth/popup-closed-by-user") return "Google sign-in was closed before it finished.";
  if (code === "auth/popup-blocked") return "Your browser blocked the Google sign-in window. Allow pop-ups for this site, then try again.";
  if (code === "auth/unauthorized-domain") return "This site isn’t authorized for Google sign-in yet. Add its hostname under Firebase Authentication → Settings → Authorized domains.";
  if (code === "auth/operation-not-allowed") return "Google sign-in isn’t enabled for this Firebase project. Enable the Google provider in Firebase Authentication.";
  if (code === "auth/network-request-failed") return "Google sign-in couldn’t reach Firebase. Check your connection and try again.";
  if (error instanceof AuthFlowTimeoutError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

export function AuthForm({ nextPath, setupRequired, notice, verified }: { nextPath?: string; setupRequired: boolean; notice?: string; verified?: boolean }) {
  const destination = safeNextPath(nextPath, "/projects");
  const [mode, setMode] = useState<AuthMode>("signin");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");
  const [canResendVerification, setCanResendVerification] = useState(false);

  function verificationContinueUrl() {
    const query = new URLSearchParams({ verified: "1", next: destination });
    return actionContinueUrl(`/auth?${query.toString()}`);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setCanResendVerification(false);
    setVerificationEmail("");
    if (mode !== "forgot" && !isAllowedEmailAddress(email)) {
      setError(EMAIL_DOMAIN_BLOCK_MESSAGE);
      return;
    }
    setBusy(true);

    try {
      const auth = getFirebaseAuth();
      if (mode === "forgot") {
        const query = new URLSearchParams({ reset: "1" });
        await sendPasswordResetEmail(auth, email, {
          url: actionContinueUrl(`/auth/reset-password?${query.toString()}`),
        });
        setMessage("If an account exists for that address, a password reset link is on its way.");
      } else if (mode === "signup") {
        const cleanUsername = username.trim();
        if (cleanUsername.length < 2) {
          setError("Username must be at least 2 characters.");
          return;
        }
        const { user } = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(user, { displayName: cleanUsername });
        await clearFirebaseSession(user);
        await sendEmailVerification(user, {
          url: verificationContinueUrl(),
        });
        setMode("signin");
        setPassword("");
        setVerificationEmail(email);
        setCanResendVerification(true);
        setMessage("Check your email for a confirmation link, then sign in here.");
      } else {
        const { user } = await signInWithEmailAndPassword(auth, email, password);
        if (!user.emailVerified) {
          setVerificationEmail(user.email ?? email);
          setCanResendVerification(true);
          await clearFirebaseSession(user);
          setMessage("This account still needs email confirmation. Check your inbox, or resend the verification email below.");
          return;
        }
        await syncFirebaseSession(user);
        window.location.replace(destination);
      }
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const auth = getFirebaseAuth();
      const currentUser = auth.currentUser;
      const user = currentUser?.email === (verificationEmail || email).trim()
        ? currentUser
        : (await signInWithEmailAndPassword(auth, verificationEmail || email, password)).user;
      if (user.emailVerified) {
        await syncFirebaseSession(user);
        window.location.replace(destination);
        return;
      }
      await sendEmailVerification(user, { url: verificationContinueUrl() });
      setMessage("A new verification email has been sent. Check your inbox.");
    } catch (resendError) {
      setError(errorMessage(resendError));
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const { user } = await withTimeout(
        signInWithPopup(getFirebaseAuth(), provider),
        90_000,
        "Google sign-in is taking too long. If a Google window is open, finish or close it; otherwise check that pop-ups are allowed for this site and try again.",
      );
      if (!isAllowedEmailAddress(user.email)) {
        await signOutFromCirkitra();
        throw new FirebaseSessionError(EMAIL_DOMAIN_BLOCK_MESSAGE, "EMAIL_DOMAIN_NOT_ALLOWED");
      }
      if (!user.emailVerified) {
        await signOutFromCirkitra();
        throw new FirebaseSessionError("Google did not confirm this email address. Try another account.", "EMAIL_NOT_VERIFIED");
      }
      await withTimeout(
        syncFirebaseSession(user),
        60_000,
        "Google signed you in, but Cirkitra could not finish creating your session. Check your connection and try again.",
      );
      window.location.replace(destination);
    } catch (oauthError) {
      setError(errorMessage(oauthError));
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "signup" ? "Create your account" : mode === "forgot" ? "Reset your password" : "Welcome back";

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <Link className="auth-brand" href="/" aria-label="Cirkitra home"><span className="auth-brand-mark">C</span><span>Cirkitra<small>AI circuit design & simulation</small></span></Link>
        <h1 id="auth-title">{title}</h1>
        {setupRequired ? (
          <div className="auth-notice auth-error" role="alert">
            Account access is not configured yet. Add the Firebase web settings and server-only credentials, the Supabase URL and keys, enable Firebase Auth in Supabase, and apply the Firebase migration in <code>supabase/migrations</code>.
          </div>
        ) : (
          <>
            <p className="auth-intro">Sign in to save your circuits and open them from any device.</p>
            {notice && <div className="auth-notice auth-error" role="alert">Sign-in couldn’t be completed. Please try again.</div>}
            {verified && <div className="auth-notice auth-success" role="status">Email confirmed. You can sign in now.</div>}
            {mode !== "forgot" && <button type="button" className="google-button" onClick={signInWithGoogle} disabled={busy}>
              <svg aria-hidden="true" viewBox="0 0 48 48" focusable="false">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.76 7.18l7.73 6c4.51-4.17 7.07-10.31 7.07-17.2z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.14 1.45-4.88 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.9l-7.93 6.96C6.52 43.13 14.62 48 24 48z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.4-1.22-.63-2.53-.63-3.89s.23-2.67.62-3.89l-7.98-6.19C.93 17.83 0 21.77 0 24.7c0 3.91.94 7.59 2.6 10.85l7.93-6.96z" />
              </svg>
              Continue with Google
            </button>}
            {mode !== "forgot" && <div className="auth-divider"><span>or continue with email</span></div>}
            <form className="auth-form" onSubmit={submit}>
              {mode === "signup" && <label>Username<input type="text" name="username" autoComplete="nickname" minLength={2} maxLength={32} required value={username} onChange={(event) => setUsername(event.target.value)} /></label>}
              <label>Email address<input type="email" name="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              {mode !== "forgot" && <label>Password<input type="password" name="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
              {error && <div className="auth-notice auth-error" role="alert">{error}</div>}
              {message && <div className="auth-notice auth-success" role="status">{message}</div>}
              {canResendVerification && <button className="auth-link-button" type="button" onClick={() => void resendVerification()} disabled={busy}>Resend verification email</button>}
              <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create account" : mode === "forgot" ? "Send reset link" : "Sign in"}</button>
            </form>
            {mode === "signin" && <button className="auth-link-button" type="button" onClick={() => { setMode("forgot"); setError(""); setMessage(""); }}>Forgot password?</button>}
            <p className="auth-switch">{mode === "signup" ? "Already have an account?" : mode === "forgot" ? "Remembered your password?" : "New to Cirkitra?"}{" "}<button type="button" onClick={() => { setMode(mode === "signup" || mode === "forgot" ? "signin" : "signup"); setError(""); setMessage(""); setCanResendVerification(false); }}>{mode === "signup" || mode === "forgot" ? "Sign in" : "Create an account"}</button></p>
          </>
        )}
        <Link className="auth-back" href="/">← Back to Cirkitra</Link>
      </section>
    </main>
  );
}
