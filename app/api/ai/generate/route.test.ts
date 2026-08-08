import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultBlinkProject } from "../../../../lib/circuit/default-project.ts";
import { POST } from "./route.ts";

const generatedEnvelope = {
  project: createDefaultBlinkProject(),
  explanation: "Generated a validated blink circuit.",
  assumptions: [],
  warnings: [],
};

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
  assert.equal((await defaultResponse.json()).model, "gemini-3.5-flash");
  assert.equal((await liteResponse.json()).model, "gemini-3.5-flash-lite");
  assert.match(requests[0].url, /models\/gemini-3\.5-flash:generateContent$/);
  assert.match(requests[1].url, /models\/gemini-3\.5-flash-lite:generateContent$/);

  for (const request of requests) {
    const headers = new Headers(request.init?.headers);
    const body = JSON.parse(String(request.init?.body));
    assert.equal(headers.get("x-goog-api-key"), "test-secret");
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.equal("temperature" in body.generationConfig, false);
  }
});
