import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const file = (path) => new URL(path, import.meta.url);

test("protected handlers enforce auth at the handler boundary and cap bodies", async () => {
  const [compile, generation, session, adminAuth, grants, usage] = await Promise.all([
    readFile(file("../app/api/compile/route.ts"), "utf8"),
    readFile(file("../app/api/ai/generate/route.ts"), "utf8"),
    readFile(file("../app/api/auth/session/route.ts"), "utf8"),
    readFile(file("../lib/billing/admin-plan-grant-auth.ts"), "utf8"),
    readFile(file("../app/api/admin/plan-grants/route.ts"), "utf8"),
    readFile(file("../app/api/admin/ai-usage/route.ts"), "utf8"),
  ]);
  assert.match(compile, /authenticateAiRequest\(request\)/);
  assert.match(compile, /readBoundedJson\(request, MAX_COMPILE_BODY_BYTES\)/);
  assert.match(generation, /authenticateAiRequest\(request\)/);
  assert.match(generation, /reserveAiGenerationAttempt\(userId\)/);
  assert.match(generation, /readBoundedJson\(request, MAX_REQUEST_BYTES/);
  assert.match(session, /isSameOriginRequest\(request\)/);
  assert.match(session, /httpOnly:\s*true/);
  assert.match(session, /sameSite:\s*"lax"/);
  assert.match(session, /secure:\s*process\.env\.NODE_ENV === "production"/);
  assert.match(adminAuth, /authenticateAiRequest\(request\)/);
  assert.match(adminAuth, /isCirkitraOwner\(userId\)/);
  assert.match(adminAuth, /if \(mutation && !isSameOriginRequest\(request\)\)/);
  assert.match(grants, /requirePlanGrantAdmin\(request, true\)/);
  assert.match(usage, /requirePlanGrantAdmin\(request, true\)/);
  assert.doesNotMatch(grants, /body\.userId/);
  assert.doesNotMatch(usage, /body\.userId/);
});

test("browser and both deployment paths apply CSP and security headers", async () => {
  const [proxy, worker, headers] = await Promise.all([
    readFile(file("../proxy.ts"), "utf8"),
    readFile(file("../worker/index.ts"), "utf8"),
    readFile(file("../lib/security/headers.ts"), "utf8"),
  ]);
  assert.match(proxy, /createCspNonce\(\)/);
  assert.match(proxy, /requestHeaders\.set\("Content-Security-Policy"/);
  assert.match(proxy, /applySecurityHeaders\(response\.headers/);
  assert.match(worker, /createContentSecurityPolicy\(options\)/);
  assert.match(worker, /applySecurityHeaders\(responseHeaders, options\)/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /https:\/\/accounts\.google\.com/);
  assert.match(headers, /https:\/\/www\.sandbox\.paypal\.com/);
  assert.match(headers, /supabaseOrigin/);
});

test("webhook size checks preserve PayPal signature verification and event idempotency", async () => {
  const [webhook, migration] = await Promise.all([
    readFile(file("../app/api/billing/paypal/webhook/route.ts"), "utf8"),
    readFile(file("../supabase/migrations/20261009040000_paypal_multi_tier.sql"), "utf8"),
  ]);
  assert.match(webhook, /readBoundedText\(request, 1_000_000\)/);
  assert.match(webhook, /JSON\.parse\(rawBody\)/);
  assert.match(webhook, /verifyPayPalWebhook\(config, request, event\)/);
  assert.match(migration, /on conflict \(event_id\) do nothing[\s\S]*if v_inserted = 0 then\s+return false/i);
});
