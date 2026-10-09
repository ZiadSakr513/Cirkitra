import assert from "node:assert/strict";
import test, { after } from "node:test";
import nextEnv from "@next/env";

import { POST, configureGenerationTestLimitsForTests, hasObservableButtonEffect, hasObservableButtonEffectAfterRelease, hasObservableEncoderEffect, simulateButtonScenario, simulateEncoderScenario } from "../app/api/ai/generate/route.ts";
import { configureAiUsageAdapterForTests, type AiUsageAdapter } from "../lib/billing/ai-usage.ts";
import { safeParseCircuitProject } from "../lib/circuit/index.ts";
import { createDefaultBlinkProject } from "../lib/circuit/default-project.ts";
import { ArduinoSimulator } from "../lib/simulator/index.ts";
import { greenhouseMonitorPrompt } from "./fixtures/greenhouse.ts";

const enabled = process.env.CIRKITRA_RUN_LIVE_AI_EDIT_TESTS === "true";
if (enabled) nextEnv.loadEnvConfig(process.cwd());
const canRunLive = enabled && !!process.env.GEMINI_API_KEY?.trim();
const skipReason = enabled ? "GEMINI_API_KEY is not configured" : "Set CIRKITRA_RUN_LIVE_AI_EDIT_TESTS=true to allow real Gemini calls";
let lastLiveProviderRequestAt = 0;
const LIVE_PROVIDER_MIN_INTERVAL_MS = 5_000;

const liveUsage: AiUsageAdapter = {
  authenticate: async () => "cirkitra-live-edit-test-user",
  reserve: async () => ({
    allowed: true,
    reservation: {
      reservationId: "in-memory-live-edit-test",
      usage: { planId: "free", planName: "Free", used: 0, limit: 5, remaining: 5, unlimited: false, resetsAt: null, billingEnabled: false },
    },
  }),
  finalize: async () => {},
  snapshot: async () => ({ planId: "free", planName: "Free", used: 0, limit: 5, remaining: 5, unlimited: false, resetsAt: null, billingEnabled: false }),
};

if (canRunLive) configureAiUsageAdapterForTests(liveUsage);
after(() => {
  configureAiUsageAdapterForTests(undefined);
  configureGenerationTestLimitsForTests(undefined);
});

