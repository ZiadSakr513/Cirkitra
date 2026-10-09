import { CIRKITRA_PLANS, type CirkitraPlanId } from "./plans.ts";
import { isAllowedEmailAddress } from "../../functions/email-domain-policy.mjs";

export type AiUsageSnapshot = {
  planId: CirkitraPlanId;
  planName: string;
  used: number;
  limit: number;
  remaining: number;
  unlimited: boolean;
  resetsAt: string | null;
  billingEnabled: boolean;
};

export type AiRequestReservation = {
  reservationId: string;
  usage: AiUsageSnapshot;
};

export type AiRequestReservationResult =
  | { allowed: true; reservation: AiRequestReservation }
  | { allowed: false; usage: AiUsageSnapshot };

export type AiUsageAdapter = {
  authenticate: (request: Request) => Promise<string | null>;
  reserve: (userId: string, model: string, unlimited?: boolean) => Promise<AiRequestReservationResult>;
  finalize: (userId: string, reservationId: string, succeeded: boolean, inputTokens: number, outputTokens: number, model: string) => Promise<void>;
  snapshot: (userId: string, unlimited?: boolean) => Promise<AiUsageSnapshot>;
};

let testAdapter: AiUsageAdapter | undefined;

/** Replaces billing I/O for route tests; this is not exposed over HTTP. */
export function configureAiUsageAdapterForTests(adapter: AiUsageAdapter | undefined) {
  testAdapter = adapter;
}

/** Owner access is configured only on the server and keyed to the verified Firebase UID. */
export function isCirkitraOwner(userId: string): boolean {
  const ownerUid = process.env.CIRKITRA_OWNER_UID?.trim();
  return Boolean(ownerUid && userId && ownerUid === userId);
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const pair of cookie.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0 || pair.slice(0, separator).trim() !== name) continue;
    const value = pair.slice(separator + 1).trim();
    try { return decodeURIComponent(value); }
    catch { return value; }
  }
  return null;
}

export async function authenticateAiRequest(request: Request): Promise<string | null> {
  if (testAdapter) return testAdapter.authenticate(request);
  const sessionCookie = cookieValue(request, "__cirkitra_session");
  if (!sessionCookie) return null;

  try {
    const { getFirebaseAdminAuth, isFirebaseAdminConfigured } = await import("../firebase/admin");
    if (!isFirebaseAdminConfigured()) return null;
    const session = await getFirebaseAdminAuth().verifySessionCookie(sessionCookie, true);
    return session.email_verified === true && isAllowedEmailAddress(session.email) ? session.uid : null;
  } catch {
    return null;
  }
}

function planDetails(planId: CirkitraPlanId) {
  const plan = CIRKITRA_PLANS[planId];
  return { planId, planName: plan.name, limit: plan.monthlyAiRequests };
}

function snapshotFromRow(
  row: { used_count: number; monthly_limit: number; resets_at: string | null },
  planId: CirkitraPlanId,
  billingEnabled: boolean,
  unlimited = false,
): AiUsageSnapshot {
  const used = Math.max(0, Number(row.used_count) || 0);
  const limit = unlimited ? 0 : Math.max(0, Number(row.monthly_limit) || 0);
  return {
    ...planDetails(planId),
    planName: unlimited ? "Owner" : planDetails(planId).planName,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    unlimited,
    resetsAt: row.resets_at,
    billingEnabled,
  };
}

async function getUserPlan(userId: string): Promise<CirkitraPlanId> {
  const [{ getPayPalBillingStatus }, { getPayPalServerConfig }] = await Promise.all([
    import("./paypal-store"),
    import("./paypal-config"),
  ]);
  const config = getPayPalServerConfig();
  if (!config) throw new Error("PayPal billing environment is unavailable.");
  return (await getPayPalBillingStatus(userId, config.environment)).planId;
}

async function getComplimentaryPlan(userId: string): Promise<CirkitraPlanId> {
  const [{ getActiveAdminPlanGrantPlanId }, { isMissingAdminPlanGrantSchema }] = await Promise.all([
    import("./admin-plan-grants"),
    import("./paypal-store"),
  ]);
  try {
    return (await getActiveAdminPlanGrantPlanId(userId)) ?? "free";
  } catch (error) {
    if (isMissingAdminPlanGrantSchema(error)) return "free";
    throw error;
  }
}

async function getUsagePlan(userId: string, billingEnabled: boolean, unlimited: boolean): Promise<CirkitraPlanId> {
  if (unlimited) return "free";
  // Keep PayPal entitlements gated by billing configuration, but complimentary
  // grants work independently of whether PayPal checkout is enabled.
  return billingEnabled ? getUserPlan(userId) : getComplimentaryPlan(userId);
}

async function isBillingEnabled() {
  const { isPayPalCheckoutEnabled } = await import("./paypal-config");
  return isPayPalCheckoutEnabled();
}

async function callUsageRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { createAdminClient } = await import("../supabase/admin");
  const { data, error } = await createAdminClient().rpc(name as never, args as never);
  if (error) throw new Error(`AI usage storage failed: ${error.message}`);
  return data as T;
}

function firstRow<T>(data: T[] | T | null): T {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("AI usage storage returned no result.");
  return row as T;
}

export async function reserveAiRequest(userId: string, model: string): Promise<AiRequestReservationResult> {
  const unlimited = isCirkitraOwner(userId);
  if (testAdapter) return testAdapter.reserve(userId, model, unlimited);
  const billingEnabled = await isBillingEnabled();
  const planId = await getUsagePlan(userId, billingEnabled, unlimited);
  const plan = planDetails(planId);
  const monthlyLimit = unlimited ? 0 : plan.limit;
  const row = firstRow(await callUsageRpc<Array<{
    reservation_id: string | null;
    allowed: boolean;
    used_count: number;
    monthly_limit: number;
    resets_at: string | null;
  }>>("reserve_ai_generation_request", {
    p_user_id: userId,
    p_monthly_limit: monthlyLimit,
    p_model: model,
  }));
  const usage = snapshotFromRow(row, planId, billingEnabled, unlimited);
  if (!row.allowed || !row.reservation_id) return { allowed: false, usage };
  return { allowed: true, reservation: { reservationId: row.reservation_id, usage } };
}

export async function finalizeAiRequest(
  userId: string,
  reservationId: string,
  succeeded: boolean,
  inputTokens: number,
  outputTokens: number,
  model: string,
) {
  if (testAdapter) return testAdapter.finalize(userId, reservationId, succeeded, inputTokens, outputTokens, model);
  await callUsageRpc<boolean>("finalize_ai_generation_request", {
    p_request_id: reservationId,
    p_user_id: userId,
    p_succeeded: succeeded,
    p_input_tokens: Math.max(0, Math.trunc(inputTokens)),
    p_output_tokens: Math.max(0, Math.trunc(outputTokens)),
    p_model: model,
  });
}

export async function getAiUsageSnapshot(userId: string): Promise<AiUsageSnapshot> {
  const unlimited = isCirkitraOwner(userId);
  if (testAdapter) return testAdapter.snapshot(userId, unlimited);
  const billingEnabled = await isBillingEnabled();
  const planId = await getUsagePlan(userId, billingEnabled, unlimited);
  const plan = planDetails(planId);
  const row = firstRow(await callUsageRpc<Array<{
    used_count: number;
    monthly_limit: number;
    resets_at: string | null;
  }>>("get_ai_generation_usage", {
    p_user_id: userId,
    p_monthly_limit: unlimited ? 0 : plan.limit,
  }));
  return snapshotFromRow(row, planId, billingEnabled, unlimited);
}
