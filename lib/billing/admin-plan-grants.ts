import "server-only";

import { createAdminClient } from "../supabase/admin";
import type { Database } from "../supabase/database.types";
import type { PaidCirkitraPlanId } from "./plans";

export type AdminPlanGrantRecord = Database["public"]["Tables"]["admin_plan_grants"]["Row"];

function firstResult<T>(data: T[] | T | null): T {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Admin plan grant storage returned no result.");
  return row as T;
}

export async function getActiveAdminPlanGrantPlanId(userId: string): Promise<PaidCirkitraPlanId | null> {
  const { data, error } = await createAdminClient().rpc("get_active_admin_plan_grant", { p_user_id: userId });
  if (error) throw new Error(`Could not read complimentary plan access: ${error.message}`);
  const grant = data?.[0];
  return grant?.plan_id === "maker" || grant?.plan_id === "pro" ? grant.plan_id : null;
}

export async function listAdminPlanGrants(userId: string): Promise<AdminPlanGrantRecord[]> {
  const { data, error } = await createAdminClient()
    .from("admin_plan_grants")
    .select("*")
    .eq("user_id", userId)
    .order("granted_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`Could not read plan grant history: ${error.message}`);
  return data ?? [];
}

export async function createAdminPlanGrant(input: {
  userId: string;
  planId: PaidCirkitraPlanId;
  grantedBy: string;
  expiresAt: string | null;
  internalNote: string | null;
}): Promise<AdminPlanGrantRecord> {
  const { data, error } = await createAdminClient().rpc("create_admin_plan_grant", {
    p_user_id: input.userId,
    p_plan_id: input.planId,
    p_granted_by: input.grantedBy,
    p_expires_at: input.expiresAt,
    p_internal_note: input.internalNote,
  });
  if (error) throw new Error(`Could not grant complimentary plan access: ${error.message}`);
  return firstResult(data);
}

export async function revokeAdminPlanGrant(grantId: string, revokedBy: string): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("revoke_admin_plan_grant", {
    p_grant_id: grantId,
    p_revoked_by: revokedBy,
  });
  if (error) throw new Error(`Could not revoke complimentary plan access: ${error.message}`);
  return Boolean(data);
}
