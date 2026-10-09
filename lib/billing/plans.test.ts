import assert from "node:assert/strict";
import test from "node:test";

import { CIRKITRA_PLANS, formatMonthlyPrice } from "./plans.ts";
import { isHigherCirkitraPlan, resolveEffectiveCirkitraPlan } from "./plan-entitlement.ts";

test("Free, Maker, and Pro allowances and USD prices are explicit", () => {
  assert.equal(CIRKITRA_PLANS.free.priceUsdCents, 0);
  assert.equal(CIRKITRA_PLANS.free.monthlyAiRequests, 5);
  assert.equal(CIRKITRA_PLANS.maker.priceUsdCents, 1000);
  assert.equal(CIRKITRA_PLANS.maker.monthlyAiRequests, 50);
  assert.equal(CIRKITRA_PLANS.pro.priceUsdCents, 2000);
  assert.equal(CIRKITRA_PLANS.pro.monthlyAiRequests, 200);
  assert.equal(formatMonthlyPrice(CIRKITRA_PLANS.maker.priceUsdCents), "$10");
  assert.equal(formatMonthlyPrice(CIRKITRA_PLANS.pro.priceUsdCents), "$20");
  assert.equal(formatMonthlyPrice(599), "$5.99");
});

test("complimentary access raises but never lowers valid paid access", () => {
  assert.equal(resolveEffectiveCirkitraPlan("free", "maker"), "maker");
  assert.equal(resolveEffectiveCirkitraPlan("free", "pro"), "pro");
  assert.equal(resolveEffectiveCirkitraPlan("maker", "pro"), "pro");
  assert.equal(resolveEffectiveCirkitraPlan("pro", "maker"), "pro");
  assert.equal(resolveEffectiveCirkitraPlan("maker", null), "maker");
  assert.equal(resolveEffectiveCirkitraPlan("free", null), "free");
  assert.equal(isHigherCirkitraPlan("pro", "maker"), true);
  assert.equal(isHigherCirkitraPlan("maker", "pro"), false);
});
