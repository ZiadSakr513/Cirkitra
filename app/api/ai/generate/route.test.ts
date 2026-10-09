import assert from "node:assert/strict";
import test, { after } from "node:test";

import { createDefaultBlinkProject } from "../../../../lib/circuit/default-project.ts";
import { applyCircuitEditOperations, configureGenerationTestLimitsForTests, dualBmeMuxProgramGuidance, encoderThresholdProbeProjects, encoderValidationPositions, generationRepairInstructions, GEMINI_PROVIDER_CALL_TIMEOUT_MS, hasObservableButtonEffect, hasObservableButtonEffectAfterRelease, hasObservableEncoderEffect, includeRequiredSupportingParts, ledSeriesResistorIssues, maxDuration, peripheralPinConflictIssues, repairConflictedKy040SignalConnections, repairConflictedNeoPixelDataBranch, repairMissingLedCurrentLimiters, repairStrayCommaBeforeStatement, repairUniquePeripheralPinAssignments, repairUnwiredPeripheralSignalConnections, requestedButtonBehaviorComponents, requestedRotaryControlAction, requestedWs2812DataResistorIssues, resolveUniqueComponentReference, sensorThresholdBehaviorIssues, sensorThresholdContract, sensorThresholdOutputStates, simulateButtonScenario, simulateEncoderScenario, structuredIssueDiagnostics, validatedProgramReferenceGuidance, validatedWiringReferenceGuidance, POST } from "./route.ts";
import { configureAiUsageAdapterForTests, type AiUsageAdapter } from "../../../../lib/billing/ai-usage.ts";
import { configureAiChatRateLimitAdapterForTests } from "../../../../lib/billing/ai-chat-rate-limit.ts";
import { configureAiGenerationRateLimitAdapterForTests } from "../../../../lib/billing/ai-generation-rate-limit.ts";
import { GET as getAiUsage } from "../usage/route.ts";
import { COMPONENT_CATALOG } from "../../../../lib/circuit/index.ts";
import { COMPONENT_EXAMPLES, KY040_CONTROL_EXAMPLE_CODE } from "../../../../lib/circuit/component-examples.ts";
import { greenhouseExample, greenhousePrompt } from "../../../../tests/fixtures/greenhouse.ts";
import { ArduinoSimulator } from "../../../../lib/simulator/index.ts";
import { MultiBoardSimulator } from "../../../../lib/simulator/index.ts";

let testReservationId = 0;
let testAiReservations = 0;
let testAiReservationAllowed = true;
const testAiReservationOwnerFlags: boolean[] = [];
let testChatRateLimitAllowed = true;
const testChatRateLimitUsers: string[] = [];
let testGenerationRateLimitAllowed = true;
let testGenerationRateLimitFails = false;
const testGenerationRateLimitUsers: string[] = [];
const testAiFinalizations: Array<{ userId: string; reservationId: string; succeeded: boolean; inputTokens: number; outputTokens: number; model: string }> = [];
const testAiUsageAdapter: AiUsageAdapter = {
  authenticate: async () => "ai-route-test-user",
  reserve: async (_userId, _model, unlimited = false) => {
    testAiReservations += 1;
    testAiReservationOwnerFlags.push(unlimited);
    const usage = {
      planId: "free" as const,
      planName: unlimited ? "Owner" : "Free",
      used: 1,
      limit: unlimited ? 0 : 5,
      remaining: unlimited ? 0 : 4,
      unlimited,
      resetsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      billingEnabled: false,
    };
    if (!testAiReservationAllowed && !unlimited) return { allowed: false, usage };
    return {
      allowed: true,
      reservation: { reservationId: `ai-route-test-${++testReservationId}`, usage },
    };
  },
  finalize: async (userId, reservationId, succeeded, inputTokens, outputTokens, model) => {
    testAiFinalizations.push({ userId, reservationId, succeeded, inputTokens, outputTokens, model });
  },
  snapshot: async (_userId, unlimited = false) => ({
    planId: "free",
    planName: unlimited ? "Owner" : "Free",
    used: 0,
    limit: unlimited ? 0 : 5,
    remaining: unlimited ? 0 : 5,
    unlimited,
    resetsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    billingEnabled: false,
  }),
};
configureAiUsageAdapterForTests(testAiUsageAdapter);
configureAiChatRateLimitAdapterForTests(async (userId) => {
  testChatRateLimitUsers.push(userId);
  return {
    allowed: testChatRateLimitAllowed,
    remaining: testChatRateLimitAllowed ? 9 : 0,
    resetsAt: new Date(Date.now() + 60_000).toISOString(),
  };
});
configureAiGenerationRateLimitAdapterForTests(async (userId) => {
  testGenerationRateLimitUsers.push(userId);
  if (testGenerationRateLimitFails) throw new Error("test database unavailable");
  return {
    allowed: testGenerationRateLimitAllowed,
    remaining: testGenerationRateLimitAllowed ? 4 : 0,
    resetsAt: new Date(Date.now() + 60_000).toISOString(),
  };
});
after(() => {
  configureAiUsageAdapterForTests(undefined);
  configureAiChatRateLimitAdapterForTests(undefined);
  configureAiGenerationRateLimitAdapterForTests(undefined);
});

test("usage endpoint returns the authenticated user's monthly Free allowance", async () => {
  const response = await getAiUsage(new Request("http://localhost/api/ai/usage"));
  assert.equal(response.status, 200);
  const usage = await response.json();
  assert.deepEqual(
    { planName: usage.planName, used: usage.used, limit: usage.limit, remaining: usage.remaining, billingEnabled: usage.billingEnabled },
    { planName: "Free", used: 0, limit: 5, remaining: 5, billingEnabled: false },
  );
});

test("the configured owner sees unlimited monthly AI access while ordinary accounts keep their plan quota", async (context) => {
  const originalOwnerUid = process.env.CIRKITRA_OWNER_UID;
  context.after(() => {
    if (originalOwnerUid === undefined) delete process.env.CIRKITRA_OWNER_UID;
    else process.env.CIRKITRA_OWNER_UID = originalOwnerUid;
  });

  process.env.CIRKITRA_OWNER_UID = "ai-route-test-user";
  const ownerResponse = await getAiUsage(new Request("http://localhost/api/ai/usage"));
  assert.equal(ownerResponse.status, 200);
  const ownerUsage = await ownerResponse.json();
  assert.equal(ownerUsage.unlimited, true);
  assert.equal(ownerUsage.limit, 0);
  assert.equal(ownerUsage.planName, "Owner");

  process.env.CIRKITRA_OWNER_UID = "some-other-firebase-uid";
  const regularResponse = await getAiUsage(new Request("http://localhost/api/ai/usage"));
  const regularUsage = await regularResponse.json();
  assert.equal(regularUsage.unlimited, false);
  assert.equal(regularUsage.limit, 5);
  assert.equal(regularUsage.planName, "Free");
});

test("the configured owner bypasses the monthly Build quota while the request is still tracked", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalOwnerUid = process.env.CIRKITRA_OWNER_UID;
  const originalAllowed = testAiReservationAllowed;
  const finalizationsBefore = testAiFinalizations.length;
  context.after(() => {
    globalThis.fetch = originalFetch;
    testAiReservationAllowed = originalAllowed;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    if (originalOwnerUid === undefined) delete process.env.CIRKITRA_OWNER_UID;
    else process.env.CIRKITRA_OWNER_UID = originalOwnerUid;
  });

  process.env.GEMINI_API_KEY = "test-secret";
  process.env.CIRKITRA_OWNER_UID = "ai-route-test-user";
  testAiReservationAllowed = false;
  globalThis.fetch = async () => modelResponse(JSON.stringify(generatedEnvelope));

  const response = await POST(generationRequest());
  assert.equal(response.status, 200);
  assert.equal(testAiReservationOwnerFlags.at(-1), true);
  assert.equal(testAiFinalizations.length, finalizationsBefore + 1);
  assert.equal(testAiFinalizations.at(-1)?.succeeded, true);
});
import { selectGenerationComponents } from "../../../../lib/circuit/discovery.ts";

test("generation prompts include reusable simulator-validated pin topologies", () => {
  const mux = validatedWiringReferenceGuidance(["arduino-uno", "bme280", "tca9548a", "mcp23017"]);
  assert.match(mux, /tca9548a:.*\[tca9548a\]\.SD0/);
  assert.match(mux, /mcp23017:.*\[mcp23017\]\.SDA/);
  assert.doesNotMatch(mux, /bme280:/, "a mux request should not be shown the conflicting direct-bus sensor example");
  assert.match(mux, /Keep every signal, supply rail, and ground node separate/);

  const strip = validatedWiringReferenceGuidance(["ws2812b-strip-8"]);
  assert.match(strip, /\[ws2812b-strip-8\]\.DIN/);
  assert.match(strip, /data resistor is requested or required, place it in series/);
});

test("generation prompts include compiled API examples for every retrieved supported part", () => {
  const guidance = validatedProgramReferenceGuidance([
    "bh1750-sen0097", "ssd1306-oled-128x64", "ky-040", "ws2812b-strip-8",
  ]);
  assert.match(guidance, /lightMeter\.begin\(\)/);
  assert.match(guidance, /display\.begin\(SSD1306_SWITCHCAPVCC,0x3c\)/);
  assert.match(guidance, /Encoder knob\(2,3\)/);
  assert.match(guidance, /strip\.show\(\)/);
  const sonar = validatedProgramReferenceGuidance(["hc-sr04"]);
  assert.match(sonar, /pulseIn\(4,HIGH,30000\)/);
  assert.match(sonar, /delayMicroseconds\(10\)/);
  assert.match(guidance, /convert signed count deltas into detents/);
  assert.match(guidance, /keep it there after release/);
  assert.match(guidance, /do not map the absolute encoder count back over the reset value/);
});

test("same-address dual BME280 mux requests include validated per-channel init and read guidance", () => {
  const parts = selectGenerationComponents(greenhousePrompt, "simulation");
  const guidance = dualBmeMuxProgramGuidance(greenhousePrompt, parts);
  assert.match(guidance, /westOk = west\.begin\(0x76\)/);
  assert.match(guidance, /eastOk = east\.begin\(0x76\)/);
  assert.match(guidance, /selectChannel\(0\)[\s\S]*before every west sensor read/);
  assert.match(guidance, /selectChannel\(1\)[\s\S]*before every east sensor read/);
  assert.match(guidance, /isnan\(\)[\s\S]*actuators safely stopped/);
  assert.equal(dualBmeMuxProgramGuidance("Use one BME280 and one TCA9548A", parts), "", "single-sensor mux requests should not receive the dual-sensor pattern");
});

