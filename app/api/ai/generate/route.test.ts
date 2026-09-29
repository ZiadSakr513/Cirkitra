import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultBlinkProject } from "../../../../lib/circuit/default-project.ts";
import { maxDuration, POST } from "./route.ts";
import { COMPONENT_EXAMPLES } from "../../../../lib/circuit/component-examples.ts";
import { greenhouseExample, greenhousePrompt } from "../../../../tests/fixtures/greenhouse.ts";
import { ArduinoSimulator } from "../../../../lib/simulator/index.ts";
import { MultiBoardSimulator } from "../../../../lib/simulator/index.ts";

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
        const schema = request.generationConfig.responseSchema.properties.project.properties;
        assert.equal(schema.components.items.properties.properties.properties.voltage.type, "number");
        assert.equal(schema.components.items.properties.properties.properties.enabled.type, "boolean");
        assert.ok(schema.connections.items.properties.from.properties.pin.enum.includes("+"));
        assert.ok(schema.connections.items.properties.to.properties.pin.enum.includes("-"));
      }
      if (content.validationIssues) feedback = JSON.stringify(content.validationIssues);
      return modelResponse(JSON.stringify({ project, explanation: "Runnable circuit", assumptions: [], warnings: [] }));
    };
    const response = await POST(new Request("http://localhost/api/ai/generate", {
      method: "POST", body: JSON.stringify({ prompt: id === "greenhouse" ? greenhousePrompt : `Create a circuit using ${[...new Set(project.components.map(c => c.type))].join(", ")}` }),
    }));
    assert.equal(response.status, 200, `${id}: ${feedback}`);
    assert.equal(calls, 1, `${id} should not require repairs`);
  });
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
  assert.match(body.project.code, /#define LED_PIN 13/);
  assert.match(body.project.code, /\/\/ D12 in a comment stays text/);
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
    body: JSON.stringify({ prompt: "Use the push button to toggle the LED." }),
  }));
  assert.equal(response.status, 200, JSON.stringify(repairIssues));
  assert.equal(calls, 2);
  assert.ok(repairIssues.some(issue => issue.includes("button behavior") && issue.includes("no observable circuit change")));
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
    body: JSON.stringify({ prompt: "Create a fresh single-board Uno circuit that blinks an LED.", currentProject: previousProject }),
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

test("generation still rejects a sensor with missing mandatory power", async context => {
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
  assert.equal(response.status, 502);
  assert.ok(issues.some(issue => issue.includes("component-unpowered")));
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
  assert.equal(response.status, 200);
  assert.equal(calls, 2, "the floating-control diagnostic must trigger a repair attempt");
  assert.ok(repairIssues.some((issue) => issue.includes("floating-control") && issue.includes("STBY")));
});

test("generation rejects motor controls that stay undriven after sketch startup", async context => {
  const previousFetch = globalThis.fetch; const previousKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  const invalidProject = COMPONENT_EXAMPLES.tb6612fng();
  invalidProject.code = "void setup(){} void loop(){ delay(100); }";
  const repairedProject = COMPONENT_EXAMPLES.tb6612fng();
  let calls = 0; let repairIssues: string[] = [];
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const request = JSON.parse(String(init?.body));
    const input = JSON.parse(request.contents[0].parts[0].text);
    repairIssues = input.validationIssues ?? [];
    return modelResponse(JSON.stringify({ project: input.validationIssues ? repairedProject : invalidProject, explanation: "TB6612 motor driver", assumptions: [], warnings: [] }));
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST", body: JSON.stringify({ prompt: "Create a TB6612FNG motor driver circuit" }),
  }));
  assert.equal(response.status, 200);
  assert.equal(calls, 2, "unresolved motor controls must be repaired before generation succeeds");
  assert.ok(repairIssues.some(issue => issue.includes("floating-control") && issue.includes("PWMA")));
});

const generatedEnvelope = {
  project: createDefaultBlinkProject(),
  explanation: "Generated a validated blink circuit.",
  assumptions: [],
  warnings: [],
};

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
  const espCode = "void setup(){ Serial1.begin(9600); } void loop(){ if(Serial1.available()){ int value=Serial1.read(); } delay(10); }";
  const repairedEspCode = "void setup(){ Serial1.begin(9600); Serial.begin(9600); } void loop(){ if(Serial1.available()){ int value=Serial1.read(); Serial.println(value); } delay(10); }";
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
  let requestSchema: { properties?: { project?: { properties?: { boardPrograms?: unknown } } } } | undefined;
  let calls = 0;
  let repairIssues: string[] = [];
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const request = JSON.parse(String(init?.body));
    requestSchema = request.generationConfig.responseSchema;
    const content = JSON.parse(request.contents[0].parts[0].text);
    repairIssues = content.validationIssues ?? [];
    const responseProject = content.validationIssues
      ? { ...project, boardPrograms: [{ boardId: "mega", code: megaCode }, { boardId: "esp", code: repairedEspCode }] }
      : project;
    return modelResponse(JSON.stringify({ project: responseProject, explanation: "Two wired controllers run separate sketches.", assumptions: [], warnings: [] }));
  };

  const response = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Build a simulation with an Arduino Mega 2560 and ESP32 DevKitC V4 that exchange bytes over wired UART. Print each received byte in the ESP32 Serial Monitor." }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(calls, 2, "generation should repair a receiver sketch that silently discards the received byte");
  assert.ok(repairIssues.some(issue => issue.includes("never prints or reports it")));
  assert.ok(requestSchema?.properties?.project?.properties?.boardPrograms);
  assert.equal(body.project.activeBoardId, "mega");
  assert.deepEqual(body.project.programs, { mega: megaCode, esp: repairedEspCode });

  const simulator = new MultiBoardSimulator();
  simulator.attachProject(body.project);
  simulator.run();
  simulator.advance(0);
  for (let step = 0; step < 20; step += 1) simulator.advance(20);
  assert.ok(simulator.getSnapshot().boardSerial?.esp?.some(entry => entry.text === "65"), "receiver sketch should observe the sender byte through the connected RX/TX pins");
});

