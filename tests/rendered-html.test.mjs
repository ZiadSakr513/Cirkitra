import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { POST as generateCircuit } from "../app/api/ai/generate/route.ts";
import { POST as compileSketch } from "../app/api/compile/route.ts";

test("the Cirkitra workbench and metadata contain the production identity", async () => {
  const [layout, studio] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio.tsx", import.meta.url), "utf8"),
  ]);
  const source = `${layout}\n${studio}`;

  assert.match(source, /const title = "Cirkitra"/);
  assert.match(source, /import \{ Analytics \} from "@vercel\/analytics\/next"/);
  assert.match(source, /<Analytics\s*\/>/);
  assert.doesNotMatch(source, /IMAGINE · WIRE · RUN/);
  assert.match(source, /Founded by/);
  assert.match(source, /Ziad Sakr/);
  assert.match(source, /Components/);
  assert.match(source, /Describe a circuit/);
  assert.match(source, /Run simulation/);
  assert.doesNotMatch(source, /codex-preview|react-loading-skeleton|Your site is taking shape/);
});

test("compile endpoint accepts a simulation-ready Uno sketch", async () => {
  const response = await compileSketch(
    new Request("http://localhost/api/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        board: "arduino-uno",
        code: "void setup(){pinMode(13, OUTPUT);} void loop(){digitalWrite(13, HIGH);delay(500);}",
      }),
    }),
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.mode, "simulation-ir");
  assert.equal(payload.artifact.board, "arduino-uno");
});

test("AI endpoint fails safely when the server key is absent", async (context) => {
  const originalKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  delete process.env.GEMINI_API_KEY;

  const response = await generateCircuit(
    new Request("http://localhost/api/ai/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Blink an LED" }),
    }),
  );

  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.error.code, "AI_NOT_CONFIGURED");
  assert.equal("project" in payload, false);
});

test("AI endpoint rejects models outside the Gemini allowlist", async () => {
  const response = await generateCircuit(
    new Request("http://localhost/api/ai/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Blink an LED", model: "arbitrary-provider-model" }),
    }),
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error.code, "UNSUPPORTED_AI_MODEL");
  assert.equal("project" in payload, false);
});