test("whole-project repair instructions turn simulator and wiring diagnostics into reusable corrections", () => {
  const pixel = generationRepairInstructions([
    "project.code threshold behavior: WS2812B Strip did not change when lux crossed below 800.",
  ]).join(" ");
  assert.match(pixel, /live sensor and threshold/);
  assert.match(pixel, /strip\.show\(\)/);
  assert.match(pixel, /distinct non-black colors/);
  const size = generationRepairInstructions([
    "project.components must contain between 1 and 100 components",
    "project.connections[5].to.componentId does not reference a component",
  ]).join(" ");
  assert.match(size, /no more than 100 components and 500 connections/);
  assert.match(size, /do not add duplicate or alternate parts to repair wiring/);
  assert.match(size, /every wire endpoint references one of the retained component IDs/);
  const tupleFormat = generationRepairInstructions([
    "project.connections[5] must contain from component ID, from pin, to component ID, and to pin.",
  ]).join(" ");
  assert.match(tupleFormat, /exactly a four-string array/);
  assert.match(tupleFormat, /Do not add IDs, colors, labels, objects, or extra tuple entries/);

  const topology = generationRepairInstructions([
    "project.circuit NET_PIN_CONTENTION: net buzzer:+ merges incompatible board pins uno.D6, sensor.GND.",
    "project.connections[7].from.pin cannot be empty.",
  ]).join(" ");
  assert.match(topology, /split every named contending net/);
  assert.match(topology, /never connect a board GPIO to that board's GND\/3V3 pin/i);
  assert.match(topology, /non-empty, exact catalog pin ID/);
  const duplicateWire = generationRepairInstructions(["project.connections[4] duplicates another connection."]).join(" ");
  assert.match(duplicateWire, /each unordered endpoint pair only once/);

  const override = generationRepairInstructions([
    "project.code button behavior: pressing Override Button produces no observable circuit change.",
  ]).join(" ");
  assert.match(override, /persistent boolean/);
  assert.match(override, /sensor condition OR the active override/);

  const mux = generationRepairInstructions([
    'project.code button behavior: encoder produced no observable change; sensor readings were ["NaN"]. TCA9548A and bme1/bme2 are powered and ready.',
  ]).join(" ");
  assert.match(mux, /selectChannel\(0\)[\s\S]*before[\s\S]*begin\(0x76\)/);
  assert.match(mux, /selectChannel\(1\)[\s\S]*before[\s\S]*begin\(0x76\)/);
  assert.match(mux, /separate Adafruit_BME280 objects/);

  const unsupportedSwitch = generationRepairInstructions([
    "project.code simulator UNSUPPORTED_STATEMENT: This statement is outside the simulator subset and was skipped: 0 = key;",
  ]).join(" ");
  assert.match(unsupportedSwitch, /express branches with if\/else \(never switch\/case\)/);

  const sonar = generationRepairInstructions([
    "project.code threshold behavior: Barrier Servo did not change when distance crossed below 30; HC-SR04 readings did not activate the output.",
  ]).join(" ");
  assert.match(sonar, /pulseIn\(echoPin, HIGH, 30000\)/);
  assert.match(sonar, /duration \/ 58\.3/);
  assert.match(sonar, /match the sketch trigger and echo pin numbers to the exact wired TRIG and ECHO pins/);

  const threshold = generationRepairInstructions([
    "project.code threshold behavior: WS2812B Strip#strip and Piezo Buzzer#buzzer did not change when lux crossed below 450. Expected WS2812B Strip#strip, Piezo Buzzer#buzzer to switch at 450 and retain the alarm through the 100-unit hysteresis band.",
  ]).join(" ");
  assert.match(threshold, /activate when the live reading is below 450/);
  assert.match(threshold, /clear only when the live reading reaches the threshold plus 100/);
  assert.match(threshold, /diagnosed output \(WS2812B Strip#strip, Piezo Buzzer#buzzer\)/);
  assert.match(threshold, /call strip\.show\(\)/);
  assert.match(threshold, /call tone\(\).*call noTone\(\)/);
});

test("sensor threshold observations normalize empty and inactive tone entries equally", () => {
  const project = structuredClone(COMPONENT_EXAMPLES["ky-040"]());
  project.components.push({ id: "buzzer", type: "buzzer", label: "Buzzer", x: 0, y: 0, rotation: 0, properties: {} });
  const snapshot = new ArduinoSimulator("void setup(){} void loop(){}").getSnapshot();
  const componentStates = { ...snapshot.componentStates, buzzer: { type: "buzzer", powered: false } };
  const noToneYet = { ...snapshot, componentStates, tones: [] };
  const explicitNoTone = { ...noToneYet, tones: [{ pin: 9, frequency: 1000, active: false }] };
  assert.deepEqual(sensorThresholdOutputStates(project, noToneYet, ["buzzer"]), sensorThresholdOutputStates(project, explicitNoTone, ["buzzer"]));
});

test("generation reports shared GPIO assignments across LCD, encoder, and direct sketch controls", () => {
  const project = structuredClone(COMPONENT_EXAMPLES["ky-040"]());
  assert.deepEqual(peripheralPinConflictIssues(project, "uno", project.code), [], "valid encoder pinMode calls must be recognized as setup for the same wired encoder signals");
  project.components.push(
    { id: "lcd", type: "lcd-16x2", label: "Room LCD", x: 600, y: 0 },
    { id: "buzzer", type: "buzzer", label: "Alert buzzer", x: 900, y: 0 },
  );
  for (const [id, lcdPin, boardPin] of [
    ["lcd-rs", "RS", "D12"],
    ["lcd-enable", "E", "D11"],
    ["lcd-d7", "D7", "D2"],
    ["lcd-d6", "D6", "D3"],
    ["lcd-d5", "D5", "D4"],
    ["lcd-d4", "D4", "D5"],
  ]) {
    project.connections.push({ id, from: { componentId: "lcd", pin: lcdPin }, to: { componentId: "uno", pin: boardPin } });
  }
  project.connections.push({ id: "buzzer-positive", from: { componentId: "buzzer", pin: "+" }, to: { componentId: "uno", pin: "D5" } });
  const code = `#include <LiquidCrystal.h>
#include <Encoder.h>
LiquidCrystal lcd(12, 11, 5, 4, 3, 2);
Encoder myEnc(2, 3);
const int buzzerPin = 5;
const int encSwPin = 4;
void setup() { pinMode(buzzerPin, OUTPUT); pinMode(encSwPin, INPUT_PULLUP); }
void loop() { tone(buzzerPin, 880); digitalRead(encSwPin); }`;
  const issues = peripheralPinConflictIssues(project, "uno", code);
  assert.equal(issues.length, 4, issues.join("\n"));
  assert.ok(issues.some(issue => issue.includes("D2") && issue.includes("LCD (lcd-16x2)") && issue.includes("KY-040 (ky-040)") && issue.includes("Room LCD.D7") && issue.includes("wire lcd-d7")));
  assert.ok(issues.some(issue => issue.includes("D4") && issue.includes("encSwPin") && issue.includes("Room LCD.D5")), issues.join("\n"));
  assert.ok(issues.some(issue => issue.includes("D5") && issue.includes("buzzerPin") && issue.includes("Alert buzzer.+")));

  const mismatched = structuredClone(COMPONENT_EXAMPLES["ky-040"]());
  mismatched.code = mismatched.code.replace("Encoder knob(2,3)", "Encoder knob(7,8)");
  const miswireIssues = peripheralPinConflictIssues(mismatched, "uno", mismatched.code);
  assert.equal(miswireIssues.filter(issue => issue.includes("GPIO_PIN_NOT_WIRED")).length, 2, miswireIssues.join("\n"));
});

test("generation moves a collided KY-040 signal to an unused GPIO and aligns its encoder constructor", () => {
  const project = {
    components: [
      { id: "uno", type: "arduino-uno", label: "Uno" },
      { id: "encoder", type: "ky-040", label: "KY-040" },
      { id: "sonar", type: "hc-sr04", label: "HC-SR04" },
    ],
    connections: [
      { id: "enc-clk", from: { componentId: "encoder", pin: "CLK" }, to: { componentId: "uno", pin: "D2" } },
      { id: "enc-dt", from: { componentId: "encoder", pin: "DT" }, to: { componentId: "uno", pin: "D3" } },
      { id: "enc-sw", from: { componentId: "encoder", pin: "SW" }, to: { componentId: "uno", pin: "D6" } },
      { id: "sonar-trig", from: { componentId: "sonar", pin: "TRIG" }, to: { componentId: "uno", pin: "D3" } },
      { id: "sonar-echo", from: { componentId: "sonar", pin: "ECHO" }, to: { componentId: "uno", pin: "D5" } },
    ],
  };
  const code = `#include <Encoder.h>\nEncoder knob(2, 3);\nconst int trigPin = 3;\nconst int echoPin = 5;\nconst int encoderSwitchPin = 6;\nvoid setup(){ pinMode(trigPin,OUTPUT); pinMode(echoPin,INPUT); pinMode(encoderSwitchPin,INPUT_PULLUP); }\nvoid loop(){ digitalWrite(trigPin,LOW); delayMicroseconds(2); digitalWrite(trigPin,HIGH); delayMicroseconds(10); digitalWrite(trigPin,LOW); pulseIn(echoPin,HIGH,30000); knob.read(); digitalRead(encoderSwitchPin); }`;
  assert.ok(peripheralPinConflictIssues(project, "uno", code).some(issue => issue.includes("GPIO_PIN_CONFLICT")));

  const repaired = repairConflictedKy040SignalConnections(project, "uno", code);
  assert.equal(repaired.repairs.length, 2, repaired.repairs.join("\n"));
  assert.deepEqual(repaired.connections.find(connection => connection.id === "enc-dt")?.to, { componentId: "uno", pin: "D4" });
  assert.deepEqual(repaired.connections.find(connection => connection.id === "sonar-trig")?.to, { componentId: "uno", pin: "D3" }, "the already aligned HC-SR04 output keeps its pin");
  assert.match(repaired.code, /Encoder knob\(2,\s*4\)/);
  assert.equal(peripheralPinConflictIssues({ ...project, connections: repaired.connections }, "uno", repaired.code).some(issue => issue.includes("GPIO_PIN_CONFLICT")), false);

  const ambiguous = repairConflictedKy040SignalConnections(project, "uno", `#include <Encoder.h>\nEncoder first(2, 3);\nEncoder second(4, 5);\nvoid setup(){} void loop(){}`);
  assert.deepEqual(ambiguous, { code: `#include <Encoder.h>\nEncoder first(2, 3);\nEncoder second(4, 5);\nvoid setup(){} void loop(){}`, connections: project.connections, repairs: [] }, "ambiguous encoder ownership stays with model recovery");
});

test("generation aligns a named buzzer pin only when its wiring has one supported board GPIO", () => {
  const project = structuredClone(COMPONENT_EXAMPLES["ky-040"]());
  project.components.push({ id: "buzzer", type: "buzzer", label: "Alert buzzer", x: 800, y: 200 });
  project.connections.push({ id: "buzzer-wire", from: { componentId: "buzzer", pin: "+" }, to: { componentId: "uno", pin: "D5" } });
  const code = `const int buzzerPin = 12; void setup() { pinMode(buzzerPin, OUTPUT); } void loop() { tone(buzzerPin, 880); }`;
  const repaired = repairUniquePeripheralPinAssignments(project, "uno", code);
  assert.match(repaired.code, /buzzerPin\s*=\s*5/);
  assert.doesNotMatch(repaired.code, /buzzerSilenced\s*=\s*5/);
  assert.deepEqual(repaired.repairs, ["aligned buzzerPin (buzzer.+) to its unique wired GPIO"]);

  project.connections.push({ id: "buzzer-second-wire", from: { componentId: "buzzer", pin: "+" }, to: { componentId: "uno", pin: "D6" } });
  const ambiguous = repairUniquePeripheralPinAssignments(project, "uno", code);
  assert.equal(ambiguous.code, code);
  assert.deepEqual(ambiguous.repairs, []);
});

test("generation aligns HC-SR04 trigger and pulseIn echo pins to the unique wired GPIOs", () => {
  const project = structuredClone(COMPONENT_EXAMPLES["hc-sr04"]());
  const code = `const int trigPin=9; const int echoPin=6;
void setup(){ pinMode(trigPin,OUTPUT); pinMode(echoPin,INPUT); }
void loop(){ digitalWrite(trigPin,LOW); delayMicroseconds(2); digitalWrite(trigPin,HIGH); delayMicroseconds(10); digitalWrite(trigPin,LOW); long duration=pulseIn(echoPin,HIGH,30000); Serial.println(duration/58.3); }`;
  const repaired = repairUniquePeripheralPinAssignments(project, "uno", code);
  assert.match(repaired.code, /trigPin\s*=\s*3/);
  assert.match(repaired.code, /echoPin\s*=\s*4/);
  assert.match(repaired.code, /pulseIn\(4,HIGH,30000\)/);
  assert.ok(repaired.repairs.some(repair => repair.includes("trigPin (hc-sr04.TRIG)")));
  assert.ok(repaired.repairs.some(repair => repair.includes("echoPin (hc-sr04.ECHO)")));
});

test("generation reconnects only isolated LCD signals to the unused pins named by its sketch", () => {
  const project = structuredClone(COMPONENT_EXAMPLES["ky-040"]());
  project.components.push({ id: "lcd", type: "lcd-16x2", label: "Room display", x: 600, y: 0 });
  project.code = `#include <LiquidCrystal.h>
#include <Encoder.h>
LiquidCrystal lcd(8, 9, 10, 11, 12, 13);
Encoder knob(2, 3);
void setup(){ lcd.begin(16, 2); }
void loop(){ lcd.print(knob.read()); }`;

  const repaired = repairUnwiredPeripheralSignalConnections(project, "uno", project.code);
  assert.equal(repaired.connections.length, 6);
  assert.deepEqual(repaired.connections.map(connection => [connection.from.pin, connection.to.pin]), [
    ["D8", "RS"], ["D9", "E"], ["D10", "D4"], ["D11", "D5"], ["D12", "D6"], ["D13", "D7"],
  ]);
  assert.equal(peripheralPinConflictIssues({ ...project, connections: [...project.connections, ...repaired.connections] }, "uno", project.code).length, 0);
  assert.equal(repairUnwiredPeripheralSignalConnections({ ...project, connections: [...project.connections, ...repaired.connections] }, "uno", project.code).connections.length, 0);

  const ambiguous = structuredClone(project);
  ambiguous.components.push({ id: "lcd-2", type: "lcd-16x2", label: "Second display", x: 900, y: 0 });
  assert.deepEqual(repairUnwiredPeripheralSignalConnections(ambiguous, "uno", ambiguous.code), { connections: [], repairs: [] });
});

test("generation completes a uniquely identified NeoPixel data-resistor branch", () => {
  const project = structuredClone(COMPONENT_EXAMPLES["ky-040"]());
  project.components.push(
    { id: "strip", type: "ws2812b-strip-8", label: "Status strip", x: 600, y: 0 },
    { id: "data-resistor", type: "resistor", label: "Data resistor", x: 450, y: 0, properties: { resistance: 330 } },
  );
  project.connections.push({ id: "strip-din-resistor", from: { componentId: "strip", pin: "DIN" }, to: { componentId: "data-resistor", pin: "2" } });
  project.code = `#include <Adafruit_NeoPixel.h>
Adafruit_NeoPixel strip(8, 6, NEO_GRB + NEO_KHZ800);
void setup(){ strip.begin(); }
void loop(){ strip.show(); }`;

  const repaired = repairUnwiredPeripheralSignalConnections(project, "uno", project.code);
  assert.equal(repaired.connections.length, 1);
  assert.deepEqual([repaired.connections[0]!.from, repaired.connections[0]!.to], [
    { componentId: "uno", pin: "D6" }, { componentId: "data-resistor", pin: "1" },
  ]);
  const connections = [...project.connections, ...repaired.connections];
  assert.deepEqual(peripheralPinConflictIssues({ ...project, connections }, "uno", project.code), []);
  assert.equal(repairUnwiredPeripheralSignalConnections({ ...project, connections }, "uno", project.code).connections.length, 0);
});

test("generation completes a NeoPixel branch when the sketch GPIO is already wired to a loose series resistor", () => {
  const project = structuredClone(COMPONENT_EXAMPLES["ky-040"]());
  project.components.push(
    { id: "strip", type: "ws2812b-strip-8", label: "Status strip", x: 600, y: 0 },
    { id: "data-resistor", type: "resistor", label: "Data resistor", x: 450, y: 0, properties: { resistance: 330 } },
  );
  project.connections.push({ id: "gpio-to-loose-resistor", from: { componentId: "uno", pin: "D6" }, to: { componentId: "data-resistor", pin: "1" } });
  project.code = `#include <Adafruit_NeoPixel.h>
Adafruit_NeoPixel strip(8, 6, NEO_GRB + NEO_KHZ800);
void setup(){ strip.begin(); }
void loop(){ strip.show(); }`;

  const repaired = repairUnwiredPeripheralSignalConnections(project, "uno", project.code);
  assert.equal(repaired.connections.length, 1);
  assert.deepEqual([repaired.connections[0]!.from, repaired.connections[0]!.to], [
    { componentId: "data-resistor", pin: "2" }, { componentId: "strip", pin: "DIN" },
  ]);
  const repairedProject = { ...project, connections: [...project.connections, ...repaired.connections] };
  assert.deepEqual(peripheralPinConflictIssues(repairedProject, "uno", project.code), []);
  assert.deepEqual(requestedWs2812DataResistorIssues(repairedProject, "Use a WS2812B data resistor."), []);
  assert.equal(repairUnwiredPeripheralSignalConnections(repairedProject, "uno", project.code).connections.length, 0);
});

test("a requested WS2812B data resistor must be wired in series between the data pin and strip", () => {
  const project = structuredClone(COMPONENT_EXAMPLES["ky-040"]());
  project.components.push(
    { id: "strip", type: "ws2812b-strip-8", label: "Status strip", x: 600, y: 0 },
    { id: "data-resistor", type: "resistor", label: "Data resistor", x: 450, y: 0, properties: { resistance: 330 } },
  );
  const prompt = "Use a WS2812B strip and include its required data resistor.";
  project.connections.push(
    { id: "din-side", from: { componentId: "strip", pin: "DIN" }, to: { componentId: "data-resistor", pin: "2" } },
    { id: "gpio-side", from: { componentId: "data-resistor", pin: "1" }, to: { componentId: "uno", pin: "D6" } },
  );
  assert.deepEqual(requestedWs2812DataResistorIssues(project, prompt), []);
  project.connections.pop();
  assert.ok(requestedWs2812DataResistorIssues(project, prompt).some(issue => issue.includes("WS2812B_DATA_RESISTOR_REQUIRED")));
  project.connections = project.connections.filter(connection => connection.id !== "din-side");
  project.connections.push({ id: "direct-data", from: { componentId: "strip", pin: "DIN" }, to: { componentId: "uno", pin: "D6" } });
  assert.ok(requestedWs2812DataResistorIssues(project, prompt).length > 0, "a loose resistor or direct GPIO wire cannot satisfy the request");
});

test("generation separates an unambiguous NeoPixel data resistor from an LCD GPIO conflict", () => {
  const project = structuredClone(COMPONENT_EXAMPLES["ky-040"]());
  project.components.push(
    { id: "lcd", type: "lcd-16x2", label: "Room LCD", x: 400, y: 0 },
    { id: "strip", type: "ws2812b-strip-8", label: "Status strip", x: 800, y: 0 },
    { id: "data-resistor", type: "resistor", label: "WS2812 data resistor", x: 650, y: 0, properties: { resistance: 330 } },
  );
  project.connections.push(
    { id: "lcd-data-collision", from: { componentId: "lcd", pin: "D4" }, to: { componentId: "uno", pin: "D4" } },
    { id: "strip-data", from: { componentId: "strip", pin: "DIN" }, to: { componentId: "data-resistor", pin: "2" } },
    { id: "resistor-source", from: { componentId: "data-resistor", pin: "1" }, to: { componentId: "uno", pin: "D4" } },
  );
  const code = `#include <LiquidCrystal.h>
#include <Adafruit_NeoPixel.h>
LiquidCrystal lcd(2, 3, 4, 5, 6, 7);
Adafruit_NeoPixel strip(8, 4, NEO_GRB + NEO_KHZ800);
void setup(){ lcd.begin(16, 2); strip.begin(); }
void loop(){ strip.show(); }`;
  assert.ok(peripheralPinConflictIssues(project, "uno", code).some(issue => issue.includes("GPIO_PIN_CONFLICT")));

  const repaired = repairConflictedNeoPixelDataBranch(project, "uno", code);
  assert.equal(repaired.repairs.length, 1, repaired.repairs.join("\n"));
  assert.match(repaired.code, /Adafruit_NeoPixel\s+strip\(8,\s*(\d+)/);
  const match = /Adafruit_NeoPixel\s+strip\(8,\s*(\d+)/.exec(repaired.code);
  assert.ok(match);
  const newPin = Number(match[1]);
  assert.notEqual(newPin, 4);
  assert.ok(repaired.connections.some(connection => [connection.from, connection.to].some(endpoint => endpoint.componentId === "data-resistor" && endpoint.pin === "1")
    && [connection.from, connection.to].some(endpoint => endpoint.componentId === "uno" && endpoint.pin === `D${newPin}`)));
  assert.equal(repaired.connections.find(connection => connection.id === "lcd-data-collision")?.to.pin, "D4", "the independent LCD signal stays on its original pin");
  assert.equal(peripheralPinConflictIssues({ ...project, connections: repaired.connections }, "uno", repaired.code).some(issue => issue.includes("GPIO_PIN_CONFLICT")), false);
});

test("button behavior validation targets the button the prompt assigns the action to", () => {
  const controls = [
    { id: "push", type: "push-button" },
    { id: "encoder", type: "ky-040" },
  ];
  assert.deepEqual(
    requestedButtonBehaviorComponents("Use the KY-040 rotary encoder to adjust the setpoint; pressing the pushbutton toggles sound.", controls).map(control => control.id),
    ["push"],
  );
  assert.deepEqual(
    requestedButtonBehaviorComponents("Press the KY-040's SW switch to mute the alarm.", controls).map(control => control.id),
    ["encoder"],
  );
  assert.deepEqual(
    requestedButtonBehaviorComponents("Press the encoder's SW switch to mute sound and press the separate pushbutton to turn off the strip.", controls).map(control => control.id),
    ["encoder", "push"],
  );
  assert.deepEqual(
    requestedButtonBehaviorComponents("The pushbutton toggles the alarm on every press.", controls).map(control => control.id),
    ["push"],
  );
  assert.deepEqual(
    requestedButtonBehaviorComponents("Pressing the encoder's SW switch mutes the alarm.", controls).map(control => control.id),
    ["encoder"],
  );
  assert.equal(requestedRotaryControlAction("Turning the encoder changes the alarm threshold."), true);
  assert.equal(requestedRotaryControlAction("The encoder's SW switch toggles alarm mode."), false);
});

test("rotary behavior validation observes servo motion and probes raw encoder counts", () => {
  const project = structuredClone(COMPONENT_EXAMPLES["ky-040"]());
  project.components.push({ id: "arm", type: "servo", label: "Gate arm", x: 600, y: 180 });
  project.connections.push(
    { id: "servo-vcc", from: { componentId: "arm", pin: "VCC" }, to: { componentId: "uno", pin: "5V" } },
    { id: "servo-gnd", from: { componentId: "arm", pin: "GND" }, to: { componentId: "uno", pin: "GND" } },
    { id: "servo-signal", from: { componentId: "arm", pin: "SIG" }, to: { componentId: "uno", pin: "D9" } },
  );
  const code = `#include <Encoder.h>
#include <Servo.h>
Encoder knob(2,3);
Servo arm;
void setup(){ arm.attach(9); }
void loop(){ arm.write(map(knob.read(),0,100,0,180)); }`;
  const initial = simulateEncoderScenario(project, code, "device", 0);
  const rotated = simulateEncoderScenario(project, code, "device", 100);
  assert.notEqual(initial.at(-1)?.servos[0]?.angle, rotated.at(-1)?.servos[0]?.angle);
  assert.equal(hasObservableEncoderEffect(project, initial, rotated, true), true, "a servo is a requested physical output even when no GPIO level changes");
  assert.deepEqual(encoderValidationPositions("Turn the KY-040 to map a 20%–70% threshold."), {
    positions: [-20, 0, 1, 15, 50, 100],
  }, "the setpoint's percent span must not be misread as raw encoder counts or ambient temperature");
});

test("encoder behavior probes sensor values beside the requested threshold instead of arbitrary generated defaults", () => {
  const project = structuredClone(COMPONENT_EXAMPLES["ky-040"]());
  const sonar = COMPONENT_EXAMPLES["hc-sr04"]();
  const sonarSensor = sonar.components.find(component => component.type === "hc-sr04")!;
  project.components.push({ ...sonarSensor, id: "sonar", properties: { distanceCm: 100 } });
  project.connections.push(...sonar.connections.map(connection => {
    const remap = (endpoint: typeof connection.from) => {
      if (endpoint.componentId === sonarSensor.id) return { ...endpoint, componentId: "sonar" };
      if (endpoint.componentId === "uno" && endpoint.pin === "D3") return { ...endpoint, pin: "D5" };
      if (endpoint.componentId === "uno" && endpoint.pin === "D4") return { ...endpoint, pin: "D6" };
      return endpoint;
    };
    return { ...connection, id: `sonar-${connection.id}`, from: remap(connection.from), to: remap(connection.to) };
  }));
  project.components.push({ id: "barrier", type: "servo", label: "Barrier servo", x: 650, y: 120, rotation: 0, properties: { angle: 0 } });
  project.connections.push(
    { id: "barrier-vcc", from: { componentId: "barrier", pin: "VCC" }, to: { componentId: "uno", pin: "5V" } },
    { id: "barrier-ground", from: { componentId: "barrier", pin: "GND" }, to: { componentId: "uno", pin: "GND" } },
    { id: "barrier-signal", from: { componentId: "barrier", pin: "SIG" }, to: { componentId: "uno", pin: "D9" } },
  );
  const prompt = "Start the distance threshold at 40 cm. When distance falls below the limit, close the servo barrier; open it after recovery. Use the KY-040 to adjust the threshold.";
  const code = `#include <Encoder.h>\n#include <Servo.h>\nEncoder knob(2,3);\nServo barrier;\nint threshold=40;\nlong previousPosition=0;\nvoid setup(){ Serial.begin(9600); pinMode(5,OUTPUT); pinMode(6,INPUT); barrier.attach(9); }\nvoid loop(){ long position=knob.read(); int detents=(position-previousPosition)/4; if(detents!=0){ threshold=constrain(threshold+detents*5,20,80); previousPosition=previousPosition+detents*4; } digitalWrite(5,LOW); delayMicroseconds(2); digitalWrite(5,HIGH); delayMicroseconds(10); digitalWrite(5,LOW); long duration=pulseIn(6,HIGH,30000); float distanceCm=duration/58.3; if(distanceCm<threshold) barrier.write(90); else barrier.write(0); Serial.println(threshold); delay(10); }`;
  assert.equal(project.components.find(component => component.id === "sonar")?.properties?.distanceCm, 100, "the generated default is deliberately outside the encoder range");
  const scenarios = encoderThresholdProbeProjects(project, prompt);
  assert.deepEqual(scenarios.map(scenario => scenario.components.find(component => component.id === "sonar")?.properties?.distanceCm), [39, 40, 41]);
  const changedOutput = scenarios.some(scenario => {
    const initial = simulateEncoderScenario(scenario, code, "device", 0);
    const rotated = simulateEncoderScenario(scenario, code, "device", 100);
    return hasObservableEncoderEffect(project, initial, rotated, true);
  });
  assert.equal(changedOutput, true, "a working adjustable threshold must be judged with an input value it can actually cross");
});

test("mute-button simulation primes the requested soil alarm before comparing released and pressed states", () => {
  const project = structuredClone(COMPONENT_EXAMPLES["ky-040"]());
  project.components.push(
    { id: "soil", type: "soil-moisture-sen0193", label: "Soil moisture", x: 500, y: 0, properties: { moisture: 50 } },
    { id: "buzzer", type: "buzzer", label: "Alarm buzzer", x: 700, y: 0 },
  );
  project.connections.push(
    { id: "soil-vcc", from: { componentId: "soil", pin: "VCC" }, to: { componentId: "uno", pin: "5V" } },
    { id: "soil-gnd", from: { componentId: "soil", pin: "GND" }, to: { componentId: "uno", pin: "GND" } },
    { id: "soil-out", from: { componentId: "soil", pin: "AOUT" }, to: { componentId: "uno", pin: "A0" } },
    { id: "buzzer-signal", from: { componentId: "buzzer", pin: "+" }, to: { componentId: "uno", pin: "D9" } },
    { id: "buzzer-gnd", from: { componentId: "buzzer", pin: "-" }, to: { componentId: "uno", pin: "GND" } },
  );
  project.code = `int previousSwitch = HIGH;
int muted = 0;
void setup(){ pinMode(4, INPUT_PULLUP); pinMode(9, OUTPUT); previousSwitch = digitalRead(4); }
void loop(){ int moisture = 100 - analogRead(A0) * 100 / 1023; int switchState = digitalRead(4); if (switchState == LOW && previousSwitch == HIGH) { muted = 1; } previousSwitch = switchState; if (moisture >= 40) { muted = 0; } if (moisture < 35 && muted == 0) { tone(9, 1000); } else { noTone(9); } }`;

  const prompt = "Press the KY-040 switch to mute the buzzer while soil moisture is below 35%, and keep it muted until the soil recovers.";
  const released = simulateButtonScenario(project, project.code, undefined, prompt);
  const pressed = simulateButtonScenario(project, project.code, "device", prompt);
  assert.equal(
    hasObservableButtonEffect(project, released, pressed),
    true,
    JSON.stringify({ message: "the validator must test mute behavior while the low-moisture alarm is active", released: released.at(-1)?.pins, pressed: pressed.at(-1)?.pins, releasedDiagnostics: released.at(-1)?.diagnostics, pressedDiagnostics: pressed.at(-1)?.diagnostics }),
  );
  assert.equal(
    hasObservableButtonEffectAfterRelease(project, released, pressed),
    true,
    "a mute latch stays active after the physical switch is released until soil recovery",
  );
});

test("mute-button simulation primes humidity sensors whose candidate omitted environment properties", () => {
  const project = structuredClone(COMPONENT_EXAMPLES.bme280());
  project.components.push(
    { id: "encoder", type: "ky-040", label: "Alarm encoder", x: 760, y: 0, properties: { position: 3, pressed: false } },
    { id: "buzzer", type: "buzzer", label: "Alarm buzzer", x: 900, y: 0 },
  );
  project.connections.push(
    { id: "encoder-vcc", from: { componentId: "encoder", pin: "VCC" }, to: { componentId: "uno", pin: "5V" } },
    { id: "encoder-gnd", from: { componentId: "encoder", pin: "GND" }, to: { componentId: "uno", pin: "GND" } },
    { id: "encoder-clk", from: { componentId: "encoder", pin: "CLK" }, to: { componentId: "uno", pin: "D2" } },
    { id: "encoder-dt", from: { componentId: "encoder", pin: "DT" }, to: { componentId: "uno", pin: "D3" } },
    { id: "encoder-switch", from: { componentId: "encoder", pin: "SW" }, to: { componentId: "uno", pin: "D4" } },
    { id: "buzzer-positive", from: { componentId: "buzzer", pin: "+" }, to: { componentId: "uno", pin: "D9" } },
    { id: "buzzer-ground", from: { componentId: "buzzer", pin: "-" }, to: { componentId: "uno", pin: "GND" } },
  );
  project.code = `#include <Adafruit_BME280.h>
#include <Encoder.h>
Adafruit_BME280 sensor; Encoder knob(2,3); bool alarmOn=false; bool muted=false; int previousSwitch=HIGH;
void setup(){ Serial.begin(9600); pinMode(4,INPUT_PULLUP); pinMode(9,OUTPUT); sensor.begin(0x76); previousSwitch=digitalRead(4); }
void loop(){ float humidity=sensor.readHumidity(); if(!alarmOn && humidity>72) alarmOn=true; if(alarmOn && humidity<67){ alarmOn=false; muted=false; } int sw=digitalRead(4); if(sw==LOW && previousSwitch==HIGH && alarmOn) muted=true; previousSwitch=sw; if(alarmOn && !muted) tone(9,1000); else noTone(9); Serial.println(humidity); delay(20); }`;

  const prompt = "Press the KY-040 switch to mute the buzzer while the BME280 humidity alarm is active; keep it muted until humidity recovers below the threshold.";
  const released = simulateButtonScenario(project, project.code, undefined, prompt);
  const pressed = simulateButtonScenario(project, project.code, "encoder", prompt);
  assert.equal(released.at(-1)?.componentStates.device?.readings?.humidity, 100, "the validation scenario explicitly raises a BME280 with omitted properties into its alarm range");
  assert.equal(hasObservableButtonEffect(project, released, pressed), true, "mute is compared while the humidity alarm is active");
  assert.equal(hasObservableButtonEffectAfterRelease(project, released, pressed), true, "mute remains latched after the switch is released");
});

test("sensor-threshold simulation checks activation, hysteresis retention, and recovery", () => {
  const project = structuredClone(COMPONENT_EXAMPLES["ky-040"]());
  project.components.push(
    { id: "soil", type: "soil-moisture-sen0193", label: "Soil moisture", x: 500, y: 0, properties: { moisture: 50 } },
    { id: "buzzer", type: "buzzer", label: "Alarm buzzer", x: 700, y: 0 },
    { id: "led-resistor", type: "resistor", label: "220 ohm LED resistor", x: 700, y: 100, properties: { resistance: 220 } },
    { id: "alarm-led", type: "led", label: "Alarm LED", x: 900, y: 100 },
  );
  project.connections.push(
    { id: "soil-vcc", from: { componentId: "soil", pin: "VCC" }, to: { componentId: "uno", pin: "5V" } },
    { id: "soil-gnd", from: { componentId: "soil", pin: "GND" }, to: { componentId: "uno", pin: "GND" } },
    { id: "soil-out", from: { componentId: "soil", pin: "AOUT" }, to: { componentId: "uno", pin: "A0" } },
    { id: "buzzer-positive", from: { componentId: "buzzer", pin: "+" }, to: { componentId: "uno", pin: "D9" } },
    { id: "buzzer-ground", from: { componentId: "buzzer", pin: "-" }, to: { componentId: "uno", pin: "GND" } },
    { id: "led-drive", from: { componentId: "uno", pin: "D10" }, to: { componentId: "led-resistor", pin: "1" } },
    { id: "led-limit", from: { componentId: "led-resistor", pin: "2" }, to: { componentId: "alarm-led", pin: "A" } },
    { id: "led-ground", from: { componentId: "alarm-led", pin: "K" }, to: { componentId: "uno", pin: "GND" } },
  );
  const prompt = "Use a KY-040 to adjust the dry-soil threshold, start at 35%, turn on the LED and buzzer when soil moisture drops below the threshold, and turn them off only after moisture rises 5 percentage points above it.";
  const valid = `#include <Encoder.h>
Encoder knob(2,3); int threshold=35; long previousPosition=0; bool alarmOn=false; bool muted=false; int previousSwitch=HIGH;
void setup(){ pinMode(4,INPUT_PULLUP); pinMode(9,OUTPUT); pinMode(10,OUTPUT); }
void loop(){ long position=knob.read(); int steps=(position-previousPosition)/4; if(steps!=0){ threshold=constrain(threshold+steps*5,20,70); previousPosition=previousPosition+steps*4; } int moisture=100-analogRead(A0)*100/1023; int sw=digitalRead(4); if(moisture<threshold) alarmOn=true; if(moisture>threshold+5){ alarmOn=false; muted=false; } if(sw==LOW && previousSwitch==HIGH && alarmOn) muted=true; previousSwitch=sw; digitalWrite(10,alarmOn?HIGH:LOW); if(alarmOn && !muted) tone(9,1000); else noTone(9); delay(20); }`;
  const missingHysteresis = valid.replace("if(moisture<threshold) alarmOn=true; if(moisture>threshold+5){ alarmOn=false; muted=false; }", "alarmOn=moisture<threshold; if(!alarmOn) muted=false;");
  assert.deepEqual(sensorThresholdBehaviorIssues(project, valid, prompt), []);
  const issues = sensorThresholdBehaviorIssues(project, missingHysteresis, prompt);
  assert.equal(issues.length, 1, JSON.stringify(issues));
  assert.match(issues[0]!, /did not retain its alarm through the 5-unit hysteresis band/);
  assert.match(issues[0]!, /moisture=33/);
  assert.match(issues[0]!, /moisture=39/);

  const multiwordThresholdPrompt = "Start the dry-soil threshold at 35%. Activate the alarm when soil moisture falls below the selected soil-moisture threshold and clear it only after moisture rises 5 percentage points above the threshold.";
  const multiwordContract = sensorThresholdContract(project, multiwordThresholdPrompt);
  assert.equal(multiwordContract?.direction, "low");
  assert.equal(multiwordContract?.threshold, 35);
  assert.equal(multiwordContract?.hysteresis, 5);
  assert.deepEqual(sensorThresholdBehaviorIssues(project, valid, multiwordThresholdPrompt), []);
  assert.match(sensorThresholdBehaviorIssues(project, missingHysteresis, multiwordThresholdPrompt)[0]!, /did not retain its alarm through the 5-unit hysteresis band/);
});

test("sensor-threshold simulation parses lux-unit recovery offsets", () => {
  const project = structuredClone(COMPONENT_EXAMPLES["ky-040"]());
  project.components.push(
    { id: "light", type: "bh1750-sen0097", label: "Lux sensor", x: 500, y: 0, properties: { lux: 450 } },
    { id: "buzzer", type: "buzzer", label: "Alarm buzzer", x: 850, y: 0 },
    { id: "led-resistor", type: "resistor", label: "220 ohm LED resistor", x: 700, y: 100, properties: { resistance: 220 } },
    { id: "alarm-led", type: "led", label: "Alarm LED", x: 900, y: 100 },
  );
  project.connections.push(
    { id: "light-vcc", from: { componentId: "light", pin: "VCC" }, to: { componentId: "uno", pin: "3V3" } },
    { id: "light-ground", from: { componentId: "light", pin: "GND" }, to: { componentId: "uno", pin: "GND" } },
    { id: "light-sda", from: { componentId: "light", pin: "SDA" }, to: { componentId: "uno", pin: "A4" } },
    { id: "light-scl", from: { componentId: "light", pin: "SCL" }, to: { componentId: "uno", pin: "A5" } },
    { id: "light-add", from: { componentId: "light", pin: "ADD" }, to: { componentId: "uno", pin: "GND" } },
    { id: "buzzer-positive", from: { componentId: "buzzer", pin: "+" }, to: { componentId: "uno", pin: "D9" } },
    { id: "buzzer-ground", from: { componentId: "buzzer", pin: "-" }, to: { componentId: "uno", pin: "GND" } },
    { id: "led-drive", from: { componentId: "uno", pin: "D10" }, to: { componentId: "led-resistor", pin: "1" } },
    { id: "led-limit", from: { componentId: "led-resistor", pin: "2" }, to: { componentId: "alarm-led", pin: "A" } },
    { id: "led-ground", from: { componentId: "alarm-led", pin: "K" }, to: { componentId: "uno", pin: "GND" } },
  );
  project.code = `#include <Wire.h>
#include <BH1750.h>
BH1750 lightMeter; int target=450; bool alarm=false;
void setup(){ Wire.begin(); lightMeter.begin(); pinMode(9,OUTPUT); pinMode(10,OUTPUT); }
void loop(){ float lux=lightMeter.readLightLevel(); if(!alarm && lux<target) alarm=true; if(alarm && lux>=target+100) alarm=false; digitalWrite(10,alarm?HIGH:LOW); if(alarm) tone(9,1000); else noTone(9); delay(20); }`;
  const prompt = "Start the lux target at 450. When light level is below target, activate the LED and buzzer; keep both outputs active inside the hysteresis band and recover only when lux reaches target plus 100 lux.";
  assert.equal(sensorThresholdContract(project, prompt)?.hysteresis, 100);
  assert.deepEqual(sensorThresholdBehaviorIssues(project, project.code, prompt), []);

  const independentOutputPrompt = "Start the lux target at 450. When lux is below the target, activate the LED and keep it active until lux reaches target plus 100 lux. Sound the buzzer only while lux is below half the target.";
  const independentOutputCode = project.code.replace("if(alarm) tone(9,1000); else noTone(9);", "if(lux<target/2) tone(9,1000); else noTone(9);");
  assert.deepEqual(sensorThresholdContract(project, independentOutputPrompt)?.outputIds, ["alarm-led"], "the target hysteresis contract must include the LED but exclude the independently thresholded buzzer");
  assert.deepEqual(sensorThresholdBehaviorIssues(project, independentOutputCode, independentOutputPrompt), [], "the correct independent buzzer threshold must not be rejected against the LED's target threshold");

  const missingHysteresis = project.code.replace("if(!alarm && lux<target) alarm=true; if(alarm && lux>=target+100) alarm=false;", "alarm=lux<target;");
  assert.notEqual(missingHysteresis, project.code, "the regression candidate must remove its recovery latch");
  const issues = sensorThresholdBehaviorIssues(project, missingHysteresis, prompt);
  assert.equal(issues.length, 1, JSON.stringify(issues));
  assert.match(issues[0]!, /retain its alarm through the 100-unit hysteresis band/);
});

test("generation sends failed sensor hysteresis states to whole-project repair", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const project = structuredClone(COMPONENT_EXAMPLES["ky-040"]());
  project.components.push(
    { id: "soil", type: "soil-moisture-sen0193", label: "Soil moisture", x: 500, y: 0, properties: { moisture: 50 } },
    { id: "buzzer", type: "buzzer", label: "Alarm buzzer", x: 700, y: 0 },
    { id: "led-resistor", type: "resistor", label: "220 ohm LED resistor", x: 700, y: 100, properties: { resistance: 220 } },
    { id: "alarm-led", type: "led", label: "Alarm LED", x: 900, y: 100 },
  );
  project.connections.push(
    { id: "soil-vcc", from: { componentId: "soil", pin: "VCC" }, to: { componentId: "uno", pin: "5V" } },
    { id: "soil-gnd", from: { componentId: "soil", pin: "GND" }, to: { componentId: "uno", pin: "GND" } },
    { id: "soil-out", from: { componentId: "soil", pin: "AOUT" }, to: { componentId: "uno", pin: "A0" } },
    { id: "buzzer-positive", from: { componentId: "buzzer", pin: "+" }, to: { componentId: "uno", pin: "D9" } },
    { id: "buzzer-ground", from: { componentId: "buzzer", pin: "-" }, to: { componentId: "uno", pin: "GND" } },
    { id: "led-drive", from: { componentId: "uno", pin: "D10" }, to: { componentId: "led-resistor", pin: "1" } },
    { id: "led-limit", from: { componentId: "led-resistor", pin: "2" }, to: { componentId: "alarm-led", pin: "A" } },
    { id: "led-ground", from: { componentId: "alarm-led", pin: "K" }, to: { componentId: "uno", pin: "GND" } },
  );
  const accepted = structuredClone(project);
  accepted.code = `#include <Encoder.h>
Encoder knob(2,3); int threshold=35; long previousPosition=0; bool alarmOn=false;
void setup(){ pinMode(4,INPUT_PULLUP); pinMode(9,OUTPUT); pinMode(10,OUTPUT); }
void loop(){ long position=knob.read(); int steps=(position-previousPosition)/4; if(steps!=0){ threshold=constrain(threshold+steps*5,20,70); previousPosition=previousPosition+steps*4; } int moisture=100-analogRead(A0)*100/1023; if(moisture<threshold) alarmOn=true; if(moisture>threshold+5) alarmOn=false; digitalWrite(10,alarmOn?HIGH:LOW); if(alarmOn) tone(9,1000); else noTone(9); delay(20); }`;
  project.code = accepted.code.replace("if(moisture<threshold) alarmOn=true; if(moisture>threshold+5) alarmOn=false;", "alarmOn=moisture<threshold;");
  const prompt = "Create an Arduino Uno soil-moisture alarm with one SEN0193 sensor, a KY-040 encoder, a piezo buzzer, and a red LED with its own 220 ohm resistor. Start the threshold at 35%; use encoder rotation to adjust it from 20% to 70% in 5% steps. Turn on the LED and buzzer when soil moisture drops below the threshold and clear them only after it rises 5 percentage points above the threshold.";
  let calls = 0;
  let repairIssues: string[] = [];
  let generationGuidance = "";
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const request = JSON.parse(String(init?.body));
    const content = JSON.parse(request.contents[0].parts[0].text);
    generationGuidance = request.systemInstruction?.parts?.[0]?.text ?? "";
    repairIssues = content.validationIssues ?? [];
    return modelResponse(JSON.stringify({
      project: Array.isArray(content.validationIssues) ? accepted : project,
      explanation: "Soil sensor with adjustable alarm and recovery hysteresis.", assumptions: [], warnings: [],
    }));
  };
  const response = await POST(new Request("http://localhost/api/ai/generate", { method: "POST", body: JSON.stringify({ prompt }) }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify({ body, repairIssues }));
  assert.equal(calls, 2, "the first candidate must fail sensor-state simulation and the repair must pass");
  assert.ok(repairIssues.some(issue => issue.includes("threshold behavior") && issue.includes("moisture=39")), JSON.stringify(repairIssues));
  assert.match(generationGuidance, /HYSTERESIS CONTROL/);
  assert.match(generationGuidance, /SEN0193.*dry reading.*high ADC value/i);
  assert.match(body.project.code, /threshold\+5/);
});

test("encoder reset validation rotates the setpoint before comparing an SW press", () => {
  const project = structuredClone(COMPONENT_EXAMPLES["ky-040"]());
  project.code = [
    "#include <Encoder.h>",
    "Encoder knob(2,3);",
    "long previousPosition = 0;",
    "int threshold = 35;",
    "int previousSwitch = HIGH;",
    "void setup(){ Serial.begin(9600); pinMode(4, INPUT_PULLUP); }",
    "void loop(){ long position = knob.read(); if(position != previousPosition){ threshold = constrain(35 + position * 2, 20, 70); previousPosition = position; } int switchState = digitalRead(4); if(switchState == LOW && previousSwitch == HIGH){ threshold = 35; } previousSwitch = switchState; Serial.println(threshold); delay(20); }",
  ].join("\n");
  for (const prompt of [
    "Turn the KY-040 to adjust the threshold, then pressing its SW switch resets the threshold to 35 percent.",
    "Turn the knob to change the light level; pressing encoder SW restores 250 lux.",
  ]) {
    const released = simulateButtonScenario(project, project.code, undefined, prompt);
    const pressed = simulateButtonScenario(project, project.code, "device", prompt);
    assert.equal(
      hasObservableButtonEffect(project, released, pressed),
      true,
      JSON.stringify({ prompt, released: released.at(-1)?.serial.at(-1)?.text, pressed: pressed.at(-1)?.serial.at(-1)?.text }),
    );
    assert.equal(
      hasObservableButtonEffectAfterRelease(project, released, pressed),
      true,
      "the reset remains observable after SW is released",
    );
  }

  project.code = `#include <Encoder.h>
Encoder knob(2,3);
int threshold=35;
int previousSwitch=HIGH;
void setup(){ Serial.begin(9600); pinMode(4,INPUT_PULLUP); }
void loop(){ threshold=map(knob.read(),0,100,20,70); int switchState=digitalRead(4); if(switchState==LOW && previousSwitch==HIGH){ threshold=35; } previousSwitch=switchState; Serial.println(threshold); delay(20); }`;
  const prompt = "Turn the KY-040 to adjust the threshold, then pressing its SW switch resets the threshold to 35 percent.";
  const released = simulateButtonScenario(project, project.code, undefined, prompt);
  const pressed = simulateButtonScenario(project, project.code, "device", prompt);
  assert.equal(hasObservableButtonEffect(project, released, pressed), false, "absolute mapping overwrites its brief reset during the held press");
  assert.equal(hasObservableButtonEffectAfterRelease(project, released, pressed), false, "absolute encoder mapping overwrites the reset after SW release");
});

test("encoder reset validation observes servo outputs and exercises a temperature between targets", () => {
  const project = structuredClone(COMPONENT_EXAMPLES["ky-040"]());
  project.components.push(
    { id: "temperature", type: "temperature-sensor", label: "Ambient temperature", x: 650, y: 200, properties: { temperatureC: 25 } },
    { id: "vent", type: "servo", label: "Vent servo", x: 900, y: 200 },
  );
  project.connections.push(
    { id: "temperature-vcc", from: { componentId: "temperature", pin: "VCC" }, to: { componentId: "uno", pin: "5V" } },
    { id: "temperature-gnd", from: { componentId: "temperature", pin: "GND" }, to: { componentId: "uno", pin: "GND" } },
    { id: "temperature-out", from: { componentId: "temperature", pin: "OUT" }, to: { componentId: "uno", pin: "A0" } },
    { id: "vent-vcc", from: { componentId: "vent", pin: "VCC" }, to: { componentId: "uno", pin: "5V" } },
    { id: "vent-gnd", from: { componentId: "vent", pin: "GND" }, to: { componentId: "uno", pin: "GND" } },
    { id: "vent-signal", from: { componentId: "vent", pin: "SIG" }, to: { componentId: "uno", pin: "D9" } },
  );
  project.code = `#include <Encoder.h>
#include <Servo.h>
Encoder knob(2,3); Servo vent;
int target=26; long previousPosition=0; int previousSwitch=HIGH; bool open=false;
void setup(){ pinMode(4,INPUT_PULLUP); vent.attach(9); }
void loop(){ long position=knob.read(); long steps=(position-previousPosition)/4; if(steps!=0){ target=constrain(target+steps,20,36); previousPosition+=steps*4; }
int sw=digitalRead(4); if(sw==LOW && previousSwitch==HIGH){ target=26; knob.write(0); previousPosition=0; } previousSwitch=sw;
float temperature=(analogRead(A0)*5.0/1023.0-0.5)*100.0;
if(!open && temperature>target) open=true; if(open && temperature<target-2) open=false; vent.write(open?90:0); delay(20); }`;
  const prompt = "Use a KY-040 to adjust a temperature target starting at 26 C. Open a servo vent when temperature rises above the adjustable target, and keep it open until temperature falls 2 degrees below the target. Press encoder SW to reset the target to 26 C.";
  const released = simulateButtonScenario(project, project.code, undefined, prompt);
  const pressed = simulateButtonScenario(project, project.code, "device", prompt);
  assert.equal(released.at(-1)?.servos[0]?.angle, 0, "the test temperature between adjusted and reset targets closes the vent before reset");
  assert.equal(pressed.at(-1)?.servos[0]?.angle, 90, "resetting the target reopens the vent at the same temperature");
  assert.equal(hasObservableButtonEffect(project, released, pressed), true, "servo state is a visible reset effect even without a componentStates entry");
  assert.equal(hasObservableButtonEffectAfterRelease(project, released, pressed), true, "the reset effect persists after SW is released");
});

test("generation repairs an encoder reset that absolute-count mapping overwrites", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const broken = structuredClone(COMPONENT_EXAMPLES["ky-040"]());
  broken.code = `#include <Encoder.h>
Encoder knob(2,3);
int threshold=35;
int previousSwitch=HIGH;
void setup(){ Serial.begin(9600); pinMode(4,INPUT_PULLUP); }
void loop(){ threshold=map(knob.read(),0,100,20,70); int switchState=digitalRead(4); if(switchState==LOW && previousSwitch==HIGH){ threshold=35; } previousSwitch=switchState; Serial.println(threshold); delay(20); }`;
  const repaired = { ...structuredClone(broken), code: KY040_CONTROL_EXAMPLE_CODE };
  let calls = 0;
  let repairIssues: string[] = [];
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const request = JSON.parse(String(init?.body));
    const content = JSON.parse(request.contents[0].parts[0].text);
    repairIssues = content.validationIssues ?? [];
    return modelResponse(JSON.stringify({ project: content.validationIssues ? repaired : broken, explanation: "The setpoint resets through relative encoder state.", assumptions: [], warnings: [] }));
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST",
    body: JSON.stringify({ prompt: "Use a KY-040 to adjust a threshold from 20% to 70% in 5% steps. Pressing encoder SW restores the threshold to 35%, and it must remain at that default after release." }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify({ body, repairIssues }));
  assert.equal(calls, 2, "the invalid complete candidate receives one repair call");
  assert.ok(repairIssues.some(issue => issue.includes("button behavior") && issue.includes("absolute count")), JSON.stringify(repairIssues));
  assert.equal(body.project.code, KY040_CONTROL_EXAMPLE_CODE);
});

test("encoder behavior validation rotates an encoder in one continuous simulator session", () => {
  const project = structuredClone(COMPONENT_EXAMPLES["ky-040"]());
  project.components.find(component => component.id === "device")!.properties = { position: 3, pressed: false };
  project.code = KY040_CONTROL_EXAMPLE_CODE;
  const initial = simulateEncoderScenario(project, project.code, "device", 0);
  const rotated = simulateEncoderScenario(project, project.code, "device", 20);
  assert.equal(hasObservableEncoderEffect(project, initial, rotated, false), true, "relative encoder state is validated through a simulated rotation from zero");
});

test("a request for an unsupported capacitor gets a clear alternative before model calls", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return new Response("unexpected model call", { status: 500 });
  };
  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST",
    body: JSON.stringify({ prompt: "Create a WS2812B strip circuit with its required bulk capacitor." }),
  }));
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "COMPONENT_UNAVAILABLE");
  assert.match(body.error.message, /capacitor is not in Cirkitra's supported component catalog/);
  assert.ok(body.error.details.some((detail: string) => /add it as a physical hardware note after export/.test(detail)));
  assert.equal(providerCalls, 0, "unsupported parts should be identified before spending time on generation retries");
});

