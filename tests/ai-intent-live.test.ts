import assert from "node:assert/strict";
import test, { after } from "node:test";
import nextEnv from "@next/env";

import { POST, configureGenerationTestLimitsForTests } from "../app/api/ai/generate/route.ts";
import { configureAiUsageAdapterForTests, type AiUsageAdapter } from "../lib/billing/ai-usage.ts";
import { createDefaultBlinkProject } from "../lib/circuit/default-project.ts";
import { safeParseCircuitProject } from "../lib/circuit/index.ts";
import { ArduinoSimulator } from "../lib/simulator/index.ts";
import { greenhouseMonitorPrompt } from "./fixtures/greenhouse.ts";

const enabled = process.env.CIRKITRA_RUN_LIVE_AI_INTENT_TESTS === "true";
if (enabled) nextEnv.loadEnvConfig(process.cwd());
const canRunLive = enabled && !!process.env.GEMINI_API_KEY?.trim();
const skipReason = enabled ? "GEMINI_API_KEY is not configured" : "Set CIRKITRA_RUN_LIVE_AI_INTENT_TESTS=true to allow live Gemini intent calls";
const LIVE_PROVIDER_MIN_INTERVAL_MS = 5_000;
let lastLiveProviderRequestAt = 0;
let inMemoryReservation = 0;
const finalizations: Array<{ succeeded: boolean; inputTokens: number; outputTokens: number }> = [];

const inMemoryUsage: AiUsageAdapter = {
  authenticate: async () => "cirkitra-live-intent-test-user",
  reserve: async () => ({
    allowed: true,
    reservation: {
      reservationId: `intent-live-${++inMemoryReservation}`,
      usage: { planId: "free", planName: "Free", used: 0, limit: 5, remaining: 5, unlimited: false, resetsAt: null, billingEnabled: false },
    },
  }),
  finalize: async (_userId, _reservationId, succeeded, inputTokens, outputTokens) => {
    finalizations.push({ succeeded, inputTokens, outputTokens });
  },
  snapshot: async () => ({ planId: "free", planName: "Free", used: 0, limit: 5, remaining: 5, unlimited: false, resetsAt: null, billingEnabled: false }),
};

if (canRunLive) configureAiUsageAdapterForTests(inMemoryUsage);
after(() => {
  configureAiUsageAdapterForTests(undefined);
  configureGenerationTestLimitsForTests(undefined);
});

type Intent = "create" | "edit" | "clarify";
type Scenario = { name: string; prompt: string; expected: Intent };

const liveIntentScenarios: Scenario[] = [
  {
    name: "complete traffic intersection remains a fresh build despite detailed add and wire steps",
    prompt: "Build a complete two-road traffic intersection with an Arduino Uno. Add six red, yellow, and green LEDs, pedestrian button, walk LED, and buzzer. Wire each output and use a non-blocking millis state machine so both roads are never green together.",
    expected: "create",
  },
  {
    name: "greenhouse monitor is recognized as a complete fresh system",
    prompt: greenhouseMonitorPrompt,
    expected: "create",
  },
  {
    name: "ultrasonic parking alert is recognized as a complete fresh system",
    prompt: "Build a complete Arduino Uno parking alert with an HC-SR04, three LED distance indicators with separate 220-ohm resistors, and a buzzer. Add and wire the parts, then make closer distances light more LEDs and sound faster beeps.",
    expected: "create",
  },
  {
    name: "explicit from-scratch LED controller is a fresh build",
    prompt: "Create a brand-new Arduino Uno circuit from scratch with a button and two LEDs, then wire and program the complete controller.",
    expected: "create",
  },
  {
    name: "adding a buzzer targets the open circuit",
    prompt: "Add a buzzer to the open circuit and make it beep once per second without changing the existing LED behavior.",
    expected: "edit",
  },
  {
    name: "adding a blinking LED targets the open circuit",
    prompt: "Add a green LED branch to this circuit and make it blink in sync with the existing LED.",
    expected: "edit",
  },
  {
    name: "building on the current design remains an edit",
    prompt: "Build on the current circuit by adding a second LED branch with its own resistor; keep the first branch unchanged.",
    expected: "edit",
  },
  {
    name: "code-only blink timing request remains an edit",
    prompt: "Change only the existing LED blink interval from 500 milliseconds to 300 milliseconds. Keep the components and wiring exactly as they are.",
    expected: "edit",
  },
  {
    name: "removing a part targets the open circuit",
    prompt: "Remove the resistor from the current circuit and leave every other component and the Arduino behavior unchanged.",
    expected: "edit",
  },
  {
    name: "explicit uncertainty between modifying and starting fresh asks for clarification",
    prompt: "I want a circuit with a buzzer, but I am undecided whether to add it to this open circuit or make a separate new circuit.",
    expected: "clarify",
  },
];

