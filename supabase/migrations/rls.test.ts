import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("./20261005000000_accounts_and_projects.sql", import.meta.url);
const firebaseMigrationUrl = new URL("./20261005010000_firebase_auth.sql", import.meta.url);
const aiUsageMigrationUrl = new URL("./20261005020000_ai_usage_limits.sql", import.meta.url);
const rollingAiUsageMigrationUrl = new URL("./20261005030000_rolling_ai_usage.sql", import.meta.url);
const paypalSubscriptionsMigrationUrl = new URL("./20261005040000_paypal_subscriptions.sql", import.meta.url);
const paypalEnvironmentIsolationMigrationUrl = new URL("./20261009080000_paypal_environment_isolation.sql", import.meta.url);
const aiChatRateLimitMigrationUrl = new URL("./20261005050000_ai_chat_rate_limits.sql", import.meta.url);
const ownerUnlimitedAiUsageMigrationUrl = new URL("./20261005060000_owner_unlimited_ai_usage.sql", import.meta.url);
const adminAiUsageResetsMigrationUrl = new URL("./20261009060000_admin_ai_usage_resets.sql", import.meta.url);
const aiGenerationRateLimitMigrationUrl = new URL("./20261009070000_ai_generation_rate_limit.sql", import.meta.url);

test("project and migration settings tables are protected by owner-only RLS", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /alter table public\.projects enable row level security/i);
  assert.match(sql, /alter table public\.account_settings enable row level security/i);
  assert.match(sql, /revoke all on table public\.projects from anon/i);
  assert.match(sql, /revoke all on table public\.account_settings from anon/i);
  assert.match(sql, /using\s*\(\(select auth\.uid\(\)\) = owner_id\)/i);
  assert.match(sql, /with check\s*\(\(select auth\.uid\(\)\) = owner_id\)/i);
  assert.match(sql, /using\s*\(\(select auth\.uid\(\)\) = user_id\)/i);
  assert.match(sql, /with check\s*\(\(select auth\.uid\(\)\) = user_id\)/i);
});

