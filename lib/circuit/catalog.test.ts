import assert from "node:assert/strict";
import test from "node:test";

import { COMPONENT_CATALOG, getPinDefinition } from "./catalog.ts";
import { createDefaultBlinkProject } from "./default-project.ts";
import { diagnoseCircuit } from "./diagnostics.ts";

const COMPLETE_UNO_R3_PINS = [
  "IOREF", "RESET", "3V3", "5V", "GND", "GND2", "GND3", "VIN",
  ...Array.from({ length: 14 }, (_, index) => `D${index}`),
  ...Array.from({ length: 6 }, (_, index) => `A${index}`),
  "AREF", "SDA", "SCL",
];

test("Arduino Uno exposes the complete R3 header set", () => {
  const actual = new Set(COMPONENT_CATALOG["arduino-uno"].pins.map((pin) => pin.id));
  assert.equal(actual.size, COMPLETE_UNO_R3_PINS.length);
  for (const pin of COMPLETE_UNO_R3_PINS) assert.ok(actual.has(pin), `missing ${pin}`);
});

test("new Uno R3 pins are accepted by catalog diagnostics", () => {
  for (const pin of ["IOREF", "GND3", "SDA", "SCL"]) {
    assert.ok(getPinDefinition("arduino-uno", pin));
    const project = createDefaultBlinkProject();
    project.connections[0] = {
      ...project.connections[0],
      from: { componentId: "uno", pin },
    };
    assert.equal(
      diagnoseCircuit(project).some((diagnostic) => diagnostic.code === "unknown-pin"),
      false,
    );
  }
});

test("Ground is a simulated one-pin catalog component", () => {
  assert.equal(COMPONENT_CATALOG.ground.simulated, true);
  assert.deepEqual(COMPONENT_CATALOG.ground.pins.map((pin) => pin.id), ["GND"]);
  assert.deepEqual(COMPONENT_CATALOG.ground.pins[0].signals, ["ground"]);
});
