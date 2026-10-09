import { requirePlanGrantAdmin } from "../../../../../lib/billing/admin-plan-grant-auth";
import { revokeAdminPlanGrant } from "../../../../../lib/billing/admin-plan-grants";
import { isMissingPayPalBillingSchema } from "../../../../../lib/billing/paypal-store";

export const runtime = "nodejs";

function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request, context: { params: Promise<{ grantId: string }> }) {
  const authorization = await requirePlanGrantAdmin(request, true);
  if ("response" in authorization) return authorization.response;

  const { grantId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(grantId)) {
    return errorResponse("INVALID_GRANT_ID", "That grant ID is invalid.", 400);
  }

  try {
    const revoked = await revokeAdminPlanGrant(grantId, authorization.userId);
    if (!revoked) return errorResponse("ACTIVE_GRANT_NOT_FOUND", "That grant is no longer active.", 404);
    return Response.json({ revoked: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isMissingPayPalBillingSchema(error)) {
      return errorResponse("ADMIN_PLAN_GRANTS_SETUP_REQUIRED", "Apply the latest Supabase billing migration before managing complimentary plans.", 503);
    }
    console.error("[admin-plan-grant-revoke-failed]");
    return errorResponse("ADMIN_GRANT_REVOKE_FAILED", "Could not revoke this grant. No PayPal subscription was changed.", 503);
  }
}