test("Firebase migration keeps project rows and scopes RLS to the Firebase token subject", async () => {
  const sql = await readFile(firebaseMigrationUrl, "utf8");
  assert.match(sql, /alter column owner_id type text using owner_id::text/i);
  assert.match(sql, /alter column user_id type text using user_id::text/i);
  assert.match(sql, /owner_id\s*=\s*\(select auth\.jwt\(\)\s*->>\s*'sub'\)/i);
  assert.match(sql, /user_id\s*=\s*\(select auth\.jwt\(\)\s*->>\s*'sub'\)/i);
  assert.match(sql, /create or replace function public\.link_legacy_supabase_account/i);
  assert.match(sql, /where pg_catalog\.lower\(users\.email\) = pg_catalog\.lower/i);
  assert.match(sql, /limit 1\s+for update/i);
  assert.match(sql, /revoke all on function public\.link_legacy_supabase_account\(text, text\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.link_legacy_supabase_account\(text, text\) to service_role/i);
});

test("initial AI usage migration is server-only, reserves atomically, and excludes failures from usage", async () => {
  const sql = await readFile(aiUsageMigrationUrl, "utf8");
  assert.match(sql, /create table if not exists public\.ai_generation_requests/i);
  assert.match(sql, /alter table public\.ai_generation_requests enable row level security/i);
  assert.match(sql, /revoke all on table public\.ai_generation_requests from public, anon, authenticated/i);
  assert.match(sql, /pg_advisory_xact_lock[\s\S]*select pg_catalog\.count\(\*\)[\s\S]*status in \('succeeded', 'reserved'\)/i);
  assert.match(sql, /status = 'expired'[\s\S]*created_at < v_now - interval '10 minutes'/i);
  assert.match(sql, /case when p_succeeded then 'succeeded' else 'failed' end/i);
  assert.match(sql, /requests\.status = 'succeeded'[\s\S]*requests\.status = 'reserved'/i);
  assert.match(sql, /revoke all on function public\.reserve_ai_generation_request\(text, integer, text\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.reserve_ai_generation_request\(text, integer, text\) to service_role/i);
});

test("AI request slots expire one month after submission instead of on the calendar-month boundary", async () => {
  const sql = await readFile(rollingAiUsageMigrationUrl, "utf8");
  assert.match(sql, /create or replace function public\.reserve_ai_generation_request/i);
  assert.match(sql, /create or replace function public\.get_ai_generation_usage/i);
  assert.match(sql, /requests\.created_at > v_window_start/i);
  assert.match(sql, /v_window_start := v_now - interval '1 month'/i);
  assert.match(sql, /requests\.created_at \+ interval '1 month'/i);
  assert.match(sql, /requests\.status = 'succeeded'[\s\S]*requests\.status = 'reserved'/i);
  assert.doesNotMatch(sql, /date_trunc\('month'/i);
  assert.match(sql, /notify pgrst, 'reload schema'/i);
});

test("AI chat has a separate atomic per-user rate limit that only the server can call", async () => {
  const sql = await readFile(aiChatRateLimitMigrationUrl, "utf8");
  assert.match(sql, /create table if not exists public\.ai_chat_request_windows/i);
  assert.match(sql, /primary key \(user_id, minute_bucket\)/i);
  assert.match(sql, /alter table public\.ai_chat_request_windows enable row level security/i);
  assert.match(sql, /revoke all on table public\.ai_chat_request_windows from public, anon, authenticated/i);
  assert.match(sql, /on conflict \(user_id, minute_bucket\) do update[\s\S]*request_count < 10/i);
  assert.match(sql, /minute_bucket < v_bucket - interval '1 day'/i);
  assert.match(sql, /revoke all on function public\.reserve_ai_chat_request\(text\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.reserve_ai_chat_request\(text\) to service_role/i);
});

test("costly circuit generation has a separate service-role-only per-user rate limit", async () => {
  const sql = await readFile(aiGenerationRateLimitMigrationUrl, "utf8");
  assert.match(sql, /create table if not exists public\.ai_generation_request_windows/i);
  assert.match(sql, /request_count between 1 and 5/i);
  assert.match(sql, /alter table public\.ai_generation_request_windows enable row level security/i);
  assert.match(sql, /revoke all on table public\.ai_generation_request_windows from public, anon, authenticated/i);
  assert.match(sql, /on conflict \(user_id, minute_bucket\) do update[\s\S]*request_count < 5/i);
  assert.match(sql, /minute_bucket < v_bucket - interval '1 day'/i);
  assert.match(sql, /revoke all on function public\.reserve_ai_generation_rate_limit\(text\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.reserve_ai_generation_rate_limit\(text\) to service_role/i);
});

test("every public table enables RLS and every SECURITY DEFINER function is hardened", async () => {
  const names = (await readdir(new URL(".", import.meta.url))).filter(name => name.endsWith(".sql"));
  const migrations = await Promise.all(names.map(async name => ({ name, sql: await readFile(new URL(name, import.meta.url), "utf8") })));
  const allSql = migrations.map(({ sql }) => sql).join("\n");
  const tableNames = new Set<string>();
  for (const { sql } of migrations) {
    for (const match of sql.matchAll(/create\s+table(?:\s+if\s+not\s+exists)?\s+public\.([a-z0-9_]+)/gi)) {
      tableNames.add(match[1]!.toLowerCase());
    }
  }
  assert.ok(tableNames.size > 0, "migration scan should find public tables");
  for (const tableName of tableNames) {
    const qualified = `public\\.${tableName}`;
    assert.match(allSql, new RegExp(`alter\\s+table\\s+${qualified}\\s+enable\\s+row\\s+level\\s+security`, "i"), `${tableName} must enable RLS`);
    assert.match(allSql, new RegExp(`revoke\\s+all\\s+on\\s+(?:table\\s+)?${qualified}\\s+from\\s+[^;]*\\banon\\b`, "i"), `${tableName} must revoke anonymous access`);
  }

  let securityDefinerCount = 0;
  for (const { name, sql } of migrations) {
    const functions = [...sql.matchAll(/create(?:\s+or\s+replace)?\s+function\s+public\.([a-z0-9_]+)\s*\([\s\S]*?\$\$;/gi)];
    for (const match of functions) {
      const definition = match[0]!;
      if (!/security\s+definer/i.test(definition)) continue;
      securityDefinerCount += 1;
      const functionName = match[1]!;
      assert.match(definition, /set\s+search_path\s*=\s*''/i, `${name}: ${functionName} must pin search_path`);
      assert.match(sql, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${functionName}\\s*\\([^;]*\\)\\s+from\\s+public,\\s*anon,\\s*authenticated`, "i"), `${name}: ${functionName} must revoke public execution`);
      assert.match(sql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${functionName}\\s*\\([^;]*\\)\\s+to\\s+service_role`, "i"), `${name}: ${functionName} must grant service-role execution`);
    }
  }
  assert.ok(securityDefinerCount > 0, "migration scan should find privileged functions");
});

test("unlimited owner AI usage keeps request tracking but reserves the zero limit sentinel for service-role RPCs", async () => {
  const sql = await readFile(ownerUnlimitedAiUsageMigrationUrl, "utf8");
  assert.match(sql, /p_monthly_limit integer/);
  assert.match(sql, /p_monthly_limit < 0 or p_monthly_limit > 1000/i);
  assert.match(sql, /if p_monthly_limit > 0 and v_used >= p_monthly_limit then/i);
  assert.match(sql, /insert into public\.ai_generation_requests[\s\S]*returning request_id/i);
  assert.match(sql, /revoke all on function public\.reserve_ai_generation_request\(text, integer, text\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.reserve_ai_generation_request\(text, integer, text\) to service_role/i);
});

test("admin AI usage resets start a fresh quota boundary without deleting request history", async () => {
  const sql = await readFile(adminAiUsageResetsMigrationUrl, "utf8");
  assert.match(sql, /create table if not exists public\.admin_ai_usage_resets/i);
  assert.match(sql, /idempotency_key uuid not null unique/i);
  assert.match(sql, /alter table public\.admin_ai_usage_resets enable row level security/i);
  assert.match(sql, /revoke all on public\.admin_ai_usage_resets from public, anon, authenticated/i);
  assert.match(sql, /grant all on public\.admin_ai_usage_resets to service_role/i);
  assert.match(sql, /create or replace function public\.reset_ai_generation_usage/i);
  assert.match(sql, /resets\.idempotency_key = p_idempotency_key/i);
  assert.match(sql, /v_existing\.user_id is distinct from p_user_id[\s\S]*v_existing\.reset_by is distinct from p_reset_by/i);
  assert.match(sql, /pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(p_user_id, 0\)\)/i);
  assert.match(sql, /greatest\(v_window_start, v_latest_reset\)/i);
  assert.match(sql, /requests\.created_at > v_window_start/i);
  assert.match(sql, /requests\.status = 'succeeded'[\s\S]*requests\.status = 'reserved'/i);
  assert.match(sql, /revoke all on function public\.reset_ai_generation_usage\(text, text, uuid, text\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.reset_ai_generation_usage\(text, text, uuid, text\) to service_role/i);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.ai_generation_requests/i);
});

test("PayPal subscriptions are private to the server and webhook events are idempotent", async () => {
  const sql = await readFile(paypalSubscriptionsMigrationUrl, "utf8");
  assert.match(sql, /alter table public\.paypal_subscriptions enable row level security/i);
  assert.match(sql, /revoke all on public\.paypal_subscriptions from public, anon, authenticated/i);
  assert.match(sql, /grant all on public\.paypal_subscriptions to service_role/i);
  assert.match(sql, /create or replace function public\.apply_paypal_webhook_event/i);
  assert.match(sql, /on conflict \(event_id\) do nothing[\s\S]*if v_inserted = 0 then\s+return false/i);
  assert.match(sql, /p_payment_succeeded and p_paid_through is null/i);
  assert.match(sql, /successful_payment_at is not null[\s\S]*paid_through > v_now/i);
  assert.match(sql, /revoke all on function public\.get_paypal_maker_entitlement\(text\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.get_paypal_maker_entitlement\(text\) to service_role/i);
});

test("PayPal environment isolation preserves Sandbox history and scopes every entitlement mutation", async () => {
  const sql = await readFile(paypalEnvironmentIsolationMigrationUrl, "utf8");
  for (const table of ["paypal_checkout_intents", "paypal_subscriptions", "paypal_webhook_events"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table}[\\s\\S]*?add column if not exists environment text`, "i"));
  }
  assert.match(sql, /set environment = 'sandbox'[\s\S]*where environment is null/i);
  assert.match(sql, /set default 'sandbox'[\s\S]*set not null/i);
  assert.match(sql, /primary key \(environment, paypal_subscription_id\)/i);
  assert.match(sql, /primary key \(environment, event_id\)/i);
  assert.match(sql, /intents\.environment = p_environment/i);
  assert.match(sql, /subscriptions\.environment = p_environment/i);
  assert.match(sql, /on conflict \(environment, event_id\) do nothing/i);
  assert.match(sql, /on conflict \(environment, paypal_subscription_id\) do update/i);
  assert.match(sql, /get_active_plan_entitlements\(p_user_id, 'sandbox'\)/i);
  assert.match(sql, /apply_paypal_webhook_event\([\s\S]*'sandbox', p_payment_succeeded/i);
  assert.match(sql, /set search_path = ''/i);
  assert.match(sql, /revoke all on function public\.get_active_plan_entitlements\(text, text\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.get_active_plan_entitlements\(text, text\) to service_role/i);
  assert.match(sql, /revoke all on function public\.apply_paypal_webhook_event\(text, text, text, uuid, text, timestamptz, text, boolean, boolean\) from public, anon, authenticated/i);
});
