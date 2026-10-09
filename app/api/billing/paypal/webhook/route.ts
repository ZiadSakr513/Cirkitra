import { getPayPalSubscription, verifyPayPalWebhook } from "../../../../../lib/billing/paypal-api";
import { getPayPalServerConfig } from "../../../../../lib/billing/paypal-config";
import { applyPayPalWebhookEvent, findPayPalCheckoutIntentForSubscription, getPayPalCheckoutIntent } from "../../../../../lib/billing/paypal-store";
import { identifyCirkitraPlanId } from "../../../../../lib/billing/paypal-plan-mapping";
import { CIRKITRA_PLANS } from "../../../../../lib/billing/plans";
import { getVerifiedPayPalPaymentPeriod } from "../../../../../lib/billing/paypal-verification";
import { isSupabaseAdminConfigured } from "../../../../../lib/supabase/admin";
import { readBoundedText } from "../../../../../lib/http/bounded-json.ts";

export const runtime = "nodejs";

const subscriptionEvents = new Set([
  "BILLING.SUBSCRIPTION.CREATED",
  "BILLING.SUBSCRIPTION.ACTIVATED",
  "BILLING.SUBSCRIPTION.UPDATED",
  "BILLING.SUBSCRIPTION.CANCELLED",
  "BILLING.SUBSCRIPTION.SUSPENDED",
  "BILLING.SUBSCRIPTION.EXPIRED",
]);
const paymentEvents = new Set([
  "PAYMENT.SALE.COMPLETED",
  "PAYMENT.SALE.REFUNDED",
  "PAYMENT.SALE.REVERSED",
]);
const allowedStatuses = new Set(["APPROVAL_PENDING", "APPROVED", "ACTIVE", "SUSPENDED", "CANCELLED", "EXPIRED"]);

type PayPalEvent = {
  id?: unknown;
  event_type?: unknown;
  resource?: Record<string, unknown>;
};

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function response(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const config = getPayPalServerConfig();
  if (!config || !config.apiAccessConfirmed || !isSupabaseAdminConfigured()) {
    return response(503, { error: "PayPal webhook processing is not configured." });
  }

  const boundedBody = await readBoundedText(request, 1_000_000);
  if (!boundedBody.ok) {
    if (boundedBody.reason === "too-large") return response(413, { error: "Webhook body is too large." });
    return response(400, { error: "Webhook body must be valid UTF-8 text." });
  }
  const rawBody = boundedBody.value;
  let event: PayPalEvent;
  try {
    event = JSON.parse(rawBody) as PayPalEvent;
  } catch {
    return response(400, { error: "Webhook body must be valid JSON." });
  }
  if (!event || typeof event !== "object" || !stringValue(event.id) || !stringValue(event.event_type)) {
    return response(400, { error: "PayPal event identity is incomplete." });
  }

  try {
    if (!await verifyPayPalWebhook(config, request, event)) {
      return response(400, { error: "PayPal webhook signature is invalid." });
    }

    const eventId = stringValue(event.id)!;
    const eventType = stringValue(event.event_type)!;
    if (!subscriptionEvents.has(eventType) && !paymentEvents.has(eventType)) {
      return response(200, { received: true, ignored: true });
    }

    const resource = event.resource ?? {};
    const subscriptionId = subscriptionEvents.has(eventType)
      ? stringValue(resource.id)
      : stringValue(resource.billing_agreement_id);
    if (!subscriptionId) return response(400, { error: "PayPal subscription ID is missing." });

    const details = await getPayPalSubscription(config, subscriptionId);
    const planId = identifyCirkitraPlanId(config.planIds, details.plan_id);
    if (details.id !== subscriptionId || !planId) {
      return response(200, { received: true, ignored: true });
    }

    let checkoutIntentId = stringValue(details.custom_id);
    if (!checkoutIntentId) checkoutIntentId = await findPayPalCheckoutIntentForSubscription(subscriptionId, config.environment);
    if (!checkoutIntentId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkoutIntentId)) {
      return response(200, { received: true, ignored: true });
    }
    const intent = await getPayPalCheckoutIntent(checkoutIntentId, config.environment);
    if (!intent || intent.planId !== planId) return response(200, { received: true, ignored: true });

    const statusFromPayPal = stringValue(details.status)?.toUpperCase() ?? null;
    const status = statusFromPayPal && allowedStatuses.has(statusFromPayPal) ? statusFromPayPal : null;
    const paymentSucceeded = eventType === "PAYMENT.SALE.COMPLETED";
    const revokeEntitlement = eventType === "PAYMENT.SALE.REFUNDED" || eventType === "PAYMENT.SALE.REVERSED";
    const payment = paymentSucceeded
      ? getVerifiedPayPalPaymentPeriod(details, CIRKITRA_PLANS[planId].priceUsdCents)
      : null;
    if (paymentSucceeded && !payment) {
      throw new Error(`PayPal payment did not match the verified ${planId} amount or paid-through period.`);
    }

    const processed = await applyPayPalWebhookEvent({
      environment: config.environment,
      eventId,
      eventType,
      subscriptionId,
      checkoutIntentId,
      status,
      paidThrough: payment?.paidThrough ?? null,
      paymentSucceeded,
      revokeEntitlement,
    });
    return response(200, { received: true, duplicate: !processed });
  } catch (error) {
    console.error("[paypal-webhook-processing-failed]", error instanceof Error ? error.message : "unknown error");
    return response(503, { error: "PayPal event could not be safely processed. PayPal may retry delivery." });
  }
}
