import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultBlinkProject } from "../circuit/index.ts";
import {
  ArduinoSimulator,
  compileArduinoSketch,
  isLedCircuitPowered,
  resolveLedCircuitBindings,
} from "./index.ts";

const blinkSketch = `
const int LED_PIN = LED_BUILTIN;

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(9600);
  Serial.println("ready");
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(1000);
  digitalWrite(LED_PIN, LOW);
  delay(1000);
}
`;

test("compiles constants and the supported Arduino call subset", () => {
  const program = compileArduinoSketch(blinkSketch);

  assert.equal(program.valid, true);
  assert.deepEqual(
    program.setup.map((instruction) => instruction.kind),
    ["pinMode", "serialPrint"],
  );
  assert.deepEqual(
    program.loop.map((instruction) => instruction.kind),
    ["digitalWrite", "delay", "digitalWrite", "delay"],
  );
  assert.equal(program.diagnostics.length, 0);
});

test("advances a blink sketch on a deterministic virtual clock", () => {
  const simulator = new ArduinoSimulator(blinkSketch);

  simulator.run();
  simulator.advance(0);
  let state = simulator.getSnapshot();
  assert.equal(state.pins[13].mode, "OUTPUT");
  assert.equal(state.pins[13].digitalValue, 1);
  assert.equal(state.waitRemainingMs, 1000);
  assert.equal(state.serial[0].text, "ready");
  assert.equal(state.serial[0].timestampMs, 0);

  simulator.advance(250);
  state = simulator.getSnapshot();
  assert.equal(state.timeMs, 250);
  assert.equal(state.waitRemainingMs, 750);
  assert.equal(state.pins[13].digitalValue, 1);

  simulator.advance(750);
  state = simulator.getSnapshot();
  assert.equal(state.timeMs, 1000);
  assert.equal(state.pins[13].digitalValue, 0);
  assert.equal(state.waitRemainingMs, 1000);

  simulator.advance(1000);
  state = simulator.getSnapshot();
  assert.equal(state.timeMs, 2000);
  assert.equal(state.pins[13].digitalValue, 1);
  assert.equal(state.loopCount, 1);
});

test("step consumes one instruction and treats delay as one complete step", () => {
  const simulator = new ArduinoSimulator(`
    void setup() { pinMode(3, OUTPUT); }
    void loop() { analogWrite(3, 128); delay(20); }
  `);

  simulator.step();
  assert.equal(simulator.getSnapshot().pins[3].mode, "OUTPUT");
  simulator.step();
  assert.equal(simulator.getSnapshot().pins[3].pwmValue, 128);
  simulator.step();
  assert.equal(simulator.getSnapshot().timeMs, 20);
  assert.equal(simulator.getSnapshot().loopCount, 1);
});

test("reports unsupported control flow without executing nested calls", () => {
  const program = compileArduinoSketch(`
    void setup() { pinMode(2, INPUT_PULLUP); }
    void loop() {
      if (digitalRead(2) == LOW) {
        digitalWrite(13, HIGH);
      }
      delay(10);
    }
  `);

  assert.equal(program.valid, true);
  assert.ok(
    program.diagnostics.some(
      (diagnostic) => diagnostic.code === "UNSUPPORTED_CONTROL_FLOW",
    ),
  );
  assert.deepEqual(
    program.loop.map((instruction) => instruction.kind),
    ["delay"],
  );
});

test("supports named external inputs and stable subscription snapshots", () => {
  const simulator = new ArduinoSimulator(blinkSketch);
  const received: number[] = [];
  const unsubscribe = simulator.subscribe((snapshot) => {
    received.push(snapshot.pins[14].digitalValue);
  });

  const before = simulator.getSnapshot();
  simulator.setDigitalInput("A0", true);
  const after = simulator.getSnapshot();
  unsubscribe();

  assert.notEqual(before, after);
  assert.equal(before.pins[14].digitalValue, 0);
  assert.equal(after.pins[14].digitalValue, 1);
  assert.deepEqual(received, [1]);
});

test("powers an external LED from the Uno pin used by its actual wiring", () => {
  const project = createDefaultBlinkProject();
  project.connections = project.connections.map((connection) => {
    if (connection.id === "wire-d13-r1") {
      return {
        ...connection,
        from: { ...connection.from, pin: "D12" },
      };
    }
    if (connection.id === "wire-led-gnd") {
      return {
        ...connection,
        to: { ...connection.to, pin: "GND3" },
      };
    }
    return connection;
  });
  project.code = `
    const int LED_PIN = 12;
    void setup() { pinMode(LED_PIN, OUTPUT); }
    void loop() {
      digitalWrite(LED_PIN, HIGH);
      delay(500);
      digitalWrite(LED_PIN, LOW);
      delay(500);
    }
  `;

  const binding = resolveLedCircuitBindings(project).get("led1");
  assert.deepEqual(binding?.anodeBoardPins, ["D12"]);
  assert.deepEqual(binding?.cathodeBoardPins, ["GND3"]);

  const simulator = new ArduinoSimulator(project.code);
  simulator.run();
  simulator.advance(0);
  assert.equal(isLedCircuitPowered(binding, simulator.getSnapshot()), true);
  assert.equal(simulator.getSnapshot().pins[13].digitalValue, 0);

  simulator.advance(500);
  assert.equal(isLedCircuitPowered(binding, simulator.getSnapshot()), false);

  simulator.advance(500);
  assert.equal(isLedCircuitPowered(binding, simulator.getSnapshot()), true);
});

test("does not light an LED whose cathode is not connected", () => {
  const project = createDefaultBlinkProject();
  project.connections = project.connections.filter(
    (connection) => connection.id !== "wire-led-gnd",
  );
  const binding = resolveLedCircuitBindings(project).get("led1");
  const simulator = new ArduinoSimulator(project.code);

  simulator.run();
  simulator.advance(0);

  assert.deepEqual(binding?.cathodeBoardPins, []);
  assert.equal(isLedCircuitPowered(binding, simulator.getSnapshot()), false);
});
