import { getFirebaseAdminAuth } from "../../../../lib/firebase/admin";
import { requirePlanGrantAdmin } from "../../../../lib/billing/admin-plan-grant-auth";
import {
  isMissingAdminAiUsageResetSchema,
  listAdminAiUsageResets,
  resetAdminAiUsage,
} from "../../../../lib/billing/admin-ai-usage";
import { getAiUsageSnapshot, isCirkitraOwner } from "../../../../lib/billing/ai-usage";
import { readBoundedJson } from "../../../../lib/http/bounded-json.ts";

export const runtime = "nodejs";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NOTE_LENGTH = 1000;

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
  if (isMissingAdminAiUsageResetSchema(error)) {
    return errorResponse(
      "ADMIN_USAGE_RESET_SETUP_REQUIRED",
      "Apply supabase/migrations/20261009060000_admin_ai_usage_resets.sql in Supabase before using admin AI usage tools.",
      503,
    );
  }
  return null;
}

function accountEmail(request: Request) {
  const email = new URL(request.url).searchParams.get("email")?.trim().toLowerCase() ?? "";
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

async function readUsage(userId: string) {
  const [usage, resets] = await Promise.all([
    getAiUsageSnapshot(userId),
    listAdminAiUsageResets(userId),
  ]);
  return { usage, resets, serverNow: new Date().toISOString() };
}

export async function GET(request: Request) {
  const authorization = await requirePlanGrantAdmin(request);
  if ("response" in authorization) return authorization.response;

  const email = await accountEmail(request);
  if (!email) return errorResponse("INVALID_EMAIL", "Enter the account’s full email address.", 400);

  try {
    const user = await findAccount(email);
    if (!user) return errorResponse("ACCOUNT_NOT_FOUND", "No Cirkitra account was found for that email.", 404);
    return Response.json(await readUsage(user.uid), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const setup = setupRequired(error);
    if (setup) return setup;
    console.error("[admin-ai-usage-read-failed]");
    return errorResponse("ADMIN_AI_USAGE_READ_FAILED", "Could not load this account’s AI usage.", 503);
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
  const body = parsed.value as { email?: unknown; idempotencyKey?: unknown; note?: unknown };

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return errorResponse("INVALID_EMAIL", "Enter the account’s full email address.", 400);
  }
  if (typeof body.idempotencyKey !== "string" || !UUID_PATTERN.test(body.idempotencyKey)) {
    return errorResponse("INVALID_RESET_ID", "Refresh the page and try the reset again.", 400);
  }
  if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > MAX_NOTE_LENGTH)) {
    return errorResponse("INVALID_NOTE", `Internal note must be ${MAX_NOTE_LENGTH} characters or fewer.`, 400);
  }
  const internalNote = typeof body.note === "string" ? body.note.trim() || null : null;

  try {
    const user = await findAccount(email);
    if (!user) return errorResponse("ACCOUNT_NOT_FOUND", "No Cirkitra account was found for that email.", 404);
    if (isCirkitraOwner(user.uid)) {
      return errorResponse("USAGE_RESET_NOT_APPLICABLE", "The owner account has unlimited AI access and does not have a usage limit to reset.", 409);
    }

    const reset = await resetAdminAiUsage({
      userId: user.uid,
      resetBy: authorization.userId,
      idempotencyKey: body.idempotencyKey,
      internalNote,
    });
    const result = await readUsage(user.uid);
    return Response.json({ reset, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const setup = setupRequired(error);
    if (setup) return setup;
    console.error("[admin-ai-usage-reset-failed]");
    return errorResponse("ADMIN_AI_USAGE_RESET_FAILED", "Could not reset this account’s AI usage. No plan or payment was changed.", 503);
  }
}
