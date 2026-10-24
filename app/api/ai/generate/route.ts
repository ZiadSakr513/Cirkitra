import { POST as handleGenerationPost } from "./implementation.ts";

// Next.js route modules may expose only HTTP handlers and static route config.
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  return handleGenerationPost(request);
}
