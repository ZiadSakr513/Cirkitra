import type { PaidCirkitraPlanId } from "./plans";

export type PayPalPlanIdMap = Partial<Record<PaidCirkitraPlanId, string | null>>;

export function getConfiguredPayPalPlanId(planIds: PayPalPlanIdMap, planId: PaidCirkitraPlanId) {
  return planIds[planId] || null;
}

export function identifyCirkitraPlanId(planIds: PayPalPlanIdMap, paypalPlanId: unknown): PaidCirkitraPlanId | null {
  if (typeof paypalPlanId !== "string" || !paypalPlanId) return null;
  if (planIds.maker === paypalPlanId) return "maker";
  if (planIds.pro && planIds.pro === paypalPlanId) return "pro";
  return null;
}
