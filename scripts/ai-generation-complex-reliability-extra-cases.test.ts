import assert from "node:assert/strict";
import test from "node:test";

import { COMPONENT_CATALOG, getComponentDefinition } from "../lib/circuit/catalog.ts";
import { getBoardProfile, resolveBoardPin } from "../lib/circuit/boards.ts";
import { selectGenerationComponents } from "../lib/circuit/discovery.ts";
import { COMPONENT_EXPANSION_CASES } from "./ai-generation-component-expansion-cases.ts";
import { GREENHOUSE_PUMP_CASES } from "./ai-generation-greenhouse-pump-cases.ts";
import { REMAINING_COMPONENT_CASES } from "./ai-generation-remaining-cases.ts";
import { COMPLEX_RELIABILITY_CASES } from "./ai-generation-complex-reliability-cases.ts";
import { COMPLEX_RELIABILITY_EXTRA_CASES, COMPLEX_RELIABILITY_EXTRA_SUITE_ID } from "./ai-generation-complex-reliability-extra-cases.ts";

test("conditional complex reliability generalization suite has exactly 10 distinct new scenarios", () => {
  assert.equal(COMPLEX_RELIABILITY_EXTRA_SUITE_ID, "complex-reliability-extra-10-v1");
  assert.equal(COMPLEX_RELIABILITY_EXTRA_CASES.length, 10);
  assert.equal(new Set(COMPLEX_RELIABILITY_EXTRA_CASES.map(testCase => testCase.id)).size, 10);
  assert.equal(new Set(COMPLEX_RELIABILITY_EXTRA_CASES.map(testCase => testCase.prompt)).size, 10);
  const otherPrompts = [
    ...COMPLEX_RELIABILITY_CASES,
    ...COMPONENT_EXPANSION_CASES,
    ...GREENHOUSE_PUMP_CASES,
    ...REMAINING_COMPONENT_CASES,
  ].map(testCase => normalize(testCase.prompt));
  for (const testCase of COMPLEX_RELIABILITY_EXTRA_CASES) {
    assert.ok(!otherPrompts.includes(normalize(testCase.prompt)), `${testCase.id} duplicates an existing live scenario`);
    assert.ok(testCase.prompt.length > 180, `${testCase.id} must remain a complex prompt`);
  }
});

test("each conditional generalization case defines boards, expected hardware, checked nets and observable behavior", () => {
  for (const testCase of COMPLEX_RELIABILITY_EXTRA_CASES) {
    assert.ok(testCase.expectedBoardTypes.length > 0, `${testCase.id} expected boards`);
    assert.equal(testCase.minimumBoards, testCase.expectedBoardTypes.length, `${testCase.id} board count`);
    assert.ok(testCase.expectedComponentTypes.length >= 2, `${testCase.id} expected hardware`);
    assert.ok(testCase.requiredNets.length >= 2, `${testCase.id} required physical wiring`);
    assert.ok(testCase.behavior.description.length > 15, `${testCase.id} visible outcome`);
    assert.ok(testCase.behavior.requiredSketchPatterns.length, `${testCase.id} code contract`);

    const inheritedTypes = new Set(testCase.baseCaseId
      ? COMPLEX_RELIABILITY_EXTRA_CASES.find(base => base.id === testCase.baseCaseId)?.expectedComponentTypes ?? []
      : []);
    const discoverable = new Set(selectGenerationComponents(testCase.prompt, "simulation", [...inheritedTypes]).map(part => part.id));
    for (const type of testCase.expectedComponentTypes) {
      assert.ok(COMPONENT_CATALOG[type], `${testCase.id}: catalog entry ${type}`);
      if (!inheritedTypes.has(type)) assert.ok(discoverable.has(type), `${testCase.id}: requested component ${type} is discoverable`);
    }
    for (const boardType of testCase.expectedBoardTypes) {
      assert.ok(getBoardProfile(boardType), `${testCase.id}: board profile ${boardType}`);
      assert.ok(testCase.expectedComponentTypes.includes(boardType), `${testCase.id}: board is part of expected hardware`);
    }
    for (const net of testCase.requiredNets) for (const endpoint of net) {
      assert.ok(testCase.expectedComponentTypes.includes(endpoint.componentType), `${testCase.id}: net part ${endpoint.componentType} expected`);
      for (const pin of endpoint.pins) {
        if (getBoardProfile(endpoint.componentType)) {
          const profile = getBoardProfile(endpoint.componentType)!;
          const railOrGround = Object.hasOwn(profile.rails, pin) || profile.groundPins.includes(pin);
          const catalogPin = getComponentDefinition(endpoint.componentType)?.pins.find(candidate => candidate.id === pin);
          assert.ok(railOrGround || resolveBoardPin(endpoint.componentType, pin) !== undefined || (catalogPin && !catalogPin.noConnect), `${testCase.id}: valid board pin ${pin}`);
        } else {
          assert.ok(getComponentDefinition(endpoint.componentType)?.pins.some(candidate => candidate.id === pin), `${testCase.id}: valid component pin ${endpoint.componentType}.${pin}`);
        }
      }
    }
  }
});

test("conditional edits follow their base builds and preserve the base hardware", () => {
  const indexById = new Map(COMPLEX_RELIABILITY_EXTRA_CASES.map((testCase, index) => [testCase.id, index]));
  const byId = new Map(COMPLEX_RELIABILITY_EXTRA_CASES.map(testCase => [testCase.id, testCase]));
  const edits = COMPLEX_RELIABILITY_EXTRA_CASES.filter(testCase => testCase.group === "edit");
  assert.equal(edits.length, 2);
  for (const edit of edits) {
    assert.ok(edit.baseCaseId, `${edit.id} must name a suite-local base`);
    const baseIndex = indexById.get(edit.baseCaseId!);
    assert.notEqual(baseIndex, undefined, `${edit.id} base exists`);
    assert.ok(baseIndex! < indexById.get(edit.id)!, `${edit.id} follows its base`);
    for (const type of byId.get(edit.baseCaseId!)!.expectedComponentTypes) {
      assert.ok(edit.expectedComponentTypes.includes(type), `${edit.id} must preserve ${type}`);
    }
    assert.match(edit.prompt, /preserve|keep|retain/i);
  }
});

function normalize(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
