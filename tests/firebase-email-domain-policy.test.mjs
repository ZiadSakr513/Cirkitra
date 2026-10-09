import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ALLOWED_EMAIL_DOMAINS,
  EMAIL_DOMAIN_BLOCK_MESSAGE,
  isAllowedEmailAddress,
} from "../functions/email-domain-policy.mjs";
import { createEmailDomainBlockingHandler } from "../functions/blocking-handler.mjs";

const file = (path) => new URL(path, import.meta.url);

test("every approved email domain matches exactly, regardless of case", () => {
  assert.equal(EMAIL_DOMAIN_BLOCK_MESSAGE, "Email domain isn't supported.");
  assert.deepEqual(ALLOWED_EMAIL_DOMAINS, [
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "yahoo.com",
    "icloud.com",
    "me.com",
    "mac.com",
    "proton.me",
    "protonmail.com",
    "pm.me",
  ]);

  for (const domain of ALLOWED_EMAIL_DOMAINS) {
    assert.equal(isAllowedEmailAddress(`person@${domain}`), true, domain);
    assert.equal(isAllowedEmailAddress(`Person@${domain.toUpperCase()}`), true, domain);
  }
  assert.equal(isAllowedEmailAddress("person+cirkitra@gmail.com"), true);
});

test("disposable, custom, malformed, subdomain, and lookalike addresses are rejected", () => {
  const rejected = [
    undefined,
    null,
    "",
    "not-an-email",
    "@gmail.com",
    "person@@gmail.com",
    " person @gmail.com",
    "person@mail.gmail.com",
    "person@gmail.com.evil.example",
    "person@evilgmail.com",
    "person@gmail.com.",
    "person@company.example",
    "person@school.edu",
    "person@mailinator.com",
    "person@tempmail.com",
  ];

  for (const email of rejected) assert.equal(isAllowedEmailAddress(email), false, String(email));
});

test("Firebase blocking handler rejects missing and unapproved emails and allows approved ones", () => {
  class FakeHttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  const handler = createEmailDomainBlockingHandler(FakeHttpsError);
  assert.equal(handler({ data: { email: "user@proton.me" } }), undefined);
  assert.throws(
    () => handler({ data: { email: "user@custom.example" } }),
    error => error instanceof FakeHttpsError && error.code === "permission-denied",
  );
  assert.throws(
    () => handler({ data: {} }),
    error => error instanceof FakeHttpsError && error.code === "permission-denied",
  );
});

test("both Firebase blocking triggers and app-side auth defenses are wired", async () => {
  const [firebaseEntry, authForm, session, verifier, proxy, aiAuth, config, functionsPackage] = await Promise.all([
    readFile(file("../functions/index.js"), "utf8"),
    readFile(file("../app/auth/auth-form.tsx"), "utf8"),
    readFile(file("../app/api/auth/session/route.ts"), "utf8"),
    readFile(file("../lib/firebase/session.ts"), "utf8"),
    readFile(file("../lib/supabase/proxy.ts"), "utf8"),
    readFile(file("../lib/billing/ai-usage.ts"), "utf8"),
    readFile(file("../firebase.json"), "utf8"),
    readFile(file("../functions/package.json"), "utf8"),
  ]);

  assert.match(firebaseEntry, /beforeUserCreated\(enforceAllowedEmailDomain\)/);
  assert.match(firebaseEntry, /beforeUserSignedIn\(enforceAllowedEmailDomain\)/);
  assert.match(authForm, /isAllowedEmailAddress\(email\)/);
  assert.match(authForm, /auth\/internal-error/);
  assert.match(authForm, /isAllowedEmailAddress\(user\.email\)/);
  assert.ok(
    authForm.indexOf('if (mode !== "forgot" && !isAllowedEmailAddress(email))')
      < authForm.indexOf("createUserWithEmailAndPassword(auth, email, password)"),
    "email/password signup should be rejected before Firebase is called",
  );
  assert.match(session, /isAllowedEmailAddress\(decoded\.email\)/);
  assert.match(verifier, /isAllowedEmailAddress\(decoded\.email\)/);
  assert.match(proxy, /isAllowedEmailAddress\(session\.email\)/);
  assert.match(aiAuth, /isAllowedEmailAddress\(session\.email\)/);
  assert.match(config, /"runtime":\s*"nodejs22"/);
  assert.match(functionsPackage, /"firebase-functions":\s*"\^6\.0\.0"/);
});
