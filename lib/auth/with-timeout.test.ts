import assert from "node:assert/strict";
import { test } from "node:test";

import { AuthFlowTimeoutError, withTimeout } from "./with-timeout.ts";

test("withTimeout returns a completed operation", async () => {
  assert.equal(await withTimeout(Promise.resolve("signed in"), 100, "timed out"), "signed in");
});

test("withTimeout rejects a stalled operation with an actionable timeout", async () => {
  await assert.rejects(
    withTimeout(new Promise<never>(() => {}), 5, "Google sign-in timed out"),
    (error: unknown) => error instanceof AuthFlowTimeoutError && error.message === "Google sign-in timed out",
  );
});
