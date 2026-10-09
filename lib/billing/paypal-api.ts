import "server-only";

import type { PayPalServerConfig } from "./paypal-config";

export type PayPalSubscriptionDetails = {
  id?: string;
  status?: string;
  plan_id?: string;
  custom_id?: string;
  status_update_time?: string;
  update_time?: string;
  billing_info?: {
    outstanding_balance?: { currency_code?: string; value?: string } | null;
    last_payment?: {
      amount?: { currency_code?: string; value?: string } | null;
      time?: string | null;
    } | null;
    next_billing_time?: string | null;
  };
};

function apiBase(config: PayPalServerConfig) {
  return config.environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

export async function getPayPalAccessToken(config: PayPalServerConfig): Promise<string> {
  const response = await fetch(`${apiBase(config)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`PayPal authentication failed (${response.status}).`);
  const body = await response.json() as { access_token?: unknown };
  if (typeof body.access_token !== "string" || !body.access_token) throw new Error("PayPal did not return an API access token.");
  return body.access_token;
}

async function payPalRequest<T>(config: PayPalServerConfig, token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase(config)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: init?.signal ?? AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`PayPal API request failed (${response.status}).`);
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

export async function getPayPalSubscription(config: PayPalServerConfig, subscriptionId: string) {
  const token = await getPayPalAccessToken(config);
  return payPalRequest<PayPalSubscriptionDetails>(config, token, `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

export async function cancelPayPalSubscription(config: PayPalServerConfig, subscriptionId: string) {
  const token = await getPayPalAccessToken(config);
  await payPalRequest<void>(config, token, `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason: "Cancelled by the subscriber in Cirkitra." }),
  });
}

export async function verifyPayPalWebhook(
  config: PayPalServerConfig,
  request: Request,
  event: unknown,
): Promise<boolean> {
  const transmissionId = request.headers.get("paypal-transmission-id");
  const transmissionTime = request.headers.get("paypal-transmission-time");
  const certUrl = request.headers.get("paypal-cert-url");
  const authAlgo = request.headers.get("paypal-auth-algo");
  const transmissionSig = request.headers.get("paypal-transmission-sig");
  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) return false;

  const token = await getPayPalAccessToken(config);
  const result = await payPalRequest<{ verification_status?: string }>(config, token, "/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: JSON.stringify({
      auth_algo: authAlgo,
      cert_url: certUrl,
      transmission_id: transmissionId,
      transmission_sig: transmissionSig,
      transmission_time: transmissionTime,
      webhook_id: config.webhookId,
      webhook_event: event,
    }),
  });
  return result.verification_status === "SUCCESS";
}
