import assert from "node:assert/strict";
import test from "node:test";

import { getConfiguredPayPalPlanId, identifyCirkitraPlanId } from "./paypal-plan-mapping.ts";

test("Maker remains configured when the optional Pro Sandbox plan is missing", () => {
  const planIds = { maker: "P-MAKER", pro: null };
  assert.equal(getConfiguredPayPalPlanId(planIds, "maker"), "P-MAKER");
  assert.equal(getConfiguredPayPalPlanId(planIds, "pro"), null);
  assert.equal(identifyCirkitraPlanId(planIds, "P-MAKER"), "maker");
  assert.equal(identifyCirkitraPlanId(planIds, "P-PRO"), null);
});

test("PayPal plan identity maps only explicitly configured plan IDs", () => {
  const planIds = { maker: "P-MAKER", pro: "P-PRO" };
  assert.equal(identifyCirkitraPlanId(planIds, "P-MAKER"), "maker");
  assert.equal(identifyCirkitraPlanId(planIds, "P-PRO"), "pro");
  assert.equal(identifyCirkitraPlanId(planIds, "P-OTHER"), null);
  assert.equal(identifyCirkitraPlanId(planIds, null), null);
});
