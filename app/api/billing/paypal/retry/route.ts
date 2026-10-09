import { authenticateAiRequest } from "../../../../../lib/billing/ai-usage.ts";
import { cancelPayPalSubscription, getPayPalSubscription } from "../../../../../lib/billing/paypal-api";
import { getPayPalServerConfig } from "../../../../../lib/billing/paypal-config";
import { applyPayPalWebhookEvent, findPayPalCheckoutIntentForSubscription, getPayPalBillingStatus, getPayPalCheckoutIntent, markPayPalSubscriptionStatus } from "../../../../../lib/billing/paypal-store";
import { identifyCirkitraPlanId } from "../../../../../lib/billing/paypal-plan-mapping";
import { CIRKITRA_PLANS } from "../../../../../lib/billing/plans";
import { getVerifiedPayPalPaymentPeriod } from "../../../../../lib/billing/paypal-verification";
import { isSameOriginRequest } from "../../../../../lib/auth/request-origin";
import { isSupabaseAdminConfigured } from "../../../../../lib/supabase/admin";

export const runtime = "nodejs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const openStatuses = new Set(["APPROVAL_PENDING", "APPROVED", "ACTIVE", "SUSPENDED"]);
const terminalStatuses = new Set(["CANCELLED", "EXPIRED"]);

