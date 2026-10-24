import assert from "node:assert/strict";
import test from "node:test";

import { GREENHOUSE_PUMP_CASES, GREENHOUSE_PUMP_SUITE_ID } from "./ai-generation-greenhouse-pump-cases.ts";

test("greenhouse live suite keeps eight distinct prompt scenarios and explicit verification coverage", () => {
  assert.equal(GREENHOUSE_PUMP_SUITE_ID, "greenhouse-pump-v1");
  assert.equal(GREENHOUSE_PUMP_CASES.length, 8);
  assert.equal(new Set(GREENHOUSE_PUMP_CASES.map(testCase => testCase.id)).size, 8);
  assert.equal(new Set(GREENHOUSE_PUMP_CASES.map(testCase => testCase.prompt)).size, 8);
  assert.deepEqual(new Set(GREENHOUSE_PUMP_CASES.map(testCase => testCase.verification)), new Set([
    "greenhouse", "pump-continuous", "pump-toggle", "pump-dry-default", "pump-dry-explicit", "pump-hold", "esp32-pump", "pixel-buffer",
  ]));
  for (const testCase of GREENHOUSE_PUMP_CASES) {
    assert.equal(testCase.group, "single-board", testCase.id);
    assert.equal(testCase.minimumBoards, 1, testCase.id);
    assert.ok(testCase.expectedComponentTypes.length > 0, testCase.id);
    assert.match(testCase.prompt, /R385|R385-water-pump|WS2812B|NeoPixel/i, testCase.id);
  }
  const requiredTypes = new Set(GREENHOUSE_PUMP_CASES.flatMap(testCase => testCase.expectedComponentTypes));
  for (const type of ["r385-water-pump", "relay-module-1ch-active-low", "dc-supply", "soil-moisture-sen0193", "esp32-devkit-v1-30pin", "esp32-nodemcu-32s", "sn74ahct1g125"]) {
    assert.ok(requiredTypes.has(type), `live suite must check ${type}`);
  }
});
