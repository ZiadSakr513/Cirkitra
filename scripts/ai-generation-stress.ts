import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import type { AiUsageAdapter } from "../lib/billing/ai-usage.ts";
import { configureAiUsageAdapterForTests } from "../lib/billing/ai-usage.ts";
import { isBoardType } from "../lib/circuit/boards.ts";
import { configureGenerationTestLimitsForTests, POST } from "../app/api/ai/generate/route.ts";
import { REMAINING_COMPONENT_CASES, REMAINING_COMPONENT_SUITE_ID } from "./ai-generation-remaining-cases.ts";

type TestCase = {
  id: string;
  group: "single-board" | "multi-board" | "edit" | "component-coverage";
  prompt: string;
  baseCaseId?: string;
  minimumBoards: number;
  expectedComponentTypes?: readonly string[];
};

type ProviderCall = {
  stage: "classification" | "generation" | "repair" | "truncation";
  status: number;
  inputTokens: number;
  outputTokens: number;
  candidate?: {
    componentCount: number;
    wireCount: number;
    componentTypes: string[];
    boardTypes: string[];
  };
};

type CaseResult = {
  id: string;
  group: TestCase["group"];
  prompt: string;
  expectedComponentTypes?: string[];
  observedComponentTypes?: string[];
  status: "passed" | "failed" | "blocked";
  validationOutcome: "simulator-valid" | "invalid" | "blocked";
  failureStage?: "intent" | "component coverage" | "wiring/code" | "simulation" | "repair" | "provider" | "UI feedback";
  category: string;
  message?: string;
  details?: string[];
  httpStatus?: number;
  generationMode?: string;
  componentCount?: number;
  wireCount?: number;
  boardTypes?: string[];
  repairCount: number;
  providerCalls: ProviderCall[];
  inputProject?: unknown;
  project?: unknown;
};

type StressReport = {
  version: 2;
  suite: string;
  startedAt: string;
  updatedAt: string;
  live: true;
  results: CaseResult[];
};

