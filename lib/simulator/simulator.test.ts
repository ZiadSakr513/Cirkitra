import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultBlinkProject, type CircuitProject } from "../circuit/index.ts";
import {
  ArduinoSimulator,
  compileArduinoSketch,
  isBuzzerCircuitPowered,
  isLedCircuitPowered,
  resolveBuzzerCircuitBindings,
  resolveComponentIoPins,
  resolveLedCircuitBindings,
  solveCircuit,
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

test("executes calls in nested if and else-if branches without skipped-control warnings", () => {
  const simulator = new ArduinoSimulator(`
    void setup() { pinMode(2, INPUT); pinMode(8, OUTPUT); }
    void loop() {
      if (digitalRead(2) == HIGH) {
        if (millis() > 100) { tone(8, 1200); }
        else { noTone(8); }
      } else if (millis() > 50) {
        digitalWrite(8, HIGH);
      } else if (millis() > 10) {
        digitalWrite(8, LOW);
      } else {
        noTone(8);
      }
      delay(1);
    }
  `);
  assert.equal(simulator.getSnapshot().diagnostics.some((item) => item.code === "UNSUPPORTED_CONTROL_FLOW"), false);
  assert.equal(simulator.getSnapshot().diagnostics.some((item) => item.severity === "error"), false);
  const kinds = simulator.getCompiledSketch().loop.map((instruction) => instruction.kind);
  assert.equal(kinds.includes("tone"), true);
  assert.equal(kinds.includes("digitalWrite"), true);
  assert.ok(kinds.filter((kind) => kind === "jumpIfFalse").length >= 4);
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

test("simulates smart-room sensor expressions, servo, LCD, tone, and bounded loops", () => {
  const simulator = new ArduinoSimulator(`
    #include <Servo.h>
    #include <LiquidCrystal.h>
    Servo roomServo;
    LiquidCrystal lcd(7, 6, 5, 4, 3, 2);
    float temperature = 0;
    long distance = 0;
    void setup() {
      roomServo.attach(9);
      roomServo.write(0);
      lcd.begin(16, 2);
      pinMode(8, OUTPUT);
      for (int i = 0; i < 2; i++) { digitalWrite(8, LOW); }
    }
    void loop() {
      temperature = (analogRead(A0) * 5.0 / 1023.0 - 0.5) * 100.0;
      distance = pulseIn(10, HIGH) / 58.3;
      if (distance < 15 && temperature > 20) {
        roomServo.write(90);
        tone(8, 1200);
        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print("DANGER");
        lcd.setCursor(0, 1);
        lcd.print(distance);
      } else {
        roomServo.write(0);
        noTone(8);
      }
      delay(10);
    }
  `);
  assert.deepEqual(simulator.getCompiledSketch().diagnostics, []);
  simulator.setAnalogInput("A0", Math.round(((25 / 100 + 0.5) / 5) * 1023));
  simulator.setPulseInput(10, 10 * 58.3);
  simulator.run();
  simulator.advance(0);
  const state = simulator.getSnapshot();
  assert.equal(state.servos[0]?.angle, 90);
  assert.equal(state.tones[0]?.active, true);
  assert.equal(state.tones[0]?.frequency, 1200);
  assert.deepEqual(state.lcds[0]?.lines, ["DANGER", "10"]);
});

test("component input bindings exclude ground and supply rails", () => {
  const project = createDefaultBlinkProject();
  project.components.push({ id: "button1", type: "push-button", label: "Button", x: 400, y: 400 });
  project.connections.push(
    { id: "button-input", from: { componentId: "button1", pin: "1" }, to: { componentId: "uno", pin: "D2" } },
    { id: "button-ground", from: { componentId: "button1", pin: "2" }, to: { componentId: "uno", pin: "GND" } },
  );
  assert.deepEqual(resolveComponentIoPins(project, "button1", "1"), ["D2"]);
  assert.deepEqual(resolveComponentIoPins(project, "button1", "2"), []);
});

function electricalProject(
  components: CircuitProject["components"],
  connections: CircuitProject["connections"],
): CircuitProject {
  return { schemaVersion: 1, id: "electrical-test", name: "Electrical test", description: "", board: "arduino-uno", code: "void setup(){} void loop(){}", components, connections };
}

test("solves all powered logic-gate truth tables and feeds the result into Uno inputs", () => {
  const gateTypes = ["logic-and", "logic-or", "logic-xor", "logic-nand", "logic-nor", "logic-not"];
  const expected = [false, true, true, true, false, false];
  gateTypes.forEach((type, index) => {
    const simulator = new ArduinoSimulator(`void setup(){pinMode(2,OUTPUT);pinMode(3,OUTPUT);pinMode(4,INPUT);digitalWrite(2,HIGH);digitalWrite(3,LOW);} void loop(){}`);
    simulator.run(); simulator.advance(0);
    const project = electricalProject([
      { id: "uno", type: "arduino-uno", label: "Uno", x: 0, y: 0 },
      { id: "gate", type, label: type, x: 0, y: 0 },
    ], [
      { id: "a", from: { componentId: "uno", pin: "D2" }, to: { componentId: "gate", pin: "A" } },
      ...(type === "logic-not" ? [] : [{ id: "b", from: { componentId: "uno", pin: "D3" }, to: { componentId: "gate", pin: "B" } }]),
      { id: "y", from: { componentId: "gate", pin: "Y" }, to: { componentId: "uno", pin: "D4" } },
      { id: "v", from: { componentId: "uno", pin: "5V" }, to: { componentId: "gate", pin: "VCC" } },
      { id: "g", from: { componentId: "uno", pin: "GND" }, to: { componentId: "gate", pin: "GND" } },
    ]);
    const solution = solveCircuit(project, simulator.getSnapshot());
    assert.equal(solution.digitalInputs[4], expected[index] ? 1 : 0, type);
    assert.equal(solution.componentStates.gate.powered, true);
  });
});

test("solves toggle, potentiometer, RGB, seven-segment, motor, and L293D states", () => {
  const simulator = new ArduinoSimulator(`void setup(){pinMode(2,OUTPUT);pinMode(3,OUTPUT);pinMode(5,OUTPUT);digitalWrite(2,HIGH);digitalWrite(3,LOW);analogWrite(5,128);} void loop(){}`);
  simulator.run(); simulator.advance(0);
  const project = electricalProject([
    { id: "uno", type: "arduino-uno", label: "Uno", x: 0, y: 0 },
    { id: "sw", type: "toggle-switch", label: "Switch", x: 0, y: 0, properties: { position: true } },
    { id: "pot", type: "potentiometer", label: "Pot", x: 0, y: 0, properties: { value: 25 } },
    { id: "rgb", type: "rgb-led", label: "RGB", x: 0, y: 0 },
    { id: "seg", type: "seven-segment", label: "Display", x: 0, y: 0 },
    { id: "driver", type: "l293d", label: "Driver", x: 0, y: 0 },
    { id: "motor", type: "dc-motor", label: "Motor", x: 0, y: 0 },
  ], [
    { id: "swcom", from: { componentId: "uno", pin: "5V" }, to: { componentId: "sw", pin: "COM" } },
    { id: "swno", from: { componentId: "sw", pin: "NO" }, to: { componentId: "uno", pin: "D4" } },
    { id: "potv", from: { componentId: "uno", pin: "5V" }, to: { componentId: "pot", pin: "VCC" } },
    { id: "potg", from: { componentId: "uno", pin: "GND" }, to: { componentId: "pot", pin: "GND" } },
    { id: "pots", from: { componentId: "pot", pin: "SIG" }, to: { componentId: "uno", pin: "A0" } },
    { id: "rgbr", from: { componentId: "uno", pin: "D5" }, to: { componentId: "rgb", pin: "R" } },
    { id: "rgbb", from: { componentId: "uno", pin: "D2" }, to: { componentId: "rgb", pin: "B" } },
    { id: "rgbc", from: { componentId: "uno", pin: "GND2" }, to: { componentId: "rgb", pin: "COM" } },
    { id: "sega", from: { componentId: "uno", pin: "D2" }, to: { componentId: "seg", pin: "A" } },
    { id: "segc", from: { componentId: "uno", pin: "GND3" }, to: { componentId: "seg", pin: "COM" } },
    { id: "dvss", from: { componentId: "uno", pin: "5V" }, to: { componentId: "driver", pin: "VSS" } },
    { id: "dvs", from: { componentId: "uno", pin: "5V" }, to: { componentId: "driver", pin: "VS" } },
    ...["GND1", "GND2", "GND3", "GND4"].map((pin, i) => ({ id: `dg${i}`, from: { componentId: "uno", pin: "GND" }, to: { componentId: "driver", pin } })),
    { id: "den", from: { componentId: "uno", pin: "D2" }, to: { componentId: "driver", pin: "EN1" } },
    { id: "din1", from: { componentId: "uno", pin: "D2" }, to: { componentId: "driver", pin: "IN1" } },
    { id: "din2", from: { componentId: "uno", pin: "D3" }, to: { componentId: "driver", pin: "IN2" } },
    { id: "m1", from: { componentId: "driver", pin: "OUT1" }, to: { componentId: "motor", pin: "+" } },
    { id: "m2", from: { componentId: "driver", pin: "OUT2" }, to: { componentId: "motor", pin: "-" } },
  ]);
  const solution = solveCircuit(project, simulator.getSnapshot());
  assert.equal(solution.digitalInputs[4], 1);
  assert.equal(solution.analogInputs[14], 256);
  assert.ok((solution.componentStates.rgb.channels?.R ?? 0) > 0.49);
  assert.equal(solution.componentStates.rgb.channels?.B, 1);
  assert.deepEqual(solution.componentStates.seg.segments, ["A"]);
  assert.equal(solution.componentStates.motor.direction, "forward");
  assert.equal(solution.componentStates.motor.powered, true);
});