test("an unsupported DHT11 request is rejected with the supported DHT22 alternative", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return new Response("unexpected model call", { status: 500 });
  };
  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST",
    body: JSON.stringify({ prompt: "Build a temperature and humidity monitor using a DHT11 and LCD." }),
  }));
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "COMPONENT_UNAVAILABLE");
  assert.match(body.error.message, /DHT11 is not in Cirkitra's supported component catalog/);
  assert.ok(body.error.details.some((detail: string) => /DHT22 \(AM2302\)/.test(detail)));
  assert.equal(providerCalls, 0, "an unavailable sensor must not be silently replaced by a different part");
});

test("LED current-limit validation catches an output that bypasses its resistor without flagging an input", () => {
  const project = createDefaultBlinkProject();
  assert.deepEqual(ledSeriesResistorIssues(project), [], "the standard board → resistor → LED → ground branch is valid");

  project.connections.push({
    id: "led-direct-output-bypass",
    from: { componentId: "uno", pin: "D4" },
    to: { componentId: "led1", pin: "A" },
  });
  project.code = project.code.replace("void setup() {", "void setup() {\n  pinMode(4, OUTPUT);\n  digitalWrite(4, HIGH);");
  const bypassIssues = ledSeriesResistorIssues(project);
  assert.equal(bypassIssues.length, 1, bypassIssues.join("\n"));
  assert.match(bypassIssues[0], /LED_SERIES_RESISTOR_BYPASSED/);
  assert.match(bypassIssues[0], /D4/);

  project.code = project.code.replace("pinMode(4, OUTPUT);\n  digitalWrite(4, HIGH);", "pinMode(4, INPUT);");
  assert.deepEqual(ledSeriesResistorIssues(project), [], "a high-impedance input sharing the LED net does not bypass the resistor");
});

test("generation inserts a visible series limiter for a uniquely wired bare LED and the repaired branch simulates", () => {
  const bareLed = createDefaultBlinkProject();
  bareLed.components = bareLed.components.filter(component => component.id !== "r1");
  bareLed.connections = bareLed.connections.filter(connection => connection.from.componentId !== "r1" && connection.to.componentId !== "r1");
  bareLed.connections.push({
    id: "uno-to-bare-led",
    from: { componentId: "uno", pin: "D13" },
    to: { componentId: "led1", pin: "A" },
  });
  assert.ok(ledSeriesResistorIssues(bareLed).some(issue => issue.includes("LED_CURRENT_LIMIT_MISSING")));

  const repaired = repairMissingLedCurrentLimiters(bareLed);
  const limiter = repaired.project.components.find(component => component.type === "resistor");
  assert.ok(limiter, "repair must add a real, visible resistor component");
  assert.equal(limiter.properties?.resistance, 220);
  assert.ok(repaired.repairs.length);
  assert.deepEqual(ledSeriesResistorIssues(repaired.project), []);

  const simulator = new ArduinoSimulator(repaired.project.code);
  simulator.attachProject(repaired.project);
  simulator.run();
  simulator.advance(0);
  const snapshot = simulator.getSnapshot();
  assert.equal(snapshot.componentStates.led1?.powered, true, JSON.stringify({ componentState: snapshot.componentStates.led1, diagnostics: snapshot.diagnostics }));
  assert.equal(snapshot.diagnostics.some(diagnostic => diagnostic.severity === "error"), false);
});

test("generation reuses a single floating planned limiter but leaves ambiguous LED wiring for Gemini", () => {
  const withPlannedLimiter = createDefaultBlinkProject();
  withPlannedLimiter.connections = withPlannedLimiter.connections.filter(connection => connection.from.componentId !== "r1" && connection.to.componentId !== "r1");
  withPlannedLimiter.connections.push({
    id: "uno-to-bare-led",
    from: { componentId: "uno", pin: "D13" },
    to: { componentId: "led1", pin: "A" },
  });
  const reused = repairMissingLedCurrentLimiters(withPlannedLimiter);
  assert.equal(reused.project.components.filter(component => component.type === "resistor").length, 1);
  assert.ok(reused.project.connections.some(connection => [connection.from, connection.to].some(endpoint => endpoint.componentId === "r1")));
  assert.deepEqual(ledSeriesResistorIssues(reused.project), []);

  const ambiguous = createDefaultBlinkProject();
  ambiguous.components = ambiguous.components.filter(component => component.id !== "r1");
  ambiguous.connections = ambiguous.connections.filter(connection => connection.from.componentId !== "r1" && connection.to.componentId !== "r1");
  ambiguous.connections.push(
    { id: "uno-to-led-d13", from: { componentId: "uno", pin: "D13" }, to: { componentId: "led1", pin: "A" } },
    { id: "uno-to-led-d12", from: { componentId: "uno", pin: "D12" }, to: { componentId: "led1", pin: "A" } },
  );
  ambiguous.code = ambiguous.code.replace("  pinMode(LED_PIN, OUTPUT);", "  pinMode(LED_PIN, OUTPUT);\n  pinMode(12, OUTPUT);\n  digitalWrite(12, HIGH);");
  const before = JSON.stringify(ambiguous);
  const skipped = repairMissingLedCurrentLimiters(ambiguous);
  assert.deepEqual(skipped.repairs, [], "a repair must not guess when multiple driven pins meet the LED");
  assert.equal(JSON.stringify(skipped.project), before, "an ambiguous failed project remains unchanged");
});

function threeLedSharedGroundProject() {
  const project = createDefaultBlinkProject();
  const board = project.components.find(component => component.id === "uno")!;
  const firstLed = project.components.find(component => component.id === "led1")!;
  const leds = [firstLed, ...[2, 3].map(index => ({
    ...firstLed, id: `led${index}`, label: `Indicator ${index}`, x: firstLed.x + index * 160,
  }))];
  project.components = [board, ...leds];
  project.connections = leds.flatMap((led, index) => [
    { id: `wire-${led.id}-drive`, from: { componentId: "uno", pin: `D${index + 2}` }, to: { componentId: led.id, pin: "A" } },
    { id: `wire-${led.id}-ground`, from: { componentId: led.id, pin: "K" }, to: { componentId: "uno", pin: "GND" } },
  ]);
  project.code = `void setup() { pinMode(2, OUTPUT); pinMode(3, OUTPUT); pinMode(4, OUTPUT); }
void loop() { digitalWrite(2, HIGH); digitalWrite(3, HIGH); digitalWrite(4, HIGH); }`;
  return project;
}

test("generation inserts one distinct limiter for each LED sharing a ground return", () => {
  const project = threeLedSharedGroundProject();
  const result = repairMissingLedCurrentLimiters(project);
  assert.equal(result.repairs.length, 3, result.repairs.join("\n"));
  assert.equal(result.project.components.filter(component => component.type === "resistor").length, 3);
  assert.deepEqual(ledSeriesResistorIssues(result.project), []);

  const resistorIds = new Set<string>();
  for (const ledId of ["led1", "led2", "led3"]) {
    const drive = result.project.connections.find(connection => connection.id === `wire-${ledId}-drive`);
    assert.ok(drive);
    const resistorEndpoint = [drive.from, drive.to].find(endpoint => endpoint.componentId !== "uno");
    assert.ok(resistorEndpoint);
    assert.equal(result.project.components.find(component => component.id === resistorEndpoint.componentId)?.type, "resistor");
    resistorIds.add(resistorEndpoint.componentId);
    assert.ok(result.project.connections.some(connection =>
      [connection.from, connection.to].some(endpoint => endpoint.componentId === resistorEndpoint.componentId)
        && [connection.from, connection.to].some(endpoint => endpoint.componentId === ledId && endpoint.pin === "A")));
  }
  assert.equal(resistorIds.size, 3, "each LED must have its own current limiter");

  const simulator = new ArduinoSimulator(result.project.code);
  simulator.attachProject(result.project);
  simulator.run();
  simulator.advance(0);
  const snapshot = simulator.getSnapshot();
  for (const id of ["led1", "led2", "led3"]) assert.equal(snapshot.componentStates[id]?.powered, true, id);
  assert.equal(snapshot.diagnostics.some(diagnostic => diagnostic.severity === "error"), false);
});

test("generation diagnostics keep a shared-ground LED fault on its owning indicator branch", () => {
  const project = threeLedSharedGroundProject();
  project.components.push({ id: "soil", type: "soil-moisture-sen0193", label: "Soil sensor", x: 900, y: 0 });
  project.connections.push(
    { id: "soil-vcc", from: { componentId: "soil", pin: "VCC" }, to: { componentId: "uno", pin: "5V" } },
    { id: "soil-ground", from: { componentId: "soil", pin: "GND" }, to: { componentId: "uno", pin: "GND" } },
    { id: "soil-data", from: { componentId: "soil", pin: "AOUT" }, to: { componentId: "uno", pin: "A0" } },
  );
  const diagnostic = structuredIssueDiagnostics(project, [
    "project.circuit LED_CURRENT_LIMIT_MISSING: Indicator 2#led2 is missing a dedicated limiter at its driven anode.",
  ])[0]!;
  assert.deepEqual(diagnostic.componentIds, ["led2"]);
  assert.deepEqual(new Set(diagnostic.wireIds), new Set(["wire-led2-drive", "wire-led2-ground"]));
  assert.ok(diagnostic.wireIds.every(id => !/led1|led3|soil/.test(id)));
  assert.equal(diagnostic.nets.length, 2, "the anode and shared-ground return remain separate endpoint nets");
  assert.ok(diagnostic.nets.every(net => net.endpoints.some(endpoint => endpoint.componentId === "led2")));
});

test("generation diagnostics map device-call failures to the unique device and its direct wires", () => {
  const project = {
    schemaVersion: 1 as const, id: "i2c-demo", name: "I2C demo", description: "test", board: "arduino-uno" as const,
    code: [
      "#include <BH1750.h>",
      "#include <Adafruit_SSD1306.h>",
      "BH1750 lightMeter;",
      "Adafruit_SSD1306 display(128,64,&Wire,-1);",
      "void setup(){ lightMeter.begin(); display.begin(SSD1306_SWITCHCAPVCC,0x3c); }",
      "void loop(){ delay(100); }",
    ].join("\n"),
    components: [
      { id: "uno", type: "arduino-uno", label: "Arduino Uno", x: 0, y: 0 },
      { id: "light", type: "bh1750-sen0097", label: "Light sensor", x: 300, y: 0 },
      { id: "display", type: "ssd1306-oled-128x64", label: "OLED", x: 600, y: 0 },
    ],
    connections: [
      { id: "light-vcc", from: { componentId: "light", pin: "VCC" }, to: { componentId: "uno", pin: "3V3" } },
      { id: "light-ground", from: { componentId: "light", pin: "GND" }, to: { componentId: "uno", pin: "GND" } },
      { id: "light-sda", from: { componentId: "light", pin: "SDA" }, to: { componentId: "uno", pin: "A4" } },
      { id: "light-scl", from: { componentId: "light", pin: "SCL" }, to: { componentId: "uno", pin: "A5" } },
      { id: "display-vcc", from: { componentId: "display", pin: "VCC" }, to: { componentId: "uno", pin: "3V3" } },
      { id: "display-ground", from: { componentId: "display", pin: "GND" }, to: { componentId: "uno", pin: "GND" } },
      { id: "display-sda", from: { componentId: "display", pin: "SDA" }, to: { componentId: "uno", pin: "A4" } },
      { id: "display-scl", from: { componentId: "display", pin: "SCL" }, to: { componentId: "uno", pin: "A5" } },
    ],
  };
  const diagnostic = structuredIssueDiagnostics(project, [
    "project.circuit DEVICE_NOT_CONNECTED: display.begin: no powered, correctly wired device responds.",
  ])[0]!;
  assert.deepEqual(diagnostic.componentIds, ["display"]);
  assert.deepEqual(new Set(diagnostic.wireIds), new Set(["display-vcc", "display-ground", "display-sda", "display-scl"]));
  assert.ok(diagnostic.nets.every(net => net.endpoints.some(endpoint => endpoint.componentId === "display")));
  assert.match(diagnostic.expectedTopology, /display maps to OLED#display/);
});

test("generation sends an LED resistor bypass back for a targeted model repair", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";

  const bypassed = createDefaultBlinkProject();
  bypassed.connections.push({
    id: "led-direct-output-bypass",
    from: { componentId: "uno", pin: "D4" },
    to: { componentId: "led1", pin: "A" },
  });
  bypassed.code = bypassed.code.replace("void setup() {", "void setup() {\n  pinMode(4, OUTPUT);\n  digitalWrite(4, HIGH);");
  const corrected = createDefaultBlinkProject();
  let calls = 0;
  let repairIssues: string[] = [];
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const request = JSON.parse(String(init?.body));
    const content = JSON.parse(request.contents[0].parts[0].text);
    repairIssues = content.validationIssues ?? [];
    return modelResponse(JSON.stringify({
      project: Array.isArray(content.validationIssues) ? corrected : bypassed,
      explanation: "The LED is driven through its current-limiting resistor.",
      assumptions: [],
      warnings: [],
    }));
  };

  const response = await POST(generationRequest());
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(calls, 2, "the model should receive the topology error before the circuit is published");
  assert.ok(repairIssues.some(issue => issue.includes("LED_SERIES_RESISTOR_BYPASSED")), JSON.stringify(repairIssues));
  assert.ok(!body.project.connections.some((connection: FixtureWire) => connection.id === "led-direct-output-bypass"));

  const simulator = new ArduinoSimulator();
  simulator.attachProject(body.project);
  simulator.run();
  simulator.advance(0);
  assert.equal(simulator.getSnapshot().diagnostics.some(diagnostic => diagnostic.severity === "error"), false);
});

test("ambiguous LED drive wiring is left for model repair instead of guessed", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";

  const ambiguous = createDefaultBlinkProject();
  ambiguous.connections = [
    { id: "led-d13", from: { componentId: "uno", pin: "D13" }, to: { componentId: "led1", pin: "A" } },
    { id: "led-d12", from: { componentId: "uno", pin: "D12" }, to: { componentId: "led1", pin: "A" } },
    { id: "led-ground", from: { componentId: "led1", pin: "K" }, to: { componentId: "uno", pin: "GND" } },
  ];
  ambiguous.code = `void setup() { pinMode(12, OUTPUT); pinMode(13, OUTPUT); }
void loop() { digitalWrite(12, HIGH); digitalWrite(13, HIGH); }`;
  const repaired = createDefaultBlinkProject();
  let repairIssues: string[] = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const request = JSON.parse(String(init?.body));
    const content = JSON.parse(request.contents[0].parts[0].text);
    if (Array.isArray(content.validationIssues)) repairIssues = content.validationIssues;
    return modelResponse(JSON.stringify({
      project: Array.isArray(content.validationIssues) ? repaired : ambiguous,
      explanation: "The LED now has one unambiguous current-limited output path.", assumptions: [], warnings: [],
    }));
  };

  const response = await POST(generationRequest());
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(calls, 2, "the initial full project and one whole-project repair are used");
  assert.ok(repairIssues.some(issue => issue.includes("LED_CURRENT_LIMIT_MISSING")), JSON.stringify(repairIssues));
  assert.deepEqual(ledSeriesResistorIssues(body.project), []);
});

const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
let providerMock: typeof fetch | undefined;
type FixtureComponent = { id: string; type: string; label?: string; x?: number; y?: number; rotation?: number; properties?: Record<string, unknown> };
type FixtureEndpoint = { componentId: string; pin: string };
type FixtureWire = { id?: string; from: FixtureEndpoint; to: FixtureEndpoint };
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

test("LCD generation always makes the supported 3-pin contrast potentiometer available", () => {
  const lcd = COMPONENT_CATALOG["lcd-16x2"]!;
  const potentiometer = COMPONENT_CATALOG.potentiometer!;
  const selected = includeRequiredSupportingParts([lcd]);
  assert.ok(selected.some(part => part.id === "potentiometer"));
  assert.equal(includeRequiredSupportingParts([lcd, potentiometer]).filter(part => part.id === "potentiometer").length, 1);
  assert.deepEqual(potentiometer.pins.map(pin => pin.id), ["VCC", "GND", "SIG"]);
});

const testProviderFetch: typeof fetch = async (input, init) => {
  if (!providerMock) throw new Error("No test provider response was configured");
  return providerMock(input, init);
};
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  enumerable: fetchDescriptor?.enumerable ?? true,
  get: () => testProviderFetch,
  set: value => {
    if (value === testProviderFetch) { providerMock = undefined; }
    else { providerMock = value as typeof fetch; }
  },
});
after(() => { if (fetchDescriptor) Object.defineProperty(globalThis, "fetch", fetchDescriptor); });

