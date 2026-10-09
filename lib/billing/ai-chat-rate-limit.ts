export const AI_CHAT_REQUESTS_PER_MINUTE = 10;

export type AiChatRateLimit = {
  allowed: boolean;
  remaining: number;
  resetsAt: string;
};

type AiChatRateLimitAdapter = (userId: string) => Promise<AiChatRateLimit>;

let testAdapter: AiChatRateLimitAdapter | undefined;

/** Replaces the database rate-limit call in route tests only. */
export function configureAiChatRateLimitAdapterForTests(adapter: AiChatRateLimitAdapter | undefined) {
  testAdapter = adapter;
}

export async function reserveAiChatRequest(userId: string): Promise<AiChatRateLimit> {
  if (!userId.trim()) throw new Error("User ID is required to rate-limit AI chat.");
  if (testAdapter) return testAdapter(userId);

  const { createAdminClient } = await import("../supabase/admin");
  const { data, error } = await createAdminClient().rpc("reserve_ai_chat_request", {
    p_user_id: userId,
  });
  if (error) throw new Error(`AI chat rate limit failed: ${error.message}`);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("AI chat rate limit returned no result.");
  return {
    allowed: row.allowed,
    remaining: Math.max(0, row.remaining),
    resetsAt: row.resets_at,
  };
}
