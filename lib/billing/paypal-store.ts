import "server-only";

import { createAdminClient } from "../supabase/admin";
import type { CirkitraPlanId, PaidCirkitraPlanId } from "./plans";
import { resolveEffectiveCirkitraPlan } from "./plan-entitlement";
import type { PayPalEnvironment } from "./paypal-config-core";

export type AdminPlanGrantSummary = {
  planId: PaidCirkitraPlanId;
  expiresAt: string | null;
};

export type PayPalBillingStatus = {
  planId: CirkitraPlanId;
  paypalPlanId: CirkitraPlanId;
  complimentaryGrant: AdminPlanGrantSummary | null;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  paidThrough: string | null;
  canCancel: boolean;
};

export function isMissingPayPalBillingSchema(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /could not find the (?:table|function).*(?:paypal_|admin_plan_grants|get_active_plan_entitlements)|(?:relation|function).*?(?:paypal_subscriptions|admin_plan_grants|create_paypal_checkout_intent|get_paypal_plan_entitlement|get_active_plan_entitlements).*?(?:does not exist|not found)|column .*paypal_(?:subscriptions|checkout_intents|webhook_events)\.(?:plan_id|environment) .*does not exist/i.test(message);
}

export function isMissingAdminPlanGrantSchema(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /(?:admin_plan_grants|get_active_plan_entitlements|get_active_admin_plan_grant).*?(?:does not exist|not found|schema cache)|(?:could not find the (?:table|function)).*(?:admin_plan_grants|get_active_plan_entitlements|get_active_admin_plan_grant)/i.test(message);
}

function firstResult<T>(data: T[] | T | null): T {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("PayPal billing storage returned no result.");
  return row as T;
}

export async function createPayPalCheckoutIntent(userId: string, planId: PaidCirkitraPlanId, environment: PayPalEnvironment): Promise<string> {
  const { data, error } = await createAdminClient().rpc("create_paypal_checkout_intent", { p_user_id: userId, p_plan_id: planId, p_environment: environment });
  if (error) {
    if (error.message.includes("active paid plan")) throw new Error("PAID_PLAN_ALREADY_ACTIVE");
    if (error.message.includes("open PayPal subscription")) throw new Error("OPEN_SUBSCRIPTION_EXISTS");
    if (error.message.includes("checkout is already in progress")) throw new Error("CHECKOUT_IN_PROGRESS");
    throw new Error(`Could not create PayPal checkout intent: ${error.message}`);
  }
  if (typeof data !== "string" || !data) throw new Error("PayPal checkout intent was not created.");
  return data;
}

export async function getPayPalCheckoutIntent(intentId: string, environment: PayPalEnvironment): Promise<{ userId: string; planId: PaidCirkitraPlanId } | null> {
  const { data, error } = await createAdminClient()
    .from("paypal_checkout_intents")
    .select("user_id,plan_id")
    .eq("id", intentId)
    .eq("environment", environment)
    .maybeSingle();
  if (error) throw new Error(`Could not read PayPal checkout intent: ${error.message}`);
  if (!data || (data.plan_id !== "maker" && data.plan_id !== "pro")) return null;
  return { userId: data.user_id, planId: data.plan_id };
}

export async function isPayPalCheckoutIntentOwnedBy(intentId: string, userId: string, environment: PayPalEnvironment): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("paypal_checkout_intents")
    .select("user_id")
    .eq("id", intentId)
    .eq("environment", environment)
    .maybeSingle();
  if (error) throw new Error(`Could not verify PayPal checkout ownership: ${error.message}`);
  return data?.user_id === userId;
}