test("published runnable examples pass the generation endpoint without repair", async context => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalWarn = console.warn;
  context.after(() => {
    globalThis.fetch = originalFetch; console.warn = originalWarn;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  console.warn = () => {};
  for (const [id, make] of Object.entries({ ...COMPONENT_EXAMPLES, greenhouse: greenhouseExample })) await context.test(id, async () => {
    const project = make(); let calls = 0; let feedback = "";
    globalThis.fetch = async (_input, init) => {
      calls++;
      const request = JSON.parse(String(init?.body));
      const content = JSON.parse(request.contents[0].parts[0].text);
      if (id === "greenhouse") {
        const schema = request.generationConfig.responseJsonSchema.properties;
        assert.ok(schema.project.properties.code);
        assert.ok(schema.project.properties.components);
        assert.equal(request.generationConfig.maxOutputTokens, 65_536);
        assert.equal("projectId" in schema, false, "generation no longer makes a separate plan request");
      }
      if (id === "soil-moisture-sen0193") assert.match(request.systemInstruction?.parts?.[0]?.text ?? "", /SEN0193.*dry reading.*high ADC value/i, "the model must follow the simulator's actual soil-sensor polarity");
      if (content.validationIssues) feedback = JSON.stringify(content.validationIssues);
      return modelResponse(JSON.stringify({ project, explanation: "Runnable circuit", assumptions: [], warnings: [] }));
    };
    const response = await POST(new Request("http://localhost/api/ai/generate", {
      method: "POST", body: JSON.stringify({ prompt: id === "greenhouse" ? greenhousePrompt : `Create a circuit using ${[...new Set(project.components.map(c => c.type))].join(", ")}` }),
    }));
    const responseBody = await response.json();
    assert.equal(response.status, 200, `${id}: ${feedback} ${JSON.stringify(responseBody.error ?? responseBody)}`);
    assert.equal(calls, 1, `${id} should not require repairs: ${feedback}`);
  });
});

test("complete-project generation normalizes the supported TCA9548A selector safely", async context => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const project = greenhouseExample();
  const repairedProject = greenhouseExample();
  repairedProject.code = repairedProject.code.replace("void loop(){", 'void loop(){ Serial.println("selectMuxChannel is just text");');
  project.code = project.code
    .replaceAll(".selectChannel(", ".selectMuxChannel(")
    .replace("void loop(){", '/* mux.selectMuxChannel(7) in a comment */\nvoid loop(){\n  Serial.println("selectMuxChannel is just text");');
  let providerCalls = 0;
  let sketchInstructions = "";
  globalThis.fetch = async (_input, init) => {
    providerCalls += 1;
    const request = JSON.parse(String(init?.body));
    const content = JSON.parse(request.contents[0].parts[0].text);
    sketchInstructions = request.systemInstruction?.parts?.[0]?.text ?? sketchInstructions;
    const candidate = Array.isArray(content.validationIssues) ? repairedProject : project;
    return modelResponse(JSON.stringify({ project: candidate, explanation: "Reads both greenhouse zones and safely controls its fan.", assumptions: [], warnings: [] }));
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: greenhousePrompt }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(providerCalls, 1, "the safe simulator API alias should be normalized without a second generation call");
  assert.match(sketchInstructions, /mux\.selectChannel\(channel\)/);
  assert.match(sketchInstructions, /SIMULATOR-VALIDATED DUAL BME280 \/ TCA9548A PATTERN/);
  assert.match(sketchInstructions, /westOk = west\.begin\(0x76\)/);
  assert.match(sketchInstructions, /eastOk = east\.begin\(0x76\)/);
  assert.match(body.project.code, /mux\.selectChannel\(/);
  assert.doesNotMatch(body.project.code, /\n\s*mux\.selectMuxChannel\(/);
  assert.match(body.project.code, /Serial\.println\("selectMuxChannel is just text"\)/);
  assert.ok(body.warnings.some((warning: string) => warning.includes("selectMuxChannel()")), "the automatic API correction should be disclosed");
});

test("full-project greenhouse generation repairs a TB6612 duplicate output pad before publication", async context => {
  const previousFetch = globalThis.fetch; const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const malformedProject = greenhouseExample();
  const negativeLead = malformedProject.connections.find(connection =>
    [connection.from, connection.to].some(endpoint => endpoint.componentId === "fan-motor-a" && endpoint.pin === "-"));
  assert.ok(negativeLead);
  const motorLabel = malformedProject.components.find(component => component.id === "fan-motor-a")?.label;
  assert.ok(motorLabel);
  const mistakenPad = negativeLead.from.componentId === "fan-device" ? negativeLead.from : negativeLead.to;
  assert.equal(mistakenPad.pin, "AO2_5");
  mistakenPad.pin = "AO1_2";
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return modelResponse(JSON.stringify({ project: malformedProject, explanation: "Dual-zone greenhouse fan controller.", assumptions: [], warnings: [] }));
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST", body: JSON.stringify({ prompt: greenhousePrompt }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(providerCalls, 1, "the complete project should be corrected before it needs an AI repair");
  assert.ok(body.project.connections.some((connection: FixtureWire) =>
    [connection.from, connection.to].some(endpoint => endpoint.componentId === "fan-device" && endpoint.pin === "AO2_5")
      && [connection.from, connection.to].some(endpoint => endpoint.componentId === "fan-motor-a" && endpoint.pin === "-")));
  assert.ok(body.assumptions.some((assumption: string) => assumption.includes(`Corrected ${motorLabel} wiring across TB6612FNG channel A`)));
  const simulator = new ArduinoSimulator(body.project.code);
  simulator.attachProject(body.project);
  simulator.run();
  simulator.advance(100);
  const fanState = simulator.getSnapshot().componentStates["fan-motor-a"];
  assert.equal(fanState.direction, "forward");
  assert.ok(Math.abs((fanState.speed ?? 0) - 191 / 255) < 0.001);
  assert.ok((simulator.getSnapshot().componentStates["fan-supply"].readings?.current ?? 0) > 0.14);
});

test("normalizes schematic-style D pin names in generated Arduino code", async context => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const project = structuredClone(generatedEnvelope.project);
  project.code = `// D12 in a comment stays text\n#define LED_PIN D13\nvoid setup(){ pinMode(LED_PIN, OUTPUT); }\nvoid loop(){ digitalWrite(LED_PIN, HIGH); Serial.println("D11 stays text"); delay(10); }`;
  globalThis.fetch = async () => modelResponse(JSON.stringify({ project, explanation: "Blink circuit", assumptions: [], warnings: [] }));

  const response = await POST(generationRequest());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.match(body.project.code, /#define LED_PIN\s+13/);
  assert.match(body.project.code, /Serial\.println\("D11 stays text"\)/);
});

test("generation repairs a button debounce sketch that never changes the circuit", async context => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const project = createDefaultBlinkProject();
  project.name = "Button controlled LED";
  project.components.push({ id: "button", type: "push-button", label: "Button", x: 420, y: 360 });
  project.connections.push(
    { id: "button-input", from: { componentId: "button", pin: "1" }, to: { componentId: "uno", pin: "D2" } },
    { id: "button-ground", from: { componentId: "button", pin: "2" }, to: { componentId: "uno", pin: "GND" } },
  );
  const broken = structuredClone(project);
  broken.code = `bool lastButtonState = HIGH; unsigned long lastDebounceTime = 0; unsigned long debounceDelay = 50;
void setup(){ pinMode(13, OUTPUT); pinMode(2, INPUT_PULLUP); }
void loop(){ int reading = digitalRead(2); if (reading != lastButtonState) lastDebounceTime = millis(); if ((millis() - lastDebounceTime) > debounceDelay) { if (reading == LOW && lastButtonState == HIGH) digitalWrite(13, HIGH); } lastButtonState = reading; delay(10); }`;
  const repaired = structuredClone(project);
  repaired.code = `int lastButtonState = HIGH; bool ledOn = false;
void setup(){ pinMode(13, OUTPUT); pinMode(2, INPUT_PULLUP); }
void loop(){ int reading = digitalRead(2); if (reading == LOW && lastButtonState == HIGH) { ledOn = true; } lastButtonState = reading; digitalWrite(13, ledOn ? HIGH : LOW); delay(10); }`;
  let calls = 0;
  let repairIssues: string[] = [];
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const request = JSON.parse(String(init?.body));
    const content = JSON.parse(request.contents[0].parts[0].text);
    repairIssues = content.validationIssues ?? [];
    return modelResponse(JSON.stringify({ project: content.validationIssues ? repaired : broken, explanation: "Button controlled LED", warnings: [], assumptions: [] }));
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST",
    body: JSON.stringify({ prompt: "The pushbutton toggles the LED each time it is pressed." }),
  }));
  assert.equal(response.status, 200, JSON.stringify(repairIssues));
  assert.equal(calls, 2);
  assert.ok(repairIssues.some(issue => issue.includes("button behavior") && issue.includes("no observable circuit change")));
  assert.ok(repairIssues.some(issue => issue.includes("Final released state:") && issue.includes("outputPins")), "the repair receives observable before/after simulator state");
});

test("generation repairs a button-controlled edit when Gemini omits the button wires", async context => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const code = `void setup(){ pinMode(13, OUTPUT); pinMode(2, INPUT_PULLUP); }
void loop(){ if(digitalRead(2)==LOW){ digitalWrite(13, LOW); } else { digitalWrite(13, HIGH); delay(500); digitalWrite(13, LOW); delay(500); } }`;
  let calls = 0;
  let repairIssues: string[] = [];
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const request = JSON.parse(String(init?.body));
    const content = JSON.parse(request.contents[0].parts[0].text);
    repairIssues = content.validationIssues ?? [];
    return modelResponse(JSON.stringify({
      operations: [
        { type: "add_component", component: { id: "button", type: "push-button", label: "Target Button", x: 420, y: 360, rotation: 0, properties: {} } },
        { type: "set_program", boardId: "uno", code },
        ...(Array.isArray(content.validationIssues) ? [
          { type: "add_connection", from: { componentId: "button", pin: "1" }, to: { componentId: "uno", pin: "D2" } },
          { type: "add_connection", from: { componentId: "button", pin: "2" }, to: { componentId: "uno", pin: "GND" } },
        ] : []),
      ],
      explanation: "The button controls whether the LED blinks.",
      warnings: [],
      assumptions: [],
    }));
  };

  const prompt = "Edit the current circuit. Keep its Arduino Uno, red LED, 220 ohm resistor, existing wires, and blink behavior. Add one push button between D2 and GND using INPUT_PULLUP. When the button is pressed, keep the LED off; when released, blink it every 500 milliseconds.";
  const response = await POST(requestWithCurrentProject(prompt, "edit"));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(repairIssues));
  assert.equal(calls, 2, "the missing input connection should trigger one targeted repair");
  assert.ok(repairIssues.some(issue => issue.includes("button behavior") && issue.includes("no observable circuit change")));
  assert.equal(body.generationMode, "edit");
  assert.equal(body.project.connections.filter((connection: FixtureWire) => [connection.from, connection.to].some(endpoint => endpoint.componentId === "button")).length, 2);
  assert.deepEqual(body.project.connections.slice(0, createDefaultBlinkProject().connections.length), createDefaultBlinkProject().connections);
});

test("generation repairs an LED circuit that directly shorts its anode and cathode", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";

  const shorted = structuredClone(createDefaultBlinkProject());
  shorted.code = `void setup() { pinMode(13, OUTPUT); }
void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}`;
  shorted.connections.push({
    id: "led-short",
    from: { componentId: "led1", pin: "K" },
    to: { componentId: "led1", pin: "A" },
  });
  const corrected = structuredClone(createDefaultBlinkProject());
  let calls = 0;
  let repairIssues: string[] = [];
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const request = JSON.parse(String(init?.body));
    const content = JSON.parse(request.contents[0].parts[0].text);
    repairIssues = content.validationIssues ?? [];
    return modelResponse(JSON.stringify({
      project: Array.isArray(content.validationIssues) ? corrected : shorted,
      explanation: "The Uno blinks the LED through its resistor.",
      assumptions: [],
      warnings: [],
    }));
  };

  const response = await POST(generationRequest());
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(calls, 2, "the shorted first proposal must receive a targeted repair");
  assert.ok(repairIssues.some(issue => issue.includes("output-contention")), JSON.stringify(repairIssues));
  assert.equal(body.project.connections.some((connection: FixtureWire) =>
    [connection.from, connection.to].some(endpoint => endpoint.componentId === "led1" && endpoint.pin === "K")
      && [connection.from, connection.to].some(endpoint => endpoint.componentId === "led1" && endpoint.pin === "A")), false);

  const simulator = new ArduinoSimulator();
  simulator.attachProject(body.project);
  simulator.run();
  for (let elapsed = 0; elapsed < 2_000; elapsed += 100) simulator.advance(100);
  assert.equal(simulator.getSnapshot().diagnostics.some(diagnostic => diagnostic.severity === "error"), false);
});

test("generation checks the integrated KY-040 switch rather than counting its state as the action", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const project = structuredClone(COMPONENT_EXAMPLES["ky-040"]());
  const broken = structuredClone(project);
  broken.code = `bool lastButtonState = HIGH;
unsigned long lastDebounceTime = 0;
unsigned long debounceDelay = 50;
void setup(){
  pinMode(4, INPUT_PULLUP);
  pinMode(13, OUTPUT);
}
void loop(){
  int reading = digitalRead(4);
  if (reading != lastButtonState) lastDebounceTime = millis();
  if ((millis() - lastDebounceTime) > debounceDelay) {
    if (reading == LOW && lastButtonState == HIGH) digitalWrite(13, HIGH);
  }
  lastButtonState = reading;
  delay(10);
}`;
  const repaired = structuredClone(project);
  repaired.code = `int lastButtonState = HIGH;
bool outputOn = false;
void setup(){
  pinMode(4, INPUT_PULLUP);
  pinMode(13, OUTPUT);
}
void loop(){
  int reading = digitalRead(4);
  if (reading == LOW && lastButtonState == HIGH) outputOn = !outputOn;
  lastButtonState = reading;
  digitalWrite(13, outputOn ? HIGH : LOW);
  delay(10);
}`;
  let calls = 0;
  let repairIssues: string[] = [];
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const request = JSON.parse(String(init?.body));
    const content = JSON.parse(request.contents[0].parts[0].text);
    repairIssues = content.validationIssues ?? [];
    return modelResponse(JSON.stringify({ project: content.validationIssues ? repaired : broken, explanation: "Encoder button controls output", warnings: [], assumptions: [] }));
  };
  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST",
    body: JSON.stringify({ prompt: "Press the KY-040 encoder push switch to toggle the output." }),
  }));
  assert.equal(response.status, 200, JSON.stringify(repairIssues));
  assert.equal(calls, 2);
  assert.ok(repairIssues.some(issue => issue.includes("button behavior") && issue.includes("no observable circuit change")));
});

test("generation repairs a rotary sketch that prints encoder position without changing the requested strip output", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";

  const project = structuredClone(COMPONENT_EXAMPLES["ky-040"]());
  project.components.push(
    { id: "temperature", type: "temperature-sensor", label: "Temperature", x: 650, y: 200, properties: { temperatureC: 40 } },
    { id: "strip", type: "ws2812b-strip-8", label: "WS2812B", x: 900, y: 0 },
    { id: "supply", type: "dc-supply", label: "5V strip supply", x: 650, y: 400, properties: { voltage: 5, enabled: true } },
  );
  project.connections.push(
    { id: "temperature-vcc", from: { componentId: "temperature", pin: "VCC" }, to: { componentId: "uno", pin: "5V" } },
    { id: "temperature-ground", from: { componentId: "temperature", pin: "GND" }, to: { componentId: "uno", pin: "GND" } },
    { id: "temperature-out", from: { componentId: "temperature", pin: "OUT" }, to: { componentId: "uno", pin: "A0" } },
    { id: "strip-vdd", from: { componentId: "strip", pin: "VDD" }, to: { componentId: "supply", pin: "+" } },
    { id: "strip-ground", from: { componentId: "strip", pin: "GND" }, to: { componentId: "uno", pin: "GND" } },
    { id: "strip-data", from: { componentId: "strip", pin: "DIN" }, to: { componentId: "uno", pin: "D6" } },
    { id: "supply-ground", from: { componentId: "supply", pin: "-" }, to: { componentId: "uno", pin: "GND" } },
  );
  project.components = project.components.map(component => component.id === "device"
    ? { ...component, properties: { ...component.properties, position: 0, pressed: false } }
    : component);
  const broken = structuredClone(project);
  broken.code = `#include <Encoder.h>\n#include <Adafruit_NeoPixel.h>\nEncoder knob(2,3); Adafruit_NeoPixel strip(8,6,NEO_GRB + NEO_KHZ800);\nvoid setup(){ strip.begin(); }\nvoid loop(){ int temperature=analogRead(A0); int position=knob.read(); uint32_t color=strip.Color(0,255,0); for(int i=0;i<8;i++) strip.setPixelColor(i,color); strip.show(); Serial.println(position); delay(20); }`;
  const repaired = structuredClone(project);
  repaired.code = `#include <Encoder.h>\n#include <Adafruit_NeoPixel.h>\nEncoder knob(2,3); Adafruit_NeoPixel strip(8,6,NEO_GRB + NEO_KHZ800);\nvoid setup(){ strip.begin(); }\nvoid loop(){ int temperature=analogRead(A0); int position=constrain(knob.read(),0,15); int threshold=map(position,0,15,20,35); int thresholdAdc=map(threshold,20,35,143,174); uint32_t color=strip.Color(0,255,0); if(temperature>thresholdAdc) color=strip.Color(255,0,0); for(int i=0;i<8;i++) strip.setPixelColor(i,color); strip.show(); Serial.println(threshold); delay(20); }`;

  let calls = 0;
  let repairIssues: string[] = [];
  let sketchInstructions = "";
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const request = JSON.parse(String(init?.body));
    const content = JSON.parse(request.contents[0].parts[0].text);
    sketchInstructions = request.systemInstruction?.parts?.[0]?.text ?? sketchInstructions;
    repairIssues = content.validationIssues ?? [];
    return modelResponse(JSON.stringify({
      project: content.validationIssues ? repaired : broken,
      explanation: "The encoder selects the WS2812B strip color.",
      assumptions: [], warnings: [],
    }));
  };
  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST",
    body: JSON.stringify({ prompt: "Create an Arduino Uno circuit with an analog temperature sensor, KY-040 encoder, WS2812B strip, and 5V DC supply. The encoder changes the temperature threshold from 20°C to 35°C as it is turned; show the strip red when the temperature is above the selected threshold and green otherwise. Print the selected threshold." }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(calls, 2, "an encoder sketch that only reports position must receive a targeted repair");
  assert.ok(repairIssues.some(issue => issue.includes("encoder behavior") && issue.includes("did not change an observable circuit output")), JSON.stringify(repairIssues));
  assert.match(sketchInstructions, /map and constrain the encoder position/i);

  for (const position of [0, 15]) {
    const scenario = structuredClone(body.project);
    const encoder = scenario.components.find((component: { type: string }) => component.type === "ky-040");
    encoder.properties = { ...encoder.properties, position };
    const temperature = scenario.components.find((component: { type: string }) => component.type === "temperature-sensor");
    temperature.properties = { ...temperature.properties, temperatureC: 27.5 };
    const simulator = new ArduinoSimulator(scenario.code);
    simulator.attachProject(scenario);
    simulator.run(); simulator.advance(0); simulator.advance(100);
    const pixel = simulator.getSnapshot().componentStates.strip?.pixels?.[0];
    assert.deepEqual([pixel?.r, pixel?.g], position === 0 ? [255, 0] : [0, 255]);
  }
});

test("a fresh single-board request ignores boards in the previous project", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const previousProject = structuredClone(generatedEnvelope.project);
  previousProject.components.push({ id: "old-mega", type: "arduino-mega-2560", label: "Old Mega", x: 400, y: 0 });
  previousProject.programs = { uno: previousProject.code, "old-mega": "void setup(){} void loop(){ delay(10); }" };
  let multipleBoardRuleSelected = false;
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    multipleBoardRuleSelected = request.systemInstruction.parts[0].text.includes("The user explicitly requested multiple boards.");
    return modelResponse(JSON.stringify({ project: generatedEnvelope.project, explanation: "Fresh Uno circuit", warnings: [], assumptions: [] }));
  };
  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST",
    body: JSON.stringify({ prompt: "Create a fresh single-board Uno circuit that blinks an LED.", currentProject: previousProject, generationModeOverride: "create" }),
  }));
  assert.equal(response.status, 200);
  assert.equal(multipleBoardRuleSelected, false, "the old multi-board canvas must not change a fresh-generation request into a multi-board request");
  const body = await response.json();
  assert.equal(body.project.components.filter((component: { type: string }) => component.type.startsWith("arduino-")).length, 1);
});

test("greenhouse mux, expander and externally supplied fan respond to live conditions", () => {
  const project = greenhouseExample();
  const sim = new ArduinoSimulator(project.code); sim.attachProject(project); sim.run(); sim.advance(100);
  assert.deepEqual(sim.getSnapshot().diagnostics.filter(d => d.severity === "error"), []);
  const states = sim.getSnapshot().componentStates;
  assert.equal(states["fan-motor-a"].direction, "forward");
  assert.ok(Math.abs(states["fan-motor-a"].speed! - 191 / 255) < 0.001);
  assert.ok(Math.abs((states["fan-supply"].readings?.current ?? 0) - 0.2 * (191 / 255)) < 0.002, JSON.stringify(states["fan-supply"]));
  for (const id of ["io-led", "led-1", "led-2"]) assert.equal(states[id].powered, true);
  project.components.find(c => c.id === "sensor")!.properties!.temperature = 24;
  project.components.find(c => c.id === "east")!.properties!.temperature = 26;
  sim.attachProject(project); sim.advance(500);
  assert.equal(sim.getSnapshot().componentStates["fan-motor-a"].speed, 0);
  assert.equal(sim.getSnapshot().componentStates["fan-supply"].readings?.current, 0);
  project.components.find(c => c.id === "sensor")!.properties!.temperature = 34;
  sim.attachProject(project); sim.advance(500);
  assert.ok(sim.getSnapshot().componentStates["fan-motor-a"].speed! > 0);
  assert.ok((sim.getSnapshot().componentStates["fan-supply"].readings?.current ?? 0) > 0.14);
  project.components.find(c => c.id === "fan-supply")!.properties!.enabled = false;
  sim.attachProject(project); sim.advance(500);
  assert.equal(sim.getSnapshot().componentStates["fan-motor-a"].direction, "coast");
  assert.equal(sim.getSnapshot().componentStates["fan-supply"].readings?.current, 0);
  project.components.find(c => c.id === "fan-supply")!.properties!.enabled = true;
  project.connections = project.connections.filter(w => !(w.from.componentId === "fan-supply" && w.from.pin === "-"));
  sim.attachProject(project); sim.advance(500);
  assert.equal(sim.getSnapshot().componentStates["fan-motor-a"].direction, "coast");
  project.connections.push({ id: "restore-return", from: { componentId: "fan-supply", pin: "-" }, to: { componentId: "uno", pin: "GND" } });
  project.connections = project.connections.filter(w => !(w.from.componentId === "sensor" && w.from.pin === "SDI"));
  sim.attachProject(project); sim.advance(500);
  assert.equal(sim.getSnapshot().componentStates["fan-motor-a"].speed, 0);
  assert.ok(sim.getSnapshot().serial.some(entry => entry.text === "Sensor unavailable"));
});

test("generation repairs missing mixed-board OLED bus wires only to its explicitly named ESP32", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const project = COMPONENT_EXAMPLES["ssd1306-oled-128x64"]();
  const board = project.components.find(component => component.id === "uno")!;
  board.id = "esp"; board.type = "esp32-devkitc-v4"; board.label = "ESP32 DevKitC V4";
  project.board = "esp32-devkitc-v4"; project.activeBoardId = "esp";
  project.components.push({ id: "pico", type: "raspberry-pi-pico", label: "Raspberry Pi Pico", x: 900, y: 0, properties: {} });
  for (const connection of project.connections) for (const endpoint of [connection.from, connection.to]) {
    if (endpoint.componentId === "uno") {
      endpoint.componentId = "esp";
      if (endpoint.pin === "A4") endpoint.pin = "GPIO21";
      else if (endpoint.pin === "A5") endpoint.pin = "GPIO22";
    }
  }
  const oledId = project.components.find(component => component.type === "ssd1306-oled-128x64")!.id;
  project.connections = project.connections.filter(connection => ![connection.from, connection.to].some(endpoint =>
    endpoint.componentId === oledId && ["SDA", "SCL"].includes(endpoint.pin))
    || ![connection.from, connection.to].some(endpoint => endpoint.componentId === "esp" && ["GPIO21", "GPIO22"].includes(endpoint.pin)));
  const espSketch = project.code;
  const picoSketch = `void setup(){ pinMode(25, OUTPUT); Serial.begin(9600); }\nvoid loop(){ digitalWrite(25,HIGH); Serial.println("Pico alive"); delay(500); digitalWrite(25,LOW); delay(500); }`;
  project.programs = { esp: espSketch, pico: picoSketch };
  Object.assign(project, { boardPrograms: [{ boardId: "esp", code: espSketch }, { boardId: "pico", code: picoSketch }] });
  project.code = espSketch;
  project.connections.push({ id: "shared-ground", from: { componentId: "esp", pin: "GND" }, to: { componentId: "pico", pin: "GND" } });
  globalThis.fetch = async () => modelResponse(JSON.stringify({ project, explanation: "OLED attached to ESP32 while the Pico runs independently", warnings: [], assumptions: [] }));

  const prompt = "Create exactly one ESP32 DevKitC V4, one Raspberry Pi Pico and one SSD1306 OLED. Connect the OLED only to ESP32 GPIO21 SDA, GPIO22 SCL, 3V3 and ground. Have ESP32 display PICO READY while the Pico independently blinks GP25. Share grounds; do not join board power rails.";
  const response = await POST(new Request("http://localhost/api/ai/generate", { method: "POST", body: JSON.stringify({ prompt }) }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body.error));
  assert.ok(body.project.connections.some((wire: FixtureWire) => [wire.from, wire.to].some(endpoint => endpoint.componentId === oledId && endpoint.pin === "SDA")
    && [wire.from, wire.to].some(endpoint => endpoint.componentId === "esp" && endpoint.pin === "GPIO21")));
  assert.ok(body.project.connections.some((wire: FixtureWire) => [wire.from, wire.to].some(endpoint => endpoint.componentId === oledId && endpoint.pin === "SCL")
    && [wire.from, wire.to].some(endpoint => endpoint.componentId === "esp" && endpoint.pin === "GPIO22")));
  const simulator = new MultiBoardSimulator(); simulator.attachProject(body.project); simulator.run();
  for (let time = 0; time < 700; time += 16.67) simulator.advance(16.67);
  const snapshot = simulator.getSnapshot();
  assert.deepEqual(snapshot.diagnostics.filter(diagnostic => diagnostic.severity === "error"), []);
  assert.match(snapshot.componentStates[oledId]?.display?.[0] ?? "", /Cirkitra ready/);
  assert.ok(snapshot.boardSerial?.pico?.some(entry => entry.text === "Pico alive"));
});

test("generation restores floating reset, I2C-mode, and default-address straps before simulation", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const project = greenhouseExample();
  const floatingPins = new Map<string, Set<string>>([
    ["device", new Set(["RESET", "A0", "A1", "A2"])],
    ["io-device", new Set(["RESET", "A0", "A1", "A2"])],
    ["sensor", new Set(["CSB", "SDO"])],
    ["east", new Set(["CSB", "SDO"])],
  ]);
  project.connections = project.connections.filter(connection => ![connection.from, connection.to].some(endpoint => floatingPins.get(endpoint.componentId)?.has(endpoint.pin)));
  const originalConnectionCount = project.connections.length;
  globalThis.fetch = async () => modelResponse(JSON.stringify({ project, explanation: "Two-zone greenhouse controller", warnings: [], assumptions: [] }));

  const response = await POST(new Request("http://localhost/api/ai/generate", { method: "POST", body: JSON.stringify({ prompt: greenhousePrompt }) }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body.error));
  assert.ok(body.project.connections.length > originalConnectionCount);
  assert.ok(body.assumptions.some((assumption: string) => /TCA9548A.*RESET/.test(assumption)));
  assert.ok(body.assumptions.some((assumption: string) => /MCP23017.*RESET/.test(assumption)));
  assert.ok(body.assumptions.some((assumption: string) => /CSB/.test(assumption)));
  const simulator = new ArduinoSimulator(body.project.code);
  simulator.attachProject(body.project);
  simulator.run(); simulator.advance(1_000);
  const snapshot = simulator.getSnapshot();
  assert.deepEqual(snapshot.diagnostics.filter(diagnostic => diagnostic.severity === "error"), []);
  assert.equal(snapshot.componentStates.sensor?.readings?.temperature, body.project.components.find((component: FixtureComponent) => component.id === "sensor")?.properties?.temperature);
  assert.equal(snapshot.componentStates.east?.readings?.temperature, body.project.components.find((component: FixtureComponent) => component.id === "east")?.properties?.temperature);
});