const reliabilityCases: TestCase[] = [
  { id: "single-01", group: "single-board", minimumBoards: 1, prompt: "Build an Arduino Uno pedestrian traffic signal with red, yellow, and green LEDs plus a pedestrian request button. Use a debounced press to finish the current green phase safely, then show a timed walk phase before returning to vehicle green. Include resistors for every LED and make the states visible in the sketch." },
  { id: "single-02", group: "single-board", minimumBoards: 1, prompt: "Build an Arduino Uno parking-distance assistant with an HC-SR04, 16x2 LCD, piezo buzzer, and red/yellow/green LEDs. Show centimeters on the LCD, use three distance zones with hysteresis, and make the beep rate increase smoothly as an obstacle gets closer. Keep the loop responsive." },
  { id: "single-03", group: "single-board", minimumBoards: 1, prompt: "Create a DHT22 climate monitor on an Arduino Uno with an SSD1306 OLED and buzzer. Display temperature and humidity, latch a high-temperature alarm at 30 C, clear it only below 27 C, and report sensor-read failure safely without leaving the alarm output latched." },
  { id: "single-04", group: "single-board", minimumBoards: 1, prompt: "Build an Arduino Uno soil-moisture status station using the capacitive soil sensor, three LEDs, buzzer, and a push button. Map the live analog reading to dry, watch, and healthy zones with hysteresis; the button should silence the buzzer until the sensor returns to the healthy zone." },
  { id: "single-05", group: "single-board", minimumBoards: 1, prompt: "Build an ESP32 LED-pattern controller with a KY-040 rotary encoder, its push switch, and an 8-pixel WS2812B strip. Rotation selects among three patterns, the switch changes speed, and brightness is smoothly adjusted from the live encoder setting. Include the required series resistor and 3.3-to-5 V data buffer." },
  { id: "single-06", group: "single-board", minimumBoards: 1, prompt: "Create an Arduino Uno automatic parking barrier with HC-SR04, servo, buzzer, red/green LEDs, and a manual request button. Open when a vehicle is detected, keep it open while the sensor sees the vehicle, close only after the area is clear, and make the button request an observable safe cycle." },
  { id: "single-07", group: "single-board", minimumBoards: 1, prompt: "Build a PIR security alarm on an Arduino Uno with a toggle arm switch, piezo buzzer, relay module, and status LED. Give the PIR a short startup warm-up, latch motion alarms while armed, and let the arm switch disarm the outputs immediately without blocking the loop." },
  { id: "single-08", group: "single-board", minimumBoards: 1, prompt: "Create an Arduino Uno keypad door-lock simulation using a 4x4 keypad, 16x2 LCD, servo, and buzzer. Accept code 2580, show masked entry and clear status messages, lock after three wrong attempts for ten seconds, and return the servo to its locked angle after a brief unlock interval." },
  { id: "single-09", group: "single-board", minimumBoards: 1, prompt: "Build an Arduino Uno tilt alarm using MPU-6050 and SSD1306 OLED with a buzzer and red/green LEDs. Calibrate the baseline at startup, display signed roll and pitch, latch an alarm beyond 25 degrees, and clear it only after both angles return inside 15 degrees." },
  { id: "single-10", group: "single-board", minimumBoards: 1, prompt: "Create an ESP32 ambient-light controller with a BH1750 and an 8-pixel WS2812B strip. Read lux over I2C, show bright/dim state through distinct strip colors, apply separate enter/exit thresholds to prevent flicker, and include the required data resistor and level shifter." },
  { id: "single-11", group: "single-board", minimumBoards: 1, prompt: "Build an Arduino Uno temperature-controlled fan with a DS18B20, L293D, DC motor, and status LED. Start the fan above 32 C and stop below 28 C using a latched hysteresis state; connect all driver power, enable, and ground pins correctly, and stop the motor immediately if the temperature read is invalid." },
  { id: "single-12", group: "single-board", minimumBoards: 1, prompt: "Create an Arduino Uno scheduled alarm clock using a DS3231 RTC, 16x2 LCD, push button, and buzzer. Display time and alarm state, use the button to toggle the alarm once per press, sound at 07:30, and silence it after acknowledgment while keeping time display responsive." },
  { id: "multi-01", group: "multi-board", minimumBoards: 2, prompt: "Create a two-board Arduino Mega 2560 and ESP32 monitoring system. The Mega reads a BME280 and sends compact temperature/humidity samples over a physical UART link; the ESP32 displays them on an SSD1306 OLED and sounds a buzzer above a configurable temperature threshold. Include exact TX/RX crossover and common ground, with a complete sketch for each board." },
  { id: "multi-02", group: "multi-board", minimumBoards: 2, prompt: "Build a two-board Arduino Uno and Mega 2560 pedestrian crossing controller. The Uno reads a request button and sends a one-byte event over UART; the Mega owns the red/yellow/green traffic LEDs and runs a non-blocking safe crossing sequence. Wire the serial pins correctly, share ground, and provide separate complete sketches." },
  { id: "multi-03", group: "multi-board", minimumBoards: 2, prompt: "Create a Raspberry Pi Pico and ESP32 environmental display. The Pico reads a BH1750 over I2C and transmits lux readings over UART; the ESP32 drives an 8-pixel WS2812B strip with three brightness/color zones and hysteresis. Include exact bus/UART wiring, common ground, required strip resistor and data buffer, and one complete sketch per board." },
  { id: "multi-04", group: "multi-board", minimumBoards: 2, prompt: "Build an Arduino Mega 2560 and Raspberry Pi Pico access-control demo. The Mega scans a 4x4 keypad and sends an unlock event over UART after code 2580; the Pico drives a servo and buzzer for a timed unlock, then relocks. Add exact crossed UART wiring and common ground, and provide separate complete programs." },
  { id: "edit-01", group: "edit", baseCaseId: "single-02", minimumBoards: 1, prompt: "Edit the current parking assistant without replacing it. Preserve every existing component, wire, distance zone, and display behavior. Add a push button that latches buzzer mute on one press; keep the LCD and distance LEDs active, and clear mute only after the obstacle is safely outside the far zone." },
  { id: "edit-02", group: "edit", baseCaseId: "single-03", minimumBoards: 1, prompt: "Edit the current climate monitor without replacing it. Preserve all existing parts, wiring, display readings, and alarm behavior. Add a KY-040 encoder so rotation adjusts the high-temperature alarm setpoint, show the selected threshold on the OLED, and retain the current setpoint after the encoder is released." },
  { id: "edit-03", group: "edit", baseCaseId: "single-06", minimumBoards: 1, prompt: "Edit the current parking barrier without replacing it. Preserve all existing parts, connections, and automatic vehicle behavior. Add a toggle switch for persistent maintenance mode that holds the barrier open while active and resumes safe sensor-controlled operation when switched off." },
  { id: "edit-04", group: "edit", baseCaseId: "single-11", minimumBoards: 1, prompt: "Edit the current temperature-controlled fan without replacing it. Preserve the DS18B20, motor driver, fan, existing wires, and hysteresis behavior. Add a push button that toggles a persistent service override; show override state with an LED and keep the invalid-sensor fail-safe able to stop the motor." },
];

