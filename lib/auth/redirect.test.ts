import assert from "node:assert/strict";
import test from "node:test";

import { safeNextPath } from "./redirect.ts";
import { isSameOriginRequest } from "./request-origin.ts";

test("safeNextPath keeps same-site paths including project query strings", () => {
  assert.equal(safeNextPath("/studio?project=abc"), "/studio?project=abc");
  assert.equal(safeNextPath("/auth/reset-password"), "/auth/reset-password");
});

test("safeNextPath rejects external and malformed redirects", () => {
  assert.equal(safeNextPath("https://attacker.example"), "/projects");
  assert.equal(safeNextPath("//attacker.example"), "/projects");
  assert.equal(safeNextPath("/\\attacker.example"), "/projects");
  assert.equal(safeNextPath(null, "/studio"), "/studio");
});

test("same-origin validation accepts matching origins and localhost loopback aliases", () => {
  assert.equal(isSameOriginRequest(new Request("http://localhost:3000/api/auth/session", {
    method: "POST",
    headers: { origin: "http://localhost:3000" },
  })), true);
  assert.equal(isSameOriginRequest(new Request("http://127.0.0.1:3000/api/auth/session", {
    method: "POST",
    headers: { origin: "http://localhost:3000" },
  })), true);
});

test("same-origin validation never trusts client-controlled forwarded headers", () => {
  assert.equal(isSameOriginRequest(new Request("http://127.0.0.1:3000/api/auth/session", {
    method: "POST",
    headers: {
      origin: "https://cirkitra-preview.example",
      host: "127.0.0.1:3000",
      "x-forwarded-host": "cirkitra-preview.example",
      "x-forwarded-proto": "https",
    },
  })), false);
});

test("same-origin validation still rejects unrelated or malformed origins", () => {
  const headers = {
    origin: "https://attacker.example",
    host: "127.0.0.1:3000",
    "x-forwarded-host": "cirkitra-preview.example",
    "x-forwarded-proto": "https",
  };
  assert.equal(isSameOriginRequest(new Request("http://127.0.0.1:3000/api/auth/session", { headers })), false);
  assert.equal(isSameOriginRequest(new Request("http://localhost:3000/api/auth/session", {
    headers: { origin: "http://localhost:3000/path" },
  })), false);
});

test("missing Origin fails closed", () => {
  const request = new Request("http://localhost:3000/api/auth/session", { method: "POST" });
  assert.equal(isSameOriginRequest(request), false);
});
