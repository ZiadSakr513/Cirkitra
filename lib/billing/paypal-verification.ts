export type PayPalPaymentDetails = {
  status?: string;
  billing_info?: {
    outstanding_balance?: { currency_code?: string; value?: string } | null;
    last_payment?: {
      amount?: { currency_code?: string; value?: string } | null;
      time?: string | null;
    } | null;
    next_billing_time?: string | null;
  };
};

function moneyToCents(value: string | undefined) {
  if (!value || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/**
 * Only return a paid period when PayPal's server API reports an active
 * subscription, a full USD payment, no outstanding balance, and a future
 * billing boundary. Browser approval alone is never enough to grant access.
 */
export function getVerifiedPayPalPaymentPeriod(
  details: PayPalPaymentDetails,
  expectedAmountUsdCents: number,
  now = Date.now(),
) {
  if (details.status?.toUpperCase() !== "ACTIVE") return null;

  const billing = details.billing_info;
  const amount = billing?.last_payment?.amount;
  const balance = billing?.outstanding_balance;
  const paidAt = billing?.last_payment?.time;
  const paidThrough = billing?.next_billing_time;
  const paidAtMs = paidAt ? Date.parse(paidAt) : NaN;
  const paidThroughMs = paidThrough ? Date.parse(paidThrough) : NaN;

  if (amount?.currency_code !== "USD" || moneyToCents(amount.value) !== expectedAmountUsdCents) return null;
  if (balance?.currency_code !== "USD" || moneyToCents(balance.value) !== 0) return null;
  if (!Number.isFinite(paidAtMs) || paidAtMs > now) return null;
  if (!Number.isFinite(paidThroughMs) || paidThroughMs <= now) return null;

  return {
    paidAt: new Date(paidAtMs).toISOString(),
    paidThrough: new Date(paidThroughMs).toISOString(),
  };
}
