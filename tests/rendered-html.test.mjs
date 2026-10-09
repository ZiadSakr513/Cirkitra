import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { POST as generateCircuit } from "../app/api/ai/generate/route.ts";
import { POST as compileSketch } from "../app/api/compile/route.ts";
import { configureAiUsageAdapterForTests } from "../lib/billing/ai-usage.ts";

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

test("public SEO routes expose canonical metadata and keep the workbench separate", async () => {
  const [layout, page, studioPage, robots, sitemap, manifest, social] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/robots.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/sitemap.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/manifest.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/opengraph-image.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /metadataBase:\s*new URL\(siteUrl\)/);
  assert.match(layout, /cirkitra-green\.vercel\.app/);
  assert.match(layout, /openGraph:/);
  assert.match(layout, /twitter:/);
  assert.match(page, /SoftwareApplication/);
  assert.match(page, /FAQPage/);
  assert.match(page, /href="\/studio"/);
  assert.match(page, /Describe the circuit/);
  assert.match(studioPage, /index:\s*false/);
  assert.match(studioPage, /<CircuitStudio key=\{project\.id\} initialProject=\{project\} projectUpdatedAt=\{data\.updated_at\} userId=\{user\.uid\} \/>/);
  assert.match(studioPage, /if \(!isAccountAccessConfigured\(\)\) redirect\("\/auth\?setup=1"\)/);
  assert.match(studioPage, /\.eq\("id", params\.project\)/);
  assert.match(robots, /disallow:\s*\["\/api\/", "\/studio"\]/);
  assert.doesNotMatch(sitemap, /\/studio/);
  assert.match(manifest, /start_url:\s*"\/studio"/);
  assert.match(social, /width:\s*1200/);
  assert.match(social, /height:\s*630/);
});

test("compile endpoint accepts a simulation-ready Uno sketch", async () => {
  const testUsageAdapter = {
    authenticate: async request => request.headers.get("x-test-auth") === "valid" ? "compile-test-user" : null,
    reserve: async () => { throw new Error("compile must not reserve AI usage"); },
    finalize: async () => {},
    snapshot: async () => { throw new Error("compile must not read AI usage"); },
  };
  configureAiUsageAdapterForTests(testUsageAdapter);
  try {
    const unauthorized = await compileSketch(new Request("http://localhost/api/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ board: "arduino-uno", code: "void setup(){} void loop(){}" }),
    }));
    assert.equal(unauthorized.status, 401);

    const oversized = await compileSketch(new Request("http://localhost/api/compile", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-auth": "valid" },
      body: JSON.stringify({ board: "arduino-uno", code: "x".repeat(128_001) }),
    }));
    assert.equal(oversized.status, 413);

    const response = await compileSketch(
      new Request("http://localhost/api/compile", {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-auth": "valid" },
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
  } finally {
    configureAiUsageAdapterForTests(undefined);
  }
});

test("AI endpoint fails safely when the server key is absent", async (context) => {
  const originalKey = process.env.GEMINI_API_KEY;
  context.after(() => {
    configureAiUsageAdapterForTests(undefined);
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  delete process.env.GEMINI_API_KEY;
  configureAiUsageAdapterForTests({
    authenticate: async () => "rendered-html-test-user",
    reserve: async () => { throw new Error("generation must not reserve usage without a provider key"); },
    finalize: async () => {},
    snapshot: async () => { throw new Error("generation must not read usage without a provider key"); },
  });

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

test("public pricing explains limits and gates PayPal checkout on server configuration", async () => {
  const [pricing, home, sitemap] = await Promise.all([
    readFile(new URL("../app/pricing/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/sitemap.ts", import.meta.url), "utf8"),
  ]);
  assert.match(home, /href="\/pricing"/);
  assert.match(pricing, /Cirkitra is free while/);
  assert.match(pricing, /PayPal billing is being configured/);
  assert.match(pricing, /maker\.monthlyAiRequests/);
  assert.match(pricing, /getPayPalPublicConfig/);
  assert.match(pricing, /PayPalSubscription/);
  assert.match(sitemap, /cirkitra-green\.vercel\.app\/pricing/);
});
