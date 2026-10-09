import assert from "node:assert/strict";
import test from "node:test";

import { ArduinoSimulator } from "./engine.ts";
import { normalizeSketchProgramForSimulator, sketchProgramHeaders, sketchProgramSchema, validateSketchProgram, type SketchProgram } from "./program.ts";

const baseProgram = (): SketchProgram => ({
  headers: [],
  objects: [],
  globals: [],
  functions: [
    { name: "setup", returnType: "void", parameters: [], body: [] },
    { name: "loop", returnType: "void", parameters: [], body: [{ kind: "call", callee: "delay", arguments: ["10"] }] },
  ],
});

test("structured program schema stays bounded for Gemini requests", () => {
  assert.ok(JSON.stringify(sketchProgramSchema("arduino-uno")).length < 75_000);
  const schema = sketchProgramSchema("arduino-uno") as { properties: { functions: { items: { properties: { body: { items: { properties: { operator: { enum: string[] } } } } } } } } };
  assert.deepEqual(schema.properties.functions.items.properties.body.items.properties.operator.enum, ["=", "+=", "-=", "*=", "/=", "%=", "++", "--"]);
});

test("planned components narrow Gemini's structured-program headers", () => {
  const basicHeaders = sketchProgramHeaders("arduino-uno", [{ id: "arduino-uno" }, { id: "led" }]);
  assert.deepEqual(basicHeaders, ["Arduino.h"]);
  const basicSchema = sketchProgramSchema("arduino-uno", basicHeaders) as { properties: { headers: { items: { enum: string[] } } } };
  assert.deepEqual(basicSchema.properties.headers.items.enum, ["Arduino.h"]);

  const sensorHeaders = sketchProgramHeaders("arduino-uno", [
    { id: "arduino-uno" },
    { id: "bme280", metadata: { interfaces: ["I2C"], libraries: [{ headers: ["Wire.h", "Adafruit_BME280.h", "Adafruit_Sensor.h"] }] } },
  ]);
  assert.ok(sensorHeaders.includes("Wire.h"));
  assert.ok(sensorHeaders.includes("Adafruit_BME280.h"));
  assert.ok(!sensorHeaders.includes("Adafruit_SSD1306.h"));
});

test("normalizes only bare multiword print labels into escaped C++ text literals", () => {
  const program = baseProgram();
  program.globals.push({ kind: "declare", type: "int", name: "temperature", initializer: "34" });
  program.functions.find(fn => fn.name === "loop")!.body = [
    { kind: "call", callee: "Serial.println", arguments: ["Sensor Fault Detected"] },
    { kind: "call", callee: "Serial.println", arguments: ["temperature > 32"] },
  ];
  const normalized = normalizeSketchProgramForSimulator(program, "arduino-uno");
  const result = validateSketchProgram(normalized.program, "arduino-uno");
  assert.equal(result.ok, true, result.ok ? "" : result.issues.join("\n"));
  assert.deepEqual(normalized.warnings, ["An unquoted multiword label in a Serial or display print call was rendered as a C++ string literal."]);
  const normalizedBody = normalized.program.functions.find(fn => fn.name === "loop")!.body;
  const label = normalizedBody[0]!;
  const expression = normalizedBody[1]!;
  assert.equal(label.kind, "call");
  if (label.kind === "call") assert.deepEqual(label.arguments, ['"Sensor Fault Detected"']);
  assert.equal(expression.kind, "call");
  if (expression.kind === "call") assert.deepEqual(expression.arguments, ["temperature > 32"]);
});

