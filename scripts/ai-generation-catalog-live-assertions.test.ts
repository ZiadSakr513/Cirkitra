import assert from "node:assert/strict";
import test from "node:test";

import type { CircuitProject } from "../lib/circuit/types.ts";
import type { SimulatorSnapshot } from "../lib/simulator/types.ts";
import { simulateCatalogProject, verifyBehaviorEvidence } from "./ai-generation-catalog-live-assertions.ts";
import type { CatalogReliabilityCase } from "./ai-generation-catalog-30-cases.ts";

test("deterministic potentiometer extremes produce distinct servo motion in the generated-project simulator harness", () => {
  const project: CircuitProject = {
    schemaVersion: 1,
    id: "servo-probe",
    name: "Servo probe",
    description: "Deterministic behavior assertion fixture",
    board: "arduino-uno",
    components: [
      { id: "uno", type: "arduino-uno", label: "Arduino Uno", x: 0, y: 0 },
      { id: "knob", type: "potentiometer", label: "Knob", x: 200, y: 0, properties: { value: 50 } },
      { id: "servo", type: "servo", label: "Servo", x: 400, y: 0 },
    ],
    connections: [
      wire("pot-power", "uno", "5V", "knob", "VCC"),
      wire("pot-ground", "uno", "GND", "knob", "GND"),
      wire("pot-signal", "uno", "A0", "knob", "SIG"),
      wire("servo-signal", "uno", "D9", "servo", "SIG"),
      wire("servo-power", "uno", "5V", "servo", "VCC"),
      wire("servo-ground", "uno", "GND", "servo", "GND"),
    ],
    code: "#include <Servo.h>\nServo joint;\nvoid setup(){ joint.attach(9); }\nvoid loop(){ joint.write(map(analogRead(A0),0,1023,0,180)); delay(20); }",
  };
  const runs = simulateCatalogProject(project, 250);
  assert.equal(runs.length, 2);
  const angles = runs.map(run => run.snapshots.at(-1)?.servos.find(servo => servo.attached)?.angle);
  assert.ok(angles[0] !== undefined && angles[1] !== undefined && angles[0] !== angles[1], `expected distinct angles, saw ${angles.join("/")}`);
  assert.deepEqual(verifyBehaviorEvidence(project, { id: "servo-probe", behavior: { ...behavior("servo"), description: "respond" } }, runs), []);
});

test("dynamic behavior assertions reject generated circuits whose output stays static or unobservable", () => {
  const project = fixture();
  const fixed = run([snapshot({ pins: [{ number: 13, label: "D13", mode: "OUTPUT", digitalValue: 0, pwmValue: 0, lastChangedAtMs: 0 }] })]);
  const dynamic = [
    { input: "low" as const, snapshots: [snapshot({ pins: [{ number: 13, label: "D13", mode: "OUTPUT", digitalValue: 0, pwmValue: 0, lastChangedAtMs: 0 }] })] },
    { input: "high" as const, snapshots: [snapshot({ pins: [{ number: 13, label: "D13", mode: "OUTPUT", digitalValue: 1, pwmValue: 255, lastChangedAtMs: 1 }] })] },
  ];
  assert.match(verifyBehaviorEvidence(project, { id: "digital", behavior: { ...behavior("digital-output"), description: "switch" } }, fixed).join(" "), /never changed/);
  assert.deepEqual(verifyBehaviorEvidence(project, { id: "digital", behavior: { ...behavior("digital-output"), description: "switch" } }, dynamic), []);

  const staticMotor = [0, 0].map((speed, index) => ({ input: index ? "high" as const : "low" as const, snapshots: [snapshot({ componentStates: { motor: { type: "dc-motor", powered: false, speed } } })] }));
  assert.match(verifyBehaviorEvidence(fixture([{ id: "motor", type: "dc-motor" }]), { id: "motor", behavior: { ...behavior("motor"), description: "move" } }, staticMotor).join(" "), /powered speed change/);
});

test("digital-output replay samples between blink edges instead of aliasing a one-second loop", () => {
  const project = fixture();
  project.code = "void setup(){ pinMode(13,OUTPUT); } void loop(){ digitalWrite(13,HIGH); delay(500); digitalWrite(13,LOW); delay(500); }";
  const runs = simulateCatalogProject(project);
  const values = runs.flatMap(run => run.snapshots.map(snapshot => snapshot.pins.find(pin => pin.number === 13)?.digitalValue));
  assert.ok(new Set(values).size > 1, `sampled pin values were ${values.join(",")}`);
  assert.deepEqual(verifyBehaviorEvidence(project, { id: "blink", behavior: { ...behavior("digital-output"), description: "blink" } }, runs), []);
});

