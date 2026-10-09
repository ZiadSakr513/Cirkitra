import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const file = (path) => new URL(path, import.meta.url);

test("PayPal is sandbox-first and all server credentials stay server-only", async () => {
  const [envExample, config, configCore, plans] = await Promise.all([
    readFile(file("../.env.example"), "utf8"),
    readFile(file("../lib/billing/paypal-config.ts"), "utf8"),
    readFile(file("../lib/billing/paypal-config-core.ts"), "utf8"),
    readFile(file("../lib/billing/plans.ts"), "utf8"),
  ]);
  assert.match(envExample, /CIRKITRA_PAYPAL_ENABLED=false/);
  assert.match(envExample, /PAYPAL_ENV=sandbox/);
  assert.match(envExample, /CIRKITRA_PAYPAL_API_ACCESS_CONFIRMED=false/);
  assert.match(envExample, /PAYPAL_PRO_PLAN_ID=/);
  assert.match(configCore, /PAYPAL_CLIENT_SECRET\?\.trim\(\)/);
  assert.doesNotMatch(config + configCore, /NEXT_PUBLIC_PAYPAL_CLIENT_SECRET/);
  assert.match(configCore, /CIRKITRA_PAYPAL_LIVE_BILLING_CONFIRMED/);
  assert.match(config, /resolvePayPalConfigValues\(process\.env\)/);
  assert.match(config, /getPayPalEnvironment/);
  assert.match(plans, /priceUsdCents: 1000/);
  assert.match(plans, /monthlyAiRequests: 50/);
  assert.match(plans, /monthlyAiRequests: 5/);
  assert.match(plans, /priceUsdCents: 2000/);
  assert.match(plans, /monthlyAiRequests: 200/);
});

test("Live checkout is production-only and Sandbox rows are isolated from Live billing", async () => {
  const [core, migration, store, checkout, confirm, webhook, cancel, status] = await Promise.all([
    readFile(file("../lib/billing/paypal-config-core.ts"), "utf8"),
    readFile(file("../supabase/migrations/20261009080000_paypal_environment_isolation.sql"), "utf8"),
    readFile(file("../lib/billing/paypal-store.ts"), "utf8"),
    readFile(file("../app/api/billing/paypal/checkout-intent/route.ts"), "utf8"),
    readFile(file("../app/api/billing/paypal/confirm/route.ts"), "utf8"),
    readFile(file("../app/api/billing/paypal/webhook/route.ts"), "utf8"),
    readFile(file("../app/api/billing/paypal/cancel/route.ts"), "utf8"),
    readFile(file("../app/api/billing/paypal/status/route.ts"), "utf8"),
  ]);
  assert.match(core, /values\.VERCEL_ENV === "production"/);
  assert.match(core, /values\.NODE_ENV === "production"/);
  assert.match(core, /Boolean\(proPlanId\)/);
  assert.match(core, /liveBillingConfirmed/);
  assert.match(migration, /add column if not exists environment text/i);
  assert.match(migration, /set environment = 'sandbox'[\s\S]*where environment is null/i);
  assert.match(migration, /primary key \(environment, paypal_subscription_id\)/i);
  assert.match(migration, /primary key \(environment, event_id\)/i);
  assert.match(migration, /on conflict \(environment, event_id\) do nothing/i);
  assert.match(migration, /subscriptions\.environment = p_environment/i);
  assert.match(migration, /intents\.environment = p_environment/i);
  assert.match(migration, /create_paypal_checkout_intent\(p_user_id, p_plan_id, 'sandbox'\)/i);
  assert.match(migration, /get_active_plan_entitlements\(p_user_id, 'sandbox'\)/i);
  assert.match(store, /p_environment: environment/);
  assert.match(store, /\.eq\("environment", environment\)/);
  assert.match(checkout, /createPayPalCheckoutIntent\(userId, planId, config\.environment\)/);
  assert.match(confirm, /getPayPalCheckoutIntent\(checkoutIntentId, config\.environment\)/);
  assert.match(confirm, /environment: config\.environment/);
  assert.match(webhook, /findPayPalCheckoutIntentForSubscription\(subscriptionId, config\.environment\)/);
  assert.match(webhook, /environment: config\.environment/);
  assert.match(cancel, /cancelPayPalSubscriptionForUser\(userId, config\.environment\)/);
  assert.match(cancel, /markPayPalSubscriptionCancelled\(userId, result\.subscriptionId, config\.environment\)/);
  assert.match(status, /getPayPalBillingStatus\(userId, environment\)/);
});