test("generation deterministically aligns MCP23017 LED branches with their code outputs", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";

  const repaired = greenhouseExample();
  const mismatched = structuredClone(repaired);
  repaired.code = repaired.code
    .replaceAll("io.pinMode(0,", "io.pinMode(8,")
    .replaceAll("io.pinMode(1,", "io.pinMode(9,")
    .replaceAll("io.pinMode(2,", "io.pinMode(10,")
    .replaceAll("io.digitalWrite(0,", "io.digitalWrite(8,")
    .replaceAll("io.digitalWrite(1,", "io.digitalWrite(9,")
    .replaceAll("io.digitalWrite(2,", "io.digitalWrite(10,");
  for (const connection of mismatched.connections) {
    for (const endpoint of [connection.from, connection.to]) {
      if (endpoint.componentId === "io-device" && /^GPA[0-2]$/.test(endpoint.pin)) {
        endpoint.pin = endpoint.pin.replace("GPA", "GPB");
      }
    }
  }
  let repairFeedback = "";
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    const input = JSON.parse(request.contents[0].parts[0].text);
    if (Array.isArray(input.validationIssues)) repairFeedback = input.validationIssues.join("\n");
    const project = input.validationIssues?.length ? repaired : mismatched;
    return modelResponse(JSON.stringify({ project, explanation: "Greenhouse controller", warnings: [], assumptions: [] }));
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST",
    body: JSON.stringify({ prompt: greenhousePrompt }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body.error));
  assert.equal(repairFeedback, "", "the explicitly mapped three-indicator request can repair this mismatch without another model call");
  for (let index = 0; index < 3; index += 1) {
    const resistorId = index === 0 ? "io-resistor-led" : `res-${index}`;
    assert.ok(body.project.connections.some((connection: FixtureWire) =>
      [connection.from, connection.to].some(endpoint => endpoint.componentId === "io-device" && endpoint.pin === `GPA${index}`)
      && [connection.from, connection.to].some(endpoint => endpoint.componentId === resistorId && endpoint.pin === "1")), `LED output ${index} must match its programmed GPA pin`);
  }

  const simulator = new ArduinoSimulator(body.project.code);
  simulator.attachProject(body.project);
  simulator.run();
  simulator.advance(1_000);
  const snapshot = simulator.getSnapshot();
  assert.deepEqual(snapshot.diagnostics.filter(diagnostic => diagnostic.severity === "error"), []);
  for (const id of ["io-led", "led-1", "led-2"]) assert.equal(snapshot.componentStates[id]?.powered, true, id);
});

test("repeated invalid full-project repairs are rejected without returning a partial project", async context => {
  const previousFetch = globalThis.fetch; const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const invalid = greenhouseExample();
  invalid.code = invalid.code.replace("void loop(){", "void loop(){ unsupportedSimulationCall();");
  let repairRequests = 0;
  let nonInitialPayload: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    const content = JSON.parse(request.contents[0].parts[0].text);
    if (Array.isArray(content.validationIssues)) {
      repairRequests += 1;
      nonInitialPayload = content;
    }
    return modelResponse(JSON.stringify({ project: invalid, explanation: "Greenhouse controller", assumptions: [], warnings: [] }));
  };
  const response = await POST(new Request("http://localhost/api/ai/generate", { method: "POST", body: JSON.stringify({ prompt: greenhousePrompt }) }));
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.error.code, "AI_REPAIR_NO_CHANGE");
  assert.equal(repairRequests, 2, "Gemini receives only the two bounded complete-project repair opportunities");
  assert.equal(nonInitialPayload?.request, greenhousePrompt, "repair retains the original prompt");
  assert.ok(typeof nonInitialPayload?.rejectedResponse === "string" && nonInitialPayload.rejectedResponse.includes("unsupportedSimulationCall"), "repair receives the complete rejected project");
  assert.ok(Array.isArray(nonInitialPayload?.validationIssues) && nonInitialPayload.validationIssues.some(issue => String(issue).includes("unsupportedSimulationCall")));
  assert.ok(body.error.details.length > 0, "deduplicated validation diagnostics remain available for the UI details panel");
  assert.equal(body.error.retryable, false, "a deterministic validation failure should not invite the same automatic retry");
  assert.equal(Object.hasOwn(body, "project"), false, "an invalid candidate must never be returned for the canvas");
});

test("generation makes one complete-project request without planner or subsystem stages", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  testAiFinalizations.length = 0;
  const prompt = "Blink an LED fast";
  let calls = 0;
  let requestContent: Record<string, unknown> | undefined;
  let systemInstructionText = "";
  let generationConfig: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const providerRequest = JSON.parse(String(init?.body));
    requestContent = JSON.parse(providerRequest.contents[0].parts[0].text);
    systemInstructionText = providerRequest.systemInstruction.parts[0].text;
    generationConfig = providerRequest.generationConfig;
    return modelResponse(JSON.stringify({ project: createDefaultBlinkProject(), explanation: "A complete LED blink circuit.", assumptions: [], warnings: [] }), "STOP", { promptTokenCount: 42, candidatesTokenCount: 17 });
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST", body: JSON.stringify({ prompt }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body.error ?? body));
  assert.equal(calls, 1, "a valid prompt should use exactly one initial complete-project generation call");
  assert.equal(requestContent?.request, prompt);
  assert.equal(requestContent?.mode, "create");
  assert.match(systemInstructionText, /POWER-RANGE CHECK BEFORE WIRING/);
  assert.match(systemInstructionText, /single Li-ion cell is at most 4\.2 V/);
  assert.equal("plan" in (requestContent ?? {}), false);
  assert.equal("subsystem" in (requestContent ?? {}), false);
  assert.equal(generationConfig?.maxOutputTokens, 65_536);
  const schema = generationConfig?.responseJsonSchema as { properties?: Record<string, unknown> } | undefined;
  const projectSchema = schema?.properties?.project as { properties?: Record<string, unknown> } | undefined;
  assert.ok(projectSchema?.properties?.components && projectSchema.properties.connections && projectSchema.properties.code);
  assert.match(systemInstructionText, /at most 100 components and 500 connections/);
  assert.match(systemInstructionText, /each sketch within 30,000 characters/);
  assert.equal(schema?.properties?.programs, undefined, "sketches remain part of the complete project rather than a staged programs payload");
  assert.ok(body.project && body.project.code.includes("digitalWrite"));
  assert.equal(testAiFinalizations.at(-1)?.succeeded, true);
  assert.equal(testAiFinalizations.at(-1)?.inputTokens, 42);
  assert.equal(testAiFinalizations.at(-1)?.outputTokens, 17);
});

test("a failed model request releases its reserved AI request instead of consuming the monthly allowance", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  testAiFinalizations.length = 0;
  globalThis.fetch = async () => Response.json({ error: { message: "Invalid provider request" } }, { status: 400 });

  const response = await POST(generationRequest());
  assert.notEqual(response.status, 200);
  assert.equal(testAiFinalizations.at(-1)?.succeeded, false);
  assert.equal(testAiFinalizations.at(-1)?.inputTokens, 0);
  assert.equal(testAiFinalizations.at(-1)?.outputTokens, 0);
});

test("stray separators before standalone statements are removed only after a completed statement", () => {
  const malformed = "void loop(){\n  digitalWrite(13,HIGH);\n  ,\n  delay(20);\n}";
  const repaired = repairStrayCommaBeforeStatement(malformed);
  assert.match(repaired.code, /digitalWrite\(13,HIGH\);\n\s*\n\s*delay\(20\);/);
  assert.equal(repaired.repairs.length, 1);
  const validCommaExpression = "void loop(){\n  int value = map(position, 0, 10, 0, 100);\n}";
  assert.deepEqual(repairStrayCommaBeforeStatement(validCommaExpression), { code: validCommaExpression, repairs: [] });
  const continuation = "void loop(){\n  output = calculate\n  , nextValue;\n}";
  assert.deepEqual(repairStrayCommaBeforeStatement(continuation), { code: continuation, repairs: [] });
});

test("generation removes a model-inserted standalone comma before strict validation", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const broken = structuredClone(createDefaultBlinkProject());
  broken.code = broken.code.replace("delay(1000);", "delay(1000);\n  ,\n  delay(1000);");
  globalThis.fetch = async () => modelResponse(JSON.stringify({ project: broken, explanation: "LED blink circuit.", assumptions: [], warnings: [] }));

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST", body: JSON.stringify({ prompt: "Blink an LED" }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.doesNotMatch(body.project.code, /^\s*,\s*$/m);
  assert.ok(body.assumptions.some((assumption: string) => /stray comma/i.test(assumption)));
  const simulator = new ArduinoSimulator(body.project.code);
  simulator.attachProject(body.project);
  simulator.run(); simulator.advance(1_000);
  assert.equal(simulator.getSnapshot().diagnostics.some(diagnostic => diagnostic.severity === "error"), false);
});

test("sketch syntax failures are repaired before behavior checks add secondary symptoms", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const broken = structuredClone(COMPONENT_EXAMPLES["ky-040"]());
  broken.components.push(
    { id: "led-resistor", type: "resistor", label: "220 ohm LED resistor", x: 650, y: 100, properties: { resistance: 220 } },
    { id: "indicator", type: "led", label: "Indicator LED", x: 850, y: 100 },
  );
  broken.connections.push(
    { id: "led-drive", from: { componentId: "uno", pin: "D13" }, to: { componentId: "led-resistor", pin: "1" } },
    { id: "led-limit", from: { componentId: "led-resistor", pin: "2" }, to: { componentId: "indicator", pin: "A" } },
    { id: "led-return", from: { componentId: "indicator", pin: "K" }, to: { componentId: "uno", pin: "GND" } },
  );
  const corrected = structuredClone(broken);
  corrected.code = `#include <Encoder.h>
Encoder knob(2,3);
void setup(){ pinMode(13,OUTPUT); }
void loop(){ if(knob.read()>0){ digitalWrite(13,HIGH); } else { digitalWrite(13,LOW); } delay(20); }`;
  broken.code = corrected.code.replace("delay(20);", "break; delay(20);");
  let calls = 0;
  let repairIssues: string[] = [];
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const request = JSON.parse(String(init?.body));
    const content = JSON.parse(request.contents[0].parts[0].text);
    repairIssues = content.validationIssues ?? [];
    return modelResponse(JSON.stringify({ project: content.validationIssues ? corrected : broken, explanation: "The encoder controls the LED.", assumptions: [], warnings: [] }));
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST",
    body: JSON.stringify({ prompt: "Use the KY-040 encoder to turn the indicator LED on after clockwise rotation and off at its zero position." }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(calls, 2);
  assert.ok(repairIssues.some(issue => issue.includes("UNSUPPORTED_STATEMENT")), JSON.stringify(repairIssues));
  assert.equal(repairIssues.some(issue => /encoder behavior|button behavior|threshold behavior/.test(issue)), false, JSON.stringify(repairIssues));
});

test("full-project repair receives the complete candidate and precise diagnostics", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const invalid = greenhouseExample();
  invalid.code = invalid.code.replaceAll(".selectChannel(", ".selectNeverRegistered(");
  const corrected = greenhouseExample();
  let calls = 0;
  let repairContent: Record<string, unknown> | undefined;
  let repairSchema: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const request = JSON.parse(String(init?.body));
    const content = JSON.parse(request.contents[0].parts[0].text);
    repairSchema = request.generationConfig.responseJsonSchema;
    if (Array.isArray(content.validationIssues)) {
      repairContent = content;
      return modelResponse(JSON.stringify({ project: corrected, explanation: "Corrected complete greenhouse circuit.", assumptions: [], warnings: [] }));
    }
    return modelResponse(JSON.stringify({ project: invalid, explanation: "Greenhouse controller", assumptions: [], warnings: [] }));
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST", body: JSON.stringify({ prompt: greenhousePrompt }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body.error ?? body));
  assert.equal(calls, 2, "one bounded complete-project repair follows invalid first output");
  assert.equal(repairContent?.request, greenhousePrompt);
  assert.match(String(repairContent?.task), /complete project only/i);
  const rejected = JSON.parse(String(repairContent?.rejectedResponse));
  assert.ok(rejected.project.components.length > 1 && rejected.project.connections.length > 1, "repair receives the entire failed topology and sketch");
  assert.match(rejected.project.code, /selectNeverRegistered/);
  assert.ok(Array.isArray(repairContent?.validationIssues) && repairContent.validationIssues.some(issue => String(issue).includes("selectNeverRegistered")));
  assert.ok(Array.isArray(repairContent?.validationDiagnostics) && repairContent.validationDiagnostics.some(item => isRecord(item) && item.stage === "code"));
  const schema = repairSchema?.properties as Record<string, unknown> | undefined;
  const projectSchema = schema?.project as { properties?: Record<string, unknown> } | undefined;
  assert.ok(projectSchema?.properties?.components && projectSchema.properties.connections && projectSchema.properties.code, "repairs retain the complete-project schema");
  assert.equal(schema?.programs, undefined, "repair does not switch to a staged sketch schema");
  assert.match(body.project.code, /mux\.selectChannel\(/);
  assert.doesNotMatch(body.project.code, /selectNeverRegistered/);
  assert.equal(ledSeriesResistorIssues(body.project).length, 0);
});
test("generation repairs missing temperature indicator series wires and verifies each zone", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";

  const repaired = greenhouseExample();
  const indicatorLeds = repaired.components.filter(component => component.type === "led");
  if (indicatorLeds[0]) indicatorLeds[0].label = "West Alarm LED";
  if (indicatorLeds[1]) indicatorLeds[1].label = "East Alarm LED";
  if (indicatorLeds[2]) indicatorLeds[2].label = "Overheat Alarm LED";
  const disconnectedIndicators = structuredClone(repaired);
  const ledIds = new Set(disconnectedIndicators.components.filter(component => component.type === "led").map(component => component.id));
  disconnectedIndicators.connections = disconnectedIndicators.connections.filter(connection =>
    ![connection.from, connection.to].some(endpoint => ledIds.has(endpoint.componentId) && endpoint.pin === "A"));
  let repairFeedback = "";
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    const input = JSON.parse(request.contents[0].parts[0].text);
    if (Array.isArray(input.validationIssues)) repairFeedback = input.validationIssues.join("\n");
    return modelResponse(JSON.stringify({ project: disconnectedIndicators, explanation: "Greenhouse controller", warnings: [], assumptions: [] }));
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST",
    body: JSON.stringify({ prompt: greenhousePrompt }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body.error));
  assert.equal(repairFeedback, "", "the wire omission is safely repaired before asking Gemini for another attempt");
  assert.ok(body.assumptions.some((item: string) => /Completed a missing generated LED series wire/.test(item)));

  const simulator = new ArduinoSimulator(body.project.code);
  simulator.attachProject(body.project);
  simulator.run();
  simulator.advance(1_000);
  const sensors = body.project.components.filter((component: { type: string }) => component.type === "bme280");
  const westSensor = sensors.find((component: { label: string }) => /west/i.test(component.label)) ?? sensors[0];
  const eastSensor = sensors.find((component: { label: string }) => /east/i.test(component.label)) ?? sensors[1];
  const setTemperatures = (westTemperature: number, eastTemperature: number) => {
    westSensor.properties.temperature = westTemperature;
    eastSensor.properties.temperature = eastTemperature;
    simulator.attachProject(body.project);
    return simulator.advance(1_000).componentStates;
  };
  let states = setTemperatures(30, 23);
  assert.equal(states["io-led"]?.powered, true);
  assert.equal(states["led-1"]?.powered, false);
  assert.equal(states["led-2"]?.powered, false);
  states = setTemperatures(23, 30);
  assert.equal(states["io-led"]?.powered, false);
  assert.equal(states["led-1"]?.powered, true);
  assert.equal(states["led-2"]?.powered, false);
  states = setTemperatures(33, 23);
  assert.equal(states["io-led"]?.powered, true);
  assert.equal(states["led-1"]?.powered, false);
  assert.equal(states["led-2"]?.powered, true);
});

test("generation isolates three labeled temperature LEDs that were shorted onto one MCP23017 output", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";

  const miswired = greenhouseExample();
  const leds = miswired.components.filter(component => component.type === "led");
  const resistors = miswired.components.filter(component => component.type === "resistor" && Number(component.properties?.resistance) >= 150 && Number(component.properties?.resistance) <= 500);
  assert.equal(leds.length, 3);
  assert.equal(resistors.length, 3);
  const roles = ["west", "east", "critical"] as const;
  leds.forEach((led, index) => { led.label = [`West Zone High LED`, `East Zone High LED`, `Critical Temp LED`][index]!; });
  resistors.forEach((resistor, index) => { resistor.label = [`West LED resistor`, `East LED resistor`, `Critical LED resistor`][index]!; });
  const branchIds = new Set([...leds, ...resistors].map(component => component.id));
  miswired.connections = miswired.connections.filter(connection => ![connection.from, connection.to].some(endpoint =>
    branchIds.has(endpoint.componentId)
    || (endpoint.componentId === "io-device" && /^GPA[0-2]$/.test(endpoint.pin))));
  for (let index = 0; index < 3; index += 1) {
    const led = leds[index]!;
    const resistor = resistors[index]!;
    miswired.connections.push(
      { id: `fault-gp2-${index}`, from: { componentId: "io-device", pin: "GPA2" }, to: { componentId: resistor.id, pin: "1" } },
      { id: `fault-res-led-${index}`, from: { componentId: resistor.id, pin: "2" }, to: { componentId: led.id, pin: "A" } },
      { id: `fault-led-gnd-${index}`, from: { componentId: led.id, pin: "K" }, to: { componentId: "uno", pin: "GND" } },
    );
  }
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return modelResponse(JSON.stringify({ project: miswired, explanation: "Two-zone greenhouse indicators", warnings: [], assumptions: [] }));
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", { method: "POST", body: JSON.stringify({ prompt: greenhousePrompt }) }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body.error ?? body));
  assert.equal(providerCalls, 1, "this clearly mapped fault should be repaired locally before another provider call");
  for (let index = 0; index < 3; index += 1) {
    const led = leds[index]!;
    const resistor = resistors[index]!;
    const gpio = `GPA${index}`;
    assert.ok(body.project.connections.some((connection: FixtureWire) =>
      [connection.from, connection.to].some(endpoint => endpoint.componentId === "io-device" && endpoint.pin === gpio)
      && [connection.from, connection.to].some(endpoint => endpoint.componentId === resistor.id && endpoint.pin === "1")), `${roles[index]} output needs a dedicated source resistor`);
    assert.ok(body.project.connections.some((connection: FixtureWire) =>
      [connection.from, connection.to].some(endpoint => endpoint.componentId === resistor.id && endpoint.pin === "2")
      && [connection.from, connection.to].some(endpoint => endpoint.componentId === led.id && endpoint.pin === "A")), `${roles[index]} LED must remain in series with its resistor`);
  }
  assert.ok(body.assumptions.some((assumption: string) => /rewired .*MCP23017 GPA0/.test(assumption)));
  assert.ok(body.assumptions.some((assumption: string) => /rewired .*MCP23017 GPA1/.test(assumption)));
  assert.ok(body.assumptions.some((assumption: string) => /rewired .*MCP23017 GPA2/.test(assumption)));

  const sensors = body.project.components.filter((component: { type: string }) => component.type === "bme280");
  const zoneStates = (westTemperature: number, eastTemperature: number) => {
    const scenario = structuredClone(body.project);
    const scenarioSensors = scenario.components.filter((component: { type: string }) => component.type === "bme280");
    const west = scenarioSensors.find((component: { label: string }) => /west/i.test(component.label)) ?? scenarioSensors[0];
    const east = scenarioSensors.find((component: { label: string }) => /east/i.test(component.label)) ?? scenarioSensors.find((component: { id: string }) => component.id !== west.id);
    west.properties = { ...west.properties, temperature: westTemperature };
    east.properties = { ...east.properties, temperature: eastTemperature };
    const simulator = new ArduinoSimulator(scenario.code);
    simulator.attachProject(scenario);
    simulator.run(); simulator.advance(0); simulator.advance(10_000);
    return simulator.getSnapshot().componentStates;
  };
  assert.equal(sensors.length, 2);
  assert.deepEqual(leds.map((led, index) => body.project.components.find((component: { id: string }) => component.id === led.id)?.label ?? index), ["West Zone High LED", "East Zone High LED", "Critical Temp LED"]);
  let states = zoneStates(30, 23);
  assert.deepEqual(leds.map(led => Boolean(states[led.id]?.powered)), [true, false, false]);
  states = zoneStates(23, 30);
  assert.deepEqual(leds.map(led => Boolean(states[led.id]?.powered)), [false, true, false]);
  states = zoneStates(33, 23);
  assert.deepEqual(leds.map(led => Boolean(states[led.id]?.powered)), [true, false, true]);
});

test("generation safely repairs missing sensor power from the one compatible board rail", async context => {
  const previousFetch = globalThis.fetch; const previousKey = process.env.GEMINI_API_KEY;
  const previousWarn = console.warn;
  context.after(() => {
    globalThis.fetch = previousFetch; console.warn = previousWarn;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret"; console.warn = () => {};
  const project = COMPONENT_EXAMPLES.bme280();
  project.connections = project.connections.filter(w => w.from.pin !== "VDD");
  const issues: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const content = JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text);
    issues.push(...(content.validationIssues ?? []));
    return modelResponse(JSON.stringify({ project, explanation: "Missing power", warnings: [], assumptions: [] }));
  };
  const response = await POST(new Request("http://localhost/api/ai/generate", { method: "POST", body: JSON.stringify({ prompt: "Create a BME280 circuit" }) }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(issues.length, 0, "the unambiguous 3.3 V board rail should repair this missing connection before model repair");
  assert.ok(body.project.connections.some((wire: { from: { componentId: string; pin: string }; to: { componentId: string; pin: string } }) =>
    (wire.from.componentId === "device" && wire.from.pin === "VDD" && wire.to.componentId === "uno" && wire.to.pin === "3V3")
    || (wire.to.componentId === "device" && wire.to.pin === "VDD" && wire.from.componentId === "uno" && wire.from.pin === "3V3")),
  "repaired BME280 VDD should connect to the compatible Uno 3.3 V rail");
});

test("generation rejects a fan fail-safe that does not report an unavailable sensor", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const project = greenhouseExample();
  project.code = project.code.replace('Serial.println("Sensor unavailable");', 'Serial.println("Reading");');
  let repairFeedback = "";
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    const input = JSON.parse(request.contents[0].parts[0].text);
    if (Array.isArray(input.validationIssues)) repairFeedback = input.validationIssues.join("\n");
    return modelResponse(JSON.stringify({ project, explanation: "Greenhouse controller", warnings: [], assumptions: [] }));
  };
  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST",
    body: JSON.stringify({ prompt: greenhousePrompt }),
  }));
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.match(repairFeedback, /does not report the sensor fault in Serial/);
  assert.match(body.error.details.join("\n"), /does not report the sensor fault in Serial/);
});

test("generation repairs a temperature controller to report unavailable BME sensors and stop the fan", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const repaired = greenhouseExample();
  const broken = structuredClone(repaired);
  broken.code = broken.code.replace('Serial.println("Sensor unavailable");', 'Serial.println("Reading");');
  let repairFeedback = "";
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    const input = JSON.parse(request.contents[0].parts[0].text);
    if (Array.isArray(input.validationIssues)) repairFeedback = input.validationIssues.join("\n");
    return modelResponse(JSON.stringify({ project: input.validationIssues?.length ? repaired : broken, explanation: "Greenhouse controller", warnings: [], assumptions: [] }));
  };
  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST",
    body: JSON.stringify({ prompt: greenhousePrompt }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body.error));
  assert.match(repairFeedback, /does not report the sensor fault in Serial/);

  const disconnected = structuredClone(body.project);
  const west = disconnected.components.find((component: { type: string; label: string }) => component.type === "bme280" && /west/i.test(component.label)) ?? disconnected.components.find((component: { type: string }) => component.type === "bme280");
  disconnected.connections = disconnected.connections.filter((connection: FixtureWire) =>
    ![connection.from, connection.to].some(endpoint => endpoint.componentId === west.id && endpoint.pin === "SDI"));
  const simulator = new ArduinoSimulator(disconnected.code);
  simulator.attachProject(disconnected);
  simulator.run();
  simulator.advance(10_000);
  const snapshot = simulator.getSnapshot();
  assert.ok(snapshot.diagnostics.some(diagnostic => diagnostic.code === "DEVICE_NOT_CONNECTED"));
  assert.ok(snapshot.diagnostics.filter(diagnostic => diagnostic.severity === "error").every(diagnostic => diagnostic.code === "DEVICE_NOT_CONNECTED"));
  assert.ok(snapshot.serial.some(entry => /sensor unavailable/i.test(entry.text)));
  const motor = disconnected.components.find((component: { type: string }) => component.type === "dc-motor");
  assert.equal(snapshot.componentStates[motor.id]?.speed, 0);
});

test("generation repairs a TB6612FNG with a disconnected STBY pin before publication", async context => {
  const previousFetch = globalThis.fetch; const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const project = COMPONENT_EXAMPLES.tb6612fng();
  project.connections = project.connections.filter((connection) =>
    ![connection.from, connection.to].some((endpoint) => endpoint.componentId === "device" && endpoint.pin === "STBY"));
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const request = JSON.parse(String(init?.body));
    const input = JSON.parse(request.contents[0].parts[0].text);
    if (input.validationIssues) assert.fail(`unexpected repair attempt: ${JSON.stringify(input.validationIssues)}`);
    return modelResponse(JSON.stringify({ project, explanation: "TB6612 motor driver", assumptions: [], warnings: [] }));
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST", body: JSON.stringify({ prompt: "Create a TB6612FNG motor driver circuit" }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(calls, 1, "a safe disconnected standby fix should not spend an AI repair attempt");
  assert.ok(body.project.connections.some((connection: { from: { componentId: string; pin: string }; to: { componentId: string; pin: string } }) =>
    [connection.from, connection.to].some((endpoint) => endpoint.componentId === "device" && endpoint.pin === "STBY")));
});

test("generation uses an explicitly requested DC supply for the motor driver", async context => {
  const previousFetch = globalThis.fetch; const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const project = COMPONENT_EXAMPLES.tb6612fng();
  project.components.push({ id: "motor-supply", type: "dc-supply", label: "Adjustable motor supply", x: 400, y: 0, properties: { voltage: 7.4, enabled: true } });
  project.connections = project.connections.filter(connection =>
    ![connection.from, connection.to].some(endpoint => endpoint.componentId === "device" && ["VM1", "VM2", "VM3"].includes(endpoint.pin)));
  for (const pin of ["VM1", "VM2", "VM3"]) project.connections.push({
    id: `wrong-${pin}`, from: { componentId: "device", pin }, to: { componentId: "uno", pin: "VIN" },
  });
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return modelResponse(JSON.stringify({ project, explanation: "A motor driver on a separate supply", assumptions: [], warnings: [] }));
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST", body: JSON.stringify({ prompt: "Create a TB6612FNG motor driver circuit with a separate adjustable DC motor supply." }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body.error ?? body));
  assert.ok(providerCalls <= 3, `the repair should use bounded full-project attempts; observed ${providerCalls} provider calls`);
  const connected = (start: FixtureEndpoint, target: FixtureEndpoint) => {
    const pending = [`${start.componentId}:${start.pin}`]; const visited = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const connection of body.project.connections as FixtureWire[]) {
        if (`${connection.from.componentId}:${connection.from.pin}` === current) pending.push(`${connection.to.componentId}:${connection.to.pin}`);
        if (`${connection.to.componentId}:${connection.to.pin}` === current) pending.push(`${connection.from.componentId}:${connection.from.pin}`);
      }
    }
    return visited.has(`${target.componentId}:${target.pin}`);
  };
  for (const pin of ["VM1", "VM2", "VM3"]) assert.ok(connected({ componentId: "device", pin }, { componentId: "motor-supply", pin: "+" }), `${pin} must use the requested motor supply`);
  const commonReturns = [
    ...["GND", "GND2", "GND3"].map(pin => ({ componentId: "uno", pin })),
    ...(body.project.components as FixtureComponent[]).filter(component => component.type === "ground").map(component => ({ componentId: component.id, pin: "GND" })),
  ];
  assert.ok(commonReturns.some(endpoint => connected({ componentId: "motor-supply", pin: "-" }, endpoint)),
    "external supply return must join the circuit ground");
});

