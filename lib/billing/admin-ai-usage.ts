import "server-only";

import { createAdminClient } from "../supabase/admin";
import type { Database } from "../supabase/database.types";

export type AdminAiUsageResetRecord = Database["public"]["Tables"]["admin_ai_usage_resets"]["Row"];

function firstResult<T>(data: T[] | T | null): T {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("AI usage reset storage returned no result.");
  return row as T;
}

export function isMissingAdminAiUsageResetSchema(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  if (code === "42P01") return /admin_ai_usage_resets/i.test(message);
  if (code === "PGRST202") return /reset_ai_generation_usage/i.test(message);
  if (code === "PGRST205") return /admin_ai_usage_resets/i.test(message);
  return /admin_ai_usage_resets|reset_ai_generation_usage/i.test(message)
    && /(does not exist|could not find|schema cache|not found)/i.test(message);
}

export async function listAdminAiUsageResets(userId: string): Promise<AdminAiUsageResetRecord[]> {
  const { data, error } = await createAdminClient()
    .from("admin_ai_usage_resets")
    .select("*")
    .eq("user_id", userId)
    .order("reset_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(`Could not read AI usage reset history: ${error.message}`);
  return data ?? [];
}

export async function resetAdminAiUsage(input: {
  userId: string;
  resetBy: string;
  idempotencyKey: string;
  internalNote: string | null;
}): Promise<AdminAiUsageResetRecord> {
  const { data, error } = await createAdminClient().rpc("reset_ai_generation_usage", {
    p_user_id: input.userId,
    p_reset_by: input.resetBy,
    p_idempotency_key: input.idempotencyKey,
    p_internal_note: input.internalNote,
  });
  if (error) throw new Error(`Could not reset AI generation usage: ${error.message}`);
  return firstResult(data);
}
