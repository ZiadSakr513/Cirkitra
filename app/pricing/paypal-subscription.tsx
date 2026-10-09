"use client";

import Link from "next/link";
import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

import { CIRKITRA_PLANS, formatMonthlyPrice, type PaidCirkitraPlanId } from "../../lib/billing/plans";
import type { PayPalPublicConfig } from "../../lib/billing/paypal-config";
import { getConfiguredPayPalPlanId } from "../../lib/billing/paypal-plan-mapping";
import { getFirebaseAuth } from "../../lib/firebase/client";
import { syncFirebaseSession } from "../../lib/firebase/session-client";

type BillingStatus = {
  planId: "free" | "maker" | "pro";
  paypalPlanId: "free" | "maker" | "pro";
  subscriptionPlanId: "free" | "maker" | "pro";
  complimentaryGrant: { planId: "maker" | "pro"; expiresAt: string | null } | null;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  paidThrough: string | null;
  canCancel: boolean;
  checkoutEnabled: boolean;
};

type BillingResponseError = { error?: { code?: string } };
type PayPalApprovalData = { subscriptionID?: string };

type PayPalButtonsActions = {
  subscription: {
    create: (options: { plan_id: string; custom_id: string }) => Promise<string>;
  };
};

type PayPalWindow = Window & {
  paypal?: {
    Buttons: (options: {
      style: {
        layout: "vertical";
        color: "blue";
        shape: "pill";
        label: "paypal";
        height: number;
        tagline: false;
      };
      createSubscription: (_data: unknown, actions: PayPalButtonsActions) => Promise<string>;
      onApprove: (data: PayPalApprovalData) => Promise<void> | void;
      onError: (error: unknown) => void;
    }) => { render: (target: HTMLElement) => Promise<unknown> };
  };
};

function displayDate(value: string | null) {
  if (!value) return "the end of the paid period";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "the end of the paid period" : date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function ExistingPaymentRecovery({ onVerify, busy, amount }: { onVerify: (subscriptionId: string) => void; busy: boolean; amount: string }) {
  const [subscriptionId, setSubscriptionId] = useState("");
  return <details className="pricing-payment-recovery">
    <summary>Already approved a payment? Check it without paying again</summary>
    <p>In your PayPal account, open the matching {amount} subscription or payment and copy its subscription ID (starts with I-). This checks the PayPal environment configured for this site and does not start a payment.</p>
    <form className="pricing-payment-recovery-form" onSubmit={(event) => { event.preventDefault(); onVerify(subscriptionId.trim()); }}>
      <label htmlFor="paypal-existing-subscription-id">PayPal subscription ID</label>
      <input id="paypal-existing-subscription-id" className="pricing-payment-recovery-input" value={subscriptionId} onChange={(event) => setSubscriptionId(event.target.value)} autoComplete="off" spellCheck={false} placeholder="I-…" required />
      <button className="landing-button pricing-action" type="submit" disabled={busy}>{busy ? "Checking PayPal…" : "Verify existing payment"}</button>
    </form>
  </details>;
}

async function readBillingStatus(): Promise<{ response: Response; status?: BillingStatus; errorCode?: string }> {
  const response = await fetch("/api/billing/paypal/status", { cache: "no-store" });
  const body = await response.json().catch(() => ({})) as BillingStatus & BillingResponseError;
  if (!response.ok) return { response, errorCode: body.error?.code };
  return { response, status: body };
}

function billingStatusError(code?: string) {
  if (code === "BILLING_SETUP_REQUIRED") return "Supabase billing is not initialized. Apply the migrations in order: 20261005040000_paypal_subscriptions.sql, 20261009040000_paypal_multi_tier.sql, 20261009050000_admin_plan_grants.sql, 20261009080000_paypal_environment_isolation.sql.";
  return "Could not load your subscription status. Refresh this page to try again.";
}

async function readCirkitraSession() {
  const options: RequestInit = { cache: "no-store", credentials: "same-origin" };
  const response = await fetch("/api/auth/session", options);
  if (response.status !== 401) return response;

  // A Firebase client can still be signed in while the server session cookie is
  // missing or expired. Restore the first-party session before showing sign-in.
  const auth = getFirebaseAuth();
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user?.emailVerified) return response;
  await syncFirebaseSession(user, true);
  return fetch("/api/auth/session", options);
}