async function withLiveProviderBudget<T>(maxCalls: number, run: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async (input, init) => {
    providerCalls += 1;
    if (providerCalls > maxCalls) throw new Error(`Live Gemini scenario exceeded its ${maxCalls}-call provider budget.`);
    const waitMs = Math.max(0, LIVE_PROVIDER_MIN_INTERVAL_MS - (Date.now() - lastLiveProviderRequestAt));
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
    lastLiveProviderRequestAt = Date.now();
    return originalFetch(input, init);
  };
  try {
    const value = await run();
    return value;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function freshInMemoryClone() {
  const project = createDefaultBlinkProject();
  project.id = "3290a16e-f370-4e5e-9c09-1a6fe3c8b0ab";
  return project;
}

function request(prompt: string, currentProject: ReturnType<typeof freshInMemoryClone>, extra: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/ai/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, currentProject, model: "gemini-3.5-flash-lite", ...extra }),
  });
}

for (const scenario of liveIntentScenarios) {
  test(`LIVE Gemini intent: ${scenario.name}`, { skip: canRunLive ? false : skipReason }, async () => {
    configureGenerationTestLimitsForTests({ maxRepairs: 0, maxTransientRetries: 0, maxTruncatedRetries: 0, allowSchemaFallback: false, classificationOnly: true });
    const project = freshInMemoryClone();
    const snapshot = structuredClone(project);
    const response = await withLiveProviderBudget(1, () => POST(request(scenario.prompt, structuredClone(project))));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.deepEqual(body, { kind: "intent-test-result", intent: scenario.expected, model: "gemini-3.5-flash-lite" });
    assert.deepEqual(project, snapshot, "live classification uses only an in-memory clone and does not mutate it");
    assert.equal(finalizations.at(-1)?.succeeded, false, "a classification-only test releases its in-memory reservation");
    assert.ok((finalizations.at(-1)?.inputTokens ?? 0) > 0, "Gemini classifier usage should be recorded");
    console.info(`[live-ai-intent-test] ${scenario.expected}: ${scenario.name}`);
  });
}

async function runLiveGeneratedScenario(prompt: string, expectedMode: "create" | "edit", verify: (project: ReturnType<typeof freshInMemoryClone>, original: ReturnType<typeof freshInMemoryClone>) => void) {
  configureGenerationTestLimitsForTests({ maxRepairs: 1, maxTransientRetries: 0, maxTruncatedRetries: 0, allowSchemaFallback: false });
  const original = freshInMemoryClone();
  const snapshot = structuredClone(original);
  const response = await withLiveProviderBudget(3, () => POST(request(prompt, structuredClone(original))));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body.error ?? body));
  assert.equal(body.generationMode, expectedMode);
  assert.equal(body.project?.id, original.id, "classified fresh build or edit retains the open project's storage key");
  const parsed = safeParseCircuitProject(body.project);
  assert.deepEqual(original, snapshot, "generation must not mutate the supplied in-memory source project");
  if (!parsed.success) throw new Error(`Generated project failed schema validation: ${parsed.issues.map(issue => issue.message).join("; ")}`);
  verify(parsed.data as ReturnType<typeof freshInMemoryClone>, original);
  const simulator = new ArduinoSimulator(parsed.data.code);
  simulator.attachProject(parsed.data);
  simulator.run();
  simulator.advance(0);
  assert.deepEqual(simulator.getSnapshot().diagnostics.filter(item => item.severity === "error"), [], "generated result should pass simulator validation");
}