test("generation honors an explicit numeric STBY GPIO before the generic enable fallback", async context => {
  const previousFetch = globalThis.fetch; const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const project = COMPONENT_EXAMPLES.tb6612fng();
  project.connections = project.connections.filter(connection =>
    ![connection.from, connection.to].some(endpoint => endpoint.componentId === "device" && endpoint.pin === "STBY"));
  project.code = "void setup(){ pinMode(5,OUTPUT); pinMode(6,OUTPUT); pinMode(8,OUTPUT); digitalWrite(8,HIGH); analogWrite(5,128); analogWrite(6,255); } void loop(){ delay(100); }";
  globalThis.fetch = async () => modelResponse(JSON.stringify({ project, explanation: "Uno-controlled TB6612FNG motor circuit", assumptions: [], warnings: [] }));

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST",
    body: JSON.stringify({ prompt: "Create a TB6612FNG motor driver circuit. Use Uno D8 for STBY and drive digital pin 8 HIGH in setup so the connected motors run." }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  const standbyWire = body.project.connections.find((connection: FixtureWire) =>
    [connection.from, connection.to].some(endpoint => endpoint.componentId === "device" && endpoint.pin === "STBY"));
  assert.ok(standbyWire);
  assert.ok([standbyWire.from, standbyWire.to].some(endpoint => endpoint.componentId === "uno" && endpoint.pin === "D8"), "STBY must follow the explicit sketch GPIO");
  assert.ok(![standbyWire.from, standbyWire.to].some(endpoint => endpoint.componentId === "uno" && endpoint.pin === "5V"), "STBY must not also be tied to VCC");

  const simulator = new ArduinoSimulator(body.project.code);
  simulator.attachProject(body.project);
  simulator.run();
  simulator.advance(100);
  assert.ok((simulator.getSnapshot().componentStates["motor-a"]?.speed ?? 0) > 0, "the explicitly enabled driver should run its motor");
});

test("generation deterministically corrects a TB6612 duplicate output pad before publication", async context => {
  const previousFetch = globalThis.fetch; const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const malformedProject = COMPONENT_EXAMPLES.tb6612fng();
  const negativeLead = malformedProject.connections.find(connection =>
    [connection.from, connection.to].some(endpoint => endpoint.componentId === "motor-a" && endpoint.pin === "-"));
  assert.ok(negativeLead);
  const mistakenPad = negativeLead.from.componentId === "device" ? negativeLead.from : negativeLead.to;
  mistakenPad.pin = "AO1_2";
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return modelResponse(JSON.stringify({ project: malformedProject, explanation: "A TB6612FNG drives a motor.", assumptions: [], warnings: [] }));
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST", body: JSON.stringify({ prompt: "Create a TB6612FNG circuit with a DC motor" }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(providerCalls, 1, "a known duplicate output-pad error should not require another Gemini attempt");
  assert.ok(body.project.connections.some((connection: FixtureWire) =>
    [connection.from, connection.to].some(endpoint => endpoint.componentId === "device" && endpoint.pin === "AO2_5")
      && [connection.from, connection.to].some(endpoint => endpoint.componentId === "motor-a" && endpoint.pin === "-")));
  assert.ok(body.assumptions.some((assumption: string) => assumption.includes("Corrected motor-a wiring across TB6612FNG channel A")));
});

test("generation reroutes an undriven TB6612 standby wire from an unused Uno pin", async context => {
  const previousFetch = globalThis.fetch; const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const project = COMPONENT_EXAMPLES.tb6612fng();
  const standbyWire = project.connections.find((connection) =>
    [connection.from, connection.to].some((endpoint) => endpoint.componentId === "device" && endpoint.pin === "STBY"));
  assert.ok(standbyWire);
  if (standbyWire.from.componentId === "device" && standbyWire.from.pin === "STBY") standbyWire.to = { componentId: "uno", pin: "D7" };
  else standbyWire.from = { componentId: "uno", pin: "D7" };
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return modelResponse(JSON.stringify({ project, explanation: "TB6612 motor driver", assumptions: [], warnings: [] }));
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST", body: JSON.stringify({ prompt: "Create a TB6612FNG motor driver circuit" }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(calls, 1, "the unused MCU input should be replaced before preflight");
  const vccWire = body.project.connections.find((connection: { from: { componentId: string; pin: string }; to: { componentId: string; pin: string } }) =>
    [connection.from, connection.to].some((endpoint) => endpoint.componentId === "device" && endpoint.pin === "VCC"));
  const fixedStandbyWire = body.project.connections.find((connection: { from: { componentId: string; pin: string }; to: { componentId: string; pin: string } }) =>
    [connection.from, connection.to].some((endpoint) => endpoint.componentId === "device" && endpoint.pin === "STBY"));
  assert.ok(vccWire && fixedStandbyWire);
  const vccPeer = vccWire.from.componentId === "device" && vccWire.from.pin === "VCC" ? vccWire.to : vccWire.from;
  const standbyPeer = fixedStandbyWire.from.componentId === "device" && fixedStandbyWire.from.pin === "STBY" ? fixedStandbyWire.to : fixedStandbyWire.from;
  assert.deepEqual(standbyPeer, vccPeer);
});

test("generation repairs an undriven TB6612 standby pin connected through a floating net", async context => {
  const previousFetch = globalThis.fetch; const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const repairedProject = COMPONENT_EXAMPLES.tb6612fng();
  const invalidProject = structuredClone(repairedProject);
  const standby = invalidProject.connections.find((connection) =>
    [connection.from, connection.to].some((endpoint) => endpoint.componentId === "device" && endpoint.pin === "STBY"));
  assert.ok(standby);
  invalidProject.components.push({ id: "floating", type: "resistor", label: "Floating standby net", x: 0, y: 0 });
  if (standby.from.componentId === "device" && standby.from.pin === "STBY") standby.to = { componentId: "floating", pin: "1" };
  else standby.from = { componentId: "floating", pin: "1" };
  invalidProject.connections.push({ id: "floating-tail", from: { componentId: "floating", pin: "2" }, to: { componentId: "uno", pin: "D7" } });

  let calls = 0;
  let repairIssues: string[] = [];
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const request = JSON.parse(String(init?.body));
    const input = JSON.parse(request.contents[0].parts[0].text);
    repairIssues = input.validationIssues ?? [];
    const project = input.validationIssues ? repairedProject : invalidProject;
    return modelResponse(JSON.stringify({ project, explanation: "TB6612 motor driver", assumptions: [], warnings: [] }));
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST", body: JSON.stringify({ prompt: "Create a TB6612FNG motor driver circuit" }),
  }));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal(calls, 2, "the floating-control diagnostic must trigger a repair attempt");
  assert.ok(repairIssues.some((issue) => issue.includes("floating-control") && issue.includes("STBY")));
});

test("generation repairs motor controls left undriven after sketch startup", async context => {
  const previousFetch = globalThis.fetch; const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const invalidProject = COMPONENT_EXAMPLES.tb6612fng();
  invalidProject.code = "void setup(){} void loop(){ delay(100); }";
  const repairedProject = COMPONENT_EXAMPLES.tb6612fng();
  let calls = 0; let repairCalls = 0; let repairIssues: string[] = [];
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const request = JSON.parse(String(init?.body));
    const input = JSON.parse(request.contents[0].parts[0].text);
    repairIssues = input.validationIssues ?? [];
    if (repairIssues.length) repairCalls += 1;
    return modelResponse(JSON.stringify({ project: input.validationIssues ? repairedProject : invalidProject, explanation: "TB6612 motor driver", assumptions: [], warnings: [] }));
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST", body: JSON.stringify({ prompt: "Create a TB6612FNG motor driver circuit" }),
  }));
  assert.equal(response.status, 200);
  assert.ok(calls >= 2, "the generated circuit must receive a targeted repair");
  assert.ok(repairCalls > 0 && repairCalls <= 2, "targeted motor-control repairs must stay within the two-attempt limit");
  assert.ok(repairIssues.some(issue => issue.includes("floating-control") && issue.includes("PWMA")));
});

test("full-project repair fixes a fan sketch that never starts at its hot threshold", async context => {
  const previousFetch = globalThis.fetch; const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const repairedProject = greenhouseExample();
  const invalidProject = structuredClone(repairedProject);
  invalidProject.code = invalidProject.code.replace(
    "if (fan) { analogWrite(5, 191); } else { analogWrite(5, 0); }",
    "analogWrite(5, 0);",
  );
  assert.notEqual(invalidProject.code, repairedProject.code, "the fixture must keep the fan stopped in every temperature case");
  let providerCalls = 0;
  let repairIssues: string[] = [];
  let repairInstructions = "";
  globalThis.fetch = async (_input, init) => {
    providerCalls += 1;
    const request = JSON.parse(String(init?.body));
    const input = JSON.parse(request.contents[0].parts[0].text);
    repairIssues = input.validationIssues ?? repairIssues;
    if (repairIssues.length) repairInstructions = request.systemInstruction.parts[0].text;
    const project = input.validationIssues ? repairedProject : invalidProject;
    return modelResponse(JSON.stringify({ project, explanation: "A two-zone fan controller.", assumptions: [], warnings: [] }));
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST", body: JSON.stringify({ prompt: greenhousePrompt }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(providerCalls, 2, "the invalid complete sketch must receive one full-project repair");
  assert.ok(repairIssues.some(issue => issue.includes("project.code fan behavior") && issue.includes("turn-on threshold")), JSON.stringify(repairIssues));
  assert.match(repairInstructions, /INPUT-TO-OUTPUT BEHAVIOR/);
  assert.match(body.project.code, /if \(fan\)/);
});

test("fan behavior repair receives the complete rejected circuit and precise validation diagnostics", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  const previousWarn = console.warn;
  context.after(() => {
    globalThis.fetch = previousFetch;
    console.warn = previousWarn;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  console.warn = () => {};
  process.env.GEMINI_API_KEY = "test-secret";
  const corrected = greenhouseExample();
  const invalid = structuredClone(corrected);
  invalid.code = invalid.code.replace(
    "if (fan) { analogWrite(5, 191); } else { analogWrite(5, 0); }",
    "analogWrite(5, 0);",
  );
  let calls = 0;
  let repairContent: Record<string, unknown> | undefined;
  let repairSchema: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const request = JSON.parse(String(init?.body));
    const content = JSON.parse(request.contents[0].parts[0].text);
    if (Array.isArray(content.validationIssues)) {
      repairContent = content;
      repairSchema = request.generationConfig.responseJsonSchema;
      return modelResponse(JSON.stringify({ project: corrected, explanation: "The fan runs at the requested threshold.", assumptions: [], warnings: [] }));
    }
    return modelResponse(JSON.stringify({ project: invalid, explanation: "Fan controller", assumptions: [], warnings: [] }));
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST", body: JSON.stringify({ prompt: greenhousePrompt }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body.error ?? body));
  assert.equal(calls, 2, "the behavior failure should receive one full-project repair");
  assert.equal(repairContent?.request, greenhousePrompt);
  assert.ok(Array.isArray(repairContent?.validationIssues) && repairContent.validationIssues.some(issue => String(issue).includes("fan behavior") && String(issue).includes("turn-on threshold")));
  assert.ok(Array.isArray(repairContent?.validationDiagnostics) && repairContent.validationDiagnostics.some(item => isRecord(item) && item.stage === "code" && /fan behavior/i.test(String(item.message))));
  const rejected = JSON.parse(String(repairContent?.rejectedResponse));
  assert.ok(rejected.project.components.length > 1 && rejected.project.connections.length > 1, "the repair receives all components and connections");
  assert.match(rejected.project.code, /analogWrite\(5, 0\);/);
  const schemaProperties = (repairSchema?.properties as Record<string, unknown> | undefined)?.project as { properties?: Record<string, unknown> } | undefined;
  assert.ok(schemaProperties?.properties?.components && schemaProperties.properties.connections && schemaProperties.properties.code);
  assert.match(body.project.code, /analogWrite\(5, 191\)/);
  assert.equal(ledSeriesResistorIssues(body.project).length, 0);
});
test("fan behavior validation enforces an explicit PWM percentage written with a percent sign", async context => {
  const previousFetch = globalThis.fetch; const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const repairedProject = greenhouseExample();
  const underpoweredProject = structuredClone(repairedProject);
  underpoweredProject.code = underpoweredProject.code.replace("analogWrite(5, 191)", "analogWrite(5, 64)");
  assert.notEqual(underpoweredProject.code, repairedProject.code);
  let repairIssues: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    const input = JSON.parse(request.contents[0].parts[0].text);
    repairIssues = input.validationIssues ?? repairIssues;
    return modelResponse(JSON.stringify({
      project: input.validationIssues?.length ? repairedProject : underpoweredProject,
      explanation: "A two-zone fan controller.", assumptions: [], warnings: [],
    }));
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST", body: JSON.stringify({ prompt: greenhousePrompt }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.ok(repairIssues.some(issue => issue.includes("75% PWM") && issue.includes("PWMA")), JSON.stringify(repairIssues));
});

const generatedEnvelope = {
  project: createDefaultBlinkProject(),
  explanation: "Generated a validated blink circuit.",
  assumptions: [],
  warnings: [],
};

test("generation removes only exact duplicate wires and repairs duplicate wire IDs before strict validation", async context => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const project = structuredClone(createDefaultBlinkProject());
  const originalConnectionCount = project.connections.length;
  project.connections[1]!.id = project.connections[0]!.id;
  const duplicate = structuredClone(project.connections[0]!);
  duplicate.id = "redundant-reversed-wire";
  [duplicate.from, duplicate.to] = [duplicate.to, duplicate.from];
  project.connections.push(duplicate);
  globalThis.fetch = async () => modelResponse(JSON.stringify({
    ...generatedEnvelope,
    project,
  }));

  const response = await POST(generationRequest());
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.project.connections.length, originalConnectionCount, "the redundant reverse edge should be removed without dropping distinct wires");
  assert.equal(new Set(body.project.connections.map((connection: FixtureWire) => connection.id)).size, originalConnectionCount);
  assert.ok(body.warnings.some((warning: string) => warning.includes("Removed a duplicate wire")));
  assert.ok(body.warnings.some((warning: string) => warning.includes("Renamed duplicate wire ID")));
});

function structuredBlinkEnvelope() {
  const project = createDefaultBlinkProject();
  const program = {
    headers: ["Arduino.h"],
    objects: [],
    globals: [{ kind: "declare", type: "int", name: "LED_PIN", initializer: "13", constant: true }],
    functions: [
      { name: "setup", returnType: "void", parameters: [], body: [{ kind: "call", callee: "pinMode", arguments: ["LED_PIN", "OUTPUT"] }] },
      { name: "loop", returnType: "void", parameters: [], body: [
        { kind: "call", callee: "digitalWrite", arguments: ["LED_PIN", "1"] },
        { kind: "call", callee: "delay", arguments: ["1000"] },
        { kind: "call", callee: "digitalWrite", arguments: ["LED_PIN", "0"] },
        { kind: "call", callee: "delay", arguments: ["1000"] },
      ] },
    ],
  };
  return {
    project: {
      ...project,
      connections: project.connections.map(connection => [connection.from.componentId, connection.from.pin, connection.to.componentId, connection.to.pin]),
      sketchPrograms: [{ boardId: "uno", program }],
    },
    explanation: "Generated a validated blink circuit.",
    assumptions: [],
    warnings: [],
  };
}

test("legacy typed full-project output still normalizes while generation requests executable source", async context => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  let schema: {
    properties?: {
      project?: {
        required?: string[];
        properties?: {
          code?: unknown;
          connections?: { items?: { type?: string } };
          sketchPrograms?: unknown;
        };
      };
    };
  } | undefined;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    schema = request.generationConfig.responseJsonSchema;
    return modelResponse(JSON.stringify(structuredBlinkEnvelope()));
  };

  const response = await POST(generationRequest());
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body.error ?? body));
  assert.match(body.project.code, /pinMode\(LED_PIN, OUTPUT\)/);
  assert.equal(typeof body.project.code, "string");
  assert.deepEqual(body.project.connections[0].from, { componentId: "uno", pin: "D13" });
  assert.ok(body.project.connections.every((connection: unknown) => !Array.isArray(connection)));
  const projectSchema = schema?.properties?.project;
  assert.ok(projectSchema);
  assert.ok(projectSchema.required?.includes("code"));
  assert.equal(projectSchema.properties?.sketchPrograms, undefined);
  assert.equal(typeof projectSchema.properties?.code, "object");
  assert.equal(projectSchema.properties?.connections?.items?.type, "array");
});

test("generation normalizes unambiguous two-terminal polarity markers to exact catalog pins", async context => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const project = structuredClone(COMPONENT_EXAMPLES["ws2812b-strip-8"]());
  project.components.push({ id: "buzzer", type: "buzzer", label: "Startup beeper", x: 620, y: 240 });
  const supplyReturn = project.connections.find(connection => connection.from.componentId === "strip-supply" && connection.from.pin === "-");
  assert.ok(supplyReturn, "fixture contains a wired DC supply return");
  supplyReturn.from.pin = "--";
  const supplyPositive = project.connections.find(connection => connection.to.componentId === "strip-supply" && connection.to.pin === "+");
  assert.ok(supplyPositive, "fixture contains a wired DC supply positive terminal");
  supplyPositive.to.pin = "++";
  project.connections.push(
    { id: "buzzer-positive", from: { componentId: "buzzer", pin: "" }, to: { componentId: "uno", pin: "D9" } },
    { id: "buzzer-tilde-marker", from: { componentId: "buzzer", pin: "~" }, to: { componentId: "uno", pin: "D9" } },
    { id: "buzzer-return", from: { componentId: "buzzer", pin: "GND" }, to: { componentId: "uno", pin: "GND" } },
    { id: "buzzer-return-marker", from: { componentId: "buzzer", pin: "-\"" }, to: { componentId: "uno", pin: "GND" } },
    { id: "buzzer-comment-return-marker", from: { componentId: "buzzer", pin: "-//" }, to: { componentId: "uno", pin: "GND" } },
    { id: "buzzer-underscore-return-marker", from: { componentId: "buzzer", pin: "_" }, to: { componentId: "uno", pin: "GND" } },
  );
  project.code = project.code.replace("void setup(){ strip.begin();", "void setup(){ pinMode(9,OUTPUT); tone(9,880); delay(100); noTone(9); strip.begin();");
  globalThis.fetch = async () => modelResponse(JSON.stringify({
    project,
    explanation: "The strip receives regulated power and shares ground with the board.",
    assumptions: [],
    warnings: [],
  }));

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST",
    body: JSON.stringify({ prompt: "Build an Arduino Uno circuit with one 8-pixel WS2812B strip powered by one regulated 5 V DC supply and one piezo buzzer. Use a common ground, show distinct red, green, and blue colors on the strip, and beep briefly at startup." }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body.error ?? body));
  const supplyPins = body.project.connections.flatMap((connection: { from: { componentId: string; pin: string }; to: { componentId: string; pin: string } }) => [connection.from, connection.to])
    .filter((endpoint: { componentId: string }) => endpoint.componentId === "strip-supply")
    .map((endpoint: { pin: string }) => endpoint.pin);
  assert.ok(supplyPins.includes("+") && supplyPins.includes("-"), JSON.stringify(supplyPins));
  assert.ok(body.warnings.some((warning: string) => warning.includes("polarity marker \"--\"") && warning.includes("catalog terminal -")));
  assert.ok(body.warnings.some((warning: string) => warning.includes("polarity marker \"++\"") && warning.includes("catalog terminal +")));
  assert.ok(body.warnings.some((warning: string) => warning.includes(`polarity marker ${JSON.stringify("-\"")}`) && warning.includes("buzzer") && warning.includes("catalog terminal -")));
  assert.ok(body.warnings.some((warning: string) => warning.includes('polarity marker "-//"') && warning.includes("buzzer") && warning.includes("catalog terminal -")));
  assert.ok(body.warnings.some((warning: string) => warning.includes('polarity marker "_"') && warning.includes("buzzer") && warning.includes("catalog terminal -")));
  assert.ok(body.warnings.some((warning: string) => warning.includes("polarity marker \"GND\"") && warning.includes("buzzer") && warning.includes("catalog terminal -")));
  assert.ok(body.warnings.some((warning: string) => warning.includes("Inferred the missing terminal on buzzer as +")));
  assert.ok(body.warnings.some((warning: string) => warning.includes('polarity marker "~" on buzzer to catalog terminal +')));
  assert.ok(body.project.connections.some((connection: { from: { componentId: string; pin: string }; to: { componentId: string; pin: string } }) =>
    [connection.from, connection.to].some(endpoint => endpoint.componentId === "buzzer" && endpoint.pin === "+")
    && [connection.from, connection.to].some(endpoint => endpoint.componentId === "uno" && endpoint.pin === "D9")));
  const buzzerReturn = body.project.connections.find((connection: { from: { componentId: string; pin: string }; to: { componentId: string; pin: string } }) =>
    [connection.from, connection.to].some(endpoint => endpoint.componentId === "buzzer" && endpoint.pin === "-"));
  assert.ok(buzzerReturn, JSON.stringify(body.project.connections));
});

test("generation infers malformed battery and H-bridge motor terminals from their paired endpoints", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const project = structuredClone(COMPONENT_EXAMPLES.l298());
  project.components.push(
    { id: "cell", type: "battery-cell", label: "Li-ion cell", x: 1100, y: 300, properties: { initialSoc: 70, capacityMah: 2000, temperature: 25 } },
    { id: "cell-load", type: "dc-load", label: "100 ohm cell load", x: 1320, y: 300, properties: { resistance: 100 } },
  );
  project.connections.push(
    { id: "cell-positive", from: { componentId: "cell", pin: "+" }, to: { componentId: "cell-load", pin: "+" } },
    { id: "cell-negative", from: { componentId: "cell", pin: "-" }, to: { componentId: "cell-load", pin: "-" } },
  );
  for (const connection of project.connections) {
    for (const endpoint of [connection.from, connection.to]) {
      if (endpoint.componentId === "cell" || (endpoint.componentId.startsWith("motor-") && (endpoint.pin === "+" || endpoint.pin === "-"))) {
        endpoint.pin = "_";
      }
    }
  }
  globalThis.fetch = async () => modelResponse(JSON.stringify({
    project,
    explanation: "The L298 drives two motors; the battery cell independently powers its load.",
    assumptions: [],
    warnings: [],
  }));

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST",
    body: JSON.stringify({ prompt: "Build an Arduino Uno L298 dual H-bridge demo with two DC motors and an independent Li-ion battery cell connected across a 100 ohm DC load." }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body.error ?? body));
  const motorTerminal = (motorId: string, terminal: string) => body.project.connections.find((connection: FixtureWire) =>
    [connection.from, connection.to].some(endpoint => endpoint.componentId === motorId && endpoint.pin === terminal));
  assert.ok(motorTerminal("motor-a", "+") && motorTerminal("motor-a", "-"), "OUT1/OUT2 should provide distinct canonical motor terminals");
  assert.ok(motorTerminal("motor-b", "+") && motorTerminal("motor-b", "-"), "OUT3/OUT4 should provide distinct canonical motor terminals");
  assert.ok(body.project.connections.some((connection: FixtureWire) =>
    [connection.from, connection.to].some(endpoint => endpoint.componentId === "cell" && endpoint.pin === "+")
    && [connection.from, connection.to].some(endpoint => endpoint.componentId === "cell-load" && endpoint.pin === "+")));
  assert.ok(body.project.connections.some((connection: FixtureWire) =>
    [connection.from, connection.to].some(endpoint => endpoint.componentId === "cell" && endpoint.pin === "-")
    && [connection.from, connection.to].some(endpoint => endpoint.componentId === "cell-load" && endpoint.pin === "-")));
});

