import assert from "node:assert/strict";
import test from "node:test";

import { COMPONENT_CATALOG, simulationCapability } from "../lib/circuit/catalog.ts";
import { isBoardType } from "../lib/circuit/boards.ts";
import { selectGenerationComponents } from "../lib/circuit/discovery.ts";
import { CATALOG_RELIABILITY_30_CASES, CATALOG_RELIABILITY_30_SUITE_ID } from "./ai-generation-catalog-30-cases.ts";

test("catalog-reliability-30-v1 defines 30 distinct substantive fresh builds", () => {
  assert.equal(CATALOG_RELIABILITY_30_SUITE_ID, "catalog-reliability-30-v1");
  assert.equal(CATALOG_RELIABILITY_30_CASES.length, 30);
  assert.equal(new Set(CATALOG_RELIABILITY_30_CASES.map(testCase => testCase.id)).size, 30);
  assert.equal(new Set(CATALOG_RELIABILITY_30_CASES.map(testCase => testCase.prompt)).size, 30);
  for (const testCase of CATALOG_RELIABILITY_30_CASES) {
    assert.ok(testCase.prompt.length >= 180, `${testCase.id} must be a substantive prompt`);
    assert.notEqual(testCase.group, "edit", `${testCase.id} is a fresh build`);
    assert.doesNotMatch(testCase.prompt, /\b(?:edit|preserve every existing|current project)\b/i, `${testCase.id} must not require a pre-existing project`);
    assert.ok(testCase.expectedBoardTypes.length > 0, `${testCase.id} declares its board profile`);
    assert.ok(testCase.expectedBoardTypes.every(isBoardType), `${testCase.id} uses supported board profiles`);
    assert.equal(testCase.minimumBoards, testCase.expectedBoardTypes.length, `${testCase.id} board count`);
    assert.ok(testCase.requiredNets.length > 0, `${testCase.id} has concrete wiring expectations`);
    assert.ok(testCase.behavior.requiredSketchPatterns.length > 0, `${testCase.id} has a sketch contract`);
    for (const pattern of testCase.behavior.requiredSketchPatterns) assert.doesNotThrow(() => new RegExp(pattern, "i"));

    const discoverable = new Set(selectGenerationComponents(testCase.prompt, "simulation").map(part => part.id));
    for (const id of testCase.expectedComponentTypes) {
      assert.ok(COMPONENT_CATALOG[id], `${testCase.id}: ${id} exists in the catalog`);
      assert.notEqual(simulationCapability(COMPONENT_CATALOG[id]!), "unavailable", `${testCase.id}: ${id} is simulated`);
      assert.ok(discoverable.has(id), `${testCase.id}: ${id} is explicitly discoverable from the live prompt`);
    }
  }
});

test("catalog coverage is not satisfied by adding absent parts only to the expected-component list", () => {
  for (const testCase of CATALOG_RELIABILITY_30_CASES) {
    for (const type of testCase.supplementalComponentTypes) {
      assert.ok(testCase.prompt.toLowerCase().includes(COMPONENT_CATALOG[type]!.displayName.toLowerCase()), `${testCase.id}: ${type} must be named in its prompt`);
    }
  }
});
