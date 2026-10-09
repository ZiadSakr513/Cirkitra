"use client";

import Link from "next/link";
import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

import { CIRKITRA_PLANS, type PaidCirkitraPlanId } from "../../lib/billing/plans";
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
  renewalCancelled: boolean;
  checkoutEnabled: boolean;
};

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
      onCancel: () => void;
      onError: (error: unknown) => void;
    }) => { render: (target: HTMLElement) => Promise<unknown> };
  };
};

function displayDate(value: string | null) {
  if (!value) return "the end of the paid period";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "the end of the paid period" : date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function pendingSubscriptionStorageKey(planId: PaidCirkitraPlanId) {
  return `cirkitra-paypal-pending-subscription:${planId}`;
}

async function readBillingStatus(): Promise<{ response: Response; status?: BillingStatus }> {
  const response = await fetch("/api/billing/paypal/status", { cache: "no-store" });
  if (!response.ok) return { response };
  const body = await response.json().catch(() => ({})) as BillingStatus;
  return { response, status: body };
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
  const paypalPlanId = config ? getConfiguredPayPalPlanId(config.planIds, planId) : null;
  const containerRef = useRef<HTMLDivElement>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [message, setMessage] = useState("");
  const [accountError, setAccountError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [checkoutReady, setCheckoutReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [approvalPending, setApprovalPending] = useState(false);
  const [paymentVerificationPending, setPaymentVerificationPending] = useState(false);
  const recoveryCheckedRef = useRef(false);

  const refreshStatus = useCallback(async () => {
    const result = await readBillingStatus();
    if (result.response.ok && result.status) {
      setSignedIn(true);
      setStatus(result.status);
      return result.status;
    }
    if (result.response.status === 401) {
      setSignedIn(false);
      setStatus(null);
    }
    return null;
  }, []);

  const confirmPayPalSubscription = useCallback(async (
    subscriptionId: string,
    retryBriefly = false,
    expectedPlanId: PaidCirkitraPlanId | null = planId,
  ) => {
    if (!subscriptionId) {
      setMessage("PayPal could not finish this checkout. You can try Upgrade again.");
      setApprovalPending(false);
      setPaymentVerificationPending(false);
      return;
    }
    setApprovalPending(true);
    setPaymentVerificationPending(true);
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
          const result = await response.json() as { confirmed?: boolean; pending?: boolean; planId?: unknown; error?: { message?: string } };
          if (!response.ok) throw new Error(result.error?.message || "Could not verify this PayPal subscription yet.");

          const verifiedPlanId = result.planId === "maker" || result.planId === "pro" ? result.planId : expectedPlanId;
          const updated = await refreshStatus();
          if (result.confirmed && verifiedPlanId && updated?.paypalPlanId === verifiedPlanId) {
            window.sessionStorage.removeItem(pendingSubscriptionStorageKey(verifiedPlanId));
            window.sessionStorage.removeItem("cirkitra-paypal-pending-subscription");
            setApprovalPending(false);
            setPaymentVerificationPending(false);
            setMessage(`${CIRKITRA_PLANS[verifiedPlanId].name} is active.`);
            return;
          }
          if (result.confirmed) {
            setMessage(`Your ${verifiedPlanId ? CIRKITRA_PLANS[verifiedPlanId].name : "plan"} payment is confirmed. We're finishing the update.`);
          } else {
            setMessage("We're still confirming your PayPal payment. Please check again shortly.");
          }
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Could not verify this PayPal subscription yet.");
        }

        if (attempt + 1 < attempts) await new Promise((resolve) => window.setTimeout(resolve, 4000));
      }
    } finally {
      setApprovalPending(false);
    }
  }, [planId, refreshStatus]);

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
        const billing = await readBillingStatus();
        if (!active) return;
        if (billing.response.ok && billing.status) {
          setStatus(billing.status);
        } else if (billing.response.status === 401) {
          setSignedIn(false);
          setStatus(null);
        }
      })
      .catch(() => {
        if (active) setAccountError("Could not check your Cirkitra sign-in. Please retry.");
      })
      .finally(() => {
        if (active) {
          setAuthLoading(false);
        }
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (authLoading || !signedIn || recoveryCheckedRef.current) return;
    recoveryCheckedRef.current = true;
    const scopedKey = pendingSubscriptionStorageKey(planId);
    const pendingSubscriptionId = window.sessionStorage.getItem(scopedKey)
      ?? (planId === "pro" ? window.sessionStorage.getItem("cirkitra-paypal-pending-subscription") : null);
    if (!pendingSubscriptionId) return;
    window.setTimeout(() => {
      setPaymentVerificationPending(true);
      void confirmPayPalSubscription(pendingSubscriptionId, true, planId);
    }, 0);
  }, [authLoading, confirmPayPalSubscription, planId, signedIn]);

  useEffect(() => {
    if (!config || !paypalPlanId || !signedIn || !checkoutReady || approvalPending || !sdkLoaded || !containerRef.current) return;
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
            setPaymentVerificationPending(true);
            if (subscriptionId) window.sessionStorage.setItem(pendingSubscriptionStorageKey(planId), subscriptionId);
            setMessage("Confirming your payment…");
            await confirmPayPalSubscription(subscriptionId, true);
          },
          onCancel: () => {
            setCheckoutReady(false);
            setMessage("");
          },
          onError: (error) => {
            console.error("[paypal-button-error]", error);
            setCheckoutReady(false);
            setMessage("PayPal checkout could not be completed. Please try Upgrade again.");
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
  }, [approvalPending, checkoutReady, config, confirmPayPalSubscription, paypalPlanId, planId, refreshStatus, sdkLoaded, signedIn]);

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

  if (authLoading) return <div className="pricing-checkout-note">Checking your Cirkitra account…</div>;
  if (accountError) return <div className="pricing-account-status"><p className="pricing-account-message" role="alert">{accountError} Refresh this page to try again.</p></div>;
  if (!signedIn) {
    if (!config) return <div className="pricing-checkout-note">Checkout is not available right now.</div>;
    if (!paypalPlanId) return <div className="pricing-account-status"><p className="pricing-account-message">Checkout is not available right now.</p></div>;
    return <div className="pricing-checkout-note"><Link className="landing-button pricing-action" href="/auth?next=%2Fpricing">Upgrade <span aria-hidden="true">→</span></Link></div>;
  }
  const grantCanRaisePlan = Boolean(status?.complimentaryGrant && (
    status.paypalPlanId === "free"
    || (status.complimentaryGrant.planId === "pro" && status.paypalPlanId === "maker")
  ));
  const canUpgradeFromCancelledMaker = planId === "pro"
    && status?.planId === "maker"
    && status.paypalPlanId === "maker"
    && status.renewalCancelled
    && Boolean(status.paidThrough);
  if (status?.planId !== "free" && status && !canUpgradeFromCancelledMaker && !(checkoutReady && status.paypalPlanId === "free")) {
    const activePlan = CIRKITRA_PLANS[status.planId];
    return <div className="pricing-account-status">
      {grantCanRaisePlan && status.complimentaryGrant
        ? <p className="pricing-account-message">Complimentary {CIRKITRA_PLANS[status.complimentaryGrant.planId].name} access is active{status.complimentaryGrant.expiresAt ? ` through ${displayDate(status.complimentaryGrant.expiresAt)}` : " with no expiration"} ({activePlan.monthlyAiRequests} successful requests per rolling month).</p>
        : <p className="pricing-account-message">Your paid {activePlan.name} plan is active through {displayDate(status.paidThrough)} ({activePlan.monthlyAiRequests} successful requests per rolling month).</p>}
      {status.complimentaryGrant && !grantCanRaisePlan && <p className="pricing-account-subtle">You also have complimentary {CIRKITRA_PLANS[status.complimentaryGrant.planId].name} access{status.complimentaryGrant.expiresAt ? ` through ${displayDate(status.complimentaryGrant.expiresAt)}` : " with no expiration"}.</p>}
      {grantCanRaisePlan && status.paypalPlanId !== "free" && <p className="pricing-account-subtle">Your paid {CIRKITRA_PLANS[status.paypalPlanId].name} subscription remains unchanged and is active through {displayDate(status.paidThrough)}.</p>}
      {status.canCancel ? <button className="landing-button pricing-cancel-button" type="button" disabled={busy} onClick={() => void cancelSubscription()}>{busy ? "Cancelling…" : status.paypalPlanId === "free" ? "Cancel PayPal subscription" : `Cancel ${CIRKITRA_PLANS[status.paypalPlanId].name} renewal`}</button> : status.paypalPlanId === "maker" && status.renewalCancelled
        ? <p className="pricing-account-subtle">Maker stays available through {displayDate(status.paidThrough)}. You can upgrade to Pro now.</p>
        : status.paypalPlanId !== "free" && <p className="pricing-account-subtle">Renewal is cancelled; your paid access will end on {displayDate(status.paidThrough)}.</p>}
      {status.paypalPlanId === "free" && config && paypalPlanId && <button className="landing-button pricing-action" type="button" onClick={() => setCheckoutReady(true)}>Upgrade <span aria-hidden="true">→</span></button>}
      {message && <p aria-live="polite" className="pricing-account-subtle">{message}</p>}
    </div>;
  }
  if (paymentVerificationPending) {
    return <div className="pricing-account-status">
      <p className="pricing-account-message" aria-live="polite">{message || "We're confirming your PayPal payment. Please check again shortly."}</p>
    </div>;
  }
  if (approvalPending) {
    return <div className="pricing-account-status">
      <p className="pricing-account-message" aria-live="polite">{message || "Confirming your payment…"}</p>
    </div>;
  }
  if (!config) return <div className="pricing-checkout-note">Checkout is not available right now.</div>;

  if (!paypalPlanId) {
    return <div className="pricing-account-status">
      <p className="pricing-account-message">Checkout is not available right now.</p>
    </div>;
  }

  if (!checkoutReady) {
    return <div className="pricing-checkout">
      {canUpgradeFromCancelledMaker && <p className="pricing-checkout-note">Pro starts when PayPal confirms your payment. Your remaining Maker time is not refunded or credited.</p>}
      <button className="landing-button pricing-action" type="button" onClick={() => setCheckoutReady(true)}>Upgrade <span aria-hidden="true">→</span></button>
      {message && <p aria-live="polite" className="pricing-account-message">{message}</p>}
    </div>;
  }

  const sdkSrc = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.clientId)}&components=buttons&vault=true&intent=subscription&currency=USD`;
  return <div className="pricing-checkout">
    {canUpgradeFromCancelledMaker && <p className="pricing-checkout-note">Pro starts when PayPal confirms your payment. Your remaining Maker time is not refunded or credited.</p>}
    <Script src={sdkSrc} strategy="afterInteractive" data-cirkitra-paypal-sdk onReady={() => setSdkLoaded(true)} />
    <div className="pricing-paypal-frame">
      <div ref={containerRef} className="pricing-paypal-buttons" aria-label="PayPal subscription checkout" />
    </div>
    {message && <p aria-live="polite" className="pricing-account-message">{message}</p>}
  </div>;
}
