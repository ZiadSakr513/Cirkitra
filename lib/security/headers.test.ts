import assert from "node:assert/strict";
import test from "node:test";

import { createContentSecurityPolicy, createCspNonce, createSecurityHeaders } from "./headers.ts";

test("CSP nonce is random-looking and used by the policy", () => {
  const nonce = createCspNonce();
  assert.match(nonce, /^[A-Za-z0-9+/]+=*$/);
  assert.ok(createContentSecurityPolicy({ nonce }).includes(`'nonce-${nonce}'`));
});

test("production CSP allows required Google, PayPal, and configured Supabase origins", () => {
  const policy = createContentSecurityPolicy({
    nonce: "test-nonce",
    supabaseUrl: "https://project.supabase.co",
    production: true,
  });
  assert.match(policy, /script-src 'self' 'nonce-test-nonce'/);
  assert.match(policy, /connect-src[^;]*https:\/\/project\.supabase\.co/);
  assert.match(policy, /connect-src[^;]*wss:\/\/project\.supabase\.co/);
  assert.match(policy, /frame-src[^;]*https:\/\/\*\.paypal\.com/);
  assert.match(policy, /script-src[^;]*https:\/\/accounts\.google\.com/);
  assert.match(policy, /script-src[^;]*https:\/\/www\.sandbox\.paypal\.com/);
  assert.match(policy, /style-src 'self' 'unsafe-inline'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.doesNotMatch(policy, /script-src[^;]*unsafe-inline|script-src[^;]*unsafe-eval|\*\.supabase\.co/);
});

test("production response headers harden framing, MIME sniffing, referrers, and transport", () => {
  const headers = createSecurityHeaders({ nonce: "nonce", production: true });
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.equal(headers["Strict-Transport-Security"], "max-age=31536000");
});
