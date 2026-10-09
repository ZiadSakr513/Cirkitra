import { authenticateAiRequest } from "../../../../../lib/billing/ai-usage.ts";
import { getPayPalBillingStatus, isMissingPayPalBillingSchema } from "../../../../../lib/billing/paypal-store";
import { getPayPalEnvironment, isPayPalCheckoutEnabled } from "../../../../../lib/billing/paypal-config";
import { isSupabaseAdminConfigured } from "../../../../../lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const userId = await authenticateAiRequest(request);
  if (!userId) {
    return Response.json({ error: { code: "AUTH_REQUIRED", message: "Sign in with a verified Cirkitra account to view billing." } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (!isSupabaseAdminConfigured()) {
    return Response.json({ error: { code: "BILLING_STORAGE_UNAVAILABLE", message: "Billing status is temporarily unavailable." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const environment = getPayPalEnvironment();
  if (!environment) {
    return Response.json({ error: { code: "BILLING_UNAVAILABLE", message: "Billing environment is not configured safely." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const status = await getPayPalBillingStatus(userId, environment);
    return Response.json({ ...status, checkoutEnabled: isPayPalCheckoutEnabled() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[paypal-billing-status-failed]", error instanceof Error ? error.message : "unknown error");
    if (isMissingPayPalBillingSchema(error)) {
      return Response.json({ error: { code: "BILLING_SETUP_REQUIRED", message: "PayPal billing storage is not set up in Supabase yet." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: { code: "BILLING_UNAVAILABLE", message: "Billing status is temporarily unavailable." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