test("Gemini schema rejection retries in JSON mode and still validates the complete circuit", async context => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalWarn = console.warn;
  context.after(() => {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  console.warn = () => {};
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const request = JSON.parse(String(init?.body));
    if (calls === 1) {
      assert.ok(request.generationConfig.responseJsonSchema.properties.project.properties.code, "the one-shot schema requests executable source with the complete topology");
      assert.equal(request.generationConfig.maxOutputTokens, 65_536);
      assert.ok(JSON.stringify(request.generationConfig.responseJsonSchema).length < 12_000, "the complete-project schema stays within a compact provider-safe size");
      return Response.json({ error: { code: 400, status: "INVALID_ARGUMENT", message: "Request contains an invalid argument." } }, { status: 400 });
    }
    assert.equal(request.generationConfig.responseJsonSchema, undefined, "the compatibility retry omits only Gemini's rejected schema");
    assert.equal(request.generationConfig.responseMimeType, "application/json");
    return modelResponse(JSON.stringify(generatedEnvelope));
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Blink an LED" }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body.error ?? body));
  assert.equal(calls, 2, "Gemini should retry the same complete-project request once with a compatible JSON response mode");
  assert.ok(body.project && body.project.code.includes("digitalWrite"), "only the validated Gemini proposal reaches the response");
});

test("allows complex generation to use the five-minute route window", () => {
  assert.equal(maxDuration, 300);
});

test("explicit multi-board generation validates and runs independent wired UART sketches", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const megaCode = "void setup(){ Serial1.begin(9600); } void loop(){ Serial1.println(\"A\"); delay(100); }";
  const espCode = "void setup(){ Serial2.begin(9600); Serial.begin(9600); } void loop(){ if(Serial2.available()){ int value=Serial2.read(); if(value=='P'){ Serial2.write('A'); } } delay(10); }";
  const repairedEspCode = "void setup(){ Serial2.begin(9600, SERIAL_8N1, 16, 17); Serial.begin(9600); } void loop(){ if(Serial2.available()){ int value=Serial2.read(); Serial.println(value); } delay(10); }";
  const project = {
    schemaVersion: 1, id: "uart-boards", name: "Wired UART controllers", description: "Two controllers exchange a byte.", board: "arduino-mega-2560",
    components: [
      { id: "mega", type: "arduino-mega-2560", label: "Mega sender", x: 0, y: 0 },
      { id: "esp", type: "esp32-devkitc-v4", label: "ESP32 receiver", x: 480, y: 0 },
    ],
    connections: [
      { id: "tx-rx", from: { componentId: "mega", pin: "D18" }, to: { componentId: "esp", pin: "GPIO16" } },
      { id: "rx-tx", from: { componentId: "esp", pin: "GPIO17" }, to: { componentId: "mega", pin: "D19" } },
      { id: "shared-ground", from: { componentId: "mega", pin: "GND" }, to: { componentId: "esp", pin: "GND" } },
    ],
    code: megaCode,
    boardPrograms: [{ boardId: "mega", code: megaCode }, { boardId: "esp", code: espCode }],
  };
  let requestSchema: { properties?: Record<string, unknown> } | undefined;
  let sketchInstructions = "";
  let calls = 0;
  let repairIssues: string[] = [];
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const request = JSON.parse(String(init?.body));
    requestSchema = request.generationConfig.responseJsonSchema;
    sketchInstructions = request.systemInstruction?.parts?.[0]?.text ?? sketchInstructions;
    const content = JSON.parse(request.contents[0].parts[0].text);
    repairIssues = content.validationIssues ?? [];
    const responseProject = content.validationIssues
      ? { ...project, boardPrograms: [{ boardId: "mega", code: megaCode }, { boardId: "esp", code: repairedEspCode }] }
      : project;
    return modelResponse(JSON.stringify({ project: responseProject, explanation: "Two wired controllers run separate sketches.", assumptions: [], warnings: [] }));
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Build a simulation with an Arduino Mega 2560 and ESP32 DevKitC V4 that exchange bytes over wired UART. Log every received UART byte to the ESP32 USB Serial Monitor." }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(calls, 2, "generation should repair a receiver sketch that silently discards the received byte");
  assert.ok(repairIssues.some(issue => issue.includes("USB Serial Monitor") && issue.includes("Serial1/Serial2")), "generation should distinguish the wired UART from monitor output");
  assert.match(sketchInstructions, /Local char variables are supported/);
  assert.match(sketchInstructions, /C-style casts and switch\/case are not supported/);
  assert.match(sketchInstructions, /switch\/case are not supported/);
  assert.match(sketchInstructions, /including early return/i);
  assert.match(sketchInstructions, /do not use recursive or side-effecting helper functions, break, continue, goto/i);
  const projectSchema = requestSchema?.properties?.project as { properties?: Record<string, unknown> } | undefined;
  assert.ok(projectSchema?.properties?.boardPrograms, "the complete-project schema should request one executable sketch per board");
  assert.ok(projectSchema?.properties?.code, "the active board's sketch remains in project.code");
  assert.equal(requestSchema?.properties?.programs, undefined, "generation no longer uses a separate structured-program stage");
  assert.match(body.project.programs.mega, /Serial1\.begin\(9600\)/);
  assert.match(body.project.programs.mega, /Serial1\.println\("A"\)/);
  assert.match(body.project.programs.esp, /Serial1\.begin\(9600\)/);
  assert.match(body.project.programs.esp, /Serial1\.read\(\)/);
  assert.doesNotMatch(body.project.programs.esp, /Serial2/);
  assert.ok(body.warnings.some((warning: string) => warning.includes("GPIO16") && warning.includes("GPIO17") && warning.includes("Serial2")), "the simulator-specific ESP32 UART normalization should be disclosed");

  const simulator = new MultiBoardSimulator();
  simulator.attachProject(body.project);
  simulator.run();
  simulator.advance(0);
  for (let step = 0; step < 20; step += 1) simulator.advance(20);
  assert.ok(simulator.getSnapshot().boardSerial?.esp?.some(entry => entry.text === "65"), "receiver sketch should observe the sender byte through the connected RX/TX pins");
});

test("targeted multi-board program edits preserve the existing hardware and UART wiring", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";

  const megaCode = `void setup() { Serial.begin(9600); Serial1.begin(9600); }
void loop() {
  Serial1.write('P');
  Serial.println("Sent P");
  delay(1000);
  if (Serial1.available() > 0) {
    int incoming = Serial1.read();
    Serial.print("Mega received: ");
    Serial.println(incoming);
  }
  delay(1000);
}`;
  const espCode = "void setup(){ Serial.begin(115200); Serial1.begin(9600); pinMode(2, OUTPUT); } void loop(){ if(Serial1.available()>0){ int incoming=Serial1.read(); Serial.println(incoming); if(incoming=='P'){ digitalWrite(2,HIGH); Serial1.write('A'); } } delay(100); }";
  const currentProject = {
    schemaVersion: 1,
    id: "preserved-uart",
    name: "Preserved UART",
    description: "A wired two-board UART handshake.",
    board: "arduino-mega-2560",
    components: [
      { id: "mega", type: "arduino-mega-2560", label: "Mega", x: 0, y: 0 },
      { id: "esp", type: "esp32-devkitc-v4", label: "ESP32", x: 500, y: 0 },
    ],
    connections: [
      { id: "mega-tx", from: { componentId: "mega", pin: "D18" }, to: { componentId: "esp", pin: "GPIO16" } },
      { id: "esp-tx", from: { componentId: "esp", pin: "GPIO17" }, to: { componentId: "mega", pin: "D19" } },
      { id: "shared-ground", from: { componentId: "mega", pin: "GND" }, to: { componentId: "esp", pin: "GND" } },
    ],
    code: megaCode,
    programs: { mega: megaCode, esp: espCode },
  };
  let repairRequests = 0;
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    const content = JSON.parse(request.contents[0].parts[0].text);
    if (Array.isArray(content.validationIssues)) repairRequests += 1;
    return modelResponse(JSON.stringify({ operations: [{ type: "set_program", boardId: "esp", code: espCode }], explanation: "ESP32 reports the received byte and responds to the Mega.", assumptions: [], warnings: [] }));
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
      body: JSON.stringify({
       prompt: "Edit the current Arduino Mega 2560 and ESP32 circuit. Preserve every wire and do not alter wiring. Do not add physical parts. Keep the UART P/A handshake, log each received byte to the ESP32 USB Serial Monitor, and turn on the ESP32 built-in LED on GPIO2 when P arrives.",
      currentProject,
      generationModeOverride: "edit",
    }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.generationMode, "edit");
  assert.equal(repairRequests, 0, "the app should deterministically preserve explicitly protected wiring instead of spending another provider call");
  assert.deepEqual(body.project.connections.map((wire: FixtureWire) => [wire.from.componentId, wire.from.pin, wire.to.componentId, wire.to.pin]), [
    ["mega", "D18", "esp", "GPIO16"],
    ["esp", "GPIO17", "mega", "D19"],
    ["mega", "GND", "esp", "GND"],
  ]);
  assert.equal(body.project.components.length, 2, "edit keeps the same two boards");

  const simulator = new MultiBoardSimulator();
  simulator.attachProject(body.project);
  simulator.run();
  for (let elapsed = 0; elapsed <= 2500; elapsed += 16.67) simulator.advance(16.67);
  const snapshot = simulator.getSnapshot();
  assert.ok(snapshot.boardSerial?.esp?.some(entry => entry.text === "80"), "ESP32 should receive the P byte through the preserved D18/GPIO16 wire");
  assert.ok(snapshot.boardSerial?.mega?.some(entry => entry.text === "65"), `Mega should receive the A acknowledgement through the preserved GPIO17/D19 wire: ${JSON.stringify({ serial: snapshot.boardSerial, diagnostics: snapshot.diagnostics, programs: body.project.programs })}`);
});

function modelResponse(text: string, finishReason = "STOP", usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number }) {
  return Response.json({
    candidates: [{ finishReason, content: { parts: [{ text }] } }],
    ...(usageMetadata ? { usageMetadata } : {}),
  });
}

function generationRequest(model?: string) {
  return new Request("http://localhost/api/ai/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Blink an LED", ...(model ? { model } : {}) }),
  });
}

function requestWithCurrentProject(prompt: string, generationModeOverride?: "create" | "edit") {
  return new Request("http://localhost/api/ai/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, currentProject: createDefaultBlinkProject(), ...(generationModeOverride ? { generationModeOverride } : {}) }),
  });
}

function assistantRequest(payload: Record<string, unknown>) {
  return new Request("http://localhost/api/ai/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

test("Build rejects an oversized streamed request before authentication, quota reservation, or provider calls", async () => {
  const reservationsBefore = testAiReservations;
  const response = await POST(assistantRequest({ prompt: "x".repeat(100_001) }));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "REQUEST_TOO_LARGE");
  assert.equal(testAiReservations, reservationsBefore);
});

test("explicit Chat mode handles natural conversation with recent turns and circuit context without using circuit credits", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const reservationsBefore = testAiReservations;
  const finalizationsBefore = testAiFinalizations.length;
  const chatLimitCallsBefore = testChatRateLimitUsers.length;
  let requestBody: {
    systemInstruction: { parts: Array<{ text: string }> };
    generationConfig: { maxOutputTokens: number; responseMimeType: string; responseJsonSchema: { required: string[] } };
    contents: Array<{ role: string; parts: Array<{ text: string }> }>;
  } | undefined;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return modelResponse(JSON.stringify({ reply: "Debugging is just asking your circuit what it meant, one wire at a time." }));
  };

  const response = await POST(assistantRequest({
    assistantMode: "chat",
    prompt: "Tell me a quick joke about debugging.",
    chatHistory: [
      { role: "user", text: "I am learning how this project works." },
      { role: "assistant", text: "I can help explain the open circuit too." },
    ],
    currentProject: createDefaultBlinkProject(),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body, {
    kind: "chat",
    reply: "Debugging is just asking your circuit what it meant, one wire at a time.",
    model: "gemini-3.5-flash-lite",
  });
  assert.equal(requestBody?.generationConfig.maxOutputTokens, 1_024);
  assert.equal(requestBody?.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(requestBody?.generationConfig.responseJsonSchema.required, ["reply"]);
  assert.deepEqual(requestBody?.contents.map(turn => [turn.role, turn.parts[0].text]), [
    ["user", "I am learning how this project works."],
    ["model", "I can help explain the open circuit too."],
    ["user", "Tell me a quick joke about debugging."],
  ]);
  const systemInstruction = requestBody?.systemInstruction.parts.map(part => part.text).join("\n") ?? "";
  assert.match(systemInstruction, /general-purpose assistant/i);
  assert.match(systemInstruction, /Board: arduino-uno/);
  assert.match(systemInstruction, /Wire:/);
  assert.equal(testChatRateLimitUsers.length, chatLimitCallsBefore + 1);
  assert.equal(testAiReservations, reservationsBefore, "chat must not reserve a circuit credit");
  assert.equal(testAiFinalizations.length, finalizationsBefore, "chat must not finalize a circuit credit");
});

test("Chat mode rejects malformed and oversized conversation history before calling Gemini", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  let providerCalls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async () => {
    providerCalls += 1;
    return modelResponse(JSON.stringify({ reply: "unexpected" }));
  };

  for (const chatHistory of [
    [{ role: "system", text: "not allowed" }],
    Array.from({ length: 13 }, () => ({ role: "user", text: "previous" })),
    [{ role: "user", text: "x".repeat(2_001) }],
  ]) {
    const response = await POST(assistantRequest({ assistantMode: "chat", prompt: "hello", chatHistory }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_CHAT_HISTORY");
  }
  assert.equal(providerCalls, 0);
});

test("Chat mode requires a verified account and does not consume the chat rate slot when unauthenticated", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const chatLimitCallsBefore = testChatRateLimitUsers.length;
  let providerCalls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
    configureAiUsageAdapterForTests(testAiUsageAdapter);
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  configureAiUsageAdapterForTests({ ...testAiUsageAdapter, authenticate: async () => null });
  globalThis.fetch = async () => {
    providerCalls += 1;
    return modelResponse(JSON.stringify({ reply: "unexpected" }));
  };

  const response = await POST(assistantRequest({ assistantMode: "chat", prompt: "hello" }));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "AUTH_REQUIRED");
  assert.equal(providerCalls, 0);
  assert.equal(testChatRateLimitUsers.length, chatLimitCallsBefore);
});

test("Chat mode enforces the separate server-side per-minute limit", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalRateLimit = testChatRateLimitAllowed;
  const reservationsBefore = testAiReservations;
  let providerCalls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
    testChatRateLimitAllowed = originalRateLimit;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  testChatRateLimitAllowed = false;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return modelResponse(JSON.stringify({ reply: "unexpected" }));
  };

  const response = await POST(assistantRequest({ assistantMode: "chat", prompt: "hello" }));
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error.code, "AI_CHAT_RATE_LIMITED");
  assert.equal(providerCalls, 0);
  assert.equal(testAiReservations, reservationsBefore, "chat throttling remains separate from circuit credits");
});

test("Build mode enforces an account-scoped generation limit before consuming monthly quota or calling Gemini", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalRateLimit = testGenerationRateLimitAllowed;
  const reservationsBefore = testAiReservations;
  const rateLimitCallsBefore = testGenerationRateLimitUsers.length;
  let providerCalls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
    testGenerationRateLimitAllowed = originalRateLimit;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  testGenerationRateLimitAllowed = false;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return modelResponse(JSON.stringify(generatedEnvelope));
  };

  const response = await POST(assistantRequest({ prompt: "Blink an LED" }));
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error.code, "AI_GENERATION_RATE_LIMITED");
  assert.ok(Number(response.headers.get("retry-after")) > 0);
  assert.equal(testGenerationRateLimitUsers.length, rateLimitCallsBefore + 1);
  assert.equal(providerCalls, 0);
  assert.equal(testAiReservations, reservationsBefore);
});

test("Build mode fails closed when the account generation limiter is unavailable", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalFailure = testGenerationRateLimitFails;
  const reservationsBefore = testAiReservations;
  let providerCalls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
    testGenerationRateLimitFails = originalFailure;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  testGenerationRateLimitFails = true;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return modelResponse(JSON.stringify(generatedEnvelope));
  };

  const response = await POST(assistantRequest({ prompt: "Blink an LED" }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "AI_GENERATION_RATE_LIMIT_UNAVAILABLE");
  assert.equal(providerCalls, 0);
  assert.equal(testAiReservations, reservationsBefore);
});

test("requests without assistantMode default to Build and create fresh circuits", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const requests: RequestInit[] = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async (_input, init) => {
    requests.push(init ?? {});
    const request = JSON.parse(String(init?.body));
    const content = JSON.parse(request.contents[0].parts[0].text);
    return modelResponse(content.mode === "edit"
      ? JSON.stringify({ operations: [{ type: "update_component", componentId: "uno", changes: { label: "Arduino Uno" } }], explanation: "Kept the current circuit intact.", assumptions: [], warnings: [] })
      : JSON.stringify(generatedEnvelope));
  };

  for (const prompt of ["Blink an LED", "Tell me a joke"]) {
    const response = await POST(requestWithCurrentProject(prompt, "create"));
    assert.equal(response.status, 200);
  }
  for (const request of requests) {
    const body = JSON.parse(String(request.body));
    const data = JSON.parse(body.contents[0].parts[0].text);
    assert.equal(data.mode, "create");
    assert.equal("currentProject" in data, false);
  }
});

test("Gemini classifies the whole request, preserving detailed create intent and targeted edits", async context => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  type ProviderRequest = {
    contents: Array<{ parts: Array<{ text: string }> }>;
    systemInstruction: { parts: Array<{ text: string }> };
    generationConfig: { maxOutputTokens?: number };
  };
  const requests: Array<{ body: ProviderRequest; system: string; content: Record<string, unknown> }> = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const currentProject = createDefaultBlinkProject();
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as ProviderRequest;
    const content = JSON.parse(body.contents[0]!.parts[0]!.text) as Record<string, unknown>;
    requests.push({ body, system: body.systemInstruction.parts[0]!.text, content });
    if ("currentCircuitSummary" in content) {
      const intent = typeof content.request === "string" && content.request.startsWith("Build a complete") ? "create" : "edit";
      return modelResponse(JSON.stringify({ intent }), "STOP", { promptTokenCount: 12, candidatesTokenCount: 2 });
    }
    if (content.mode === "create") return modelResponse(JSON.stringify(generatedEnvelope), "STOP", { promptTokenCount: 50, candidatesTokenCount: 10 });
    return modelResponse(JSON.stringify({
      operations: [{ type: "update_component", componentId: "uno", changes: { label: "Current controller" } }],
      explanation: "Updated the current controller label.", assumptions: [], warnings: [],
    }), "STOP", { promptTokenCount: 40, candidatesTokenCount: 8 });
  };

  const createResponse = await POST(assistantRequest({
    prompt: "Build a complete traffic intersection with an Arduino Uno. Add the lights and button, then wire every branch and write its behavior.",
    currentProject,
  }));
  const createBody = await createResponse.json();
  assert.equal(createResponse.status, 200, JSON.stringify(createBody));
  assert.equal(createBody.generationMode, "create");
  const editResponse = await POST(assistantRequest({ prompt: "Build on the existing circuit by adding a second LED branch.", currentProject }));
  const editBody = await editResponse.json();
  assert.equal(editResponse.status, 200, JSON.stringify(editBody));
  assert.equal(editBody.generationMode, "edit");
  assert.equal(editBody.project.components.find((component: FixtureComponent) => component.id === "uno").label, "Current controller");

  const classifierRequests = requests.filter(request => {
    return "currentCircuitSummary" in request.content;
  });
  assert.equal(classifierRequests.length, 2);
  assert.equal(requests.length, 4, "each open-project request is classified before its selected generation path");
  for (const request of classifierRequests) {
    assert.equal(request.body.generationConfig.maxOutputTokens, 128);
    assert.match(request.system, /whole request/i);
    assert.match(request.system, /untrusted data/i);
    assert.equal("currentProject" in request.content, false, "classification receives a compact summary instead of the full saved project");
    assert.equal(typeof request.content.currentCircuitSummary, "string");
    assert.ok((request.content.currentCircuitSummary as string).length <= 6_000);
  }
  const createGeneration = requests.find(request => request.content.mode === "create");
  assert.ok(createGeneration);
  assert.equal("currentProject" in createGeneration.content, false);
  const editGeneration = requests.find(request => request.content.mode === "edit");
  assert.deepEqual(editGeneration?.content.currentProject, currentProject);
});

test("saved projects without a controller board go straight to full circuit generation", async context => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const baseProject = createDefaultBlinkProject();
  const boardlessProjects = [
    { ...baseProject, components: [], connections: [] },
    {
      ...baseProject,
      // A stale top-level board field is not proof that there is a board to edit.
      components: [{ id: "r1", type: "resistor", label: "Resistor 1", x: 0, y: 0, rotation: 0, properties: {} }],
      connections: [],
    },
  ];
  const providerContents: Array<Record<string, unknown>> = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    const content = JSON.parse(request.contents[0].parts[0].text) as Record<string, unknown>;
    providerContents.push(content);
    return modelResponse(JSON.stringify(generatedEnvelope));
  };

  for (const currentProject of boardlessProjects) {
    const response = await POST(assistantRequest({ prompt: "Blink LED fast", currentProject }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.generationMode, "create");
  }

  assert.equal(providerContents.length, boardlessProjects.length, "each request should make one full-generation call and skip the intent classifier");
  for (const content of providerContents) {
    assert.equal(content.mode, "create");
    assert.equal("currentProject" in content, false);
    assert.equal("currentCircuitSummary" in content, false);
  }
});

test("clarification asks the user without generating or consuming a circuit request", async context => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const project = createDefaultBlinkProject();
  const snapshot = structuredClone(project);
  const reservationsBefore = testAiReservations;
  const finalizationsBefore = testAiFinalizations.length;
  let providerCalls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async () => {
    providerCalls += 1;
    return modelResponse(JSON.stringify({ intent: "clarify" }), "STOP", { promptTokenCount: 20, candidatesTokenCount: 3 });
  };

  const response = await POST(assistantRequest({ prompt: "Make this into a buzzer circuit.", currentProject: project }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.kind, "mode-clarification");
  assert.deepEqual(body.options, ["edit", "create"]);
  assert.equal(providerCalls, 1, "clarification must stop before circuit generation");
  assert.deepEqual(project, snapshot, "classification must not mutate the supplied circuit");
  assert.equal(testAiReservations, reservationsBefore + 1, "classification still reserves through the existing auth/quota path");
  assert.equal(testAiFinalizations.length, finalizationsBefore + 1);
  assert.equal(testAiFinalizations.at(-1)?.succeeded, false, "clarification releases the reservation instead of consuming a credit");
  assert.deepEqual({ input: testAiFinalizations.at(-1)?.inputTokens, output: testAiFinalizations.at(-1)?.outputTokens }, { input: 20, output: 3 });
});

test("invalid Gemini intent fails retryably without falling back or touching the circuit", async context => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const project = createDefaultBlinkProject();
  const snapshot = structuredClone(project);
  let providerCalls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async () => {
    providerCalls += 1;
    return modelResponse(JSON.stringify({ intent: "build" }));
  };

  const response = await POST(assistantRequest({ prompt: "Add a buzzer", currentProject: project }));
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error.code, "AI_INTENT_CLASSIFICATION_FAILED");
  assert.equal(body.error.retryable, true);
  assert.equal(providerCalls, 1, "an invalid classifier result must not call the circuit generator");
  assert.equal(testAiFinalizations.at(-1)?.succeeded, false);
  assert.deepEqual(project, snapshot);
});

test("Build authentication and request reservation happen before any classifier call", async context => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalAllowed = testAiReservationAllowed;
  let providerCalls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
    testAiReservationAllowed = originalAllowed;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  testAiReservationAllowed = false;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return modelResponse(JSON.stringify({ intent: "edit" }));
  };

  const response = await POST(assistantRequest({ prompt: "Add a buzzer", currentProject: createDefaultBlinkProject() }));
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error.code, "AI_MONTHLY_LIMIT_REACHED");
  assert.equal(providerCalls, 0, "an over-quota request must not contact Gemini for classification");
});

test("explicit mode choices bypass classification and Edit requires an open project", async context => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  let providerCalls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async (_input, init) => {
    providerCalls += 1;
    const request = JSON.parse(String(init?.body));
    const content = JSON.parse(request.contents[0].parts[0].text);
    assert.equal("currentCircuitSummary" in content, false, "a user-selected mode skips the classifier");
    assert.equal(content.mode, "create");
    return modelResponse(JSON.stringify(generatedEnvelope));
  };

  const project = createDefaultBlinkProject();
  const response = await POST(assistantRequest({ prompt: "Create a new Arduino Uno LED blinking circuit.", currentProject: project, generationModeOverride: "create" }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.generationMode, "create");
  assert.equal(body.project.id, project.id, "a user-selected replacement retains the saved project identity");
  assert.equal(providerCalls, 1);

  const invalidEdit = await POST(assistantRequest({ prompt: "Add a buzzer", generationModeOverride: "edit" }));
  assert.equal(invalidEdit.status, 400);
  assert.equal((await invalidEdit.json()).error.code, "CURRENT_PROJECT_REQUIRED");

  const emptyProject = { ...project, components: [], connections: [] };
  const editWithoutBoard = await POST(assistantRequest({ prompt: "Blink LED fast", currentProject: emptyProject, generationModeOverride: "edit" }));
  assert.equal(editWithoutBoard.status, 400);
  assert.equal((await editWithoutBoard.json()).error.code, "CURRENT_CONTROLLER_BOARD_REQUIRED");
  assert.equal(providerCalls, 1, "an impossible edit must be rejected before contacting Gemini");
});