function response(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function hasPaymentEvidence(details: Awaited<ReturnType<typeof getPayPalSubscription>>) {
  const payment = details.billing_info?.last_payment;
  return Boolean(payment && (
    (typeof payment.time === "string" && payment.time.trim())
    || (typeof payment.amount?.currency_code === "string" && payment.amount.currency_code.trim())
    || (typeof payment.amount?.value === "string" && payment.amount.value.trim())
  ));
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return response(403, { error: { code: "INVALID_ORIGIN", message: "Payment retry must be requested from Cirkitra." } });
  }

  const userId = await authenticateAiRequest(request);
  if (!userId) {
    return response(401, { error: { code: "AUTH_REQUIRED", message: "Sign in with a verified Cirkitra account to manage this payment." } });
  }

  const config = getPayPalServerConfig();
  if (!config?.apiAccessConfirmed || !isSupabaseAdminConfigured()) {
    return response(503, { error: { code: "BILLING_UNAVAILABLE", message: "PayPal cannot safely check this attempt right now. No new payment was started." } });
  }

  try {
    const billing = await getPayPalBillingStatus(userId, config.environment);
    const subscriptionId = billing.subscriptionId;
    if (!subscriptionId || (billing.subscriptionPlanId !== "maker" && billing.subscriptionPlanId !== "pro")) {
      return response(409, { error: { code: "NO_OPEN_SUBSCRIPTION", message: "There is no open PayPal subscription to retry. Refresh the pricing page and try again." } });
    }
    if (billing.planId !== "free" && billing.paidThrough && Date.parse(billing.paidThrough) > Date.now()) {
      return response(409, { error: { code: "PAID_PLAN_ACTIVE", message: "PayPal already shows an active paid period. Cirkitra will not start another checkout." } });
    }

    const details = await getPayPalSubscription(config, subscriptionId);
    const planId = identifyCirkitraPlanId(config.planIds, details.plan_id);
    if (details.id !== subscriptionId || !planId || planId !== billing.subscriptionPlanId) {
      return response(409, { error: { code: "SUBSCRIPTION_MISMATCH", message: "PayPal’s subscription does not match this pending Cirkitra plan. No changes were made." } });
    }

    const mappedIntentId = await findPayPalCheckoutIntentForSubscription(subscriptionId, config.environment);
    const customIntentId = typeof details.custom_id === "string" ? details.custom_id.trim() : "";
    if (mappedIntentId && customIntentId && mappedIntentId !== customIntentId) {
      return response(409, { error: { code: "CHECKOUT_INTENT_MISMATCH", message: "PayPal’s subscription could not be matched safely to this checkout." } });
    }
    const checkoutIntentId = mappedIntentId ?? customIntentId;
    if (!uuidPattern.test(checkoutIntentId)) {
      return response(409, { error: { code: "CHECKOUT_INTENT_MISSING", message: "This PayPal attempt cannot be matched to its Cirkitra account. No new checkout was started." } });
    }
    const intent = await getPayPalCheckoutIntent(checkoutIntentId, config.environment);
    if (!intent || intent.userId !== userId) {
      return response(403, { error: { code: "SUBSCRIPTION_OWNER_MISMATCH", message: "This PayPal subscription does not belong to the signed-in Cirkitra account." } });
    }
    if (intent.planId !== planId) {
      return response(409, { error: { code: "SUBSCRIPTION_PLAN_MISMATCH", message: "The PayPal subscription does not match the original checkout plan." } });
    }

    const applyVerifiedPayment = async (paymentDetails: typeof details) => {
      const payment = getVerifiedPayPalPaymentPeriod(paymentDetails, CIRKITRA_PLANS[planId].priceUsdCents);
      if (!payment) return false;
      await applyPayPalWebhookEvent({
        environment: config.environment,
        eventId: `API-PAYMENT:${subscriptionId}:${payment.paidAt}`,
        eventType: "PAYMENT.SALE.COMPLETED",
        subscriptionId,
        checkoutIntentId,
        status: typeof paymentDetails.status === "string" ? paymentDetails.status.toUpperCase() : null,
        paidThrough: payment.paidThrough,
        paymentSucceeded: true,
      });
      return true;
    };

    if (await applyVerifiedPayment(details)) {
      return response(409, { error: { code: "PAYMENT_ALREADY_CONFIRMED", message: "PayPal confirms the payment. Cirkitra has synced it, so no second checkout was started." } });
    }
    if (hasPaymentEvidence(details)) {
      return response(409, { error: { code: "PAYMENT_REVIEW_REQUIRED", message: "PayPal reports payment activity that Cirkitra cannot verify yet. No subscription was cancelled and no new checkout was started; check the payment status again shortly." } });
    }

    const remoteStatus = typeof details.status === "string" ? details.status.toUpperCase() : "";
    if (terminalStatuses.has(remoteStatus)) {
      await markPayPalSubscriptionStatus(userId, subscriptionId, config.environment, remoteStatus as "CANCELLED" | "EXPIRED");
      return response(200, { retryAvailable: true });
    }
    if (!openStatuses.has(remoteStatus)) {
      return response(409, { error: { code: "SUBSCRIPTION_STATUS_UNSUPPORTED", message: "PayPal has not confirmed that this subscription can be safely restarted." } });
    }

    let finalDetails = details;
    try {
      await cancelPayPalSubscription(config, subscriptionId);
      finalDetails = await getPayPalSubscription(config, subscriptionId);
    } catch (cancelError) {
      // A concurrent PayPal cancellation is okay, but only if PayPal now
      // reports a terminal state. Otherwise keep the checkout lock in place.
      const latestDetails = await getPayPalSubscription(config, subscriptionId).catch(() => null);
      if (!latestDetails || !terminalStatuses.has(typeof latestDetails.status === "string" ? latestDetails.status.toUpperCase() : "")) {
        throw cancelError;
      }
      finalDetails = latestDetails;
    }

    const finalStatus = typeof finalDetails.status === "string" ? finalDetails.status.toUpperCase() : "";
    if (finalDetails.id !== subscriptionId || identifyCirkitraPlanId(config.planIds, finalDetails.plan_id) !== planId) {
      return response(409, { error: { code: "SUBSCRIPTION_MISMATCH", message: "PayPal’s cancellation result did not match the pending subscription. No new checkout was started." } });
    }
    if (!terminalStatuses.has(finalStatus)) {
      return response(503, { error: { code: "CANCELLATION_PENDING", message: "PayPal has not confirmed cancellation yet. Cirkitra is keeping this attempt locked to prevent a duplicate charge; check again shortly." } });
    }
    if (await applyVerifiedPayment(finalDetails)) {
      return response(409, { error: { code: "PAYMENT_ALREADY_CONFIRMED", message: "PayPal confirmed a payment while closing the old attempt. Cirkitra synced it and did not start another checkout." } });
    }
    if (hasPaymentEvidence(finalDetails)) {
      return response(409, { error: { code: "PAYMENT_REVIEW_REQUIRED", message: "PayPal reports payment activity on the cancelled subscription. No new checkout was started; verify that payment before retrying." } });
    }

    await markPayPalSubscriptionStatus(userId, subscriptionId, config.environment, finalStatus as "CANCELLED" | "EXPIRED");
    return response(200, { retryAvailable: true });
  } catch (error) {
    console.error("[paypal-retry-failed]", error instanceof Error ? error.message : "unknown error");
    return response(503, { error: { code: "RETRY_UNAVAILABLE", message: "PayPal could not safely close the old attempt. No new checkout was started; check the payment status again shortly." } });
  }
}