test("renders an editable sketch and simulates its requested output", () => {
  const program = baseProgram();
  program.functions.unshift({
    name: "limitValue",
    returnType: "int",
    parameters: [{ type: "int", name: "value" }],
    body: [
      { kind: "if", condition: "value < 1", then: [{ kind: "return", value: "1" }] },
      { kind: "return", value: "value" },
    ],
  });
  program.functions.find(fn => fn.name === "setup")!.body = [
    { kind: "call", callee: "pinMode", arguments: ["13", "OUTPUT"] },
    { kind: "call", callee: "digitalWrite", arguments: ["13", "limitValue(0)"] },
  ];

  const result = validateSketchProgram(program, "arduino-uno");
  assert.equal(result.ok, true, result.ok ? "" : result.issues.join("\n"));
  if (!result.ok) return;
  assert.match(result.value.code, /int limitValue\(int value\)/);
  assert.match(result.value.code, /digitalWrite\(13, limitValue\(0\)\)/);

  const simulator = new ArduinoSimulator(result.value.code);
  simulator.run();
  simulator.advance(0);
  assert.equal(simulator.getSnapshot().pins.find(pin => pin.number === 13)?.digitalValue, 1);
});

test("char declarations and character comparisons execute in the Arduino subset", () => {
  const code = `
    char expectedKey = 'A';
    void setup() { pinMode(13, OUTPUT); }
    void loop() {
      char key = 'A';
      if (key == expectedKey) digitalWrite(13, HIGH);
      else digitalWrite(13, LOW);
      delay(10);
    }
  `;
  const simulator = new ArduinoSimulator(code);
  assert.equal(simulator.getCompiledSketch().valid, true, JSON.stringify(simulator.getCompiledSketch().diagnostics));
  simulator.run(); simulator.advance(0);
  assert.equal(simulator.getSnapshot().pins.find(pin => pin.number === 13)?.digitalValue, 1);
});

test("rejects statement injection, unknown names, unsupported calls, and wrong argument counts", () => {
  const injected = baseProgram();
  injected.globals.push({ kind: "declare", type: "int", name: "value", initializer: "1; digitalWrite(13, HIGH)" } as SketchProgram["globals"][number]);
  const injectionResult = validateSketchProgram(injected, "arduino-uno");
  assert.equal(injectionResult.ok, false);
  assert.match(injectionResult.ok ? "" : injectionResult.issues.join(" "), /outside the simulator expression grammar/);

  const unknownName = baseProgram();
  unknownName.functions.find(fn => fn.name === "loop")!.body = [{ kind: "call", callee: "Serial.println", arguments: ["notDeclared"] }];
  const unknownResult = validateSketchProgram(unknownName, "arduino-uno");
  assert.equal(unknownResult.ok, false);
  assert.match(unknownResult.ok ? "" : unknownResult.issues.join(" "), /unknown name notDeclared/);

  const unsupported = baseProgram();
  unsupported.functions.find(fn => fn.name === "loop")!.body = [{ kind: "call", callee: "Serial.printf", arguments: ["1"] }];
  const unsupportedResult = validateSketchProgram(unsupported, "arduino-uno");
  assert.equal(unsupportedResult.ok, false);
  assert.match(unsupportedResult.ok ? "" : unsupportedResult.issues.join(" "), /unsupported Serial\.printf/);

  const wrongArity = baseProgram();
  wrongArity.functions.find(fn => fn.name === "setup")!.body = [{ kind: "call", callee: "pinMode", arguments: ["13"] }];
  const arityResult = validateSketchProgram(wrongArity, "arduino-uno");
  assert.equal(arityResult.ok, false);
  assert.match(arityResult.ok ? "" : arityResult.issues.join(" "), /pinMode\(\) with 1 argument/);

  const wrongConstructor = baseProgram();
  wrongConstructor.headers.push("Adafruit_NeoPixel.h");
  wrongConstructor.objects.push({ type: "Adafruit_NeoPixel", name: "strip", arguments: ["8", "6"] });
  const constructorResult = validateSketchProgram(wrongConstructor, "arduino-uno");
  assert.equal(constructorResult.ok, false);
  assert.match(constructorResult.ok ? "" : constructorResult.issues.join(" "), /constructor expects 3 argument/);
});

test("enforces board-specific library availability", () => {
  const program = baseProgram();
  program.headers.push("ESP8266WiFi.h");
  assert.equal(validateSketchProgram(program, "arduino-uno").ok, false);
  assert.equal(validateSketchProgram(program, "esp8266-nodemcu-v1").ok, true);
});