test("LIVE Gemini classify-create-generate flow validates the fresh circuit", { skip: canRunLive ? false : skipReason }, async () => {
  await runLiveGeneratedScenario(
    "Create a fresh Arduino Uno circuit from scratch with one green LED, a 220-ohm series resistor, and a 500 millisecond blink.",
    "create",
    project => {
      assert.ok(project.components.some(component => component.type === "led"));
      assert.ok(project.components.some(component => component.type === "resistor"));
    },
  );
});

test("LIVE Gemini classify-edit-generate flow preserves unrelated circuit details", { skip: canRunLive ? false : skipReason }, async () => {
  await runLiveGeneratedScenario(
    "Add a buzzer to the existing circuit and make it beep once per second. Preserve the existing LED, resistor, wiring, and blink behavior.",
    "edit",
    (project, original) => {
      for (const component of original.components) {
        const actual = project.components.find(item => item.id === component.id);
        assert.deepEqual(actual && { ...actual, rotation: actual.rotation ?? 0 }, { ...component, rotation: component.rotation ?? 0 }, `preserve ${component.id}`);
      }
      for (const connection of original.connections) assert.ok(project.connections.some(item => item.id === connection.id), `preserve ${connection.id}`);
      assert.ok(project.components.some(component => component.type === "buzzer"));
    },
  );
});

test("LIVE Gemini clarification can be resubmitted with the chosen mode and fully validated", { skip: canRunLive ? false : skipReason }, async () => {
  configureGenerationTestLimitsForTests({ maxRepairs: 1, maxTransientRetries: 1, maxTruncatedRetries: 0, allowSchemaFallback: false });
  const prompt = "I want a circuit with a buzzer that beeps once per second, but I am undecided whether to add it to this open circuit or make a separate new circuit.";
  const project = freshInMemoryClone();
  const snapshot = structuredClone(project);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    const classifierInput = JSON.parse(body.contents[0].parts[0].text);
    assert.ok("currentCircuitSummary" in classifierInput, "the open project still goes through the real classifier endpoint");
    return Response.json({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ intent: "clarify" }) }] } }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 3 },
    });
  };
  let clarification: Response;
  try {
    clarification = await POST(request(prompt, structuredClone(project)));
  } finally {
    globalThis.fetch = originalFetch;
  }
  const clarificationBody = await clarification.json();
  assert.equal(clarification.status, 200, JSON.stringify(clarificationBody));
  assert.equal(clarificationBody.kind, "mode-clarification", JSON.stringify(clarificationBody));

  const chosenMode = "edit" as const;
  const generation = await withLiveProviderBudget(2, () => POST(request(prompt, structuredClone(project), { generationModeOverride: chosenMode })));
  const body = await generation.json();
  assert.equal(generation.status, 200, JSON.stringify(body.error ?? body));
  assert.equal(body.generationMode, chosenMode);
  assert.equal(body.project?.id, project.id);
  const parsed = safeParseCircuitProject(body.project);
  assert.deepEqual(project, snapshot);
  if (!parsed.success) throw new Error(`Chosen-mode result failed schema validation: ${parsed.issues.map(issue => issue.message).join("; ")}`);
  for (const component of snapshot.components) {
    const actual: ReturnType<typeof freshInMemoryClone>["components"][number] | undefined = parsed.data.components.find(item => item.id === component.id);
    assert.deepEqual(actual && { ...actual, rotation: actual.rotation ?? 0 }, { ...component, rotation: component.rotation ?? 0 }, `preserve ${component.id}`);
  }
  for (const connection of snapshot.connections) assert.deepEqual(parsed.data.connections.find(item => item.id === connection.id), connection, `preserve ${connection.id}`);
  assert.ok(parsed.data.components.some(component => component.type === "buzzer"));
  const simulator = new ArduinoSimulator(parsed.data.code);
  simulator.attachProject(parsed.data);
  simulator.run();
  simulator.advance(0);
  assert.deepEqual(simulator.getSnapshot().diagnostics.filter(item => item.severity === "error"), []);
  assert.equal(finalizations.at(-2)?.succeeded, false, "clarification releases its reservation");
  assert.equal(finalizations.at(-1)?.succeeded, true, "the selected, validated edit consumes one request");
});
