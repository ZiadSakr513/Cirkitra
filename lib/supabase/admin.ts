import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getSupabasePublicConfig } from "./config";
import type { Database } from "./database.types";

export function isSupabaseAdminConfigured() {
  return Boolean(getSupabasePublicConfig() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

export function createAdminClient() {
  const config = getSupabasePublicConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!config || !serviceRoleKey) {
    throw new Error("Supabase server access is not configured. Add the server-only service role key.");
  }

  return createSupabaseClient<Database>(config.url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}
