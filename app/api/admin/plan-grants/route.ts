import { getFirebaseAdminAuth } from "../../../../lib/firebase/admin";
import { requirePlanGrantAdmin } from "../../../../lib/billing/admin-plan-grant-auth";
import { createAdminPlanGrant, listAdminPlanGrants } from "../../../../lib/billing/admin-plan-grants";
import { getPayPalBillingStatus, isMissingPayPalBillingSchema } from "../../../../lib/billing/paypal-store";
import { getPayPalEnvironment } from "../../../../lib/billing/paypal-config";
import type { PaidCirkitraPlanId } from "../../../../lib/billing/plans";
import { readBoundedJson } from "../../../../lib/http/bounded-json.ts";

export const runtime = "nodejs";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NOTE_LENGTH = 1000;
const DEFAULT_GRANT_DAYS = 30;

function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

function isFirebaseUserNotFound(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "auth/user-not-found");
}

async function findAccount(email: string) {
  try {
    return await getFirebaseAdminAuth().getUserByEmail(email);
  } catch (error) {
    if (isFirebaseUserNotFound(error)) return null;
    throw error;
  }
}

function setupRequired(error: unknown) {
  if (isMissingPayPalBillingSchema(error)) {
    return errorResponse("ADMIN_PLAN_GRANTS_SETUP_REQUIRED", "Apply the latest Supabase billing migration before managing complimentary plans.", 503);
  }
  return null;
}

export async function GET(request: Request) {
  const authorization = await requirePlanGrantAdmin(request);
  if ("response" in authorization) return authorization.response;

  const email = new URL(request.url).searchParams.get("email")?.trim().toLowerCase() ?? "";
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return errorResponse("INVALID_EMAIL", "Enter the account’s full email address.", 400);
  }

  try {
    const user = await findAccount(email);
    if (!user) return errorResponse("ACCOUNT_NOT_FOUND", "No Cirkitra account was found for that email.", 404);
    const paypalEnvironment = getPayPalEnvironment();
    if (!paypalEnvironment) return errorResponse("ADMIN_LOOKUP_FAILED", "Billing environment is not configured safely.", 503);

    const [billing, grants] = await Promise.all([
      getPayPalBillingStatus(user.uid, paypalEnvironment),
      listAdminPlanGrants(user.uid),
    ]);
    return Response.json({
      account: { uid: user.uid, email: user.email ?? email, displayName: user.displayName ?? null, emailVerified: user.emailVerified },
      billing,
      grants,
      serverNow: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const setup = setupRequired(error);
    if (setup) return setup;
    console.error("[admin-plan-lookup-failed]");
    return errorResponse("ADMIN_LOOKUP_FAILED", "Could not load this account’s plan details.", 503);
  }
}

export async function POST(request: Request) {
  const authorization = await requirePlanGrantAdmin(request, true);
  if ("response" in authorization) return authorization.response;
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return errorResponse("INVALID_CONTENT_TYPE", "Request body must be JSON.", 415);
  }

  const parsed = await readBoundedJson(request, 5_000);
  if (!parsed.ok) {
    if (parsed.reason === "too-large") return errorResponse("INVALID_REQUEST", "Request body is too large.", 413);
    if (parsed.reason === "invalid-content-type") return errorResponse("INVALID_CONTENT_TYPE", "Request body must be JSON.", 415);
    return errorResponse("INVALID_JSON", "Request body must be valid JSON.", 400);
  }
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return errorResponse("INVALID_JSON", "Request body must be a JSON object.", 400);
  }
  const body = parsed.value as { email?: unknown; planId?: unknown; expiresAt?: unknown; note?: unknown };

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return errorResponse("INVALID_EMAIL", "Enter the account’s full email address.", 400);
  }
  if (body.planId !== "maker" && body.planId !== "pro") {
    return errorResponse("INVALID_PLAN", "Choose Maker or Pro.", 400);
  }
  const planId: PaidCirkitraPlanId = body.planId;

  let expiresAt: string | null;
  if (!Object.hasOwn(body, "expiresAt")) {
    expiresAt = new Date(Date.now() + DEFAULT_GRANT_DAYS * 24 * 60 * 60 * 1000).toISOString();
  } else if (body.expiresAt === null) {
    expiresAt = null;
  } else if (typeof body.expiresAt === "string" && body.expiresAt.length <= 64 && Number.isFinite(Date.parse(body.expiresAt))) {
    expiresAt = new Date(body.expiresAt).toISOString();
    if (Date.parse(expiresAt) <= Date.now()) return errorResponse("INVALID_EXPIRATION", "Expiration must be in the future.", 400);
  } else {
    return errorResponse("INVALID_EXPIRATION", "Choose a future expiration date or no expiration.", 400);
  }

  if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > MAX_NOTE_LENGTH)) {
    return errorResponse("INVALID_NOTE", `Internal note must be ${MAX_NOTE_LENGTH} characters or fewer.`, 400);
  }
  const internalNote = typeof body.note === "string" ? body.note.trim() || null : null;

  try {
    const user = await findAccount(email);
    if (!user) return errorResponse("ACCOUNT_NOT_FOUND", "No Cirkitra account was found for that email.", 404);
    const grant = await createAdminPlanGrant({
      userId: user.uid,
      planId,
      grantedBy: authorization.userId,
      expiresAt,
      internalNote,
    });
    return Response.json({ grant }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const setup = setupRequired(error);
    if (setup) return setup;
    console.error("[admin-plan-grant-create-failed]");
    return errorResponse("ADMIN_GRANT_FAILED", "Could not grant this plan. No PayPal payment or subscription was changed.", 503);
  }
}