test("display, pixel, matrix, and tone evidence requires an observed rendered or active output", () => {
  const project = fixture([{ id: "strip", type: "ws2812b-strip-8" }, { id: "matrix", type: "max7219-8x8-matrix" }, { id: "tft", type: "st7735s-tft-1-8" }]);
  const blank = run([snapshot()]);
  assert.match(verifyBehaviorEvidence(project, { id: "pixels", behavior: { ...behavior("pixels"), description: "light" } }, blank).join(" "), /no addressable/);
  assert.match(verifyBehaviorEvidence(project, { id: "matrix", behavior: { ...behavior("matrix"), description: "draw" } }, blank).join(" "), /remained blank/);
  assert.match(verifyBehaviorEvidence(project, { id: "display", behavior: { ...behavior("display"), description: "show" } }, blank).join(" "), /no visible/);

  const active = run([snapshot({
    componentStates: {
      strip: { type: "ws2812b-strip-8", powered: true, pixels: [{ r: 4, g: 2, b: 0 }] },
      matrix: { type: "max7219-8x8-matrix", powered: true, readings: { litPixels: 1 }, display: ["#......."] },
      tft: { type: "st7735s-tft-1-8", powered: true, status: "Displaying", readings: { spiBytes: 2 } },
      display: { type: "ssd1306-oled-128x64", powered: true, status: "Displaying", display: ["READY"] },
    },
    lcds: [{ instance: "lcd", columns: 16, rows: 2, column: 0, row: 0, lines: ["Ready", ""] }],
  })]);
  assert.deepEqual(verifyBehaviorEvidence(project, { id: "pixels", behavior: { ...behavior("pixels"), description: "light" } }, active), []);
  assert.deepEqual(verifyBehaviorEvidence(project, { id: "matrix", behavior: { ...behavior("matrix"), description: "draw" } }, active), []);
  assert.deepEqual(verifyBehaviorEvidence(project, { id: "both", behavior: { ...behavior("matrix-and-spi-display"), description: "render" } }, active), []);
  assert.deepEqual(verifyBehaviorEvidence(project, { id: "display", behavior: { ...behavior("display"), description: "show" } }, active), []);
});

test("stepper and buzzer evidence requires actual two-direction movement and an active tone sample", () => {
  const stepperProject = fixture([{ id: "stepper", type: "nema17-stepper-17hs4401s" }]);
  const stepperRuns = run([
    snapshot({ componentStates: { stepper: { type: "nema17-stepper-17hs4401s", powered: true, direction: "forward", readings: { steps: 200 } } } }),
    snapshot({ componentStates: { stepper: { type: "nema17-stepper-17hs4401s", powered: true, direction: "reverse", readings: { steps: -200 } } } }),
  ]);
  assert.deepEqual(verifyBehaviorEvidence(stepperProject, { id: "stepper", behavior: { ...behavior("stepper-indexer"), description: "index" } }, stepperRuns), []);

  const joystickRuns = [
    { input: "low" as const, snapshots: [snapshot({ componentStates: { stepper: { type: "stepper-28byj-48", powered: true, readings: { steps: 32 } } } })] },
    { input: "high" as const, snapshots: [snapshot({ componentStates: { stepper: { type: "stepper-28byj-48", powered: true, readings: { steps: -40 } } } })] },
  ];
  assert.deepEqual(verifyBehaviorEvidence(fixture([{ id: "stepper", type: "stepper-28byj-48" }]), { id: "joystick", behavior: { ...behavior("joystick-stepper"), description: "move" } }, joystickRuns), []);
  assert.match(verifyBehaviorEvidence(fixture([{ id: "buzzer", type: "buzzer" }]), { id: "tone", behavior: { ...behavior("tone"), description: "sound" } }, run([snapshot()])).join(" "), /no requested tone/);
  assert.deepEqual(verifyBehaviorEvidence(fixture([{ id: "buzzer", type: "buzzer" }]), { id: "tone", behavior: { ...behavior("tone"), description: "sound" } }, run([snapshot({ tones: [{ pin: 3, active: true, frequency: 880 }] })])), []);
});

test("distance-warning evidence requires a displayed distance, near buzzer output, and far silence", () => {
  const project = fixture([{ id: "buzzer", type: "buzzer" }]);
  project.connections.push(wire("buzzer-signal", "board", "D9", "buzzer", "+"));
  const expectation = { id: "range", behavior: { ...behavior("range-buzzer"), description: "warn when close" } };
  const runs = [
    { input: "low" as const, snapshots: [snapshot({
      lcds: [{ instance: "distance", columns: 4, rows: 1, column: 0, row: 0, lines: ["15cm"] }],
      componentStates: { buzzer: { type: "buzzer", powered: true } },
      tones: [{ pin: 9, active: true, frequency: 880 }],
    })] },
    { input: "high" as const, snapshots: [snapshot({
      lcds: [{ instance: "distance", columns: 4, rows: 1, column: 0, row: 0, lines: ["150cm"] }],
      componentStates: { buzzer: { type: "buzzer", powered: false } },
      tones: [{ pin: 9, active: false, frequency: 0 }],
    })] },
  ];
  assert.deepEqual(verifyBehaviorEvidence(project, expectation, runs), []);
  assert.match(verifyBehaviorEvidence(project, expectation, [runs[0]!, runs[0]!]).join(" "), /far-silent=false/);
});

function behavior(evidence: CatalogReliabilityCase["behavior"]["evidence"]): CatalogReliabilityCase["behavior"] {
  return { description: "behavior test", requiredSketchPatterns: ["setup"], evidence };
}

function fixture(extra: Array<{ id: string; type: string }> = []): CircuitProject {
  return {
    schemaVersion: 1, id: "fixture", name: "Fixture", description: "", board: "arduino-uno", code: "",
    components: [{ id: "board", type: "arduino-uno", label: "Uno", x: 0, y: 0 }, ...extra.map((component, index) => ({ ...component, label: component.type, x: 100 + index * 100, y: 0 }))],
    connections: [],
  };
}

function run(snapshots: readonly SimulatorSnapshot[]) {
  return [{ input: "low" as const, snapshots }, { input: "high" as const, snapshots }];
}

function snapshot(overrides: Partial<SimulatorSnapshot> = {}): SimulatorSnapshot {
  return {
    status: "running", phase: "loop", timeMs: 0, speed: 1, programCounter: 0, loopCount: 0, waitRemainingMs: 0,
    pins: [], serial: [], servos: [], lcds: [], tones: [], componentStates: {}, diagnostics: [],
    ...overrides,
  };
}

function wire(id: string, fromId: string, fromPin: string, toId: string, toPin: string): CircuitProject["connections"][number] {
  return { id, from: { componentId: fromId, pin: fromPin }, to: { componentId: toId, pin: toPin } };
}