async function runLiveEdit(prompt: string, verify: (project: ReturnType<typeof createDefaultBlinkProject>, original: ReturnType<typeof createDefaultBlinkProject>) => void) {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async (input, init) => {
    providerCalls += 1;
    if (providerCalls > 2) throw new Error("Live edit scenario exceeded its two-call Gemini budget");
    const waitMs = Math.max(0, LIVE_PROVIDER_MIN_INTERVAL_MS - (Date.now() - lastLiveProviderRequestAt));
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
    lastLiveProviderRequestAt = Date.now();
    return originalFetch(input, init);
  };
  configureGenerationTestLimitsForTests({ maxRepairs: 1, maxTransientRetries: 0, maxTruncatedRetries: 0, allowSchemaFallback: false });
  try {
    const original = createDefaultBlinkProject();
    // Supabase project keys are UUIDs; this fixture deliberately starts with
    // a digit to cover IDs rejected by the old component-ID validator.
    original.id = "3290a16e-f370-4e5e-9c09-1a6fe3c8b0ab";
    const originalSnapshot = structuredClone(original);
    const response = await POST(new Request("http://localhost/api/ai/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, currentProject: structuredClone(original), generationModeOverride: "edit" }),
    }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body.error ?? body));
    assert.equal(body.generationMode, "edit");
    const parsed = safeParseCircuitProject(body.project);
    assert.deepEqual(original, originalSnapshot, "live scenarios only use independent in-memory circuit clones");
    if (!parsed.success) throw new Error(`the full patched result should satisfy the public circuit schema: ${parsed.issues.map(issue => issue.message).join("; ")}`);
    try {
      verify(parsed.data as ReturnType<typeof createDefaultBlinkProject>, original);
    } catch (error) {
      const project = parsed.data as ReturnType<typeof createDefaultBlinkProject>;
      const diagnostic = {
        components: project.components.map(component => ({ id: component.id, type: component.type, x: component.x, y: component.y, properties: component.properties })),
        connections: project.connections,
        code: project.code,
      };
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nGenerated edit for diagnosis: ${JSON.stringify(diagnostic)}`);
    }
    assert.ok(providerCalls >= 1 && providerCalls <= 2, `expected one initial request and at most one repair; saw ${providerCalls}`);
    console.info(`[live-ai-edit-test] ${prompt.slice(0, 48)}… completed with ${providerCalls} Gemini call(s)`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runLiveCreate(prompt: string, verify: (project: ReturnType<typeof createDefaultBlinkProject>, original: ReturnType<typeof createDefaultBlinkProject>) => void) {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async (input, init) => {
    providerCalls += 1;
    if (providerCalls > 2) throw new Error("Live build scenario exceeded its two-call Gemini budget");
    const waitMs = Math.max(0, LIVE_PROVIDER_MIN_INTERVAL_MS - (Date.now() - lastLiveProviderRequestAt));
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
    lastLiveProviderRequestAt = Date.now();
    return originalFetch(input, init);
  };
  configureGenerationTestLimitsForTests({ maxRepairs: 1, maxTransientRetries: 0, maxTruncatedRetries: 0, allowSchemaFallback: false });
  try {
    const original = createDefaultBlinkProject();
    original.id = "3290a16e-f370-4e5e-9c09-1a6fe3c8b0ab";
    const originalSnapshot = structuredClone(original);
    const response = await POST(new Request("http://localhost/api/ai/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, currentProject: structuredClone(original), generationModeOverride: "create" }),
    }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body.error ?? body));
    assert.equal(body.generationMode, "create");
    assert.equal(body.project?.id, original.id, "fresh builds must retain the open project's opaque storage identity");
    const parsed = safeParseCircuitProject(body.project);
    assert.deepEqual(original, originalSnapshot, "live scenarios only use independent in-memory circuit clones");
    if (!parsed.success) throw new Error(`the generated project should satisfy the public circuit schema: ${parsed.issues.map(issue => issue.message).join("; ")}`);
    try {
      verify(parsed.data as ReturnType<typeof createDefaultBlinkProject>, original);
    } catch (error) {
      const project = parsed.data as ReturnType<typeof createDefaultBlinkProject>;
      const diagnostic = {
        components: project.components.map(component => ({ id: component.id, type: component.type, label: component.label, properties: component.properties })),
        connections: project.connections,
        code: project.code,
      };
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nGenerated build for diagnosis: ${JSON.stringify(diagnostic)}`);
    }
    assert.ok(providerCalls >= 1 && providerCalls <= 2, `expected one initial request and at most one repair; saw ${providerCalls}`);
    console.info(`[live-ai-build-test] ${prompt.slice(0, 48)}… completed with ${providerCalls} Gemini call(s)`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function assertPreservedLayoutAndWiring(project: ReturnType<typeof createDefaultBlinkProject>, original: ReturnType<typeof createDefaultBlinkProject>) {
  const byId = new Map(project.components.map(component => [component.id, component]));
  for (const component of original.components) {
    const actual = byId.get(component.id);
    assert.deepEqual(actual && { ...actual, rotation: actual.rotation ?? 0 }, { ...component, rotation: component.rotation ?? 0 }, `preserve ${component.id} including its position and properties`);
  }
  for (const connection of original.connections) assert.ok(project.connections.some(candidate => candidate.id === connection.id && candidate.from.componentId === connection.from.componentId && candidate.from.pin === connection.from.pin && candidate.to.componentId === connection.to.componentId && candidate.to.pin === connection.to.pin), `preserve ${connection.id}`);
}

function assertPreservedExceptComponents(project: ReturnType<typeof createDefaultBlinkProject>, original: ReturnType<typeof createDefaultBlinkProject>, editableIds: string[]) {
  const byId = new Map(project.components.map(component => [component.id, component]));
  for (const component of original.components) {
    const actual = byId.get(component.id);
    assert.ok(actual, `preserve original component ${component.id}`);
    if (editableIds.includes(component.id)) {
      assert.deepEqual(
        actual && { id: actual.id, type: actual.type, x: actual.x, y: actual.y, rotation: actual.rotation ?? 0 },
        { id: component.id, type: component.type, x: component.x, y: component.y, rotation: component.rotation ?? 0 },
        `keep ${component.id}'s identity and position while editing its requested fields`,
      );
    } else {
      assert.deepEqual(actual && { ...actual, rotation: actual.rotation ?? 0 }, { ...component, rotation: component.rotation ?? 0 }, `preserve ${component.id}`);
    }
  }
  for (const connection of original.connections) assert.ok(project.connections.some(candidate => candidate.id === connection.id && candidate.from.componentId === connection.from.componentId && candidate.from.pin === connection.from.pin && candidate.to.componentId === connection.to.componentId && candidate.to.pin === connection.to.pin), `preserve ${connection.id}`);
}

function assertPreservedExceptPosition(project: ReturnType<typeof createDefaultBlinkProject>, original: ReturnType<typeof createDefaultBlinkProject>, movedId: string) {
  const byId = new Map(project.components.map(component => [component.id, component]));
  for (const component of original.components) {
    const actual = byId.get(component.id);
    assert.ok(actual, `preserve original component ${component.id}`);
    if (component.id === movedId) {
      assert.deepEqual(
        actual && { id: actual.id, type: actual.type, label: actual.label, rotation: actual.rotation ?? 0, properties: actual.properties },
        { id: component.id, type: component.type, label: component.label, rotation: component.rotation ?? 0, properties: component.properties },
        `moving ${movedId} must not change its identity, label, orientation, or properties`,
      );
    } else {
      assert.deepEqual(actual && { ...actual, rotation: actual.rotation ?? 0 }, { ...component, rotation: component.rotation ?? 0 }, `preserve ${component.id}`);
    }
  }
  for (const connection of original.connections) assert.ok(project.connections.some(candidate => candidate.id === connection.id && candidate.from.componentId === connection.from.componentId && candidate.from.pin === connection.from.pin && candidate.to.componentId === connection.to.componentId && candidate.to.pin === connection.to.pin), `preserve ${connection.id}`);
}

function assertSimulationHasNoErrors(project: ReturnType<typeof createDefaultBlinkProject>, milliseconds = 1_000) {
  const simulator = new ArduinoSimulator(project.code);
  simulator.attachProject(project);
  simulator.run();
  simulator.advance(0);
  simulator.advance(milliseconds);
  assert.deepEqual(simulator.getSnapshot().diagnostics.filter(diagnostic => diagnostic.severity === "error"), [], "the edited project must remain simulation-ready");
  return simulator;
}

function hasWire(project: ReturnType<typeof createDefaultBlinkProject>, first: [string, string], second: [string, string]) {
  return project.connections.some(connection =>
    (connection.from.componentId === first[0] && connection.from.pin === first[1] && connection.to.componentId === second[0] && connection.to.pin === second[1])
    || (connection.from.componentId === second[0] && connection.from.pin === second[1] && connection.to.componentId === first[0] && connection.to.pin === first[1]));
}

function hasGroundReturn(project: ReturnType<typeof createDefaultBlinkProject>, componentId: string, pin: string) {
  const groundIds = new Set(project.components.filter(component => component.type === "ground").map(component => component.id));
  const boardIds = new Set(project.components.filter(component => component.type.startsWith("arduino-") || component.type.startsWith("esp") || component.type === "raspberry-pi-pico").map(component => component.id));
  const endpoint = (id: string, pinId: string) => `${id}:${pinId}`;
  const graph = new Map<string, string[]>();
  for (const connection of project.connections) {
    const from = endpoint(connection.from.componentId, connection.from.pin);
    const to = endpoint(connection.to.componentId, connection.to.pin);
    graph.set(from, [...(graph.get(from) ?? []), to]);
    graph.set(to, [...(graph.get(to) ?? []), from]);
  }
  const queue = [endpoint(componentId, pin)];
  const visited = new Set(queue);
  while (queue.length) {
    const current = queue.shift()!;
    const [id, pinId] = current.split(":");
    if (id && boardIds.has(id) && /^GND\d*$/.test(pinId ?? "") || id && groundIds.has(id) && pinId === "GND") return true;
    for (const neighbor of graph.get(current) ?? []) if (!visited.has(neighbor)) {
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }
  return false;
}

function assertLedResistorBranch(project: ReturnType<typeof createDefaultBlinkProject>, boardId: string, pin: string) {
  const endpoint = (wire: (typeof project.connections)[number], componentId: string) =>
    wire.from.componentId === componentId ? wire.from.pin : wire.to.pin;
  for (const resistor of project.components.filter(component => component.type === "resistor")) {
    const boardWire = project.connections.find(wire =>
      [wire.from, wire.to].some(point => point.componentId === boardId && point.pin === pin)
      && [wire.from, wire.to].some(point => point.componentId === resistor.id));
    if (!boardWire) continue;
    const resistorPin = endpoint(boardWire, resistor.id);
    const otherResistorPin = resistorPin === "1" ? "2" : "1";
    const led = project.components.find(component => component.type === "led" && project.connections.some(wire =>
      [wire.from, wire.to].some(point => point.componentId === resistor.id && point.pin === otherResistorPin)
      && [wire.from, wire.to].some(point => point.componentId === component.id && point.pin === "A")));
    if (led && hasGroundReturn(project, led.id, "K")) return led;
  }
  assert.fail(`expected ${boardId}:${pin} to feed a resistor, LED anode, and grounded cathode`);
}

function assertNoTwoRoadGreensAtOnce(project: ReturnType<typeof createDefaultBlinkProject>, milliseconds = 30_000) {
  const simulator = assertSimulationHasNoErrors(project, 0);
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 500) {
    simulator.advance(500);
    const roadAGreen = simulator.getPinState("D4")?.digitalValue === 1;
    const roadBGreen = simulator.getPinState("D7")?.digitalValue === 1;
    assert.ok(!(roadAGreen && roadBGreen), `both traffic-road green outputs were high at virtual time ${elapsed + 500}ms`);
  }
  return simulator;
}

function simulateDistanceOutput(project: ReturnType<typeof createDefaultBlinkProject>, distanceCm: number, outputPin: string) {
  const scenario = structuredClone(project);
  const sensor = scenario.components.find(component => component.type === "hc-sr04");
  assert.ok(sensor, "parking alert must include HC-SR04");
  sensor.properties = { ...sensor.properties, distanceCm };
  const simulator = new ArduinoSimulator(scenario.code);
  simulator.attachProject(scenario);
  simulator.run();
  for (let elapsed = 0; elapsed < 1_500; elapsed += 50) simulator.advance(50);
  return simulator.getPinState(outputPin)?.digitalValue === 1;
}

const trafficIntersectionPrompt = `Build a complete two-road traffic intersection with an Arduino Uno. Use six LEDs for the two traffic lights: red, yellow, and green for each road. Add a pedestrian request button, a white walk LED, and a buzzer. Put a 220 ohm resistor in series with every LED.
Use D2, D3, and D4 for Road A red, yellow, and green; D5, D6, and D7 for Road B; D8 for the walk LED; D9 for the button; and D10 for the buzzer. Wire the button from D9 to GND and use INPUT_PULLUP.
Write the Arduino behavior as a non-blocking state machine using millis(), not delay(). Road A should stay green for 8 seconds, then yellow for 2 seconds, followed by 1 second with both roads red. Then give Road B the same sequence. A button press should be debounced and remembered until it is safe to serve: after the next road’s yellow phase, keep both roads red for 6 seconds, light the walk LED, and beep every 500 milliseconds. Then turn off the walk signal and resume the traffic cycle.
Never allow both roads to show green at once. Start in a safe all-red state. Make the wiring match the pin assignments and generated code. Validate that the LEDs, button, buzzer, and timing behavior work in simulation.`;

test("LIVE Gemini fresh-builds the two-road traffic intersection without entering edit mode", { skip: !canRunLive && skipReason }, async () => {
  await runLiveCreate(trafficIntersectionPrompt, (project) => {
    const board = project.components.find(component => component.type === "arduino-uno");
    assert.ok(board, "intersection should contain an Arduino Uno");
    assert.ok(project.components.filter(component => component.type === "led").length >= 7, "six traffic LEDs plus the white walk LED are required");
    assert.ok(project.components.filter(component => component.type === "resistor").length >= 7, "every LED needs its own resistor");
    const button = project.components.find(component => component.type === "push-button");
    const buzzer = project.components.find(component => component.type === "buzzer");
    assert.ok(button && buzzer, "the pedestrian button and buzzer must be present");
    const trafficLeds = [2, 3, 4, 5, 6, 7, 8].map(pin => assertLedResistorBranch(project, board.id, `D${pin}`));
    assert.equal(new Set(trafficLeds.map(led => led.id)).size, 7, "each assigned output should have a distinct LED branch");
    assert.ok(project.connections.some(wire => [wire.from, wire.to].some(point => point.componentId === button.id && point.pin === "1") && [wire.from, wire.to].some(point => point.componentId === board.id && point.pin === "D9")), "button should connect to D9");
    assert.ok(hasGroundReturn(project, button.id, "2"), "button should return to ground for INPUT_PULLUP");
    assert.ok(project.connections.some(wire => [wire.from, wire.to].some(point => point.componentId === buzzer.id && point.pin === "+") && [wire.from, wire.to].some(point => point.componentId === board.id && point.pin === "D10")), "buzzer should connect to D10");
    assert.match(project.code, /INPUT_PULLUP/);
    assert.match(project.code, /\bmillis\s*\(/);
    assert.doesNotMatch(project.code, /\bdelay\s*\(/, "traffic timings should be non-blocking");
    assertNoTwoRoadGreensAtOnce(project);
  });
});

test("LIVE Gemini fresh-builds the greenhouse monitor with its requested sensors and controls", { skip: !canRunLive && skipReason }, async () => {
  await runLiveCreate(greenhouseMonitorPrompt, project => {
    for (const type of ["arduino-uno", "dht22", "soil-moisture-sen0193", "lcd-16x2", "ky-040", "buzzer", "led", "resistor"]) {
      assert.ok(project.components.some(component => component.type === type), `greenhouse build should include ${type}`);
    }
    assert.ok(project.components.filter(component => component.type === "resistor" && Number(component.properties?.resistance) === 220).length >= 1, "alarm LED needs its 220-ohm current limiter");
    assert.match(project.code, /analogRead\s*\(/, "soil moisture should be measured");
    assert.match(project.code, /digitalRead\s*\(/, "the rotary encoder/button should be read");
    assertSimulationHasNoErrors(project, 2_000);
    const encoder = project.components.find(component => component.type === "ky-040")!;
    const alarmFrames = simulateButtonScenario(project, project.code, undefined, greenhouseMonitorPrompt);
    const mutedFrames = simulateButtonScenario(project, project.code, encoder.id, greenhouseMonitorPrompt);
    const alarmLed = project.components.find(component => component.type === "led")!;
    assert.ok(alarmFrames.some(frame => frame.tones.some(tone => tone.active)), "dry soil should activate the buzzer in simulation");
    assert.ok(alarmFrames.some(frame => frame.componentStates[alarmLed.id]?.powered), "dry soil should light the alarm LED in simulation");
    assert.ok(hasObservableButtonEffectAfterRelease(project, alarmFrames, mutedFrames), "pressing the encoder switch should latch buzzer mute until recovery");
    assert.equal(mutedFrames.at(-1)?.componentStates[alarmLed.id]?.powered, true, "muting should leave the dry-soil LED alarm active");
    assert.ok(!mutedFrames.at(-1)?.tones.some(tone => tone.active), "the buzzer should remain muted after releasing the switch");
    const initial = simulateEncoderScenario(project, project.code, encoder.id, 0);
    const rotated = simulateEncoderScenario(project, project.code, encoder.id, 20);
    assert.ok(hasObservableEncoderEffect(project, initial, rotated, false), "encoder rotation should visibly update the threshold/display");
  });
});

test("LIVE Gemini fresh-builds a distance-based ultrasonic parking alert", { skip: !canRunLive && skipReason }, async () => {
  await runLiveCreate("Build a complete ultrasonic parking alert with an Arduino Uno, one HC-SR04, three LEDs with separate 220-ohm resistors, and a piezo buzzer. Wire TRIG to D3 and ECHO to D4, then wire green, yellow, and red LED branches to D5, D6, and D7 and the buzzer signal to D8. Measure distance with pulseIn. Above 100 cm show green and keep the buzzer silent; from 40 through 100 cm show yellow and beep once per second; below 40 cm show red and beep four times per second. Use non-blocking millis timing for the alert pattern, print distance to Serial, and make the distance states work in simulation.", project => {
    const board = project.components.find(component => component.type === "arduino-uno");
    const sensor = project.components.find(component => component.type === "hc-sr04");
    const buzzer = project.components.find(component => component.type === "buzzer");
    assert.ok(board && sensor && buzzer, "parking alert needs Uno, HC-SR04, and buzzer");
    assert.ok(project.components.filter(component => component.type === "led").length >= 3);
    assert.ok(project.components.filter(component => component.type === "resistor").length >= 3);
    assert.ok(hasWire(project, [sensor.id, "TRIG"], [board.id, "D3"]));
    assert.ok(hasWire(project, [sensor.id, "ECHO"], [board.id, "D4"]));
    assert.ok(hasWire(project, [sensor.id, "VCC"], [board.id, "5V"]));
    assert.ok(hasGroundReturn(project, sensor.id, "GND"));
    assert.equal(new Set([5, 6, 7].map(pin => assertLedResistorBranch(project, board.id, `D${pin}`).id)).size, 3);
    assert.ok(hasWire(project, [buzzer.id, "+"], [board.id, "D8"]));
    assert.match(project.code, /\bpulseIn\s*\(/);
    assert.match(project.code, /\bmillis\s*\(/);
    assertSimulationHasNoErrors(project, 2_000);
    assert.equal(simulateDistanceOutput(project, 150, "D5"), true, "far distance should select the green output");
    assert.equal(simulateDistanceOutput(project, 20, "D7"), true, "near distance should select the red output");
  });
});

test("LIVE Gemini edit adds a buzzer to the existing circuit", { skip: !canRunLive && skipReason }, async () => {
  await runLiveEdit(
    "Add one buzzer to the existing LED blink circuit so it beeps in sync with the LED. Keep all original parts, wires, positions, and behavior unchanged otherwise.",
    (project, original) => {
      assertPreservedLayoutAndWiring(project, original);
      const buzzer = project.components.find(component => component.type === "buzzer");
      assert.ok(buzzer, "Gemini should add a catalog buzzer instead of replacing the circuit");
      assert.ok(project.connections.some(wire => [wire.from, wire.to].some(endpoint => endpoint.componentId === buzzer!.id && endpoint.pin === "+")));
      const simulator = new ArduinoSimulator(project.code);
      simulator.attachProject(project);
      simulator.run(); simulator.advance(0); simulator.advance(100);
      assert.ok(simulator.getSnapshot().tones?.some(tone => tone.active), "the new buzzer should produce an active simulated tone");
    },
  );
});

test("LIVE Gemini edit adds a behavior-controlled button", { skip: !canRunLive && skipReason }, async () => {
  const prompt = "Add a momentary push button between Arduino Uno D2 and GND, configured with INPUT_PULLUP, and add a buzzer with its positive terminal on D3 and negative terminal grounded. Make the existing LED turn on only while the button is held; call tone(3, 1000) while held and noTone(3) immediately after release. Replace only the conflicting blink behavior; preserve every original component, wire, and position.";
  await runLiveEdit(prompt, (project, original) => {
    assertPreservedLayoutAndWiring(project, original);
    const button = project.components.find(component => component.type === "push-button");
    const buzzer = project.components.find(component => component.type === "buzzer");
    assert.ok(button && buzzer, "Gemini should add the behavior button and buzzer to the open circuit");
    assert.ok(hasWire(project, [button.id, "1"], ["uno", "D2"]));
    assert.ok(hasGroundReturn(project, button.id, "2"), "button should close to ground for INPUT_PULLUP");
    assert.ok(hasWire(project, [buzzer.id, "+"], ["uno", "D3"]));
    assert.ok(hasGroundReturn(project, buzzer.id, "-"));
    assert.match(project.code, /INPUT_PULLUP/);
    const released = simulateButtonScenario(project, project.code, undefined, prompt);
    const pressed = simulateButtonScenario(project, project.code, button.id, prompt);
    assert.ok(hasObservableButtonEffect(project, released, pressed), "pressing the new button should visibly alter the circuit");
    assert.ok(pressed.some(frame => frame.tones.some(tone => tone.active)), "the held button should make the new buzzer sound in simulation");
    assert.ok(!released.some(frame => frame.tones.some(tone => tone.active)), "the released button should silence the new buzzer");
  });
});

test("LIVE Gemini edit changes only the existing circuit's sketch behavior", { skip: !canRunLive && skipReason }, async () => {
  const prompt = "Change only the existing LED sketch's blink interval from 1000 milliseconds to 500 milliseconds. Keep every component, wire, position, and property exactly unchanged.";
  await runLiveEdit(prompt, (project, original) => {
    assert.deepEqual(
      project.components.map(component => ({ ...component, rotation: component.rotation ?? 0 })),
      original.components.map(component => ({ ...component, rotation: component.rotation ?? 0 })),
    );
    assert.deepEqual(project.connections, original.connections);
    assert.match(project.code, /delay\(500\)/);
    assert.doesNotMatch(project.code, /delay\(1000\)/);
    assertSimulationHasNoErrors(project, 600);
  });
});

test("LIVE Gemini edit changes only the LED color", { skip: !canRunLive && skipReason }, async () => {
  await runLiveEdit("Edit only the existing red LED so its displayed color is exactly #22C55E green. Keep every component, wire, position, and the blink sketch unchanged.", (project, original) => {
    assertPreservedExceptComponents(project, original, ["led1"]);
    const color = project.components.find(component => component.id === "led1")?.properties?.color;
    assert.equal(typeof color, "string");
    assert.equal(String(color).toLowerCase(), "#22c55e");
    assert.deepEqual(project.connections, original.connections);
    assertSimulationHasNoErrors(project);
  });
});

test("LIVE Gemini edit changes only the series resistor value", { skip: !canRunLive && skipReason }, async () => {
  await runLiveEdit("Change only the existing LED's series resistor from 220 ohms to exactly 330 ohms. Keep its label, position, wiring, all other parts, and sketch unchanged.", (project, original) => {
    assertPreservedExceptComponents(project, original, ["r1"]);
    assert.equal(project.components.find(component => component.id === "r1")?.properties?.resistance, 330);
    assert.deepEqual(project.connections, original.connections);
    assertSimulationHasNoErrors(project);
  });
});

test("LIVE Gemini edit moves only the existing LED", { skip: !canRunLive && skipReason }, async () => {
  await runLiveEdit("Move only the existing red LED 80 canvas units to the right and 40 units down. Keep every wire, component property, and the sketch unchanged.", (project, original) => {
    assertPreservedExceptPosition(project, original, "led1");
    const led = project.components.find(component => component.id === "led1");
    assert.ok(led && led.x !== original.components.find(component => component.id === "led1")?.x && led.y !== original.components.find(component => component.id === "led1")?.y, "the requested LED position should change");
    assert.deepEqual(project.connections, original.connections);
    assertSimulationHasNoErrors(project);
  });
});

test("LIVE Gemini edit adds a second LED branch without replacing the first", { skip: !canRunLive && skipReason }, async () => {
  await runLiveEdit("Add one green LED with its own 220-ohm series resistor on Arduino Uno D12, and blink it in sync with the existing red LED. Preserve the existing branch exactly.", (project, original) => {
    assertPreservedLayoutAndWiring(project, original);
    const led = project.components.find(component => component.type === "led" && component.id !== "led1");
    const resistor = project.components.find(component => component.type === "resistor" && component.id !== "r1");
    assert.ok(led && resistor, "the second LED and its current-limiting resistor should be added");
    assert.ok(hasWire(project, ["uno", "D12"], [resistor.id, "1"]));
    assert.ok(hasWire(project, [resistor.id, "2"], [led.id, "A"]));
    assert.ok(hasGroundReturn(project, led.id, "K"));
    assertSimulationHasNoErrors(project);
  });
});

test("LIVE Gemini edit adds and simulates a servo", { skip: !canRunLive && skipReason }, async () => {
  await runLiveEdit("Add a hobby servo to the existing circuit. Connect servo SIG to Uno D9, VCC to 5V, and GND to GND. In the sketch attach it to D9 and move it to 45 degrees after startup; preserve the LED blink branch.", (project, original) => {
    assertPreservedLayoutAndWiring(project, original);
    const servo = project.components.find(component => component.type === "servo");
    assert.ok(servo, "Gemini should add a catalog servo");
    assert.ok(hasWire(project, [servo.id, "SIG"], ["uno", "D9"]));
    assert.ok(hasWire(project, [servo.id, "VCC"], ["uno", "5V"]));
    assert.ok(hasGroundReturn(project, servo.id, "GND"));
    const simulator = assertSimulationHasNoErrors(project);
    assert.ok(simulator.getSnapshot().servos.some(state => state.pin === 9 && state.attached), "the new servo should be attached in simulation");
  });
});

test("LIVE Gemini edit adds a toggle switch that controls the existing LED", { skip: !canRunLive && skipReason }, async () => {
  await runLiveEdit("Add a toggle switch to the existing circuit. Connect COM to Uno D2 and NC to GND; use INPUT_PULLUP. The LED must be off in the NC position and on in the NO position. Replace only the conflicting LED blink behavior and preserve the existing LED wiring.", (project, original) => {
    assertPreservedLayoutAndWiring(project, original);
    const toggle = project.components.find(component => component.type === "toggle-switch");
    assert.ok(toggle, "Gemini should add a catalog toggle switch");
    assert.ok(hasWire(project, [toggle.id, "COM"], ["uno", "D2"]));
    assert.ok(hasGroundReturn(project, toggle.id, "NC"));
    const offProject = structuredClone(project);
    const onProject = structuredClone(project);
    const offSwitch = offProject.components.find(component => component.id === toggle.id)!;
    const onSwitch = onProject.components.find(component => component.id === toggle.id)!;
    offSwitch.properties = { ...offSwitch.properties, position: false };
    onSwitch.properties = { ...onSwitch.properties, position: true };
    const off = assertSimulationHasNoErrors(offProject).getSnapshot().componentStates.led1?.powered;
    const on = assertSimulationHasNoErrors(onProject).getSnapshot().componentStates.led1?.powered;
    assert.equal(off, false, "NC/GND position should turn the LED off");
    assert.equal(on, true, "NO/open position should turn the LED on through INPUT_PULLUP");
  });
});

test("LIVE Gemini edit changes the blink pattern to two short flashes and a long pause", { skip: !canRunLive && skipReason }, async () => {
  await runLiveEdit("Change only the existing LED sketch pattern to exactly two 200 millisecond flashes followed by a 1000 millisecond pause, repeating forever. Preserve all components, wires, positions, and properties.", (project, original) => {
    assertPreservedLayoutAndWiring(project, original);
    assertPreservedLayoutAndWiring(project, original);
    assert.deepEqual(project.connections, original.connections);
    assert.match(project.code, /delay\s*\(\s*200\s*\)/);
    assert.match(project.code, /delay\s*\(\s*1000\s*\)/);
    assertSimulationHasNoErrors(project, 2_000);
  });
});