const require = createRequire(import.meta.url);
const nextEnv = require("@next/env") as { loadEnvConfig: (directory: string) => unknown };
const cli = new Set(process.argv.slice(2));
const rerunFailures = cli.has("--rerun-failures");
const suiteArgumentIndex = process.argv.indexOf("--suite");
const suiteId = suiteArgumentIndex >= 0 ? process.argv[suiteArgumentIndex + 1] : "reliability-20-v1";
const caseArgumentIndex = process.argv.indexOf("--case-id");
const caseId = caseArgumentIndex >= 0 ? process.argv[caseArgumentIndex + 1] : undefined;
const cases = suiteId === REMAINING_COMPONENT_SUITE_ID
  ? [...REMAINING_COMPONENT_CASES]
  : suiteId === "reliability-20-v1" ? reliabilityCases : [];
const reportPath = resolve(process.env.CIRKITRA_STRESS_REPORT ?? join(
  tmpdir(),
  suiteId === REMAINING_COMPONENT_SUITE_ID ? "cirkitra-ai-generation-remaining-components-v1.json" : "cirkitra-ai-generation-stress.json",
));

if (!cases.length) {
  console.error(`Unknown generation suite ${JSON.stringify(suiteId)}. Use reliability-20-v1 or ${REMAINING_COMPONENT_SUITE_ID}.`);
  process.exitCode = 1;
} else if (caseId && (!rerunFailures || !cases.some(testCase => testCase.id === caseId))) {
  console.error("--case-id requires --rerun-failures and a case ID from the selected suite.");
  process.exitCode = 1;
} else if (!cli.has("--live")) {
  console.error("Refusing to contact Gemini. Pass --live to run the explicitly billable live test suite.");
  process.exitCode = 1;
} else {
  nextEnv.loadEnvConfig(process.cwd());
  if (!process.env.GEMINI_API_KEY?.trim()) {
    console.error("GEMINI_API_KEY is not configured in the current environment or .env.local.");
    process.exitCode = 1;
  } else {
    try {
      await runSuite();
    } catch (error) {
      console.error("Generation suite runner failed:", error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = 1;
    }
  }
}

async function runSuite() {
  let report: StressReport;
  if (rerunFailures) {
    try {
      report = JSON.parse(await readFile(reportPath, "utf8")) as StressReport;
    } catch {
      console.error(`Cannot rerun failures: no readable report at ${reportPath}`);
      process.exitCode = 1;
      return;
    }
    const loadedReport = report as Omit<StressReport, "version"> & { version: number; suite?: string };
    const legacyReliabilityReport = suiteId === "reliability-20-v1" && loadedReport.version === 1 && !loadedReport.suite;
    if ((loadedReport.version !== 2 && !legacyReliabilityReport)
      || (loadedReport.suite !== undefined && loadedReport.suite !== suiteId)
      || report.results.length !== cases.length) {
      console.error(`The existing report does not match suite ${suiteId}.`);
      process.exitCode = 1;
      return;
    }
    loadedReport.version = 2;
    loadedReport.suite = suiteId;
    for (const result of report.results) {
      result.validationOutcome ??= result.status === "passed" ? "simulator-valid" : result.status === "blocked" ? "blocked" : "invalid";
      if (result.status !== "passed") result.failureStage ??= failureStageFor(result.category);
    }
  } else {
    report = { version: 2, suite: suiteId, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), live: true, results: [] };
  }

  let reservationId = 0;
  const finalizations: Array<{ reservationId: string; inputTokens: number; outputTokens: number }> = [];
  const usageSnapshot = {
    planId: "free" as const,
    planName: "Local stress test",
    used: 0,
    limit: 0,
    remaining: 0,
    unlimited: true,
    resetsAt: null,
    billingEnabled: false,
  };
  const usageAdapter: AiUsageAdapter = {
    authenticate: async () => "local-ai-generation-stress-test",
    reserve: async () => ({
      allowed: true,
      reservation: { reservationId: `local-stress-${++reservationId}`, usage: usageSnapshot },
    }),
    finalize: async (_userId, id, _succeeded, inputTokens, outputTokens) => {
      finalizations.push({ reservationId: id, inputTokens, outputTokens });
    },
    snapshot: async () => usageSnapshot,
  };

  configureAiUsageAdapterForTests(usageAdapter);
  configureGenerationTestLimitsForTests({ maxRepairs: 1, maxTransientRetries: 0, maxTruncatedRetries: 0 });
  const originalFetch = globalThis.fetch;
  let currentCalls: ProviderCall[] = [];
  globalThis.fetch = async (input, init) => {
    const payload = JSON.parse(String(init?.body ?? "{}")) as { contents?: Array<{ parts?: Array<{ text?: string }> }> };
    const text = payload.contents?.[0]?.parts?.map(part => part.text ?? "").join("\n") ?? "";
    let stage: ProviderCall["stage"] = "generation";
    if (text.includes("currentCircuitSummary")) stage = "classification";
    else if (/\bvalidationIssues\b/.test(text)) stage = "repair";
    else if (/\bcompactRetry\b/.test(text)) stage = "truncation";
    try {
      const response = await originalFetch(input, init);
      const body = await response.clone().json().catch(() => ({})) as unknown;
      const usage = isRecord(body) && isRecord(body.usageMetadata) ? body.usageMetadata : {};
      const candidate = summarizeProviderCandidate(body);
      currentCalls.push({
        stage,
        status: response.status,
        inputTokens: typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : 0,
        outputTokens: typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : 0,
        ...(candidate ? { candidate } : {}),
      });
      return response;
    } catch {
      currentCalls.push({ stage, status: 0, inputTokens: 0, outputTokens: 0 });
      throw new Error("Gemini provider request failed before a response was received.");
    }
  };

  try {
    const lastById = new Map(report.results.map(result => [result.id, result]));
    const selectedCases = caseId ? cases.filter(testCase => testCase.id === caseId) : cases;
    const pending = rerunFailures
      ? selectedCases.filter(testCase => lastById.get(testCase.id)?.status !== "passed")
      : selectedCases;
    if (!pending.length) {
      console.log("All 20 cases already passed; nothing to rerun.");
      return;
    }
    console.log(`${rerunFailures ? "Rerunning failed" : "Running"} ${pending.length} live prompt cases for ${suiteId}. Report: ${reportPath}`);
    for (const [index, testCase] of pending.entries()) {
      currentCalls = [];
      const previous = lastById.get(testCase.id);
      const baseCaseId = "baseCaseId" in testCase ? testCase.baseCaseId : undefined;
      const base = baseCaseId ? lastById.get(baseCaseId)?.project : undefined;
      const inputProject = testCase.group === "edit" ? (base ?? previous?.inputProject) : undefined;
      if (testCase.group === "edit" && !inputProject) {
        const blocked: CaseResult = {
          id: testCase.id,
          group: testCase.group,
          prompt: testCase.prompt,
          status: "blocked",
          validationOutcome: "blocked",
          failureStage: "component coverage",
          category: "missing-edit-base",
          message: `No validated generated project is available from ${baseCaseId}.`,
          repairCount: 0,
          providerCalls: [],
        };
        lastById.set(testCase.id, blocked);
        console.log(`${String(index + 1).padStart(2, "0")}/${pending.length} ${testCase.id}: BLOCKED (base project unavailable)`);
        await persistReport(report, lastById);
        continue;
      }

      console.log(`${String(index + 1).padStart(2, "0")}/${pending.length} ${testCase.id}: ${testCase.prompt}`);
      const reservationBefore = reservationId;
      let response: Response;
      try {
        response = await POST(new Request("http://localhost/api/ai/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: testCase.prompt, ...(inputProject ? { currentProject: inputProject } : {}) }),
          signal: AbortSignal.timeout(210_000),
        }));
      } catch (error) {
        const failed: CaseResult = {
          id: testCase.id,
          group: testCase.group,
          prompt: testCase.prompt,
          ...(testCase.expectedComponentTypes ? { expectedComponentTypes: [...testCase.expectedComponentTypes], observedComponentTypes: [] } : {}),
          status: "blocked",
          validationOutcome: "blocked",
          failureStage: "provider",
          category: "provider-or-timeout",
          message: error instanceof Error ? error.message : "Generation request failed.",
          repairCount: currentCalls.filter(call => call.stage === "repair").length,
          providerCalls: [...currentCalls],
          ...(inputProject ? { inputProject } : {}),
        };
        lastById.set(testCase.id, failed);
        console.log(`${String(index + 1).padStart(2, "0")}/${pending.length} ${testCase.id}: FAIL (${failed.category})`);
        await persistReport(report, lastById);
        continue;
      }

      const body = await response.json().catch(() => ({})) as {
        kind?: string;
        message?: string;
        generationMode?: string;
        project?: { id?: string; components?: Array<{ id?: string; type?: string }>; connections?: unknown[] };
        error?: { code?: string; message?: string; details?: string[] };
      };
      const project = body.project;
      const boardTypes = project?.components?.flatMap(component => typeof component.type === "string" && isBoardType(component.type) ? [component.type] : []) ?? [];
      const observedComponentTypes = [...new Set(project?.components?.flatMap(component => typeof component.type === "string" ? [component.type] : []) ?? [])].sort();
      const expectedComponentTypes = testCase.expectedComponentTypes ? [...testCase.expectedComponentTypes] : undefined;
      const missingPreserved = inputProject && testCase.prompt.toLowerCase().includes("preserve")
        ? (inputProject as { components?: Array<{ id?: string }>; connections?: Array<{ id?: string }> }).components?.some(component => !project?.components?.some(next => next.id === component.id))
          || (inputProject as { connections?: Array<{ id?: string }> }).connections?.some(connection => !project?.connections?.some(next => (next as { id?: string }).id === connection.id))
        : false;
      let category = body.kind === "mode-clarification" ? "intent-classification" : response.ok ? "passed" : classifyFailure(body.error?.code, body.error?.details ?? []);
      let message = body.error?.message;
      let status: CaseResult["status"] = response.ok && body.kind !== "mode-clarification" ? "passed" : category === "provider-or-timeout" ? "blocked" : "failed";
      const routeReturnedValidatedProject = response.ok && body.kind !== "mode-clarification" && !!project;
      if (response.ok && body.kind === "mode-clarification") message = body.message ?? "The request unexpectedly required intent clarification.";
      if (response.ok && !project) {
        status = "failed";
        category = "response-contract";
        message = "The route returned success without a project.";
      }
      if (response.ok && project && boardTypes.length < testCase.minimumBoards) {
        status = "failed";
        category = "board-coverage";
        message = `Expected at least ${testCase.minimumBoards} board(s), received ${boardTypes.length}.`;
      }
      const missingTargetTypes = expectedComponentTypes?.filter(type => !observedComponentTypes.includes(type)) ?? [];
      if (response.ok && project && missingTargetTypes.length) {
        status = "failed";
        category = "missing-target-components";
        message = `The generated circuit omitted required component type(s): ${missingTargetTypes.join(", ")}.`;
      }
      if (testCase.group === "edit" && body.generationMode !== "edit") {
        status = "failed";
        category = "edit-intent";
        message = `Expected an edit, received ${body.generationMode ?? "no generation mode"}.`;
      }
      if (missingPreserved) {
        status = "failed";
        category = "edit-preservation";
        message = "The edit removed an existing component or wire despite the preservation instruction.";
      }
      const result: CaseResult = {
        id: testCase.id,
        group: testCase.group,
        prompt: testCase.prompt,
        ...(expectedComponentTypes ? { expectedComponentTypes } : {}),
        observedComponentTypes,
        status,
        validationOutcome: routeReturnedValidatedProject ? "simulator-valid" : status === "blocked" ? "blocked" : "invalid",
        ...(status !== "passed" ? { failureStage: failureStageFor(category) } : {}),
        category,
        ...(message ? { message } : {}),
        ...(body.error?.details?.length ? { details: body.error.details.slice(0, 12) } : {}),
        httpStatus: response.status,
        ...(body.generationMode ? { generationMode: body.generationMode } : {}),
        ...(project ? { componentCount: project.components?.length ?? 0, wireCount: project.connections?.length ?? 0, boardTypes, project } : {}),
        repairCount: currentCalls.filter(call => call.stage === "repair").length,
        providerCalls: [...currentCalls],
        ...(inputProject ? { inputProject } : {}),
      };
      lastById.set(testCase.id, result);
      const finalized = finalizations.slice().reverse().find(item => item.reservationId === `local-stress-${reservationBefore + 1}`);
      const totalTokens = finalized ? finalized.inputTokens + finalized.outputTokens : 0;
      console.log(`${String(index + 1).padStart(2, "0")}/${pending.length} ${testCase.id}: ${status.toUpperCase()} mode=${body.generationMode ?? body.kind ?? "?"} parts=${result.componentCount ?? 0} wires=${result.wireCount ?? 0} boards=${boardTypes.length} repairs=${result.repairCount} providerCalls=${currentCalls.length} tokens=${totalTokens}${message ? ` reason=${message}` : ""}`);
      await persistReport(report, lastById);
    }

    const finalResults = cases.map(testCase => lastById.get(testCase.id)).filter((result): result is CaseResult => !!result);
    const summary = Object.groupBy(finalResults, result => `${result.status}:${result.category}`);
    console.log("\nSummary:", JSON.stringify(Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, value?.length ?? 0]))));
    const coveredTypes = new Set(finalResults.filter(result => result.status === "passed").flatMap(result => result.observedComponentTypes ?? []));
    const expectedTypes = new Set(cases.flatMap(testCase => testCase.expectedComponentTypes ?? []));
    const missingCoverage = [...expectedTypes].filter(type => !coveredTypes.has(type)).sort();
    console.log(`Passed ${finalResults.filter(result => result.status === "passed").length}/${cases.length}. Component coverage ${coveredTypes.size}/${expectedTypes.size}${missingCoverage.length ? `; missing ${missingCoverage.join(", ")}` : ""}. Report saved locally: ${reportPath}`);
  } finally {
    globalThis.fetch = originalFetch;
    configureGenerationTestLimitsForTests(undefined);
    configureAiUsageAdapterForTests(undefined);
  }
}

