import { NextRequest } from "next/server";

import { updateSession } from "./lib/supabase/proxy";
import { applySecurityHeaders, createContentSecurityPolicy, createCspNonce } from "./lib/security/headers";

export async function proxy(request: NextRequest) {
  const nonce = createCspNonce();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const production = process.env.NODE_ENV === "production";
  const policy = createContentSecurityPolicy({ nonce, supabaseUrl, production });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", policy);
  requestHeaders.set("x-nonce", nonce);
  const securedRequest = new NextRequest(request, { headers: requestHeaders });
  const response = await updateSession(securedRequest);
  applySecurityHeaders(response.headers, { nonce, supabaseUrl, production });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
