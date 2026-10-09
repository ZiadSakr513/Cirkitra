import "server-only";

import type { PaidCirkitraPlanId } from "./plans";
import { readPayPalEnvironment, resolvePayPalConfigValues, type PayPalEnvironment } from "./paypal-config-core";

export type { PayPalEnvironment } from "./paypal-config-core";

export type PayPalServerConfig = {
  environment: PayPalEnvironment;
  clientId: string;
  clientSecret: string;
  planIds: Record<PaidCirkitraPlanId, string | null>;
  webhookId: string;
  apiAccessConfirmed: boolean;
  checkoutEnabled: boolean;
};

export type PayPalPublicConfig = {
  environment: PayPalEnvironment;
  clientId: string;
  planIds: Record<PaidCirkitraPlanId, string | null>;
};

export function getPayPalServerConfig(): PayPalServerConfig | null {
  return resolvePayPalConfigValues(process.env);
}

export function getPayPalEnvironment(): PayPalEnvironment | null {
  return readPayPalEnvironment(process.env);
}

export function getPayPalPublicConfig(): PayPalPublicConfig | null {
  const config = getPayPalServerConfig();
  if (!config?.checkoutEnabled) return null;
  return { environment: config.environment, clientId: config.clientId, planIds: config.planIds };
}

export function isPayPalCheckoutEnabled() {
  return Boolean(getPayPalPublicConfig());
}
