import assert from "node:assert/strict";
import test from "node:test";

import { readBoundedJson, readBoundedText } from "./bounded-json.ts";

test("bounded JSON accepts valid JSON under its byte limit", async () => {
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ safe: true }),
  });
  assert.deepEqual(await readBoundedJson(request, 64), { ok: true, value: { safe: true } });
});

test("bounded JSON rejects non-JSON content types and malformed bodies", async () => {
  const wrongType = new Request("http://localhost/api/test", { method: "POST", body: "{}" });
  assert.deepEqual(await readBoundedJson(wrongType, 64), { ok: false, reason: "invalid-content-type" });

  const malformed = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{bad",
  });
  assert.deepEqual(await readBoundedJson(malformed, 64), { ok: false, reason: "invalid-json" });
});

test("bounded JSON rejects oversized declared and chunked bodies before parsing", async () => {
  const declared = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "1000" },
    body: "{}",
  });
  assert.deepEqual(await readBoundedJson(declared, 64), { ok: false, reason: "too-large" });

  const chunked = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`{"value":"${"x".repeat(80)}"}`));
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  assert.deepEqual(await readBoundedJson(chunked, 64), { ok: false, reason: "too-large" });
});

test("bounded JSON can parse existing JSON-only APIs without a content-type header when configured", async () => {
  const request = new Request("http://localhost/api/test", { method: "POST", body: "{\"safe\":true}" });
  assert.deepEqual(await readBoundedJson(request, 64, { requireContentType: false }), {
    ok: true,
    value: { safe: true },
  });
});

test("bounded text preserves the exact webhook body and rejects oversized input before parsing", async () => {
  const body = '{"event_type":"PAYMENT.SALE.COMPLETED","unicode":"café"}';
  const request = new Request("https://example.test/webhook", { method: "POST", body });
  const result = await readBoundedText(request, 256);
  assert.deepEqual(result, { ok: true, value: body });

  const oversized = new Request("https://example.test/webhook", {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(65)));
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  assert.deepEqual(await readBoundedText(oversized, 64), { ok: false, reason: "too-large" });
});