export function PayPalSubscription({ config, planId }: { config: PayPalPublicConfig | null; planId: PaidCirkitraPlanId }) {
  const plan = CIRKITRA_PLANS[planId];
  const paypalPlanId = config ? getConfiguredPayPalPlanId(config.planIds, planId) : null;
  const amount = `${formatMonthlyPrice(plan.priceUsdCents)} USD`;
  const containerRef = useRef<HTMLDivElement>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [message, setMessage] = useState("");
  const [accountError, setAccountError] = useState("");
  const [billingError, setBillingError] = useState("");
  const [billingLoading, setBillingLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [checkoutReady, setCheckoutReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [approvalPending, setApprovalPending] = useState(false);
  const [approvedSubscriptionId, setApprovedSubscriptionId] = useState("");
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const recoveryCheckedRef = useRef(false);

  const refreshStatus = useCallback(async () => {
    const result = await readBillingStatus();
    if (result.response.ok && result.status) {
      setSignedIn(true);
      setStatus(result.status);
      setBillingError("");
      return result.status;
    }
    if (result.response.status === 401) {
      setSignedIn(false);
      setStatus(null);
      setBillingError("Your Cirkitra sign-in has expired. Sign in again to continue.");
    } else {
      setBillingError(billingStatusError(result.errorCode));
    }
    return null;
  }, []);

  const confirmPayPalSubscription = useCallback(async (subscriptionId: string, retryBriefly = false) => {
    if (!subscriptionId) {
      setMessage("PayPal did not return a subscription ID. Do not start another checkout; refresh this page and check your subscription again.");
      setApprovalPending(false);
      return;
    }
    setApprovalPending(true);
    setApprovedSubscriptionId(subscriptionId);
    setConfirmationBusy(true);
    const attempts = retryBriefly ? 4 : 1;
    try {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          const response = await fetch("/api/billing/paypal/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subscriptionId }),
            cache: "no-store",
          });
          const result = await response.json() as { confirmed?: boolean; pending?: boolean; error?: { message?: string } };
          if (!response.ok) throw new Error(result.error?.message || "Could not verify this PayPal subscription yet.");

          const updated = await refreshStatus();
          if (updated?.planId !== "free" && updated) {
            window.sessionStorage.removeItem("cirkitra-paypal-pending-subscription");
            setApprovalPending(false);
            const activePlan = CIRKITRA_PLANS[updated.planId];
            setMessage(`${activePlan.name} is active. Your allowance is ${activePlan.monthlyAiRequests} successful AI requests per rolling month.`);
            return;
          }
          if (result.confirmed) {
            setMessage("PayPal verified the payment. Cirkitra is finishing the account update; check again shortly and don’t start another checkout.");
          } else {
            setMessage("PayPal has not yet confirmed a successful payment. This check will not charge again; don’t start another checkout.");
          }
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Could not verify this PayPal subscription yet.");
        }

        if (attempt + 1 < attempts) await new Promise((resolve) => window.setTimeout(resolve, 4000));
      }
    } finally {
      setConfirmationBusy(false);
      setApprovalPending(false);
    }
  }, [refreshStatus]);

  useEffect(() => {
    let active = true;
    readCirkitraSession()
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401) {
          setSignedIn(false);
          setStatus(null);
          return;
        }
        if (!response.ok) {
          setAccountError("Could not check your Cirkitra sign-in. Please retry.");
          return;
        }
        setSignedIn(true);
        setBillingLoading(true);
        const billing = await readBillingStatus();
        if (!active) return;
        if (billing.response.ok && billing.status) {
          setStatus(billing.status);
          setBillingError("");
        } else if (billing.response.status === 401) {
          setSignedIn(false);
          setStatus(null);
          setBillingError("Your Cirkitra sign-in has expired. Sign in again to continue.");
        } else {
          setBillingError(billingStatusError(billing.errorCode));
        }
      })
      .catch(() => {
        if (active) setAccountError("Could not check your Cirkitra sign-in. Please retry.");
      })
      .finally(() => {
        if (active) {
          setAuthLoading(false);
          setBillingLoading(false);
        }
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (authLoading || !signedIn || recoveryCheckedRef.current) return;
    recoveryCheckedRef.current = true;
    const pendingSubscriptionId = window.sessionStorage.getItem("cirkitra-paypal-pending-subscription");
    if (!pendingSubscriptionId) return;
    window.setTimeout(() => void confirmPayPalSubscription(pendingSubscriptionId, true), 0);
  }, [authLoading, confirmPayPalSubscription, signedIn]);

  useEffect(() => {
    if (!config || !paypalPlanId || !signedIn || !checkoutReady || approvalPending || !status || status.paypalPlanId !== "free" || !sdkLoaded || !containerRef.current) return;
    const paypalWindow = window as PayPalWindow;
    let disposed = false;
    let rendered = false;
    const container = containerRef.current;
    const renderButtons = async () => {
      if (disposed || rendered || !paypalWindow.paypal || !container) return;
      rendered = true;
      container.replaceChildren();
      try {
        await paypalWindow.paypal.Buttons({
          style: {
            layout: "vertical",
            color: "blue",
            shape: "pill",
            label: "paypal",
            height: 48,
            tagline: false,
          },
          createSubscription: async (_data, actions) => {
            const intentResponse = await fetch("/api/billing/paypal/checkout-intent", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ planId }),
              cache: "no-store",
            });
            const result = await intentResponse.json() as { intentId?: string; error?: { message?: string } };
            if (!intentResponse.ok || !result.intentId) throw new Error(result.error?.message || "Could not start PayPal checkout.");
            return actions.subscription.create({ plan_id: paypalPlanId, custom_id: result.intentId });
          },
          onApprove: async (data) => {
            const subscriptionId = typeof data.subscriptionID === "string" ? data.subscriptionID : "";
            setApprovalPending(true);
            setApprovedSubscriptionId(subscriptionId);
            if (subscriptionId) window.sessionStorage.setItem("cirkitra-paypal-pending-subscription", subscriptionId);
            setMessage("PayPal approved the subscription. Verifying the payment directly with PayPal…");
            await confirmPayPalSubscription(subscriptionId, true);
          },
          onError: (error) => {
            console.error("[paypal-button-error]", error);
            setMessage("PayPal checkout could not be completed. No plan access was changed; please try again.");
          },
        }).render(container);
      } catch (error) {
        if (!disposed) setMessage(error instanceof Error ? error.message : "Could not load PayPal checkout.");
      }
    };

    if (paypalWindow.paypal) {
      void renderButtons();
    }
    return () => {
      disposed = true;
      container.replaceChildren();
    };
  }, [approvalPending, checkoutReady, config, confirmPayPalSubscription, paypalPlanId, planId, refreshStatus, sdkLoaded, signedIn, status]);

  async function cancelSubscription() {
    const paidPlanName = status && status.paypalPlanId !== "free" ? CIRKITRA_PLANS[status.paypalPlanId].name : "PayPal";
    if (!window.confirm(`Cancel the next renewal? You’ll keep ${paidPlanName} access through the paid-through date.`)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/billing/paypal/cancel", { method: "POST", cache: "no-store" });
      const result = await response.json() as { error?: { message?: string }; cancelled?: boolean };
      if (!response.ok) throw new Error(result.error?.message || "Could not cancel the PayPal subscription.");
      await refreshStatus();
      const currentPlanName = status && status.paypalPlanId !== "free" ? CIRKITRA_PLANS[status.paypalPlanId].name : "PayPal";
      setMessage(result.cancelled ? `Renewal cancelled. ${currentPlanName} access remains available until ${displayDate(status?.paidThrough ?? null)}.` : "The subscription is already cancelled or no active renewal was found.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not cancel the PayPal subscription.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelUnpaidAttemptAndRetry() {
    const pendingPlanName = status?.subscriptionPlanId === "maker" || status?.subscriptionPlanId === "pro"
      ? CIRKITRA_PLANS[status.subscriptionPlanId].name
      : plan.name;
    if (!window.confirm(`Cancel the unresolved ${pendingPlanName} PayPal attempt and prepare a fresh checkout? Cirkitra will first check PayPal for a completed payment. If one exists, it will sync that payment instead of starting another. This action does not refund any payment already processed.`)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/billing/paypal/retry", { method: "POST", cache: "no-store" });
      const result = await response.json() as { retryAvailable?: boolean; error?: { code?: string; message?: string } };
      if (result.error?.code === "PAYMENT_ALREADY_CONFIRMED") {
        await refreshStatus();
        setMessage("PayPal confirmed the existing payment. Your plan status has been updated; no second checkout was started.");
        return;
      }
      if (!response.ok || !result.retryAvailable) throw new Error(result.error?.message || "PayPal has not confirmed that it is safe to retry yet.");
      window.sessionStorage.removeItem("cirkitra-paypal-pending-subscription");
      setApprovedSubscriptionId("");
      setApprovalPending(false);
      setCheckoutReady(false);
      const updated = await refreshStatus();
      const anotherAttemptIsOpen = Boolean(updated && ["APPROVAL_PENDING", "APPROVED", "ACTIVE", "SUSPENDED"].includes(updated.subscriptionStatus ?? ""));
      if (anotherAttemptIsOpen && updated) {
        const otherPlanName = updated.subscriptionPlanId === "maker" || updated.subscriptionPlanId === "pro"
          ? CIRKITRA_PLANS[updated.subscriptionPlanId].name
          : "another";
        setMessage(`That unpaid attempt was cancelled, but ${otherPlanName} PayPal attempt is still unresolved. Resolve it before starting a new checkout.`);
      } else if (updated) {
        setMessage("The unpaid PayPal attempt was cancelled. You can now start a fresh checkout.");
      } else {
        setMessage("PayPal cancelled the old attempt, but Cirkitra could not refresh your status. Refresh the page before starting checkout.");
      }
    } catch (error) {
      await refreshStatus();
      setMessage(error instanceof Error ? error.message : "Could not safely restart this PayPal attempt.");
    } finally {
      setBusy(false);
    }
  }

  if (authLoading) return <div className="pricing-checkout-note">Checking your Cirkitra account…</div>;
  if (accountError) return <div className="pricing-account-status"><p className="pricing-account-message" role="alert">{accountError} Refresh this page to try again.</p></div>;
  if (!signedIn) {
    if (!config) return <div className="pricing-checkout-note">PayPal checkout is not configured yet. Cirkitra remains free, and no payment details are collected.</div>;
    if (!paypalPlanId) return <div className="pricing-account-status"><p className="pricing-account-message">{plan.name} checkout is being configured. No payment can be started yet.</p><button className="landing-button pricing-action pricing-action-disabled" type="button" disabled>{plan.name} unavailable</button></div>;
    return <div className="pricing-checkout-note"><Link className="landing-button pricing-action" href="/auth?next=%2Fpricing">Upgrade <span aria-hidden="true">→</span></Link>{config.environment === "sandbox" && <p className="pricing-account-subtle">Sign in to continue. Sandbox checkout only; no live charge.</p>}</div>;
  }
  const hasOpenPayPalSubscription = Boolean(status && ["APPROVAL_PENDING", "APPROVED", "ACTIVE", "SUSPENDED"].includes(status.subscriptionStatus ?? ""));
  const grantCanRaisePlan = Boolean(status?.complimentaryGrant && (
    status.paypalPlanId === "free"
    || (status.complimentaryGrant.planId === "pro" && status.paypalPlanId === "maker")
  ));
  if (status?.planId !== "free" && status && !(checkoutReady && status.paypalPlanId === "free" && !hasOpenPayPalSubscription)) {
    const activePlan = CIRKITRA_PLANS[status.planId];
    return <div className="pricing-account-status">
      {grantCanRaisePlan && status.complimentaryGrant
        ? <p className="pricing-account-message">Complimentary {CIRKITRA_PLANS[status.complimentaryGrant.planId].name} access is active{status.complimentaryGrant.expiresAt ? ` through ${displayDate(status.complimentaryGrant.expiresAt)}` : " with no expiration"} ({activePlan.monthlyAiRequests} successful requests per rolling month).</p>
        : <p className="pricing-account-message">Your paid {activePlan.name} plan is active through {displayDate(status.paidThrough)} ({activePlan.monthlyAiRequests} successful requests per rolling month).</p>}
      {status.complimentaryGrant && !grantCanRaisePlan && <p className="pricing-account-subtle">You also have complimentary {CIRKITRA_PLANS[status.complimentaryGrant.planId].name} access{status.complimentaryGrant.expiresAt ? ` through ${displayDate(status.complimentaryGrant.expiresAt)}` : " with no expiration"}.</p>}
      {grantCanRaisePlan && status.paypalPlanId !== "free" && <p className="pricing-account-subtle">Your paid {CIRKITRA_PLANS[status.paypalPlanId].name} subscription remains unchanged and is active through {displayDate(status.paidThrough)}.</p>}
      {hasOpenPayPalSubscription && status.paypalPlanId === "free" && <>
        <p className="pricing-account-subtle">PayPal has an open subscription. Check its payment status before starting another checkout.</p>
        {status.subscriptionId && <button className="landing-button pricing-action" type="button" disabled={confirmationBusy} onClick={() => void confirmPayPalSubscription(status.subscriptionId!)}>{confirmationBusy ? "Checking PayPal…" : "Check payment status"}</button>}
      </>}
      {status.canCancel ? <button className="landing-button pricing-cancel-button" type="button" disabled={busy} onClick={() => void cancelSubscription()}>{busy ? "Cancelling…" : status.paypalPlanId === "free" ? "Cancel PayPal subscription" : `Cancel ${CIRKITRA_PLANS[status.paypalPlanId].name} renewal`}</button> : status.paypalPlanId !== "free" && <p className="pricing-account-subtle">Renewal is cancelled; your paid access will end on that date. You can choose a different paid plan after then.</p>}
      {status.paypalPlanId === "free" && !hasOpenPayPalSubscription && config && paypalPlanId && <button className="landing-button pricing-action" type="button" onClick={() => setCheckoutReady(true)}>Choose paid {plan.name} <span aria-hidden="true">→</span></button>}
      {message && <p aria-live="polite" className="pricing-account-subtle">{message}</p>}
    </div>;
  }
  if (approvalPending) {
    return <div className="pricing-account-status">
      <p className="pricing-account-message" aria-live="polite">{message || "Checking the PayPal payment…"}</p>
      {approvedSubscriptionId && <button className="landing-button pricing-action" type="button" disabled={confirmationBusy} onClick={() => void confirmPayPalSubscription(approvedSubscriptionId)}>{confirmationBusy ? "Checking PayPal…" : "Check payment status"}</button>}
      <p className="pricing-account-subtle">This check does not start a payment. Don’t approve another checkout while this one is being checked.</p>
      <ExistingPaymentRecovery onVerify={(id) => void confirmPayPalSubscription(id, true)} busy={confirmationBusy} amount={amount} />
    </div>;
  }
  if (billingLoading) return <div className="pricing-checkout-note">Checking your subscription…</div>;
  if (billingError) return <div className="pricing-account-status"><p className="pricing-account-message" role="alert">{billingError}</p><button className="landing-button pricing-action pricing-action-disabled" type="button" disabled>Checkout unavailable</button></div>;
  if (!status && !checkoutReady) {
    return <div className="pricing-account-status"><p className="pricing-account-message" role="alert">Could not load your subscription status. Refresh this page to try again.</p></div>;
  }
  if (status?.subscriptionStatus === "APPROVAL_PENDING" || status?.subscriptionStatus === "APPROVED" || status?.subscriptionStatus === "ACTIVE" || status?.subscriptionStatus === "SUSPENDED") {
    const pendingPlanId = status.subscriptionPlanId === "maker" || status.subscriptionPlanId === "pro" ? status.subscriptionPlanId : null;
    const pendingPlanName = pendingPlanId ? CIRKITRA_PLANS[pendingPlanId].name : "paid";
    const isPendingPlan = pendingPlanId === planId;
    return <div className="pricing-account-status">
      <p className="pricing-account-message">{isPendingPlan
        ? `Your ${pendingPlanName} PayPal attempt is waiting for payment confirmation.`
        : `A ${pendingPlanName} PayPal attempt is still unresolved. Resolve it before starting ${plan.name}.`}</p>
      {isPendingPlan && status.subscriptionId && <>
        <button className="landing-button pricing-action" type="button" disabled={confirmationBusy || busy} onClick={() => void confirmPayPalSubscription(status.subscriptionId!)}>{confirmationBusy ? "Checking PayPal…" : "Check payment status"}</button>
        <button className="landing-button pricing-cancel-button" type="button" disabled={confirmationBusy || busy} onClick={() => void cancelUnpaidAttemptAndRetry()}>{busy ? "Checking and cancelling…" : "Cancel unpaid attempt & retry"}</button>
        <ExistingPaymentRecovery onVerify={(id) => void confirmPayPalSubscription(id, true)} busy={confirmationBusy || busy} amount={`${formatMonthlyPrice(pendingPlanId ? CIRKITRA_PLANS[pendingPlanId].priceUsdCents : plan.priceUsdCents)} USD`} />
      </>}
      {message && <p aria-live="polite" className="pricing-account-subtle">{message}</p>}
    </div>;
  }

  if (!config) return <div className="pricing-checkout-note">PayPal checkout is not configured yet. Your current complimentary plan remains active, and no payment details are collected.</div>;

  if (!paypalPlanId) {
    return <div className="pricing-account-status">
      <p className="pricing-account-message">{plan.name} checkout is being configured. No payment can be started yet.</p>
      <button className="landing-button pricing-action pricing-action-disabled" type="button" disabled>{plan.name} unavailable</button>
    </div>;
  }

  if (!checkoutReady) {
    return <div className="pricing-checkout">
      <button className="landing-button pricing-action" type="button" onClick={() => setCheckoutReady(true)}>Choose {plan.name} <span aria-hidden="true">→</span></button>
      {config.environment === "sandbox" && <p className="pricing-account-subtle">Sandbox test checkout. It does not charge a live PayPal account.</p>}
      <ExistingPaymentRecovery onVerify={(id) => void confirmPayPalSubscription(id, true)} busy={confirmationBusy} amount={amount} />
      {message && <p aria-live="polite" className="pricing-account-subtle">{message}</p>}
    </div>;
  }

  const sdkSrc = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.clientId)}&components=buttons&vault=true&intent=subscription&currency=USD`;
  return <div className="pricing-checkout">
    <Script src={sdkSrc} strategy="afterInteractive" data-cirkitra-paypal-sdk onReady={() => setSdkLoaded(true)} />
    <div className="pricing-paypal-frame">
      <div ref={containerRef} className="pricing-paypal-buttons" aria-label="PayPal subscription checkout" />
    </div>
    {config.environment === "sandbox" && <p className="pricing-account-subtle">Sandbox test checkout. It does not charge a live PayPal account.</p>}
    {message && <p aria-live="polite" className="pricing-account-message">{message}</p>}
    <ExistingPaymentRecovery onVerify={(id) => void confirmPayPalSubscription(id, true)} busy={confirmationBusy} amount={amount} />
  </div>;
}