test("Live preflight is explicit, read-only, and verifies prices, cadence, and webhook", async () => {
  const [script, helper, packageJson] = await Promise.all([
    readFile(file("../scripts/paypal-live-preflight.ts"), "utf8"),
    readFile(file("../lib/billing/paypal-live-preflight.ts"), "utf8"),
    readFile(file("../package.json"), "utf8"),
  ]);
  assert.match(script, /process\.argv\.includes\("--live"\)/);
  assert.match(script, /PAYPAL_ENV\?\.trim\(\)\.toLowerCase\(\) !== "live"/);
  assert.match(helper, /https:\/\/api-m\.paypal\.com/);
  assert.match(helper, /\/v1\/billing\/plans/);
  assert.match(helper, /\/v1\/notifications\/webhooks/);
  assert.match(helper, /plan\.status !== "ACTIVE"/);
  assert.match(helper, /interval_unit !== "MONTH"/);
  assert.match(helper, /currency_code !== "USD"/);
  assert.match(helper, /REQUIRED_PAYPAL_WEBHOOK_EVENTS/);
  assert.match(helper, /method: "GET"/);
  assert.match(packageJson, /"paypal:preflight": "node --experimental-transform-types scripts\/paypal-live-preflight\.ts"/);
});

test("only authenticated checkout starts an intent; browser approval cannot grant Maker", async () => {
  const [checkout, ui, confirm, store, usage, generate] = await Promise.all([
    readFile(file("../app/api/billing/paypal/checkout-intent/route.ts"), "utf8"),
    readFile(file("../app/pricing/paypal-subscription.tsx"), "utf8"),
    readFile(file("../app/api/billing/paypal/confirm/route.ts"), "utf8"),
    readFile(file("../lib/billing/paypal-store.ts"), "utf8"),
    readFile(file("../lib/billing/ai-usage.ts"), "utf8"),
    readFile(file("../app/api/ai/generate/route.ts"), "utf8"),
  ]);
  assert.match(checkout, /authenticateAiRequest\(request\)/);
  assert.match(checkout, /config\?\.checkoutEnabled/);
  assert.match(checkout, /body\.planId !== "maker" && body\.planId !== "pro"/);
  assert.match(checkout, /createPayPalCheckoutIntent\(userId, planId, config\.environment\)/);
  assert.match(checkout, /getConfiguredPayPalPlanId\(config\.planIds, planId\)/);
  assert.doesNotMatch(checkout, /Check or cancel that subscription|Finish or close it before choosing/i);
  assert.match(ui, /custom_id: result\.intentId/);
  assert.match(ui, /onApprove: async \(data\) =>/);
  assert.match(ui, /cirkitra-paypal-pending-subscription/);
  assert.match(ui, /onCancel: \(\) =>/);
  assert.match(ui, /setCheckoutReady\(false\)/);
  assert.match(ui, /type="button" onClick=\{\(\) => setCheckoutReady\(true\)\}>Upgrade/);
  assert.doesNotMatch(ui, /Cancel unpaid attempt|Check payment status|Already approved a payment|unresolved|open subscription/i);
  assert.doesNotMatch(ui, /PayPal Sandbox Activity/);
  assert.match(store, /subscriptionPlanId/);
  assert.match(store, /\.in\("status", \["APPROVAL_PENDING", "APPROVED", "ACTIVE", "SUSPENDED"\]\)/);
  assert.match(confirm, /authenticateAiRequest\(request\)/);
  assert.match(confirm, /isSameOriginRequest\(request\)/);
  assert.match(confirm, /getPayPalSubscription\(config, subscriptionId\)/);
  assert.match(confirm, /identifyCirkitraPlanId\(config\.planIds, details\.plan_id\)/);
  assert.match(confirm, /intent\.userId !== userId/);
  assert.match(confirm, /intent\.planId !== configuredPlanId/);
  assert.match(confirm, /getVerifiedPayPalPaymentPeriod\(details, CIRKITRA_PLANS\[configuredPlanId\]\.priceUsdCents\)/);
  assert.match(confirm, /applyPayPalWebhookEvent\(/);
  assert.match(usage, /billingEnabled \? getUserPlan\(userId\) : getComplimentaryPlan\(userId\)/);
  assert.match(usage, /getActiveAdminPlanGrantPlanId/);
  assert.match(generate, /CIRKITRA_PLANS\.pro\.monthlyAiRequests/);
  assert.match(generate, /currentPlan\.monthlyAiRequests/);
  assert.doesNotMatch(generate, /paid plans are not available yet/);
  assert.equal((usage.match(/await getUsagePlan\(userId, billingEnabled, unlimited\)/g) ?? []).length, 2,
    "use the grant-only lookup when PayPal is disabled, and skip entitlement lookups for the configured owner");
});

test("abandoned PayPal checkouts can be retried without blocking paid entitlements", async () => {
  const migration = await readFile(file("../supabase/migrations/20261009100000_paypal_checkout_retries.sql"), "utf8");
  const checkoutIntentFunction = migration.match(/create or replace function public\.create_paypal_checkout_intent\([\s\S]*?\$\$;/i)?.[0] ?? "";
  const webhookFunction = migration.match(/create or replace function public\.apply_paypal_webhook_event\([\s\S]*?\$\$;/i)?.[0] ?? "";

  assert.ok(checkoutIntentFunction, "the migration replaces the checkout-intent function");
  assert.ok(webhookFunction, "the migration replaces the webhook event function");
  assert.match(checkoutIntentFunction, /Every click gets a new intent/i);
  assert.match(checkoutIntentFunction, /subscriptions\.successful_payment_at is not null[\s\S]*subscriptions\.paid_through > v_now/i);
  assert.doesNotMatch(checkoutIntentFunction, /open PayPal subscription|checkout is already in progress/i);
  assert.doesNotMatch(webhookFunction, /Another paid plan or PayPal subscription is already active|subscriptions\.status in \('APPROVAL_PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED'\)/i);
  assert.match(webhookFunction, /Another paid entitlement is still active/i);
});

test("a cancelled Maker renewal can move to Pro after verified payment without overlapping renewals", async () => {
  const [migration, ui, store, confirm, checkout, environmentMigration] = await Promise.all([
    readFile(file("../supabase/migrations/20261009120000_paypal_maker_to_pro_upgrade.sql"), "utf8"),
    readFile(file("../app/pricing/paypal-subscription.tsx"), "utf8"),
    readFile(file("../lib/billing/paypal-store.ts"), "utf8"),
    readFile(file("../app/api/billing/paypal/confirm/route.ts"), "utf8"),
    readFile(file("../app/api/billing/paypal/checkout-intent/route.ts"), "utf8"),
    readFile(file("../supabase/migrations/20261009080000_paypal_environment_isolation.sql"), "utf8"),
  ]);
  const checkoutIntentFunction = migration.match(/create or replace function public\.create_paypal_checkout_intent\([\s\S]*?\$\$;/i)?.[0] ?? "";
  const webhookFunction = migration.match(/create or replace function public\.apply_paypal_webhook_event\([\s\S]*?\$\$;/i)?.[0] ?? "";

  assert.match(checkoutIntentFunction, /subscriptions\.paid_through > v_now/i);
  assert.match(checkoutIntentFunction, /p_plan_id = 'pro'[\s\S]*subscriptions\.plan_id = 'maker'[\s\S]*subscriptions\.cancellation_requested_at is not null or subscriptions\.status = 'CANCELLED'/i);
  assert.match(webhookFunction, /v_plan_id = 'pro'[\s\S]*subscriptions\.plan_id = 'maker'[\s\S]*subscriptions\.cancellation_requested_at is not null or subscriptions\.status = 'CANCELLED'/i);
  assert.match(webhookFunction, /when p_subscription_status = 'CANCELLED' then coalesce\(paypal_subscriptions\.cancellation_requested_at, v_now\)/i);
  assert.match(environmentMigration, /case when subscriptions\.plan_id = 'pro' then 0 else 1 end/i,
    "when both paid periods overlap, Pro is selected as the current entitlement");
  assert.match(store, /renewalCancelled: Boolean\(subscription\.cancellation_requested_at\) \|\| subscription\.status === "CANCELLED"/);
  assert.match(ui, /status\.renewalCancelled/);
  assert.match(ui, /Your remaining Maker time is not refunded or credited/);
  assert.match(ui, /updated\?\.paypalPlanId === verifiedPlanId/);
  assert.match(confirm, /pending: !payment, planId: configuredPlanId/);
  assert.match(checkout, /Could not start this checkout\. Please try again shortly\./);
});

test("pricing checks the Cirkitra session separately and offers an Upgrade sign-in action", async () => {
  const [session, ui, statusRoute, store] = await Promise.all([
    readFile(file("../app/api/auth/session/route.ts"), "utf8"),
    readFile(file("../app/pricing/paypal-subscription.tsx"), "utf8"),
    readFile(file("../app/api/billing/paypal/status/route.ts"), "utf8"),
    readFile(file("../lib/billing/paypal-store.ts"), "utf8"),
  ]);
  assert.match(session, /export async function GET\(\)/);
  assert.match(session, /verifyFirebaseSessionCookie\(cookieStore\.get\(FIREBASE_SESSION_COOKIE\)\?\.value\)/);
  assert.match(session, /\{ authenticated: true \}/);
  assert.match(ui, /fetch\("\/api\/auth\/session", options\)/);
  assert.match(ui, /await auth\.authStateReady\(\)/);
  assert.match(ui, /await syncFirebaseSession\(user, true\)/);
  assert.match(ui, /href="\/auth\?next=%2Fpricing">Upgrade/);
  assert.doesNotMatch(ui, /billingError|Checkout unavailable|Could not load your subscription status/);
  assert.doesNotMatch(ui, />Retry</);
  assert.match(statusRoute, /BILLING_SETUP_REQUIRED/);
  assert.match(store, /isMissingPayPalBillingSchema/);
  assert.doesNotMatch(ui, /Sign in with a verified account/);
});

test("webhook signature, plan identity, and database idempotency gate paid access", async () => {
  const [webhook, api, migration] = await Promise.all([
    readFile(file("../app/api/billing/paypal/webhook/route.ts"), "utf8"),
    readFile(file("../lib/billing/paypal-api.ts"), "utf8"),
    readFile(file("../supabase/migrations/20261009040000_paypal_multi_tier.sql"), "utf8"),
  ]);
  assert.match(webhook, /verifyPayPalWebhook\(config, request, event\)/);
  assert.match(webhook, /readBoundedText\(request, 1_000_000\)/);
  assert.match(webhook, /event\s*=\s*JSON\.parse\(rawBody\)/);
  assert.match(webhook, /identifyCirkitraPlanId\(config\.planIds, details\.plan_id\)/);
  assert.match(webhook, /getVerifiedPayPalPaymentPeriod\(details, CIRKITRA_PLANS\[planId\]\.priceUsdCents\)/);
  assert.match(migration, /add column if not exists plan_id text/i);
  assert.match(migration, /set plan_id = coalesce\(intents\.plan_id, 'maker'\)/i);
  assert.match(migration, /p_plan_id not in \('maker', 'pro'\)/i);
  assert.match(migration, /An active paid plan already exists/i);
  assert.match(migration, /Another paid entitlement is still active/i);
  assert.match(migration, /subscriptions\.plan_id = v_plan_id/i);
  assert.match(migration, /get_paypal_plan_entitlement/i);
  assert.match(webhook, /eventType === "PAYMENT\.SALE\.COMPLETED"/);
  assert.match(webhook, /applyPayPalWebhookEvent\(/);
  assert.match(api, /verify-webhook-signature/);
  assert.match(api, /result\.verification_status === "SUCCESS"/);
  assert.match(migration, /on conflict \(event_id\) do nothing/);
  assert.match(migration, /when p_payment_succeeded then p_paid_through\s+else paypal_subscriptions\.paid_through/);
});

test("cancellation is a PayPal API operation and keeps paid-through access", async () => {
  const [route, store, migration] = await Promise.all([
    readFile(file("../app/api/billing/paypal/cancel/route.ts"), "utf8"),
    readFile(file("../lib/billing/paypal-store.ts"), "utf8"),
    readFile(file("../supabase/migrations/20261005040000_paypal_subscriptions.sql"), "utf8"),
  ]);
  assert.match(route, /cancelWithPayPal\(config, result\.subscriptionId\)/);
  assert.match(route, /markPayPalSubscriptionCancelled\(userId, result\.subscriptionId, config\.environment\)/);
  assert.match(store, /status: "CANCELLED", cancellation_requested_at: now/);
  assert.match(migration, /successful_payment_at is not null[\s\S]*paid_through > v_now/i);
  assert.match(migration, /when p_payment_succeeded then p_paid_through\s+else paypal_subscriptions\.paid_through/);
});

test("complimentary plan grants are owner-only, audited, and separate from PayPal payments", async () => {
  const [auth, lookupAndCreate, revoke, grantsStore, billingStore, migration, types, manager, adminPage, pricingUi] = await Promise.all([
    readFile(file("../lib/billing/admin-plan-grant-auth.ts"), "utf8"),
    readFile(file("../app/api/admin/plan-grants/route.ts"), "utf8"),
    readFile(file("../app/api/admin/plan-grants/[grantId]/route.ts"), "utf8"),
    readFile(file("../lib/billing/admin-plan-grants.ts"), "utf8"),
    readFile(file("../lib/billing/paypal-store.ts"), "utf8"),
    readFile(file("../supabase/migrations/20261009050000_admin_plan_grants.sql"), "utf8"),
    readFile(file("../lib/supabase/database.types.ts"), "utf8"),
    readFile(file("../app/admin/plans/plan-manager.tsx"), "utf8"),
    readFile(file("../app/admin/plans/page.tsx"), "utf8"),
    readFile(file("../app/pricing/paypal-subscription.tsx"), "utf8"),
  ]);

  assert.match(auth, /authenticateAiRequest\(request\)/);
  assert.match(auth, /isCirkitraOwner\(userId\)/);
  assert.match(auth, /isSameOriginRequest\(request\)/);
  assert.match(lookupAndCreate, /getUserByEmail\(email\)/);
  assert.match(lookupAndCreate, /body\.planId !== "maker" && body\.planId !== "pro"/);
  assert.doesNotMatch(lookupAndCreate, /body\.userId/);
  assert.match(revoke, /isSameOriginRequest|requirePlanGrantAdmin\(request, true\)/);
  assert.match(grantsStore, /create_admin_plan_grant/);
  assert.match(grantsStore, /revoke_admin_plan_grant/);
  assert.match(billingStore, /get_active_plan_entitlements/);
  assert.match(billingStore, /resolveEffectiveCirkitraPlan\(paypalPlanId, complimentaryGrant\?\.planId \?\? null\)/);
  assert.match(migration, /create table if not exists public\.admin_plan_grants/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on public\.admin_plan_grants from public, anon, authenticated/i);
  assert.match(migration, /grant all on public\.admin_plan_grants to service_role/i);
  assert.match(migration, /create or replace function public\.create_admin_plan_grant/i);
  assert.match(migration, /revoked_at = v_now[\s\S]*revoked_by = p_granted_by/i);
  assert.match(migration, /create or replace function public\.get_active_admin_plan_grant/i);
  assert.match(migration, /grants\.revoked_at is null[\s\S]*grants\.starts_at <= v_now[\s\S]*grants\.expires_at is null or grants\.expires_at > v_now/i);
  assert.match(migration, /grant execute on function public\.get_active_plan_entitlements\(text\) to service_role/i);
  assert.match(types, /admin_plan_grants:/);
  assert.match(types, /get_active_plan_entitlements:/);
  assert.match(manager, /No PayPal payment or subscription was created/);
  assert.match(manager, /No expiration; access stays until revoked/);
  assert.match(manager, /Revoke/);
  assert.match(adminPage, /isCirkitraOwner\(user\.uid\)/);
  assert.match(pricingUi, /status\.complimentaryGrant/);
  assert.match(pricingUi, /subscription remains unchanged and is active/);
});

test("owner admin can immediately reset circuit-generation usage without changing a plan or erasing history", async () => {
  const [auth, route, usageStore, migration, types, manager] = await Promise.all([
    readFile(file("../lib/billing/admin-plan-grant-auth.ts"), "utf8"),
    readFile(file("../app/api/admin/ai-usage/route.ts"), "utf8"),
    readFile(file("../lib/billing/admin-ai-usage.ts"), "utf8"),
    readFile(file("../supabase/migrations/20261009060000_admin_ai_usage_resets.sql"), "utf8"),
    readFile(file("../lib/supabase/database.types.ts"), "utf8"),
    readFile(file("../app/admin/plans/plan-manager.tsx"), "utf8"),
  ]);

  assert.match(auth, /isSameOriginRequest\(request\)/);
  assert.match(route, /requirePlanGrantAdmin\(request, true\)/);
  assert.match(route, /getUserByEmail\(email\)/);
  assert.doesNotMatch(route, /body\.userId/);
  assert.match(route, /isCirkitraOwner\(user\.uid\)/);
  assert.match(route, /getAiUsageSnapshot\(userId\)/);
  assert.match(route, /resetAdminAiUsage\(/);
  assert.match(route, /ADMIN_USAGE_RESET_SETUP_REQUIRED/);
  assert.match(usageStore, /reset_ai_generation_usage/);
  assert.match(usageStore, /p_idempotency_key: input\.idempotencyKey/);

  assert.match(migration, /create table if not exists public\.admin_ai_usage_resets/i);
  assert.match(migration, /idempotency_key uuid not null unique/i);
  assert.match(migration, /alter table public\.admin_ai_usage_resets enable row level security/i);
  assert.match(migration, /revoke all on public\.admin_ai_usage_resets from public, anon, authenticated/i);
  assert.match(migration, /grant all on public\.admin_ai_usage_resets to service_role/i);
  assert.match(migration, /resets\.idempotency_key = p_idempotency_key/i);
  assert.match(migration, /v_existing\.user_id is distinct from p_user_id[\s\S]*v_existing\.reset_by is distinct from p_reset_by/i);
  assert.match(migration, /pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(p_user_id, 0\)\)/i);
  assert.match(migration, /greatest\(v_window_start, v_latest_reset\)/i);
  assert.match(migration, /requests\.created_at > v_window_start/i);
  assert.match(migration, /requests\.status = 'succeeded'[\s\S]*requests\.status = 'reserved'/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.ai_generation_requests/i);
  assert.match(types, /admin_ai_usage_resets:/);
  assert.match(types, /reset_ai_generation_usage:/);

  assert.match(manager, /AI circuit-generation usage/);
  assert.match(manager, /crypto\.randomUUID\(\)/);
  assert.match(manager, /window\.confirm\(/);
  assert.match(manager, /Reset usage/);
  assert.match(manager, /previous request records will be kept but will no longer count/i);
  assert.match(manager, /usage\.unlimited/);
});
