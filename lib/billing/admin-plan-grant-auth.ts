import "server-only";

import { isSameOriginRequest } from "../auth/request-origin";
import { isFirebaseAdminConfigured } from "../firebase/admin";
import { isSupabaseAdminConfigured } from "../supabase/admin";
import { authenticateAiRequest, isCirkitraOwner } from "./ai-usage";

export type OwnerAdminResult = { userId: string } | { response: Response };

function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function requirePlanGrantAdmin(request: Request, mutation = false): Promise<OwnerAdminResult> {
  if (mutation && !isSameOriginRequest(request)) {
    return { response: errorResponse("INVALID_ORIGIN", "This admin change must come from Cirkitra.", 403) };
  }

  const userId = await authenticateAiRequest(request);
  if (!userId) return { response: errorResponse("AUTH_REQUIRED", "Sign in with a verified Cirkitra account.", 401) };
  if (!isCirkitraOwner(userId)) return { response: errorResponse("ADMIN_REQUIRED", "Only the configured Cirkitra owner can use admin tools.", 403) };
  if (!isFirebaseAdminConfigured() || !isSupabaseAdminConfigured()) {
    return { response: errorResponse("ADMIN_SETUP_REQUIRED", "Admin account lookup and storage are not configured yet.", 503) };
  }
  return { userId };
}