function modelResponse(text: string, finishReason = "STOP") {
  return Response.json({
    candidates: [{ finishReason, content: { parts: [{ text }] } }],
  });
}

function generationRequest(model?: string) {
  return new Request("http://localhost/api/ai/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Blink an LED", ...(model ? { model } : {}) }),
  });
}

function requestWithCurrentProject(prompt: string) {
  return new Request("http://localhost/api/ai/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, currentProject: createDefaultBlinkProject() }),
  });
}

test("ordinary greetings receive a model-generated chat reply without circuit generation", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  let requestBody: {
    generationConfig: { maxOutputTokens: number; responseSchema: { required: string[] } };
    contents: Array<{ parts: Array<{ text: string }> }>;
  } | undefined;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return modelResponse(JSON.stringify({ reply: "Hello! How can I help with your circuit?" }));
  };

  const response = await POST(requestWithCurrentProject("hello"));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    kind: "chat",
    reply: "Hello! How can I help with your circuit?",
    model: "gemini-3.5-flash-lite",
  });
  assert.equal(requestBody?.generationConfig.maxOutputTokens, 512);
  assert.deepEqual(requestBody?.generationConfig.responseSchema.required, ["reply"]);
  assert.equal(requestBody?.contents[0].parts[0].text, "hello");
});

test("standalone and ambiguous prompts create fresh circuits without current project context", async (context) => {
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
    return modelResponse(JSON.stringify(generatedEnvelope));
  };

  for (const prompt of ["Buzzer alert every second", "Traffic light with 3 LEDs", "Make something useful"]) {
    const response = await POST(requestWithCurrentProject(prompt));
    assert.equal(response.status, 200);
  }
  for (const request of requests) {
    const body = JSON.parse(String(request.body));
    const data = JSON.parse(body.contents[0].parts[0].text);
    assert.equal(data.mode, "create");
    assert.equal("currentProject" in data, false);
    assert.match(data.task, /fresh circuit/i);
  }
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
    return modelResponse(JSON.stringify(generatedEnvelope));
  };

  for (const prompt of ["Add a buzzer to this traffic light", "Remove the LED", "Modify the current circuit"]) {
    const response = await POST(requestWithCurrentProject(prompt));
    assert.equal(response.status, 200);
  }
  for (const request of requests) {
    const body = JSON.parse(String(request.body));
    const data = JSON.parse(body.contents[0].parts[0].text);
    assert.equal(data.mode, "edit");
    assert.deepEqual(data.currentProject, createDefaultBlinkProject());
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
    assert.equal(body.generationConfig.maxOutputTokens, 32_768);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.equal(body.generationConfig.responseSchema.type, "object");
    assert.ok(body.generationConfig.responseSchema.properties.project);
    assert.equal("temperature" in body.generationConfig, false);
  }
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
  assert.equal(repairData.mode, "create");
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
  assert.ok(repairData.validationIssues.includes("project.schemaVersion must be 1"));
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
  assert.ok(repairData.validationIssues.some((issue: string) => issue.includes("project.code simulator UNSUPPORTED_CALL")));
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
  assert.equal(
    regeneratedBody.contents[0].parts[0].text,
    firstBody.contents[0].parts[0].text,
  );
  assert.equal(JSON.parse(regeneratedBody.contents[0].parts[0].text).mode, "create");
  assert.notEqual(
    repairBody.contents[0].parts[0].text,
    firstBody.contents[0].parts[0].text,
  );
});

test("returns one friendly error after all recovery attempts fail", async (context) => {
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
  assert.equal(calls, 7);
  assert.equal(body.error.code, "AI_GENERATION_INCOMPLETE");
  assert.equal(body.error.message, "We couldn’t finish this circuit right now. Please try again.");
  assert.equal("details" in body.error, false);
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
    return Response.json({ error: { message: "temporarily unavailable" } }, { status: 503 });
  };

  const response = await POST(generationRequest());
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(calls, 1 + 2);
  assert.equal(body.error.code, "AI_UNAVAILABLE");
  assert.match(body.error.message, /Gemini returned temporary HTTP 503/);
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
    if (calls === 1) return Response.json({ error: { message: "temporarily unavailable" } }, { status: 503 });
    return modelResponse(JSON.stringify(generatedEnvelope));
  };

  const response = await POST(generationRequest());
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});


test("newly published sensor and radio hardware pass simulation preflight", async context => {
  const originalFetch = globalThis.fetch; const originalKey = process.env.GEMINI_API_KEY;
  context.after(() => { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey; });
  process.env.GEMINI_API_KEY = "test-secret";
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("intentional mocked provider failure"); };
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
