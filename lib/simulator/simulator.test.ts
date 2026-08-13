import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultBlinkProject } from "../circuit/index.ts";
import {
  ArduinoSimulator,
  compileArduinoSketch,
  isBuzzerCircuitPowered,
  isLedCircuitPowered,
  resolveBuzzerCircuitBindings,
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

test("executes if statements with digitalRead conditions", () => {
  const simulator = new ArduinoSimulator(`
    void setup() { pinMode(2, INPUT_PULLUP); pinMode(13, OUTPUT); }
    void loop() {
      if (digitalRead(2) == LOW) {
        digitalWrite(13, HIGH);
      } else {
        digitalWrite(13, LOW);
      }
      delay(10);
    }
  `);
  simulator.run();
  simulator.advance(0);
  simulator.setDigitalInput(2, false);
  simulator.advance(10);
  assert.equal(simulator.getSnapshot().pins[13].digitalValue, 1);
});

test("executes millis-based variables, assignments, arithmetic, and conditions", () => {
  const simulator = new ArduinoSimulator(`
    const int RED_PIN = 13;
    unsigned long previous = 0;
    int state = 0;
    void setup() { pinMode(RED_PIN, OUTPUT); }
    void loop() {
      if (millis() - previous >= 500) {
        previous = millis();
        state = (state + 1) % 2;
        if (state == 1) { digitalWrite(RED_PIN, HIGH); }
        else { digitalWrite(RED_PIN, LOW); }
      }
    }
  `);
  assert.equal(simulator.getCompiledSketch().valid, true);
  simulator.run();
  simulator.advance(499);
  assert.equal(simulator.getSnapshot().pins[13].digitalValue, 0);
  simulator.advance(1);
  assert.equal(simulator.getSnapshot().pins[13].digitalValue, 1);
  simulator.advance(500);
  assert.equal(simulator.getSnapshot().pins[13].digitalValue, 0);
});

test("evaluates state and ternary expressions passed to digitalWrite", () => {
  const simulator = new ArduinoSimulator(`
    bool buzzerOn = false;
    void setup() { pinMode(8, OUTPUT); }
    void loop() {
      buzzerOn = !buzzerOn;
      digitalWrite(8, buzzerOn ? HIGH : LOW);
      delay(100);
    }
  `);
  simulator.run();
  simulator.advance(0);
  assert.equal(simulator.getSnapshot().pins[8].digitalValue, 1);
  simulator.advance(100);
  assert.equal(simulator.getSnapshot().pins[8].digitalValue, 0);
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

test("treats a Ground component as the zero-volt reference", () => {
  const project = createDefaultBlinkProject();
  project.components.push({ id: "ground1", type: "ground", label: "GND", x: 500, y: 350 });
  project.connections = project.connections.map((connection) => connection.id === "wire-led-gnd"
    ? { ...connection, to: { componentId: "ground1", pin: "GND" } }
    : connection);
  const binding = resolveLedCircuitBindings(project).get("led1");
  const simulator = new ArduinoSimulator(project.code);
  simulator.run();
  simulator.advance(0);

  assert.deepEqual(binding?.cathodeBoardPins, ["GND"]);
  assert.equal(isLedCircuitPowered(binding, simulator.getSnapshot()), true);
});

test("powers a buzzer only while voltage is applied across its terminals", () => {
  const project = createDefaultBlinkProject();
  project.components = [
    project.components.find((component) => component.type === "arduino-uno")!,
    { id: "buzzer1", type: "buzzer", label: "Buzzer", x: 500, y: 250 },
  ];
  project.connections = [
    { id: "wire-buzzer-positive", from: { componentId: "uno", pin: "D8" }, to: { componentId: "buzzer1", pin: "+" } },
    { id: "wire-buzzer-ground", from: { componentId: "buzzer1", pin: "-" }, to: { componentId: "uno", pin: "GND" } },
  ];
  project.code = `
    void setup() { pinMode(8, OUTPUT); }
    void loop() {
      digitalWrite(8, HIGH); delay(1000);
      digitalWrite(8, LOW); delay(1000);
    }
  `;
  const binding = resolveBuzzerCircuitBindings(project).get("buzzer1");
  const simulator = new ArduinoSimulator(project.code);
  simulator.run();
  simulator.advance(0);
  assert.equal(isBuzzerCircuitPowered(binding, simulator.getSnapshot()), true);
  simulator.advance(1000);
  assert.equal(isBuzzerCircuitPowered(binding, simulator.getSnapshot()), false);
});
