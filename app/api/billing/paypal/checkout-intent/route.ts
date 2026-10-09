import { authenticateAiRequest } from "../../../../../lib/billing/ai-usage.ts";
import { createPayPalCheckoutIntent, isMissingPayPalBillingSchema } from "../../../../../lib/billing/paypal-store";
import { getPayPalServerConfig } from "../../../../../lib/billing/paypal-config";
import { getConfiguredPayPalPlanId } from "../../../../../lib/billing/paypal-plan-mapping";
import type { PaidCirkitraPlanId } from "../../../../../lib/billing/plans";
import { isSupabaseAdminConfigured } from "../../../../../lib/supabase/admin";
import { isSameOriginRequest } from "../../../../../lib/auth/request-origin";
import { readBoundedJson } from "../../../../../lib/http/bounded-json.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: { code: "INVALID_ORIGIN", message: "Checkout must be started from Cirkitra." } }, { status: 403 });
  }
  const userId = await authenticateAiRequest(request);
  if (!userId) {
    return Response.json({ error: { code: "AUTH_REQUIRED", message: "Sign in with a verified Cirkitra account before upgrading." } }, { status: 401 });
  }

  const config = getPayPalServerConfig();
  if (!config?.checkoutEnabled || !config.apiAccessConfirmed) {
    return Response.json({ error: { code: "BILLING_UNAVAILABLE", message: "PayPal checkout is not configured yet." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!isSupabaseAdminConfigured()) {
    return Response.json({ error: { code: "BILLING_STORAGE_UNAVAILABLE", message: "Billing is temporarily unavailable." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const parsed = await readBoundedJson(request, 4_096);
  if (!parsed.ok) {
    if (parsed.reason === "too-large") return Response.json({ error: { code: "REQUEST_TOO_LARGE", message: "Checkout request is too large." } }, { status: 413, headers: { "Cache-Control": "no-store" } });
    if (parsed.reason === "invalid-content-type") return Response.json({ error: { code: "INVALID_CONTENT_TYPE", message: "Request body must be JSON." } }, { status: 415, headers: { "Cache-Control": "no-store" } });
    return Response.json({ error: { code: "INVALID_PLAN", message: "Choose Maker or Pro to continue." } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const body = parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
    ? parsed.value as { planId?: unknown }
    : {};
  if (body.planId !== "maker" && body.planId !== "pro") {
    return Response.json({ error: { code: "INVALID_PLAN", message: "Choose Maker or Pro to continue." } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const planId: PaidCirkitraPlanId = body.planId;
  if (!getConfiguredPayPalPlanId(config.planIds, planId)) {
    return Response.json({ error: { code: "PLAN_UNAVAILABLE", message: "This PayPal plan is not configured yet. No payment was started." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const intentId = await createPayPalCheckoutIntent(userId, planId, config.environment);
    return Response.json({ intentId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "PAID_PLAN_ALREADY_ACTIVE") {
      return Response.json({ error: { code: "PAID_PLAN_ACTIVE", message: "Your current paid plan is still active. You can choose another plan after its paid-through date; no second subscription was started." } }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    if (error instanceof Error && error.message === "OPEN_SUBSCRIPTION_EXISTS") {
      return Response.json({ error: { code: "OPEN_SUBSCRIPTION_EXISTS", message: "A PayPal subscription is already open for this account. Check or cancel that subscription before starting another checkout." } }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    if (error instanceof Error && error.message === "CHECKOUT_IN_PROGRESS") {
      return Response.json({ error: { code: "CHECKOUT_IN_PROGRESS", message: "A checkout is already in progress for this account. Finish or close it before choosing a different plan." } }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    if (isMissingPayPalBillingSchema(error)) {
      return Response.json({ error: { code: "BILLING_SETUP_REQUIRED", message: "PayPal billing storage is not set up in Supabase yet." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    console.error("[paypal-checkout-intent-failed]", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: { code: "BILLING_UNAVAILABLE", message: "Could not start checkout. Please try again shortly." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
