import assert from "node:assert/strict";
import test from "node:test";

import { COMPONENT_CATALOG } from "../lib/circuit/catalog.ts";
import { REMAINING_COMPONENT_CASES, REMAINING_COMPONENT_SUITE_ID } from "./ai-generation-remaining-cases.ts";

const requiredTypes = [
  "74hc138", "74hc595", "a4988-stepper-driver", "arduino-nano-classic", "battery-cell",
  "bipolar-stepper-motor", "bmp280", "bq24074", "bq27441-g1", "bq76920", "cd74hc4051",
  "cd74hc4067", "dc-load", "dc-supply", "drv8833", "esp8266-nodemcu-v1", "ideal-mosfet",
  "l298", "logic-and", "logic-nand", "logic-nor", "logic-not", "logic-or", "logic-xor",
  "mcp23017", "mfrc522-rfid-module", "micro-sd-spi-module", "pir-sensor", "rfm95w", "rgb-led",
  "seven-segment", "sht31-dis", "tb6612fng", "tca9548a", "temperature-sensor", "xbee-s2c-zigbee-th",
].sort();

test("remaining-components-v1 targets all and only the 36 unobserved component types", () => {
  assert.equal(REMAINING_COMPONENT_SUITE_ID, "remaining-components-v1");
  assert.equal(REMAINING_COMPONENT_CASES.length, 20);

  const ids = REMAINING_COMPONENT_CASES.map(testCase => testCase.id);
  assert.equal(new Set(ids).size, ids.length, "case IDs must be unique");

  const targets = REMAINING_COMPONENT_CASES.flatMap(testCase => testCase.expectedComponentTypes);
  assert.equal(new Set(targets).size, 36, "target component IDs must be unique across the suite");
  assert.deepEqual([...new Set(targets)].sort(), requiredTypes);
  for (const type of requiredTypes) assert.ok(COMPONENT_CATALOG[type], `${type} must be in the simulated catalog`);

  for (const testCase of REMAINING_COMPONENT_CASES) {
    assert.ok(testCase.prompt.length >= 80, `${testCase.id} should be a real build request`);
    assert.equal(testCase.group, "component-coverage");
    assert.ok(testCase.minimumBoards >= 1);
    assert.ok(testCase.expectedComponentTypes.length > 0);
  }
  const l298Case = REMAINING_COMPONENT_CASES.find(testCase => testCase.id === "component-13-l298-battery");
  assert.ok(l298Case?.prompt.includes("regulated 5V rail") && l298Case.prompt.includes("positive isolated"), "the L298 scenario must keep its battery isolated and use a compatible driver supply");
});
