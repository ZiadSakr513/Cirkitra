import assert from "node:assert/strict";
import test from "node:test";

import type { CircuitProject } from "../lib/circuit/types.ts";
import { hasForwardAndReverseStepperMotion, hasOppositeSignedStepperMotion, hasVisiblePixelsAcrossSnapshots, verifyRequiredNets } from "./ai-generation-stress-assertions.ts";
import type { ComplexPinExpectation } from "./ai-generation-complex-reliability-cases.ts";

test("required-net verifier treats a board's separate ground header pads as internally bonded", () => {
  const project = projectWith(
    [{ id: "uno", type: "arduino-uno" }, { id: "dht", type: "dht11" }, { id: "oled", type: "ssd1306-oled-128x64" }],
    [
      wire("dht-ground", "dht", "GND", "uno", "GND"),
      wire("oled-ground", "oled", "GND", "uno", "GND2"),
    ],
  );
  const requirement: ComplexPinExpectation[] = [
    { componentType: "arduino-uno", pins: ["GND", "GND2"] },
    { componentType: "dht11", pins: ["GND"] },
    { componentType: "ssd1306-oled-128x64", pins: ["GND"] },
  ];
  assert.equal(verifyRequiredNets(project, [requirement]), undefined);
});

test("required-net verifier does not silently join grounds belonging to separate boards", () => {
  const project = projectWith(
    [{ id: "uno", type: "arduino-uno" }, { id: "esp", type: "esp32-devkit-v1-30pin" }, { id: "dht", type: "dht11" }, { id: "oled", type: "ssd1306-oled-128x64" }],
    [
      wire("uno-ground", "dht", "GND", "uno", "GND"),
      wire("esp-ground", "oled", "GND", "esp", "GND"),
    ],
  );
  const requirement: ComplexPinExpectation[] = [
    { componentType: "arduino-uno", pins: ["GND"] },
    { componentType: "esp32-devkit-v1-30pin", pins: ["GND"] },
  ];
  assert.match(verifyRequiredNets(project, [requirement]) ?? "", /does not join/);
});

test("required-net verifier accepts a package's duplicated physical terminal pad", () => {
  const project = projectWith(
    [{ id: "driver", type: "tb6612fng" }, { id: "motor", type: "dc-motor" }],
    [wire("bo1", "driver", "BO1_12", "motor", "+")],
  );
  assert.equal(verifyRequiredNets(project, [[
    { componentType: "tb6612fng", pins: ["BO1_11"] },
    { componentType: "dc-motor", pins: ["+"] },
  ]]), undefined);
});

test("required-net verifier resolves board aliases and ground-symbol references", () => {
  const project = projectWith(
    [
      { id: "xiao", type: "xiao-esp32s3-sense" },
      { id: "sensor", type: "scd41-co2-sensor" },
      { id: "board-ground", type: "ground" },
      { id: "sensor-ground", type: "ground" },
    ],
    [
      wire("sda", "xiao", "D4", "sensor", "SDA"),
      wire("board-ref", "xiao", "GND", "board-ground", "GND"),
      wire("sensor-ref", "sensor", "GND", "sensor-ground", "GND"),
    ],
  );
  assert.equal(verifyRequiredNets(project, [[
    { componentType: "xiao-esp32s3-sense", pins: ["GPIO5"] },
    { componentType: "scd41-co2-sensor", pins: ["SDA"] },
  ]]), undefined);
  assert.equal(verifyRequiredNets(project, [[
    { componentType: "xiao-esp32s3-sense", pins: ["GND"] },
    { componentType: "scd41-co2-sensor", pins: ["GND"] },
  ]]), undefined);
});

