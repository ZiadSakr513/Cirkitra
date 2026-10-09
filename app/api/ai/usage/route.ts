import { authenticateAiRequest, getAiUsageSnapshot } from "../../../../lib/billing/ai-usage.ts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const userId = await authenticateAiRequest(request);
  if (!userId) {
    return Response.json(
      { error: { code: "AUTH_REQUIRED", message: "Sign in with a verified account to view AI usage." } },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    return Response.json(await getAiUsageSnapshot(userId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[ai-usage-read-failed]", error instanceof Error ? error.message : "unknown error");
    return Response.json(
      { error: { code: "AI_USAGE_UNAVAILABLE", message: "AI usage is temporarily unavailable. Please try again shortly." } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
