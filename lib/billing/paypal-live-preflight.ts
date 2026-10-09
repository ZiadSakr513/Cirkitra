export type PayPalLivePlan = {
  id?: unknown;
  status?: unknown;
  billing_cycles?: Array<{
    sequence?: unknown;
    tenure_type?: unknown;
    total_cycles?: unknown;
    frequency?: { interval_unit?: unknown; interval_count?: unknown };
    pricing_scheme?: { fixed_price?: { currency_code?: unknown; value?: unknown } };
  }>;
  payment_preferences?: { setup_fee?: { currency_code?: unknown; value?: unknown } };
};

export type PayPalLiveWebhook = {
  id?: unknown;
  url?: unknown;
  event_types?: Array<{ name?: unknown }>;
};

export type PayPalLivePreflightInput = {
  clientId: string;
  clientSecret: string;
  makerPlanId: string;
  proPlanId: string;
  webhookId: string;
  fetchImpl?: typeof fetch;
};

const API_BASE = "https://api-m.paypal.com";
export const PAYPAL_LIVE_WEBHOOK_PATH = "/api/billing/paypal/webhook";
export const REQUIRED_PAYPAL_WEBHOOK_EVENTS = [
  "BILLING.SUBSCRIPTION.CREATED",
  "BILLING.SUBSCRIPTION.ACTIVATED",
  "BILLING.SUBSCRIPTION.UPDATED",
  "BILLING.SUBSCRIPTION.CANCELLED",
  "BILLING.SUBSCRIPTION.SUSPENDED",
  "BILLING.SUBSCRIPTION.EXPIRED",
  "PAYMENT.SALE.COMPLETED",
  "PAYMENT.SALE.REFUNDED",
  "PAYMENT.SALE.REVERSED",
] as const;

function requireText(value: string, name: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function assertNoChargeableSetupFee(plan: PayPalLivePlan, label: string) {
  const setupFee = plan.payment_preferences?.setup_fee;
  if (setupFee && (setupFee.currency_code !== "USD" || Number(setupFee.value) !== 0)) {
    throw new Error(`${label} Live plan has a non-zero or non-USD setup fee.`);
  }
}

export function validatePayPalLivePlan(plan: PayPalLivePlan, planId: string, expectedUsdCents: number, label: string) {
  if (plan.id !== planId) throw new Error(`${label} Live plan ID did not match the configured value.`);
  if (plan.status !== "ACTIVE") throw new Error(`${label} Live plan is not ACTIVE.`);
  const cycles = plan.billing_cycles;
  if (!Array.isArray(cycles) || cycles.length !== 1) {
    throw new Error(`${label} Live plan must contain exactly one regular monthly billing cycle (no trial or extra cycle).`);
  }
  const cycle = cycles[0];
  if (cycle.tenure_type !== "REGULAR" || cycle.sequence !== 1 || cycle.total_cycles !== 0) {
    throw new Error(`${label} Live plan must be an unlimited regular billing cycle with no trial.`);
  }
  if (cycle.frequency?.interval_unit !== "MONTH" || cycle.frequency.interval_count !== 1) {
    throw new Error(`${label} Live plan must recur every one month.`);
  }
  const fixedPrice = cycle.pricing_scheme?.fixed_price;
  const actualCents = typeof fixedPrice?.value === "string" || typeof fixedPrice?.value === "number"
    ? Math.round(Number(fixedPrice.value) * 100)
    : Number.NaN;
  if (fixedPrice?.currency_code !== "USD" || !Number.isFinite(actualCents) || actualCents !== expectedUsdCents) {
    throw new Error(`${label} Live plan must be priced at the configured USD monthly amount.`);
  }
  assertNoChargeableSetupFee(plan, label);
}

function parseResponseJson<T>(value: unknown, label: string): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`PayPal returned an invalid ${label} response.`);
  return value as T;
}

async function getJson<T>(fetchImpl: typeof fetch, token: string, path: string, label: string): Promise<T> {
  const response = await fetchImpl(`${API_BASE}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`PayPal Live ${label} check failed (${response.status}).`);
  return parseResponseJson<T>(await response.json(), label);
}

function validatePayPalLiveWebhook(webhook: PayPalLiveWebhook, expectedWebhookId: string) {
  if (webhook.id !== expectedWebhookId) throw new Error("Live webhook ID did not match the configured value.");
  if (typeof webhook.url !== "string") throw new Error("Live webhook URL is missing.");
  let url: URL;
  try {
    url = new URL(webhook.url);
  } catch {
    throw new Error("Live webhook URL is invalid.");
  }
  if (url.protocol !== "https:" || url.pathname !== PAYPAL_LIVE_WEBHOOK_PATH || url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    throw new Error(`Live webhook must use HTTPS and end at ${PAYPAL_LIVE_WEBHOOK_PATH}.`);
  }
  const eventNames = new Set((webhook.event_types ?? []).map((event) => event.name).filter((name): name is string => typeof name === "string"));
  const missingEvents = REQUIRED_PAYPAL_WEBHOOK_EVENTS.filter((name) => !eventNames.has(name));
  if (missingEvents.length > 0) {
    throw new Error(`Live webhook is missing required events: ${missingEvents.join(", " )}.`);
  }
  return { id: expectedWebhookId, url: url.origin + url.pathname, eventCount: eventNames.size };
}

export async function runPayPalLivePreflight(input: PayPalLivePreflightInput) {
  const clientId = requireText(input.clientId, "PAYPAL_CLIENT_ID");
  const clientSecret = requireText(input.clientSecret, "PAYPAL_CLIENT_SECRET");
  const makerPlanId = requireText(input.makerPlanId, "PAYPAL_PLAN_ID");
  const proPlanId = requireText(input.proPlanId, "PAYPAL_PRO_PLAN_ID");
  const webhookId = requireText(input.webhookId, "PAYPAL_WEBHOOK_ID");
  if (makerPlanId === proPlanId) throw new Error("Maker and Pro Live plan IDs must be different.");

  const fetchImpl = input.fetchImpl ?? fetch;
  const tokenResponse = await fetchImpl(`${API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokenResponse.ok) throw new Error(`PayPal Live authentication failed (${tokenResponse.status}).`);
  const tokenBody = parseResponseJson<{ access_token?: unknown }>(await tokenResponse.json(), "authentication");
  if (typeof tokenBody.access_token !== "string" || !tokenBody.access_token) throw new Error("PayPal Live did not return an API access token.");

  const token = tokenBody.access_token;
  const [makerPlan, proPlan, webhook] = await Promise.all([
    getJson<PayPalLivePlan>(fetchImpl, token, `/v1/billing/plans/${encodeURIComponent(makerPlanId)}`, "Maker plan"),
    getJson<PayPalLivePlan>(fetchImpl, token, `/v1/billing/plans/${encodeURIComponent(proPlanId)}`, "Pro plan"),
    getJson<PayPalLiveWebhook>(fetchImpl, token, `/v1/notifications/webhooks/${encodeURIComponent(webhookId)}`, "webhook"),
  ]);

  validatePayPalLivePlan(makerPlan, makerPlanId, 1_000, "Maker");
  validatePayPalLivePlan(proPlan, proPlanId, 2_000, "Pro");
  const validatedWebhook = validatePayPalLiveWebhook(webhook, webhookId);
  return {
    environment: "live" as const,
    plans: [
      { plan: "maker" as const, status: "ACTIVE" as const, monthlyUsd: 10 },
      { plan: "pro" as const, status: "ACTIVE" as const, monthlyUsd: 20 },
    ],
    webhook: validatedWebhook,
  };
}