test("required-net verifier accepts any explicitly compatible board power rail for a module", () => {
  const project = projectWith(
    [
      { id: "uno", type: "arduino-uno" },
      { id: "sensor", type: "dht22" },
      { id: "oled", type: "ssd1306-oled-128x64" },
    ],
    [
      wire("sensor-power", "uno", "5V", "sensor", "VDD"),
      wire("display-power", "uno", "3V3", "oled", "VCC"),
    ],
  );
  assert.equal(verifyRequiredNets(project, [
    [{ componentType: "arduino-uno", pins: ["5V"] }, { componentType: "dht22", pins: ["VDD"] }],
    [{ componentType: "arduino-uno", pins: ["5V", "3V3"] }, { componentType: "ssd1306-oled-128x64", pins: ["VCC"] }],
  ]), undefined);
});

test("required-net verifier selects the intended repeated component by label", () => {
  const project = projectWith(
    [
      { id: "xiao", type: "xiao-esp32s3-sense" },
      { id: "pullup-sda", type: "resistor" },
      { id: "pullup-scl", type: "resistor" },
      { id: "led-limiter", type: "resistor" },
      { id: "led", type: "led" },
    ],
    [
      wire("led-pin", "xiao", "D2", "led-limiter", "1"),
      wire("led-anode", "led-limiter", "2", "led", "A"),
    ],
  );
  project.components.find(component => component.id === "pullup-sda")!.label = "SDA Pull-up";
  project.components.find(component => component.id === "pullup-scl")!.label = "SCL Pull-up";
  project.components.find(component => component.id === "led-limiter")!.label = "Amber LED Resistor";
  assert.equal(verifyRequiredNets(project, [[
    { componentType: "xiao-esp32s3-sense", pins: ["D2"] },
    { componentType: "resistor", labelIncludes: "LED", pins: ["1"] },
  ], [
    { componentType: "resistor", labelIncludes: "LED", pins: ["2"] },
    { componentType: "led", pins: ["A"] },
  ]]), undefined);
});

test("behavior evidence includes transient lit pixels even when the final frame is dark", () => {
  const snapshots = [
    { componentStates: { strip: { pixels: [{ r: 16, g: 0, b: 0 }] } } },
    { componentStates: { strip: { pixels: [{ r: 0, g: 0, b: 0 }] } } },
  ];
  assert.equal(hasVisiblePixelsAcrossSnapshots(snapshots), true);
  assert.equal(hasVisiblePixelsAcrossSnapshots([snapshots[1]!]), false);
});

test("joystick stepper verifier accepts either left/right forward convention but requires opposite motion", () => {
  assert.equal(hasOppositeSignedStepperMotion(12, -14), true);
  assert.equal(hasOppositeSignedStepperMotion(-12, 14), true);
  assert.equal(hasOppositeSignedStepperMotion(12, 14), false);
  assert.equal(hasOppositeSignedStepperMotion(0, -14), false);
});

test("A4988 behavior verifier requires sampled motor motion in both directions", () => {
  const snapshots = [
    { componentStates: { motor: { direction: "forward", readings: { steps: 42 } } } },
    { boardSnapshots: { mega: { componentStates: { motor: { direction: "reverse", readings: { steps: -7 } } } } } },
  ];
  assert.equal(hasForwardAndReverseStepperMotion(snapshots, "motor"), true);
  assert.equal(hasForwardAndReverseStepperMotion([snapshots[0]!], "motor"), false);
  assert.equal(hasForwardAndReverseStepperMotion([
    { componentStates: { motor: { direction: "forward", readings: { steps: 0 } } } },
    { componentStates: { motor: { direction: "forward", readings: { steps: 0 } } } },
  ], "motor"), false);
});

function projectWith(
  components: Array<{ id: string; type: string }>,
  connections: CircuitProject["connections"],
): CircuitProject {
  return {
    schemaVersion: 1,
    id: "ground-check",
    name: "ground-check",
    description: "ground net verifier test",
    board: "arduino-uno",
    components: components.map((component, index) => ({ ...component, label: component.type, x: 100 + index * 100, y: 100 })),
    connections,
    code: "",
  };
}

function wire(id: string, fromComponent: string, fromPin: string, toComponent: string, toPin: string): CircuitProject["connections"][number] {
  return { id, from: { componentId: fromComponent, pin: fromPin }, to: { componentId: toComponent, pin: toPin } };
}