async function persistReport(report: StressReport, results: Map<string, CaseResult>) {
  report.updatedAt = new Date().toISOString();
  report.results = cases.flatMap(testCase => {
    const result = results.get(testCase.id);
    return result ? [result] : [];
  });
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
}

function classifyFailure(code = "", details: string[]) {
  const text = `${code} ${details.join(" ")}`.toLowerCase();
  if (/provider|timeout|deadline|gemini.*(?:reach|connect)|(?:reach|connect).*gemini|\brate.?limit\b|\b429\b|\b503\b|ai_(?:unavailable|provider|network|daily_quota|rate_limited)|ai_response_truncated|max_tokens|output limit/.test(text)) return "provider-or-timeout";
  if (/intent|clarif/.test(text)) return "intent-classification";
  if (/component_unavailable|unsupported_type|component coverage|requires \d+/.test(text)) return "component-coverage";
  if (/boardid|board in the current circuit|controller board|multi-board/.test(text)) return "board-mapping";
  if (/pin|wire|connection|net|ground|short|supply|voltage|electrical|logic.level|rfid_logic_level/.test(text)) return "wiring-electrical";
  if (/syntax|sketch|program|unsupported_call|unsupported statement|unsupported expression/.test(text)) return "code-validation";
  if (/simulat|behavior|observable|threshold|state/.test(text)) return "simulation-behavior";
  if (/repair|no_change|exhausted/.test(text)) return "repair";
  return code ? `other:${code}` : "unknown";
}

