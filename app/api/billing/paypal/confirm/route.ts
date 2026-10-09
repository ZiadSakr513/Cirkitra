import { authenticateAiRequest } from "../../../../../lib/billing/ai-usage.ts";
import { getPayPalSubscription } from "../../../../../lib/billing/paypal-api";
import { getPayPalServerConfig } from "../../../../../lib/billing/paypal-config";
import { CIRKITRA_PLANS } from "../../../../../lib/billing/plans";
import { applyPayPalWebhookEvent, getPayPalCheckoutIntent } from "../../../../../lib/billing/paypal-store";
import { getVerifiedPayPalPaymentPeriod } from "../../../../../lib/billing/paypal-verification";
import { identifyCirkitraPlanId } from "../../../../../lib/billing/paypal-plan-mapping";
import { isSameOriginRequest } from "../../../../../lib/auth/request-origin";
import { isSupabaseAdminConfigured } from "../../../../../lib/supabase/admin";
import { readBoundedJson } from "../../../../../lib/http/bounded-json.ts";

export const runtime = "nodejs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedStatuses = new Set(["APPROVAL_PENDING", "APPROVED", "ACTIVE", "SUSPENDED", "CANCELLED", "EXPIRED"]);

function response(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return response(403, { error: { code: "INVALID_ORIGIN", message: "Payment confirmation must be requested from Cirkitra." } });
  }

  const userId = await authenticateAiRequest(request);
  if (!userId) {
    return response(401, { error: { code: "AUTH_REQUIRED", message: "Sign in to confirm this PayPal payment." } });
  }

  const config = getPayPalServerConfig();
  if (!config?.checkoutEnabled || !config.apiAccessConfirmed || !isSupabaseAdminConfigured()) {
    return response(503, { error: { code: "BILLING_UNAVAILABLE", message: "Payment confirmation is temporarily unavailable. Do not start another checkout." } });
  }

  const parsed = await readBoundedJson(request, 4_096);
  if (!parsed.ok) {
    if (parsed.reason === "too-large") return response(413, { error: { code: "REQUEST_TOO_LARGE", message: "Payment confirmation request is too large." } });
    if (parsed.reason === "invalid-content-type") return response(415, { error: { code: "INVALID_CONTENT_TYPE", message: "Request body must be JSON." } });
    return response(400, { error: { code: "INVALID_REQUEST", message: "PayPal subscription ID is required." } });
  }
  const subscriptionId = parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
    ? (parsed.value as { subscriptionId?: unknown }).subscriptionId
    : undefined;
  if (typeof subscriptionId !== "string" || !/^[A-Za-z0-9-]{5,64}$/.test(subscriptionId)) {
    return response(400, { error: { code: "INVALID_REQUEST", message: "PayPal subscription ID is invalid." } });
  }

  try {
    const details = await getPayPalSubscription(config, subscriptionId);
    const configuredPlanId = identifyCirkitraPlanId(config.planIds, details.plan_id);
    if (details.id !== subscriptionId || !configuredPlanId) {
      return response(409, { error: { code: "SUBSCRIPTION_MISMATCH", message: "This PayPal subscription does not match a configured Cirkitra plan." } });
    }

    const checkoutIntentId = typeof details.custom_id === "string" ? details.custom_id.trim() : "";
    const status = typeof details.status === "string" ? details.status.toUpperCase() : "";
    if (!uuidPattern.test(checkoutIntentId) || !allowedStatuses.has(status)) {
      return response(409, { error: { code: "SUBSCRIPTION_UNVERIFIABLE", message: "PayPal did not return a verifiable Cirkitra subscription. No access was changed." } });
    }
    const intent = await getPayPalCheckoutIntent(checkoutIntentId, config.environment);
    if (!intent || intent.userId !== userId) {
      return response(403, { error: { code: "SUBSCRIPTION_OWNER_MISMATCH", message: "This PayPal approval does not belong to the signed-in Cirkitra account." } });
    }
    if (intent.planId !== configuredPlanId) {
      return response(409, { error: { code: "SUBSCRIPTION_PLAN_MISMATCH", message: "The PayPal subscription plan does not match this checkout. No plan access was changed." } });
    }

    const payment = getVerifiedPayPalPaymentPeriod(details, CIRKITRA_PLANS[configuredPlanId].priceUsdCents);
    const statusTime = typeof details.status_update_time === "string"
      ? details.status_update_time
      : typeof details.update_time === "string" ? details.update_time : status;
    const eventId = payment
      ? `API-PAYMENT:${subscriptionId}:${payment.paidAt}`
      : `API-STATUS:${subscriptionId}:${statusTime}`;

    // PayPal's authenticated subscription API is the evidence here. The
    // existing RPC gives both this reconciliation path and signed webhooks
    // the same atomic, idempotent database update and ownership checks.
    await applyPayPalWebhookEvent({
      environment: config.environment,
      eventId,
      eventType: payment ? "PAYMENT.SALE.COMPLETED" : "BILLING.SUBSCRIPTION.UPDATED",
      subscriptionId,
      checkoutIntentId,
      status,
      paidThrough: payment?.paidThrough ?? null,
      paymentSucceeded: Boolean(payment),
    });

    return response(200, { confirmed: Boolean(payment), pending: !payment });
  } catch (error) {
    console.error("[paypal-confirmation-failed]", error instanceof Error ? error.message : "unknown error");
    return response(503, { error: { code: "CONFIRMATION_UNAVAILABLE", message: "PayPal has not yet provided enough verified payment details. No new payment was started; check again shortly." } });
  }
}