test("targeted edit operations preserve unrelated parts, positions, properties, and wires", () => {
  const original = createDefaultBlinkProject();
  const snapshot = structuredClone(original);
  const result = applyCircuitEditOperations(original, [
    { type: "add_component", component: { id: "buzzer1", type: "buzzer", label: "Buzzer", x: 820, y: 180, rotation: 0, properties: {} } },
    { type: "add_connection", from: { componentId: "buzzer1", pin: "+" }, to: { componentId: "uno", pin: "D8" } },
    { type: "add_connection", from: { componentId: "buzzer1", pin: "-" }, to: { componentId: "uno", pin: "GND" } },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(original, snapshot, "applying a patch must not mutate the supplied saved project object");
  assert.deepEqual((result.project.components as unknown[]).slice(0, snapshot.components.length), snapshot.components);
  assert.deepEqual((result.project.connections as unknown[]).slice(0, snapshot.connections.length), snapshot.connections);
  assert.equal((result.project.components as Array<{ id: string }>).at(-1)?.id, "buzzer1");
});

test("single-board set_program patches canonicalize an unambiguous board reference", () => {
  const original = createDefaultBlinkProject();
  const code = "void setup(){} void loop(){ delay(10); }";
  const result = applyCircuitEditOperations(original, [{ type: "set_program", boardId: "Arduino Uno", code }]);
  assert.equal(result.ok, true, "the only board is the unambiguous target even when the model echoes its display label");
  if (result.ok) assert.equal(result.project.code, code);
  assert.equal(original.code, createDefaultBlinkProject().code, "the source project remains unchanged");
});

test("wire reference aliases resolve only to a unique exact type or label", () => {
  const components = [
    { id: "board-esp", type: "esp32-devkitc-v4", label: "ESP32" },
    { id: "light-sensor", type: "bh1750-sen0097", label: "BH1750" },
    { id: "red-led", type: "led", label: "Red status LED" },
    { id: "green-led", type: "led", label: "Green status LED" },
  ];
  assert.equal(resolveUniqueComponentReference("ESP32", components), "board-esp");
  assert.equal(resolveUniqueComponentReference("bh1750-sen0097", components), "light-sensor");
  assert.equal(resolveUniqueComponentReference("led", components), undefined, "repeated component types must remain ambiguous");
  assert.equal(resolveUniqueComponentReference("unplaced-buzzer", components), undefined, "unknown references remain validation failures");
});

test("targeted removal and rewiring touch only the requested connection", () => {
  const original = createDefaultBlinkProject();
  const result = applyCircuitEditOperations(original, [
    { type: "remove_connection", connectionId: "wire-d13-r1" },
    { type: "add_connection", from: { componentId: "uno", pin: "D9" }, to: { componentId: "r1", pin: "1" } },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(original.connections[0], { id: "wire-d13-r1", from: { componentId: "uno", pin: "D13" }, to: { componentId: "r1", pin: "1" }, color: "#f59e0b" });
  const wires = result.project.connections as Array<{ id: string; from: { componentId: string; pin: string }; to: { componentId: string; pin: string } }>;
  assert.equal(wires.some(wire => wire.id === "wire-d13-r1"), false);
  assert.ok(wires.some(wire => wire.from.componentId === "uno" && wire.from.pin === "D9" && wire.to.componentId === "r1" && wire.to.pin === "1"));
  assert.deepEqual(wires.filter(wire => wire.id !== "wire-ai-1"), original.connections.slice(1));
});

test("invalid targeted edits leave the original project untouched", () => {
  const original = createDefaultBlinkProject();
  const snapshot = structuredClone(original);
  const result = applyCircuitEditOperations(original, [{ type: "remove_connection", connectionId: "missing-wire" }]);
  assert.equal(result.ok, false);
  assert.deepEqual(original, snapshot);
});

test("an AI edit patch adds and simulates a buzzer without replacing the open circuit", async context => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const initialProject = createDefaultBlinkProject();
  const setProgram = `void setup(){ pinMode(13, OUTPUT); pinMode(8, OUTPUT); }\nvoid loop(){ digitalWrite(13, HIGH); tone(8, 880); delay(1000); digitalWrite(13, LOW); noTone(8); delay(1000); }`;
  let providerRequest: Record<string, unknown> | undefined;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    providerRequest = request;
    return modelResponse(JSON.stringify({
      operations: [
        { type: "add_component", component: { id: "buzzer1", type: "buzzer", label: "Buzzer", x: 820, y: 180, rotation: 0, properties: {} } },
        { type: "add_connection", from: { componentId: "buzzer1", pin: "__plus" }, to: { componentId: "uno", pin: "D8" } },
        { type: "add_connection", from: { componentId: "buzzer1", pin: "@" }, to: { componentId: "uno", pin: "GND" } },
        { type: "set_program", boardId: "uno", code: setProgram },
      ],
      explanation: "The buzzer now sounds alongside the existing LED blink.",
      assumptions: [], warnings: [],
    }));
  };
  const response = await POST(assistantRequest({ prompt: "Add a buzzer that beeps in sync with the existing LED blink.", currentProject: initialProject, generationModeOverride: "edit" }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.generationMode, "edit");
  for (const existing of initialProject.components) {
    const actual = body.project.components.find((component: FixtureComponent) => component.id === existing.id);
    assert.deepEqual(actual && { ...actual, rotation: actual.rotation ?? 0 }, { ...existing, rotation: existing.rotation ?? 0 });
  }
  assert.deepEqual(body.project.connections.slice(0, initialProject.connections.length), initialProject.connections);
  assert.ok(body.project.connections.some((wire: FixtureWire) => [wire.from, wire.to].some(endpoint => endpoint.componentId === "buzzer1" && endpoint.pin === "+")));
  assert.ok(body.project.connections.some((wire: FixtureWire) => [wire.from, wire.to].some(endpoint => endpoint.componentId === "buzzer1" && endpoint.pin === "-")));
  assert.equal(body.project.components.find((component: { id: string }) => component.id === "buzzer1").x, 820);
  assert.equal(body.project.code, setProgram);
  const providerBody = providerRequest as { contents: Array<{ parts: Array<{ text: string }> }>; generationConfig: { responseJsonSchema: { properties: Record<string, unknown> } }; systemInstruction: { parts: Array<{ text: string }> } };
  const prompt = JSON.parse(providerBody.contents[0]!.parts[0]!.text);
  assert.equal(prompt.mode, "edit");
  assert.deepEqual(prompt.currentProject, initialProject);
  assert.ok("operations" in providerBody.generationConfig.responseJsonSchema.properties);
  assert.equal("project" in providerBody.generationConfig.responseJsonSchema.properties, false);
  assert.match(providerBody.systemInstruction.parts[0]!.text, /NEVER a replacement project/);

  const simulator = new ArduinoSimulator(body.project.code);
  simulator.attachProject(body.project);
  simulator.run(); simulator.advance(0);
  assert.ok(simulator.getSnapshot().tones?.some(tone => tone.active && tone.frequency === 880));
  assert.deepEqual(simulator.getSnapshot().diagnostics.filter(diagnostic => diagnostic.severity === "error"), []);
});

test("AI adds a blinking LED to the open circuit and preserves its numeric-first UUID identity", async context => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const initialProject = createDefaultBlinkProject();
  initialProject.id = "3290a16e-f370-4e5e-9c09-1a6fe3c8b0ab";
  const snapshot = structuredClone(initialProject);
  const blinkCode = "void setup(){ pinMode(13,OUTPUT); pinMode(12,OUTPUT); } void loop(){ digitalWrite(13,HIGH); digitalWrite(12,HIGH); delay(500); digitalWrite(13,LOW); digitalWrite(12,LOW); delay(500); }";
  let providerCalls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async () => {
    providerCalls += 1;
    return modelResponse(JSON.stringify({
      operations: [
        { type: "add_component", component: { id: "r2", type: "resistor", label: "R2 · 220 Ω", x: 900, y: 180, rotation: 0, properties: { resistance: 220 } } },
        { type: "add_component", component: { id: "led2", type: "led", label: "LED2 · Green", x: 1120, y: 180, rotation: 90, properties: { color: "#22c55e", forwardVoltage: 2 } } },
        { type: "add_connection", from: { componentId: "uno", pin: "D12" }, to: { componentId: "r2", pin: "1" } },
        { type: "add_connection", from: { componentId: "r2", pin: "2" }, to: { componentId: "led2", pin: "A" } },
        { type: "add_connection", from: { componentId: "led2", pin: "K" }, to: { componentId: "uno", pin: "GND" } },
        { type: "set_program", boardId: "uno", code: blinkCode },
      ],
      explanation: "Added a green LED branch that blinks in sync with the existing LED.",
      assumptions: [], warnings: [],
    }));
  };

  const response = await POST(assistantRequest({ prompt: "Add a blinking LED please.", currentProject: initialProject, generationModeOverride: "edit" }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.generationMode, "edit");
  assert.equal(body.project.id, snapshot.id);
  assert.equal(providerCalls, 1, "a numeric-first project UUID must not trigger provider repair");
  assert.deepEqual(initialProject, snapshot, "AI edits must not mutate the submitted open project");
  for (const component of snapshot.components) {
    const actual = body.project.components.find((item: FixtureComponent) => item.id === component.id);
    assert.deepEqual(actual && { ...actual, rotation: actual.rotation ?? 0 }, { ...component, rotation: component.rotation ?? 0 });
  }
  for (const connection of snapshot.connections) assert.deepEqual(body.project.connections.find((item: FixtureWire) => item.id === connection.id), connection);
  assert.ok(body.project.connections.some((wire: FixtureWire) => [wire.from, wire.to].some(endpoint => endpoint.componentId === "uno" && endpoint.pin === "D12") && [wire.from, wire.to].some(endpoint => endpoint.componentId === "r2" && endpoint.pin === "1")));
  assert.ok(body.project.connections.some((wire: FixtureWire) => [wire.from, wire.to].some(endpoint => endpoint.componentId === "r2" && endpoint.pin === "2") && [wire.from, wire.to].some(endpoint => endpoint.componentId === "led2" && endpoint.pin === "A")));
  assert.ok(body.project.connections.some((wire: FixtureWire) => [wire.from, wire.to].some(endpoint => endpoint.componentId === "led2" && endpoint.pin === "K")));
  assert.equal(body.project.code, blinkCode);

  const simulator = new ArduinoSimulator(body.project.code);
  simulator.attachProject(body.project);
  simulator.run();
  simulator.advance(0);
  assert.deepEqual(simulator.getSnapshot().diagnostics.filter(diagnostic => diagnostic.severity === "error"), []);
  assert.equal(simulator.getSnapshot().componentStates.led1?.powered, true);
  assert.equal(simulator.getSnapshot().componentStates.led2?.powered, true);
});

test("project identity is server-owned for edits, replacements, and new projects", async context => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const existingProject = createDefaultBlinkProject();
  existingProject.id = "3290a16e-f370-4e5e-9c09-1a6fe3c8b0ab";
  const createProjectSchemas: Array<{ properties: Record<string, unknown>; required: string[] }> = [];
  let providerCalls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async (_input, init) => {
    providerCalls += 1;
    const request: {
      contents: Array<{ parts: Array<{ text: string }> }>;
      generationConfig: {
        responseJsonSchema: {
          properties: {
            project: { properties: Record<string, unknown>; required: string[] };
          };
        };
      };
    } = JSON.parse(String(init?.body));
    const modelRequest: { mode: string } = JSON.parse(request.contents[0].parts[0].text);
    if (modelRequest.mode !== "edit") {
      createProjectSchemas.push(request.generationConfig.responseJsonSchema.properties.project);
    }
    if (modelRequest.mode === "edit") {
      return modelResponse(JSON.stringify({
        operations: [{ type: "update_component", componentId: "uno", changes: { label: "Identity test board" } }],
        explanation: "Renamed the open controller.", assumptions: [], warnings: [],
      }));
    }
    const envelope = structuredClone(generatedEnvelope);
    if (providerCalls === 2) envelope.project.id = "9-provider-generated-id";
    else delete (envelope.project as { id?: string }).id;
    return modelResponse(JSON.stringify(envelope));
  };

  const editResponse = await POST(assistantRequest({ prompt: "Rename the controller to Identity test board.", currentProject: existingProject, generationModeOverride: "edit" }));
  const editBody = await editResponse.json();
  assert.equal(editResponse.status, 200, JSON.stringify(editBody));
  assert.equal(editBody.generationMode, "edit");
  assert.equal(editBody.project.id, existingProject.id);
  assert.equal(editBody.project.components.find((component: FixtureComponent) => component.id === "uno").label, "Identity test board");

  const replacementResponse = await POST(assistantRequest({ prompt: "Create a fresh Arduino Uno blink circuit from scratch.", currentProject: existingProject, generationModeOverride: "create" }));
  const replacementBody = await replacementResponse.json();
  assert.equal(replacementResponse.status, 200, JSON.stringify(replacementBody));
  assert.equal(replacementBody.generationMode, "create");
  assert.equal(replacementBody.project.id, existingProject.id, "replacing the circuit contents must preserve the saved-project key");

  const newProjectResponse = await POST(assistantRequest({ prompt: "Blink an LED" }));
  const newProjectBody = await newProjectResponse.json();
  assert.equal(newProjectResponse.status, 200, JSON.stringify(newProjectBody));
  assert.match(newProjectBody.project.id, /^project-[0-9a-f-]{36}$/i, "the server must assign an ID when there is no open saved project");
  assert.equal(providerCalls, 3, "invalid or omitted provider project IDs must not trigger repairs");

  for (const schema of createProjectSchemas) {
    assert.equal(Object.hasOwn(schema.properties, "id"), false, "the provider schema must not ask Gemini for the storage key");
    assert.equal(schema.required.includes("id"), false);
  }
});

test("server-owned project IDs do not weaken component or wire ID validation", async context => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const invalidProject = createDefaultBlinkProject();
  invalidProject.id = "9-invalid-model-project-id";
  invalidProject.components[1]!.id = "9-invalid-component-id";
  invalidProject.connections[0]!.id = "9-invalid-wire-id";
  let providerCalls = 0;
  configureGenerationTestLimitsForTests({ maxRepairs: 0 });
  context.after(() => {
    globalThis.fetch = originalFetch;
    configureGenerationTestLimitsForTests(undefined);
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async () => {
    providerCalls += 1;
    return modelResponse(JSON.stringify({ ...generatedEnvelope, project: invalidProject }));
  };

  const response = await POST(generationRequest());
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.error.code, "AI_VALIDATION_FAILED");
  assert.ok(body.error.details.some((issue: string) => /project\.components\[1\]\.id must start with a letter/.test(issue)), JSON.stringify(body.error.details));
  assert.ok(body.error.details.some((issue: string) => /project\.connections\[0\]\.id must start with a letter/.test(issue)), JSON.stringify(body.error.details));
  assert.equal(providerCalls, 1, "invalid circuit identifiers remain validation errors, separate from the ignored project ID");
});

test("explicit edit prompts include the current project", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const requests: RequestInit[] = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async (_input, init) => {
    requests.push(init ?? {});
    return modelResponse(JSON.stringify({
      operations: [{ type: "update_component", componentId: "uno", changes: { label: "Arduino Uno" } }],
      explanation: "Kept the current circuit intact.", assumptions: [], warnings: [],
    }));
  };

  for (const prompt of ["Modify the current circuit", "Update the current circuit", "Edit the current circuit"]) {
    const response = await POST(requestWithCurrentProject(prompt, "edit"));
    assert.equal(response.status, 200);
  }
  for (const request of requests) {
    const body = JSON.parse(String(request.body));
    const data = JSON.parse(body.contents[0].parts[0].text);
    assert.equal(data.mode, "edit");
    assert.deepEqual(data.currentProject, createDefaultBlinkProject());
    assert.ok(body.generationConfig.responseJsonSchema.properties.operations);
    assert.equal("project" in body.generationConfig.responseJsonSchema.properties, false);
  }
});

test("forwards only the default and selected Gemini models", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });

  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return Response.json({
      candidates: [{
        finishReason: "STOP",
        content: { parts: [{ text: JSON.stringify(generatedEnvelope) }] },
      }],
    });
  };

  const defaultResponse = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Blink an LED" }),
  }));
  const liteResponse = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Blink an LED", model: "gemini-3.5-flash-lite" }),
  }));

  assert.equal(defaultResponse.status, 200);
  assert.equal(liteResponse.status, 200);
  assert.equal((await defaultResponse.json()).model, "gemini-3.5-flash-lite");
  assert.equal((await liteResponse.json()).model, "gemini-3.5-flash-lite");
  assert.match(requests[0].url, /models\/gemini-3\.5-flash-lite:generateContent$/);
  assert.match(requests[1].url, /models\/gemini-3\.5-flash-lite:generateContent$/);

  for (const request of requests) {
    const headers = new Headers(request.init?.headers);
    const body = JSON.parse(String(request.init?.body));
    assert.equal(headers.get("x-goog-api-key"), "test-secret");
    assert.equal(body.generationConfig.maxOutputTokens, 65_536);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.equal(body.generationConfig.responseJsonSchema.type, "object");
    assert.ok(body.generationConfig.responseJsonSchema.properties.project.properties.code);
    assert.equal("temperature" in body.generationConfig, false);
  }
});

test("a truncated initial answer gets one compact full-project retry and never publishes an invalid result", async context => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalInfo = console.info;
  const requests: RequestInit[] = [];
  const logs: string[] = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret-must-not-be-logged";
  console.info = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  let providerCalls = 0;
  const contents: Record<string, unknown>[] = [];
  globalThis.fetch = async (_input, init) => {
    providerCalls += 1;
    requests.push(init ?? {});
    const request = JSON.parse(String(init?.body));
    contents.push(JSON.parse(request.contents[0].parts[0].text));
    return Response.json({
      modelVersion: "gemini-3.5-flash-lite",
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 65_536, totalTokenCount: 65_656 },
      candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "" }] } }],
    });
  };

  const response = await POST(generationRequest());
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.error.code, "AI_RESPONSE_TRUNCATED");
  assert.match(body.error.message, /65,536-token output limit/);
  assert.match(body.error.message, /split the design into smaller circuits/);
  assert.equal(providerCalls, 2, "the truncation request and its single compact retry reach Gemini");
  assert.equal(requests.length, 2, "truncation permits exactly one compact complete-project retry, never planner or subsystem calls");
  assert.equal(contents[1]?.compactRetry, true);
  assert.match(String(contents[1]?.task), /previous complete-project response reached the model output limit/i);
  assert.equal(contents[1]?.request, contents[0]?.request, "the compact retry preserves the original request");
  assert.equal(contents[1]?.mode, contents[0]?.mode);
  for (const request of requests) {
    const providerRequest = JSON.parse(String(request.body));
    assert.equal(providerRequest.generationConfig.maxOutputTokens, 65_536);
    assert.ok(providerRequest.generationConfig.responseJsonSchema.properties.project.properties.components);
    assert.ok(providerRequest.generationConfig.responseJsonSchema.properties.project.properties.connections);
  }
  assert.ok(logs.some(line => line.includes("finishReason\":\"MAX_TOKENS")));
  assert.ok(logs.some(line => line.includes("candidatesTokenCount\":65536")));
  assert.ok(logs.some(line => line.includes("latencyMs")));
  assert.doesNotMatch(logs.join("\n"), /test-secret-must-not-be-logged|Blink an LED/);
});

test("a compact complete-project retry after output truncation is validated before publication", async context => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const request = JSON.parse(String(init?.body));
    const content = JSON.parse(request.contents[0].parts[0].text);
    if (calls === 1) return Response.json({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "" }] } }] });
    assert.equal(content.compactRetry, true);
    assert.equal(request.generationConfig.maxOutputTokens, 65_536);
    return modelResponse(JSON.stringify({ project: createDefaultBlinkProject(), explanation: "Blinking LED.", assumptions: [], warnings: [] }));
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST", body: JSON.stringify({ prompt: "Blink an LED" }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(calls, 2);
  assert.ok(body.project.code.includes("digitalWrite"));
});

test("repairs malformed JSON before returning a circuit", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const requests: RequestInit[] = [];
  const responses = [
    modelResponse('{"project":'),
    modelResponse(JSON.stringify(generatedEnvelope)),
  ];
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async (_input, init) => {
    requests.push(init ?? {});
    return responses.shift() ?? modelResponse("");
  };

  const response = await POST(generationRequest("gemini-3.5-flash-lite"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).model, "gemini-3.5-flash-lite");
  assert.equal(requests.length, 2);
  const repairBody = JSON.parse(String(requests[1].body));
  const repairData = JSON.parse(repairBody.contents[0].parts[0].text);
  assert.match(repairData.task, /Repair the rejected circuit proposal/);
  assert.deepEqual(repairData.validationIssues, ["response invalid_json"]);
  assert.equal(repairData.rejectedResponse, '{"project":');
});

test("passes schema issues into the repair attempt", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const requests: RequestInit[] = [];
  const responses = [
    modelResponse(JSON.stringify({ project: {} })),
    modelResponse(JSON.stringify(generatedEnvelope)),
  ];
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async (_input, init) => {
    requests.push(init ?? {});
    return responses.shift() ?? modelResponse("");
  };

  const response = await POST(generationRequest());
  assert.equal(response.status, 200);
  const repairBody = JSON.parse(String(requests[1].body));
  const repairData = JSON.parse(repairBody.contents[0].parts[0].text);
  assert.ok(repairData.validationIssues.some((issue: string) => issue.includes("project.components must be an array")), JSON.stringify(repairData.validationIssues));
  assert.deepEqual(repairData.requiredComponentCounts, [{ type: "led", count: 1 }]);
  assert.ok(repairData.availableComponentTypes.includes("led"));
  assert.equal("details" in (await response.json()), false);
});

test("repairs simulator-unsupported Arduino code before accepting a project", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const requests: RequestInit[] = [];
  const unsupported = {
    ...generatedEnvelope,
    project: { ...generatedEnvelope.project, code: "void setup(){ lcd.unsupported(); } void loop(){}" },
  };
  const responses = [modelResponse(JSON.stringify(unsupported)), modelResponse(JSON.stringify(generatedEnvelope))];
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async (_input, init) => {
    requests.push(init ?? {});
    return responses.shift() ?? modelResponse("");
  };
  const response = await POST(generationRequest());
  assert.equal(response.status, 200);
  assert.equal(requests.length, 2);
  const repairBody = JSON.parse(String(requests[1].body));
  const repairData = JSON.parse(repairBody.contents[0].parts[0].text);
  assert.ok(repairData.validationIssues.some((issue: string) => issue.includes("project.code simulator UNSUPPORTED_CALL") && issue.includes("lcd.unsupported() is outside the simulator subset")), JSON.stringify(repairData.validationIssues));
});

test("regenerates cleanly when repair is also malformed", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const requests: RequestInit[] = [];
  const responses = [
    modelResponse("not json"),
    modelResponse("still not json"),
    modelResponse(JSON.stringify(generatedEnvelope)),
  ];
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async (_input, init) => {
    requests.push(init ?? {});
    return responses.shift() ?? modelResponse("");
  };

  const response = await POST(generationRequest());
  assert.equal(response.status, 200);
  assert.equal(requests.length, 3);
  const firstBody = JSON.parse(String(requests[0].body));
  const repairBody = JSON.parse(String(requests[1].body));
  const regeneratedBody = JSON.parse(String(requests[2].body));
  const regeneratedData = JSON.parse(regeneratedBody.contents[0].parts[0].text);
  assert.equal(regeneratedData.rejectedResponse, "still not json");
  assert.match(regeneratedData.task, /Repair the rejected circuit proposal/);
  assert.equal(JSON.parse(firstBody.contents[0].parts[0].text).mode, "create");
  assert.notEqual(
    repairBody.contents[0].parts[0].text,
    firstBody.contents[0].parts[0].text,
  );
});

test("reports when the provider repeats a malformed generation response", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  let calls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async () => {
    calls += 1;
    return modelResponse("malformed");
  };

  const response = await POST(generationRequest());
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(calls, 3);
  assert.equal(body.error.code, "AI_REPAIR_NO_CHANGE");
  assert.match(body.error.message, /same invalid/);
  assert.ok(Array.isArray(body.error.details));
});

test("provider request rejection exposes sanitized field diagnostics", async context => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async () => Response.json({ error: {
    message: "Request contains an invalid argument.",
    details: [{ fieldViolations: [{ field: "generationConfig.responseFormat", description: "unsupported schema field" }] }],
  } }, { status: 400 });

  const response = await POST(generationRequest());
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.deepEqual(body.error.details, ["generationConfig.responseFormat: unsupported schema field"]);
});

test("daily Gemini quota exhaustion reports the provider error without retrying the same model", async context => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalWarn = console.warn;
  let calls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    console.warn = originalWarn;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  console.warn = () => {};
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    const [callback, delay, ...extra] = args;
    return originalSetTimeout(callback, delay === 30_000 || delay === 60_000 ? 0 : delay, ...extra);
  }) as typeof setTimeout;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ error: {
      status: "RESOURCE_EXHAUSTED",
      message: "You exceeded your current quota.",
      details: [{
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }],
      }],
    } }, { status: 429 });
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/x-ndjson" },
    body: JSON.stringify({ prompt: "Blink an LED" }),
  }));
  const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
  const error = events.at(-1)?.error;
  assert.equal(calls, 1);
  assert.equal(events.at(-1)?.type, "error");
  assert.equal(error?.code, "AI_DAILY_QUOTA_EXCEEDED");
  assert.equal(error?.retryable, false);
  assert.match(error?.message ?? "", /daily request quota is exhausted/i);
  assert.ok(error?.details?.some((detail: string) => detail.includes("You exceeded your current quota")));
});


test("NDJSON generation streams one complete-project request, validation, and one complete result", async context => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async () => modelResponse(JSON.stringify(generatedEnvelope));

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/x-ndjson" },
    body: JSON.stringify({ prompt: "Blink an LED" }),
  }));
  assert.equal(response.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
  const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(events.at(-1)?.type, "complete");
  assert.equal(events.filter(event => event.type === "complete").length, 1);
  const stages = events.filter(event => event.type === "progress").map(event => event.stage);
  assert.ok(stages.includes("generating"));
  assert.ok(stages.includes("validating"));
  assert.ok(events.at(-1)?.result?.project?.schemaVersion === 1);
});

test("transient Gemini failures are retried and expose the provider's HTTP status", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  let calls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ error: { status: "UNAVAILABLE", message: "This model is currently experiencing high demand." } }, { status: 503, headers: { "retry-after": "0" } });
  };

  const response = await POST(generationRequest());
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(calls, 1 + 2);
  assert.equal(body.error.code, "AI_UNAVAILABLE");
  assert.match(body.error.message, /Gemini returned temporary HTTP 503 \(UNAVAILABLE\)/);
  assert.deepEqual(body.error.details, ["Google Gemini: This model is currently experiencing high demand."]);
  assert.equal(body.error.retryable, true);
});

test("a stalled Gemini request gets a bounded retry and reports that no HTTP status was received", async context => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalWarn = console.warn;
  let calls = 0;
  const warnings: string[] = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    console.warn = originalWarn;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    const [callback, delay, ...extra] = args;
    return originalSetTimeout(callback, delay === GEMINI_PROVIDER_CALL_TIMEOUT_MS || delay === 30_000 ? 0 : delay, ...extra);
  }) as typeof setTimeout;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    if (calls === 1) return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      const abort = () => reject(new DOMException("Provider call timed out", "AbortError"));
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });
    return modelResponse(JSON.stringify(generatedEnvelope));
  };

  const response = await POST(generationRequest());
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(calls, 2, "one call timeout should permit one retry within the generation deadline");
  assert.ok(warnings.some(line => line.includes("[ai-generation-provider-timeout]") && line.includes('"providerStatus":null')), warnings.join("\n"));
  assert.equal(body.project.schemaVersion, 1);
});

test("Retry-After beyond the request deadline is not retried", async context => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  let calls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ error: { message: "temporarily unavailable" } }, { status: 503, headers: { "retry-after": "3600" } });
  };
  const response = await POST(generationRequest());
  assert.equal(response.status, 503);
  assert.equal(calls, 1);
});

test("generation succeeds after a transient Gemini 503", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return Response.json({ error: { message: "temporarily unavailable" } }, { status: 503, headers: { "retry-after": "0" } });
    return modelResponse(JSON.stringify(generatedEnvelope));
  };

  const response = await POST(generationRequest());
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test("a transient provider connection failure is retried before generation is reported failed", async context => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    const [callback, delay, ...extra] = args;
    return originalSetTimeout(callback, delay === 30_000 || delay === 60_000 ? 0 : delay, ...extra);
  }) as typeof setTimeout;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("temporary network failure");
    return modelResponse(JSON.stringify(generatedEnvelope));
  };

  const response = await POST(generationRequest());
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test("provider network failures expose sanitized low-level diagnostics in the UI and server log", async context => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalWarn = console.warn;
  const warnings: string[] = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    console.warn = originalWarn;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret-do-not-log";
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    const [callback, delay, ...extra] = args;
    return originalSetTimeout(callback, delay === 30_000 || delay === 60_000 ? 0 : delay, ...extra);
  }) as typeof setTimeout;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const denied = Object.assign(new Error("socket permission denied"), { code: "EACCES", errno: -4092, syscall: "connect" });
    const unreachable = Object.assign(new Error("no network route"), { code: "ENETUNREACH", errno: -4062, syscall: "connect" });
    const aggregate = Object.assign(new AggregateError([denied, unreachable], "all connection attempts failed"), { code: "EACCES" });
    throw new TypeError("fetch failed", { cause: aggregate });
  };

  const response = await POST(generationRequest());
  const body = await response.json() as { error?: { code?: string; message?: string; details?: string[] } };
  assert.equal(response.status, 503);
  assert.equal(body.error?.code, "AI_UNAVAILABLE");
  assert.equal(calls, 3, "the request should retain its bounded retry behavior");
  assert.ok(body.error?.details?.some(detail => detail.includes("EACCES") && detail.includes("ENETUNREACH")));
  assert.match(body.error?.details?.[0] ?? "", /outbound socket connection/);
  assert.ok(warnings.some(line => line.includes("[ai-generation-network-retry]") && line.includes("EACCES") && line.includes("ENETUNREACH") && line.includes("connect")));
  assert.ok(warnings.some(line => line.includes("[ai-generation-network-failure]") && line.includes("outbound_access_denied+network_unreachable")));
  assert.doesNotMatch(warnings.join("\n"), /test-secret-do-not-log|Blink an LED|socket permission denied|all connection attempts failed/);
});


test("newly published sensor and radio hardware pass simulation preflight", async context => {
  const originalFetch = globalThis.fetch; const originalKey = process.env.GEMINI_API_KEY;
  context.after(() => { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey; });
  process.env.GEMINI_API_KEY = "test-secret";
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ error: { message: "temporary provider failure" } }, { status: 503, headers: { "retry-after": "3600" } });
  };
  for (const name of ["BME280", "LoRa", "Zigbee"]) {
    const response = await POST(new Request("http://localhost/api/ai/generate", { method: "POST", body: JSON.stringify({ prompt: `Create a circuit with ${name}`, target: "simulation" }) }));
    assert.equal(response.status, 503);
    assert.notEqual((await response.json()).error.code, "COMPONENT_UNAVAILABLE");
  }
  assert.equal(calls, 3);
});

test("non-simulation generation modes are rejected without provider access", async context => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { throw new Error("must not contact provider"); };
  const response = await POST(new Request("http://localhost/api/ai/generate", { method: "POST", body: JSON.stringify({ prompt: "Create a BME280 circuit", target: "design" }) }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_GENERATION_TARGET");
});

test("simulation never accepts a provider-inserted unregistered part", async context => {
  const originalFetch = globalThis.fetch; const originalKey = process.env.GEMINI_API_KEY;
  context.after(() => { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey; });
  process.env.GEMINI_API_KEY = "test-secret";
  const envelope = structuredClone(generatedEnvelope);
  envelope.project.components.push({ id: "draft", type: "unfinished-draft-part", label: "Draft part", x: 700, y: 0 });
  globalThis.fetch = async () => modelResponse(JSON.stringify(envelope));
  const response = await POST(generationRequest());
  assert.equal(response.status, 502);
});