function failureStageFor(category: string): NonNullable<CaseResult["failureStage"]> {
  if (/intent/.test(category)) return "intent";
  if (/component-coverage|board-coverage|board-mapping|missing-target-components/.test(category)) return "component coverage";
  if (/wiring|code-validation/.test(category)) return "wiring/code";
  if (/simulation/.test(category)) return "simulation";
  if (/repair|edit-preservation/.test(category)) return "repair";
  if (/provider|timeout/.test(category)) return "provider";
  return "UI feedback";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keep only sanitized counts and type names from provider output; never write raw Gemini text to the report. */
function summarizeProviderCandidate(body: unknown): ProviderCall["candidate"] {
  if (!isRecord(body) || !Array.isArray(body.candidates)) return undefined;
  const candidate = body.candidates.find(isRecord);
  if (!candidate || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) return undefined;
  const text = candidate.content.parts.flatMap(part => isRecord(part) && typeof part.text === "string" ? [part.text] : []).join("\n");
  const jsonText = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  let parsed: unknown;
  try { parsed = JSON.parse(jsonText); } catch { return undefined; }
  if (!isRecord(parsed) || !isRecord(parsed.project)) return undefined;
  const project = parsed.project;
  const components = Array.isArray(project.components) ? project.components.filter(isRecord) : [];
  const wires = Array.isArray(project.connections) ? project.connections : [];
  const componentTypes = [...new Set(components.flatMap(component => typeof component.type === "string" ? [component.type] : []))].sort();
  const boardTypes = [...new Set(componentTypes.filter(isBoardType))].sort();
  return { componentCount: components.length, wireCount: wires.length, componentTypes, boardTypes };
}
