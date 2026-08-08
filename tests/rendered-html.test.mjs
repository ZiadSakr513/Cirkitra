import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);

async function loadWorker() {
  const url = new URL(workerUrl);
  url.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(url.href);
  return worker;
}

const bindings = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
};

const context = {
  waitUntil() {},
  passThroughOnException() {},
};

test("server-renders the Zircuit workbench", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    bindings,
    context,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Zircuit/);
  assert.doesNotMatch(html, /IMAGINE · WIRE · RUN/);
  assert.match(html, /Founded by/);
  assert.match(html, /Ziad Sakr/);
  assert.match(html, /Components/);
  assert.match(html, /Describe a circuit/);
  assert.match(html, /Run simulation/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/);
});

test("compile endpoint accepts a simulation-ready Uno sketch", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        board: "arduino-uno",
        code: "void setup(){pinMode(13, OUTPUT);} void loop(){digitalWrite(13, HIGH);delay(500);}",
      }),
    }),
    bindings,
    context,
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.mode, "simulation-ir");
  assert.equal(payload.artifact.board, "arduino-uno");
});

test("AI endpoint fails safely when the server key is absent", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/ai/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Blink an LED" }),
    }),
    bindings,
    context,
  );

  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.error.code, "AI_NOT_CONFIGURED");
  assert.equal("project" in payload, false);
});

test("AI endpoint rejects models outside the Gemini allowlist", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/ai/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Blink an LED", model: "arbitrary-provider-model" }),
    }),
    bindings,
    context,
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error.code, "UNSUPPORTED_AI_MODEL");
  assert.equal("project" in payload, false);
});
