import assert from "node:assert/strict";
import test from "node:test";

import { accountProjectCacheKey, LEGACY_LOCAL_PROJECT_KEY, legacyMigrationIdKey } from "./account-storage.ts";

test("account project cache keys are isolated by user and project", () => {
  assert.equal(accountProjectCacheKey("user-a", "project-1"), "ai-circuit-studio.account-project.v1:user-a:project-1");
  assert.notEqual(accountProjectCacheKey("user-a", "project-1"), accountProjectCacheKey("user-b", "project-1"));
  assert.notEqual(accountProjectCacheKey("user-a", "project-1"), accountProjectCacheKey("user-a", "project-2"));
});

test("legacy draft key stays unchanged and migration IDs are per user", () => {
  assert.equal(LEGACY_LOCAL_PROJECT_KEY, "ai-circuit-studio.project.v1");
  assert.notEqual(legacyMigrationIdKey("user-a"), legacyMigrationIdKey("user-b"));
});
