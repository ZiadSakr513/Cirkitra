export const AI_GENERATION_REQUESTS_PER_MINUTE = 5;

export type AiGenerationRateLimit = {
  allowed: boolean;
  remaining: number;
  resetsAt: string;
};

type AiGenerationRateLimitAdapter = (userId: string) => Promise<AiGenerationRateLimit>;

let testAdapter: AiGenerationRateLimitAdapter | undefined;

/** Replaces the database rate-limit call in route tests only. */
export function configureAiGenerationRateLimitAdapterForTests(adapter: AiGenerationRateLimitAdapter | undefined) {
  testAdapter = adapter;
}

export async function reserveAiGenerationAttempt(userId: string): Promise<AiGenerationRateLimit> {
  if (!userId.trim()) throw new Error("User ID is required to rate-limit AI generation.");
  if (testAdapter) return testAdapter(userId);

  const { createAdminClient } = await import("../supabase/admin");
  const { data, error } = await createAdminClient().rpc("reserve_ai_generation_rate_limit", {
    p_user_id: userId,
  });
  if (error) throw new Error(`AI generation rate limit failed: ${error.message}`);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("AI generation rate limit returned no result.");
  return {
    allowed: row.allowed,
    remaining: Math.max(0, row.remaining),
    resetsAt: row.resets_at,
  };
}
