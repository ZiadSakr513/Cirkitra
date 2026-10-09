import { authenticateAiRequest } from "../../../../../lib/billing/ai-usage.ts";
import { cancelPayPalSubscriptionForUser, markPayPalSubscriptionCancelled } from "../../../../../lib/billing/paypal-store";
import { cancelPayPalSubscription as cancelWithPayPal } from "../../../../../lib/billing/paypal-api";
import { getPayPalServerConfig } from "../../../../../lib/billing/paypal-config";
import { isSupabaseAdminConfigured } from "../../../../../lib/supabase/admin";
import { isSameOriginRequest } from "../../../../../lib/auth/request-origin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: { code: "INVALID_ORIGIN", message: "Cancellation must be requested from Cirkitra." } }, { status: 403 });
  }
  const userId = await authenticateAiRequest(request);
  if (!userId) {
    return Response.json({ error: { code: "AUTH_REQUIRED", message: "Sign in with a verified Cirkitra account to manage billing." } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const config = getPayPalServerConfig();
  if (!config?.apiAccessConfirmed) {
    return Response.json({ error: { code: "PAYPAL_API_UNAVAILABLE", message: "PayPal subscription management is not configured. Contact support to cancel." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!isSupabaseAdminConfigured()) {
    return Response.json({ error: { code: "BILLING_STORAGE_UNAVAILABLE", message: "Billing is temporarily unavailable." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const result = await cancelPayPalSubscriptionForUser(userId, config.environment);
    if (!result.cancelled || !result.subscriptionId) {
      return Response.json({ cancelled: false, alreadyCancelled: true }, { headers: { "Cache-Control": "no-store" } });
    }
    await cancelWithPayPal(config, result.subscriptionId);
    await markPayPalSubscriptionCancelled(userId, result.subscriptionId, config.environment);
    return Response.json({ cancelled: true, paidThroughPreserved: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[paypal-cancel-failed]", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: { code: "PAYPAL_CANCEL_FAILED", message: "PayPal could not confirm cancellation. No access was changed; please try again or cancel in PayPal." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