export async function getPayPalBillingStatus(userId: string, environment: PayPalEnvironment): Promise<PayPalBillingStatus> {
  const { data, error } = await createAdminClient().rpc("get_active_plan_entitlements", { p_user_id: userId, p_environment: environment });
  if (error && isMissingAdminPlanGrantSchema(error)) {
    // Deploy remains compatible before the complimentary-grants migration is applied.
    const { data: subscriptions, error: legacyError } = await createAdminClient()
      .from("paypal_subscriptions")
      .select("paypal_subscription_id,plan_id,status,successful_payment_at,paid_through,cancellation_requested_at")
      .eq("user_id", userId)
      .eq("environment", environment)
      .order("updated_at", { ascending: false });
    if (legacyError) throw new Error(`Could not read PayPal billing status: ${legacyError.message}`);
    const rows = subscriptions ?? [];
    const now = Date.now();
    const entitled = rows.find((subscription) => Boolean(subscription.successful_payment_at && subscription.paid_through && Date.parse(subscription.paid_through) > now));
    const relevant = entitled ?? rows[0];
    const paypalPlanId: CirkitraPlanId = entitled?.plan_id === "pro" ? "pro" : entitled ? "maker" : "free";
    return {
      planId: paypalPlanId,
      paypalPlanId,
      complimentaryGrant: null,
      subscriptionId: relevant?.paypal_subscription_id ?? null,
      subscriptionStatus: relevant?.status ?? null,
      paidThrough: relevant?.paid_through ?? null,
      canCancel: (relevant?.status === "ACTIVE" || relevant?.status === "APPROVED") && !relevant.cancellation_requested_at,
    };
  }
  if (error) throw new Error(`Could not read billing entitlements: ${error.message}`);
  const row = firstResult(data);
  const paypalPlanId: CirkitraPlanId = row.paypal_plan_id === "maker" || row.paypal_plan_id === "pro" ? row.paypal_plan_id : "free";
  const complimentaryGrant: AdminPlanGrantSummary | null = row.admin_grant_id
    && (row.admin_grant_plan_id === "maker" || row.admin_grant_plan_id === "pro")
    ? { planId: row.admin_grant_plan_id, expiresAt: row.admin_grant_expires_at }
    : null;
  return {
    planId: resolveEffectiveCirkitraPlan(paypalPlanId, complimentaryGrant?.planId ?? null),
    paypalPlanId,
    complimentaryGrant,
    subscriptionId: row.paypal_subscription_id,
    subscriptionStatus: row.subscription_status,
    paidThrough: row.paid_through,
    canCancel: (row.subscription_status === "ACTIVE" || row.subscription_status === "APPROVED") && !row.cancellation_requested_at,
  };
}

export async function cancelPayPalSubscriptionForUser(userId: string, environment: PayPalEnvironment) {
  const { data, error } = await createAdminClient()
    .from("paypal_subscriptions")
    .select("paypal_subscription_id,status,cancellation_requested_at")
    .eq("user_id", userId)
    .eq("environment", environment)
    .in("status", ["ACTIVE", "APPROVED"])
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`Could not find the PayPal subscription: ${error.message}`);
  const row = data?.[0];
  if (!row) return { cancelled: false, alreadyCancelled: true };
  if (row.cancellation_requested_at) return { cancelled: false, alreadyCancelled: true };
  return { cancelled: true, subscriptionId: row.paypal_subscription_id };
}

export async function markPayPalSubscriptionCancelled(userId: string, subscriptionId: string, environment: PayPalEnvironment) {
  const now = new Date().toISOString();
  const { error } = await createAdminClient()
    .from("paypal_subscriptions")
    .update({ status: "CANCELLED", cancellation_requested_at: now, updated_at: now })
    .eq("user_id", userId)
    .eq("environment", environment)
    .eq("paypal_subscription_id", subscriptionId);
  if (error) throw new Error(`Could not save PayPal cancellation: ${error.message}`);
}

export async function findPayPalCheckoutIntentForSubscription(subscriptionId: string, environment: PayPalEnvironment): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from("paypal_subscriptions")
    .select("checkout_intent_id")
    .eq("environment", environment)
    .eq("paypal_subscription_id", subscriptionId)
    .maybeSingle();
  if (error) throw new Error(`Could not map PayPal subscription: ${error.message}`);
  return data?.checkout_intent_id ?? null;
}

export async function applyPayPalWebhookEvent(input: {
  environment: PayPalEnvironment;
  eventId: string;
  eventType: string;
  subscriptionId: string;
  checkoutIntentId: string;
  status: string | null;
  paidThrough: string | null;
  paymentSucceeded?: boolean;
  revokeEntitlement?: boolean;
}) {
  const { data, error } = await createAdminClient().rpc("apply_paypal_webhook_event", {
    p_event_id: input.eventId,
    p_event_type: input.eventType,
    p_paypal_subscription_id: input.subscriptionId,
    p_checkout_intent_id: input.checkoutIntentId,
    p_subscription_status: input.status,
    p_paid_through: input.paidThrough,
    p_environment: input.environment,
    p_payment_succeeded: input.paymentSucceeded ?? false,
    p_revoke_entitlement: input.revokeEntitlement ?? false,
  });
  if (error) throw new Error(`Could not apply verified PayPal event: ${error.message}`);
  return Boolean(data);
}

export async function getPayPalMakerEntitlement(userId: string, environment: PayPalEnvironment) {
  const { data, error } = await createAdminClient().rpc("get_paypal_maker_entitlement", { p_user_id: userId, p_environment: environment });
  if (error) throw new Error(`Could not read Maker entitlement: ${error.message}`);
  return firstResult(data);
}
