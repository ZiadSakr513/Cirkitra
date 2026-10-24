import assert from "node:assert/strict";
import test from "node:test";

import { COMPONENT_CATALOG, getComponentDefinition } from "../lib/circuit/catalog.ts";
import { getBoardProfile, resolveBoardPin } from "../lib/circuit/boards.ts";
import { selectGenerationComponents } from "../lib/circuit/discovery.ts";
import { COMPONENT_EXPANSION_CASES } from "./ai-generation-component-expansion-cases.ts";
import { GREENHOUSE_PUMP_CASES } from "./ai-generation-greenhouse-pump-cases.ts";
import { REMAINING_COMPONENT_CASES } from "./ai-generation-remaining-cases.ts";
import { COMPLEX_RELIABILITY_CASES, COMPLEX_RELIABILITY_SUITE_ID } from "./ai-generation-complex-reliability-cases.ts";

test("complex-reliability-30-v1 has exactly the requested distinct scenario mix", () => {
  assert.equal(COMPLEX_RELIABILITY_SUITE_ID, "complex-reliability-30-v1");
  assert.equal(COMPLEX_RELIABILITY_CASES.length, 30);
  assert.equal(new Set(COMPLEX_RELIABILITY_CASES.map(testCase => testCase.id)).size, 30);
  assert.equal(new Set(COMPLEX_RELIABILITY_CASES.map(testCase => testCase.prompt)).size, 30);

  const categories = Object.groupBy(COMPLEX_RELIABILITY_CASES, testCase => testCase.category);
  assert.equal(categories["sensor-control"]?.length, 8);
  assert.equal(categories["robotics-motion"]?.length, 6);
  assert.equal(categories["multi-board"]?.length, 5);
  assert.equal(categories["circuit-preserving-edit"]?.length, 5);
  assert.equal(categories["power-bus-display"]?.length, 6);

  const olderPrompts = [
    ...COMPONENT_EXPANSION_CASES,
    ...GREENHOUSE_PUMP_CASES,
    ...REMAINING_COMPONENT_CASES,
  ].map(testCase => normalize(testCase.prompt));
  for (const testCase of COMPLEX_RELIABILITY_CASES) {
    assert.ok(!olderPrompts.includes(normalize(testCase.prompt)), `${testCase.id} duplicates a prompt from an existing suite`);
  }
});

test("every complex prompt declares discoverable hardware, physical nets, boards and observable behavior", () => {
  for (const testCase of COMPLEX_RELIABILITY_CASES) {
    assert.ok(testCase.prompt.length >= 180, `${testCase.id} should be a substantive prompt`);
    assert.ok(testCase.expectedBoardTypes.length > 0, `${testCase.id} must explicitly name expected boards`);
    assert.equal(testCase.minimumBoards, testCase.expectedBoardTypes.length, `${testCase.id} board count`);
    assert.ok(testCase.expectedComponentTypes.length >= 3, `${testCase.id} expected hardware`);
    assert.ok(testCase.requiredNets.length >= 2, `${testCase.id} required wiring`);
    assert.ok(testCase.behavior.description.length > 15, `${testCase.id} observable behavior`);
    assert.ok(testCase.behavior.requiredSketchPatterns.length > 0, `${testCase.id} behavior code contract`);
    for (const pattern of testCase.behavior.requiredSketchPatterns) {
      assert.doesNotThrow(() => new RegExp(pattern, "i"), `${testCase.id} contains a valid behavior regex: ${pattern}`);
    }

    const inheritedTypes = testCase.baseCaseId
      ? new Set(COMPLEX_RELIABILITY_CASES.find(base => base.id === testCase.baseCaseId)?.expectedComponentTypes ?? [])
      : new Set<string>();
    const discoverable = new Set(selectGenerationComponents(testCase.prompt, "simulation", [...inheritedTypes]).map(part => part.id));
    for (const type of testCase.expectedComponentTypes) {
      assert.ok(COMPONENT_CATALOG[type], `${testCase.id}: ${type} exists in the shared catalog`);
      if (!inheritedTypes.has(type)) assert.ok(discoverable.has(type), `${testCase.id}: added part ${type} is discoverable from its prompt`);
    }
    for (const boardType of testCase.expectedBoardTypes) {
      assert.ok(getBoardProfile(boardType), `${testCase.id}: ${boardType} has a board profile`);
      assert.ok(testCase.expectedComponentTypes.includes(boardType), `${testCase.id}: board must be in expected hardware`);
    }

    for (const net of testCase.requiredNets) {
      assert.ok(net.length >= 2, `${testCase.id}: a required net needs at least two endpoints`);
      for (const endpoint of net) {
        assert.ok(testCase.expectedComponentTypes.includes(endpoint.componentType), `${testCase.id}: ${endpoint.componentType} must be expected hardware`);
        assert.ok(endpoint.pins.length > 0, `${testCase.id}: ${endpoint.componentType} needs a concrete pin expectation`);
        if (endpoint.labelIncludes !== undefined) assert.ok(endpoint.labelIncludes.trim().length > 0, `${testCase.id}: labelIncludes must be nonempty`);
        for (const pin of endpoint.pins) {
          if (getBoardProfile(endpoint.componentType)) {
            const profile = getBoardProfile(endpoint.componentType)!;
            const isRailOrGround = Object.keys(profile.rails).includes(pin) || profile.groundPins.includes(pin);
            const boardPin = getComponentDefinition(endpoint.componentType)?.pins.find(componentPin => componentPin.id === pin);
            assert.ok(isRailOrGround || resolveBoardPin(endpoint.componentType, pin) !== undefined || (boardPin && !boardPin.noConnect), `${testCase.id}: ${endpoint.componentType}.${pin} must be a valid profile pin`);
          } else {
            const definition = getComponentDefinition(endpoint.componentType);
            assert.ok(definition?.pins.some(componentPin => componentPin.id === pin), `${testCase.id}: ${endpoint.componentType}.${pin} must be a catalog pin`);
          }
        }
      }
    }
  }
});

test("edit scenarios are ordered after and preserve the declared base-build hardware", () => {
  const indexById = new Map(COMPLEX_RELIABILITY_CASES.map((testCase, index) => [testCase.id, index]));
  const byId = new Map(COMPLEX_RELIABILITY_CASES.map(testCase => [testCase.id, testCase]));
  const edits = COMPLEX_RELIABILITY_CASES.filter(testCase => testCase.category === "circuit-preserving-edit");
  assert.equal(edits.length, 5);
  for (const edit of edits) {
    assert.equal(edit.group, "edit", `${edit.id} must use the edit generation mode`);
    assert.ok(edit.baseCaseId, `${edit.id} must identify a base build`);
    const baseIndex = indexById.get(edit.baseCaseId!);
    assert.notEqual(baseIndex, undefined, `${edit.id} base build exists`);
    assert.ok(baseIndex! < indexById.get(edit.id)!, `${edit.id} follows its base build`);
    const base = byId.get(edit.baseCaseId!)!;
    for (const type of base.expectedComponentTypes) {
      assert.ok(edit.expectedComponentTypes.includes(type), `${edit.id} must retain base component ${type}`);
    }
    assert.match(edit.prompt, /preserve|without replacing/i, `${edit.id} must explicitly require preservation`);
  }
});

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
