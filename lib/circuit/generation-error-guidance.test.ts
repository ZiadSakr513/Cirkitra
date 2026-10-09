import assert from "node:assert/strict";
import test from "node:test";

import { generationFailureNextStep } from "./generation-error-guidance.ts";

test("generation failure guidance recommends retrying transient provider failures", () => {
  assert.match(generationFailureNextStep("AI_UNAVAILABLE", ["Gemini timed out"]), /wait briefly, then retry/i);
  assert.match(generationFailureNextStep("AI_UNAVAILABLE", ["Gemini timed out"]), /circuit was left unchanged/i);
});

test("generation failure guidance turns wiring diagnostics into a concrete prompt action", () => {
  const nextStep = generationFailureNextStep("AI_VALIDATION_FAILED", ["l298.VS is missing a valid supply connection"]);
  assert.match(nextStep, /exact component IDs, pin names, and power\/ground connections/i);
});

test("generation failure guidance suggests simplifying invalid code behavior", () => {
  const nextStep = generationFailureNextStep("AI_VALIDATION_FAILED", ["project.code uses an unsupported call"]);
  assert.match(nextStep, /one behavior/i);
  assert.match(nextStep, /wired input.*control.*output/i);
});

test("generation failure guidance gives a useful fallback for unclassified errors", () => {
  assert.match(generationFailureNextStep(undefined, []), /open the diagnostics/i);
});
