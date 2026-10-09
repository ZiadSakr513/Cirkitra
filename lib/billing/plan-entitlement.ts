import type { CirkitraPlanId } from "./plans";

const PLAN_RANK: Record<CirkitraPlanId, number> = {
  free: 0,
  maker: 1,
  pro: 2,
};

export function isHigherCirkitraPlan(left: CirkitraPlanId, right: CirkitraPlanId) {
  return PLAN_RANK[left] > PLAN_RANK[right];
}

/** Complimentary access can raise, but never lower, a valid paid entitlement. */
export function resolveEffectiveCirkitraPlan(
  paypalPlanId: CirkitraPlanId,
  grantPlanId: CirkitraPlanId | null,
): CirkitraPlanId {
  if (!grantPlanId || !isHigherCirkitraPlan(grantPlanId, paypalPlanId)) return paypalPlanId;
  return grantPlanId;
}
