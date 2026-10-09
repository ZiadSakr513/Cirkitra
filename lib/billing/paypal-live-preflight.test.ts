import assert from "node:assert/strict";
import test from "node:test";
import { resolvePayPalConfigValues } from "./paypal-config-core.ts";
import {
  REQUIRED_PAYPAL_WEBHOOK_EVENTS,
  runPayPalLivePreflight,
  validatePayPalLivePlan,
  type PayPalLivePlan,
} from "./paypal-live-preflight.ts";

const baseEnv = {
  PAYPAL_CLIENT_ID: "client-id",
  PAYPAL_CLIENT_SECRET: "secret",
  PAYPAL_PLAN_ID: "maker-live",
  PAYPAL_PRO_PLAN_ID: "pro-live",
  PAYPAL_WEBHOOK_ID: "webhook-live",
  CIRKITRA_PAYPAL_ENABLED: "true",
  CIRKITRA_PAYPAL_API_ACCESS_CONFIRMED: "true",
  CIRKITRA_PAYPAL_LIVE_BILLING_CONFIRMED: "true",
  NODE_ENV: "production",
};

test("PayPal configuration defaults to Sandbox and guards Live with all explicit production checks", () => {
  const sandbox = resolvePayPalConfigValues({ ...baseEnv, PAYPAL_ENV: undefined, NODE_ENV: "development" });
  assert.equal(sandbox?.environment, "sandbox");
  assert.equal(sandbox?.checkoutEnabled, true);
  assert.equal(sandbox?.planIds.pro, "pro-live");

  const livePreview = resolvePayPalConfigValues({ ...baseEnv, PAYPAL_ENV: "live", VERCEL_ENV: "preview" });
  assert.equal(livePreview?.checkoutEnabled, false);
  const liveWithoutVercelEnvironment = resolvePayPalConfigValues({ ...baseEnv, PAYPAL_ENV: "live" });
  assert.equal(liveWithoutVercelEnvironment?.checkoutEnabled, false);
  assert.equal(resolvePayPalConfigValues({ ...baseEnv, PAYPAL_ENV: undefined, VERCEL_ENV: "production" }), null);
  const liveWithoutApiConfirmation = resolvePayPalConfigValues({ ...baseEnv, PAYPAL_ENV: "live", VERCEL_ENV: "production", CIRKITRA_PAYPAL_API_ACCESS_CONFIRMED: "false" });
  assert.equal(liveWithoutApiConfirmation?.checkoutEnabled, false);
  const liveWithoutBillingConfirmation = resolvePayPalConfigValues({ ...baseEnv, PAYPAL_ENV: "live", VERCEL_ENV: "production", CIRKITRA_PAYPAL_LIVE_BILLING_CONFIRMED: "false" });
  assert.equal(liveWithoutBillingConfirmation?.checkoutEnabled, false);
  const liveProduction = resolvePayPalConfigValues({ ...baseEnv, PAYPAL_ENV: "live", VERCEL_ENV: "production" });
  assert.equal(liveProduction?.checkoutEnabled, true);
  assert.equal(liveProduction?.planIds.maker, "maker-live");
  assert.equal(liveProduction?.planIds.pro, "pro-live");
  assert.equal(resolvePayPalConfigValues({ ...baseEnv, PAYPAL_ENV: "sandbox", VERCEL_ENV: "production" }), null);
});

test("PayPal configuration fails closed for missing credentials, webhook, duplicate plan IDs, or incomplete Live tiers", () => {
  assert.equal(resolvePayPalConfigValues({ ...baseEnv, PAYPAL_ENV: "live", VERCEL_ENV: "production", PAYPAL_CLIENT_SECRET: "" }), null);
  assert.equal(resolvePayPalConfigValues({ ...baseEnv, PAYPAL_ENV: "live", VERCEL_ENV: "production", PAYPAL_WEBHOOK_ID: "" }), null);
  const duplicatePlanIds = resolvePayPalConfigValues({ ...baseEnv, PAYPAL_ENV: "live", VERCEL_ENV: "production", PAYPAL_PRO_PLAN_ID: "maker-live" });
  assert.equal(duplicatePlanIds?.planIds.pro, null);
  assert.equal(duplicatePlanIds?.checkoutEnabled, false);
  const noProPlan = resolvePayPalConfigValues({ ...baseEnv, PAYPAL_ENV: "live", VERCEL_ENV: "production", PAYPAL_PRO_PLAN_ID: "" });
  assert.equal(noProPlan?.planIds.pro, null);
  assert.equal(noProPlan?.checkoutEnabled, false);
  assert.equal(resolvePayPalConfigValues({ ...baseEnv, PAYPAL_ENV: "staging", VERCEL_ENV: "production" }), null);
});

