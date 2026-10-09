import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicConfig } from "./config";
import { getFirebasePublicConfig } from "../firebase/config";
import { getFirebaseAdminAuth, isFirebaseAdminConfigured } from "../firebase/admin";
import { FIREBASE_SESSION_COOKIE } from "../firebase/session";
import { isAllowedEmailAddress } from "../../functions/email-domain-policy.mjs";
import { isSupabaseAdminConfigured } from "./admin";

function isProtectedPath(pathname: string) {
  return pathname === "/studio"
    || pathname.startsWith("/studio/")
    || pathname === "/projects"
    || pathname.startsWith("/projects/")
    || pathname === "/api/compile"
    || pathname === "/api/ai/generate";
}

function isApiPath(pathname: string) {
  return pathname.startsWith("/api/");
}

export async function updateSession(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isProtected = isProtectedPath(pathname);
  const configured = Boolean(
    getFirebasePublicConfig()
    && isFirebaseAdminConfigured()
    && getSupabasePublicConfig()
    && isSupabaseAdminConfigured(),
  );

  if (!configured) {
    if (!isProtected) return NextResponse.next({ request });
    if (isApiPath(pathname)) {
      return NextResponse.json(
        { error: { code: "AUTH_NOT_CONFIGURED", message: "Account access is not configured yet." } },
        { status: 503 },
      );
    }
    const destination = request.nextUrl.clone();
    destination.pathname = "/auth";
    destination.search = "?setup=1";
    return NextResponse.redirect(destination);
  }

  const sessionCookie = request.cookies.get(FIREBASE_SESSION_COOKIE)?.value;
  let authenticated = false;
  if (sessionCookie) {
    try {
      const session = await getFirebaseAdminAuth().verifySessionCookie(sessionCookie, true);
      authenticated = session.email_verified === true && isAllowedEmailAddress(session.email);
    } catch {
      authenticated = false;
    }
  }

  if (isProtected && !authenticated) {
    if (isApiPath(pathname)) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Sign in to use this feature." } },
        { status: 401 },
      );
    }
    const destination = request.nextUrl.clone();
    destination.pathname = "/auth";
    destination.search = `?next=${encodeURIComponent(`${pathname}${search}`)}`;
    return NextResponse.redirect(destination);
  }

  return NextResponse.next({ request });
}
