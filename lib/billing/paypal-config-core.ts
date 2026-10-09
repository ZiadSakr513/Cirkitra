import type { PaidCirkitraPlanId } from "./plans";

export type PayPalEnvironment = "sandbox" | "live";

export type PayPalConfigValues = {
  environment: PayPalEnvironment;
  clientId: string;
  clientSecret: string;
  planIds: Record<PaidCirkitraPlanId, string | null>;
  webhookId: string;
  apiAccessConfirmed: boolean;
  checkoutEnabled: boolean;
};

export function readPayPalEnvironment(values: Record<string, string | undefined>): PayPalEnvironment | null {
  const configuredEnvironment = values.PAYPAL_ENV?.trim().toLowerCase();
  if (!configuredEnvironment) {
    if (values.VERCEL_ENV === undefined || values.VERCEL_ENV === "preview" || values.VERCEL_ENV === "development") return "sandbox";
    return null;
  }
  const environment = configuredEnvironment;
  if (environment !== "sandbox" && environment !== "live") return null;
  if (environment === "sandbox" && values.VERCEL_ENV === "production") return null;
  return environment;
}

export function resolvePayPalConfigValues(values: Record<string, string | undefined>): PayPalConfigValues | null {
  const environment = readPayPalEnvironment(values);
  if (!environment) return null;

  const clientId = values.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = values.PAYPAL_CLIENT_SECRET?.trim();
  const makerPlanId = values.PAYPAL_PLAN_ID?.trim();
  const proPlanIdValue = values.PAYPAL_PRO_PLAN_ID?.trim();
  const webhookId = values.PAYPAL_WEBHOOK_ID?.trim();
  if (!clientId || !clientSecret || !makerPlanId || !webhookId) return null;

  const proPlanId = proPlanIdValue && proPlanIdValue !== makerPlanId ? proPlanIdValue : null;
  const apiAccessConfirmed = values.CIRKITRA_PAYPAL_API_ACCESS_CONFIRMED?.trim().toLowerCase() === "true";
  const enabled = values.CIRKITRA_PAYPAL_ENABLED?.trim().toLowerCase() === "true";
  const liveBillingConfirmed = values.CIRKITRA_PAYPAL_LIVE_BILLING_CONFIRMED?.trim().toLowerCase() === "true";
  const liveEnvironmentAllowed = environment === "sandbox" || (
    values.VERCEL_ENV === "production"
    && values.NODE_ENV === "production"
    && Boolean(proPlanId)
    && liveBillingConfirmed
  );

  return {
    environment,
    clientId,
    clientSecret,
    planIds: { maker: makerPlanId, pro: proPlanId },
    webhookId,
    apiAccessConfirmed,
    checkoutEnabled: enabled && apiAccessConfirmed && liveEnvironmentAllowed,
  };
}