function validPlan(id: string, value: string): PayPalLivePlan {
  return {
    id,
    status: "ACTIVE",
    billing_cycles: [{
      sequence: 1,
      tenure_type: "REGULAR",
      total_cycles: 0,
      frequency: { interval_unit: "MONTH", interval_count: 1 },
      pricing_scheme: { fixed_price: { currency_code: "USD", value } },
    }],
    payment_preferences: { setup_fee: { currency_code: "USD", value: "0.00" } },
  };
}

test("Live plan validation requires the configured active monthly USD amount and no upfront charge", () => {
  const maker = validPlan("maker-live", "10.00");
  validatePayPalLivePlan(maker, "maker-live", 1_000, "Maker");
  assert.throws(() => validatePayPalLivePlan({ ...maker, status: "INACTIVE" }, "maker-live", 1_000, "Maker"), /not ACTIVE/);
  assert.throws(() => validatePayPalLivePlan(validPlan("maker-live", "10.01"), "maker-live", 1_000, "Maker"), /priced at/);
  assert.throws(() => validatePayPalLivePlan({ ...maker, billing_cycles: [{ ...maker.billing_cycles![0], frequency: { interval_unit: "YEAR", interval_count: 1 } }] }, "maker-live", 1_000, "Maker"), /every one month/);
  assert.throws(() => validatePayPalLivePlan({ ...maker, billing_cycles: [{ ...maker.billing_cycles![0], pricing_scheme: { fixed_price: { currency_code: "EUR", value: "10.00" } } }] }, "maker-live", 1_000, "Maker"), /USD monthly amount/);
  assert.throws(() => validatePayPalLivePlan({ ...maker, billing_cycles: [{ ...maker.billing_cycles![0], tenure_type: "TRIAL" }] }, "maker-live", 1_000, "Maker"), /no trial/);
  assert.throws(() => validatePayPalLivePlan({ ...maker, payment_preferences: { setup_fee: { currency_code: "USD", value: "1.00" } } }, "maker-live", 1_000, "Maker"), /setup fee/);
});

test("Live preflight performs only OAuth and read-only plan/webhook checks", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "test-token" });
    if (url.endsWith("/v1/billing/plans/maker-live")) return Response.json(validPlan("maker-live", "10.00"));
    if (url.endsWith("/v1/billing/plans/pro-live")) return Response.json(validPlan("pro-live", "20.00"));
    if (url.endsWith("/v1/notifications/webhooks/webhook-live")) {
      return Response.json({
        id: "webhook-live",
        url: "https://cirkitra.example/api/billing/paypal/webhook",
        event_types: REQUIRED_PAYPAL_WEBHOOK_EVENTS.map((name) => ({ name })),
      });
    }
    return new Response(null, { status: 404 });
  };

  const result = await runPayPalLivePreflight({
    clientId: "client-id",
    clientSecret: "secret",
    makerPlanId: "maker-live",
    proPlanId: "pro-live",
    webhookId: "webhook-live",
    fetchImpl,
  });
  assert.equal(result.plans.length, 2);
  assert.equal(result.webhook.url, "https://cirkitra.example/api/billing/paypal/webhook");
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map((call) => call.method), ["POST", "GET", "GET", "GET"]);
  assert.ok(calls.every((call) => call.url.startsWith("https://api-m.paypal.com/")));
});

test("Live preflight rejects duplicate tiers and incomplete webhook configuration", async () => {
  await assert.rejects(runPayPalLivePreflight({ clientId: "id", clientSecret: "secret", makerPlanId: "same", proPlanId: "same", webhookId: "webhook", fetchImpl: fetch }), /must be different/);

  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "test-token" });
    if (url.endsWith("/v1/billing/plans/maker-live")) return Response.json(validPlan("maker-live", "10.00"));
    if (url.endsWith("/v1/billing/plans/pro-live")) return Response.json(validPlan("pro-live", "20.00"));
    return Response.json({ id: "webhook-live", url: "http://localhost/api/billing/paypal/webhook", event_types: [] });
  };
  await assert.rejects(runPayPalLivePreflight({ clientId: "id", clientSecret: "secret", makerPlanId: "maker-live", proPlanId: "pro-live", webhookId: "webhook-live", fetchImpl }), /must use HTTPS/);
});
