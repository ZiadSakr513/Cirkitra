import assert from "node:assert/strict";
import test from "node:test";
import { COMPONENT_CATALOG } from "../lib/circuit/catalog.ts";
import { getBoardProfile } from "../lib/circuit/boards.ts";
import { selectGenerationComponents } from "../lib/circuit/discovery.ts";
import { SCREENSHOT_PART_IDS } from "../lib/circuit/screenshot-components.ts";
import { COMPONENT_EXPANSION_CASES, COMPONENT_EXPANSION_SUITE_ID } from "./ai-generation-component-expansion-cases.ts";

test("component-expansion-v1 runs 38 live prompts and covers every screenshot component and new board profile", () => {
  assert.equal(COMPONENT_EXPANSION_SUITE_ID, "component-expansion-v1");
  assert.equal(COMPONENT_EXPANSION_CASES.length, 38);
  const ids = COMPONENT_EXPANSION_CASES.map(testCase => testCase.id);
  assert.equal(new Set(ids).size, ids.length);
  const covered = new Set<string>(COMPONENT_EXPANSION_CASES.flatMap(testCase => testCase.expectedComponentTypes));
  for (const board of ["esp32-nodemcu-32s", "esp32-devkit-v1-30pin", "xiao-esp32s3-sense", "freenove-esp32s3-wroom"]) {
    assert.ok(getBoardProfile(board), `${board} has a board profile`);
    assert.ok(covered.has(board), `${board} is covered by live generation`);
  }
  for (const type of SCREENSHOT_PART_IDS) assert.ok(covered.has(type), `${type} is covered by live generation`);
  for (const type of covered) assert.ok(COMPONENT_CATALOG[type], `${type} is in the shared component catalog`);
  for (const testCase of COMPONENT_EXPANSION_CASES) {
    assert.ok(testCase.prompt.length >= 100, `${testCase.id} exercises a real prompt`);
    assert.ok(testCase.expectedComponentTypes.length >= 2, `${testCase.id} asserts meaningful component coverage`);
    const discoverable = new Set(selectGenerationComponents(testCase.prompt, "simulation").map(part => part.id));
    for (const expected of testCase.expectedComponentTypes) {
      assert.ok(discoverable.has(expected), `${testCase.id} must expose ${expected} to generation`);
    }
  }
});
