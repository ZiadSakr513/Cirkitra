import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getFirebaseAdminAuth, isFirebaseAdminConfigured } from "../../../../lib/firebase/admin";
import { FIREBASE_SESSION_COOKIE, FIREBASE_SESSION_MAX_AGE_MS, verifyFirebaseSessionCookie } from "../../../../lib/firebase/session";
import { createAdminClient, isSupabaseAdminConfigured } from "../../../../lib/supabase/admin";
import { isSameOriginRequest } from "../../../../lib/auth/request-origin";
import { isAllowedEmailAddress } from "../../../../functions/email-domain-policy.mjs";
import { readBoundedJson } from "../../../../lib/http/bounded-json.ts";

export const runtime = "nodejs";

function unavailable() {
  return NextResponse.json(
    { error: { code: "AUTH_NOT_CONFIGURED", message: "Account access is not fully configured yet." } },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET() {
  if (!isFirebaseAdminConfigured()) return unavailable();
  const cookieStore = await cookies();
  const session = await verifyFirebaseSessionCookie(cookieStore.get(FIREBASE_SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json(
      { authenticated: false },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { authenticated: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function firebaseTokenFailureReason(error: unknown) {
  const message = error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message ?? "")
    : "";
  if (message.includes('incorrect "aud"')) return "token-audience-mismatch";
  if (message.includes('incorrect "iss"')) return "token-issuer-mismatch";
  if (message.includes("invalid signature")) return "token-signature-invalid";
  if (message.includes('no "kid"')) return "token-missing-key-id";
  if (message.includes("incorrect algorithm")) return "token-algorithm-invalid";
  if (message.includes("Decoding Firebase ID token failed")) return "token-malformed";
  if (message.includes('no "sub"') || message.includes('empty "sub"')) return "token-subject-invalid";
  return "token-verification-failed";
}

function safeFirebaseErrorDetail(error: unknown) {
  const message = error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message ?? "")
    : "";
  return message
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]")
    .replace(/\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[token]")
    .replace(/(private[_ ]key|client[_ ]secret|api[_ ]key)(\s*[:=]\s*)\S+/gi, "$1$2[redacted]")
    .slice(0, 240);
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "INVALID_ORIGIN", message: "Sign-in request must come from Cirkitra." } }, { status: 403 });
  }
  if (!isFirebaseAdminConfigured() || !isSupabaseAdminConfigured()) return unavailable();
  const parsed = await readBoundedJson(request, 16_384);
  if (!parsed.ok) {
    if (parsed.reason === "too-large") return NextResponse.json({ error: { code: "REQUEST_TOO_LARGE", message: "Sign-in request is too large." } }, { status: 413 });
    if (parsed.reason === "invalid-content-type") return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Request body must be JSON." } }, { status: 415 });
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 });
  }
  const body = parsed.value;
  const idToken = body && typeof body === "object" && !Array.isArray(body)
    ? (body as { idToken?: unknown }).idToken
    : undefined;
  if (typeof idToken !== "string" || idToken.length > 12_000) {
    return NextResponse.json({ error: { code: "INVALID_TOKEN", message: "A valid Firebase sign-in token is required." } }, { status: 400 });
  }

  let failureStage = "initialize-firebase-admin";
  try {
    const auth = getFirebaseAdminAuth();
    failureStage = "verify-id-token";
    const decoded = await auth.verifyIdToken(idToken, true);
    if (typeof decoded.email !== "string" || !isAllowedEmailAddress(decoded.email)) {
      return NextResponse.json(
        { error: { code: "EMAIL_DOMAIN_NOT_ALLOWED", message: "Email domain isn't supported." } },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (decoded.email_verified !== true) {
      return NextResponse.json(
        { error: { code: "EMAIL_NOT_VERIFIED", message: "Confirm your email address before opening Cirkitra projects." } },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (decoded.role !== "authenticated") {
      failureStage = "read-firebase-user";
      const firebaseUser = await auth.getUser(decoded.uid);
      failureStage = "set-supabase-auth-role-claim";
      await auth.setCustomUserClaims(firebaseUser.uid, {
        ...firebaseUser.customClaims,
        role: "authenticated",
      });
      return NextResponse.json({ refreshToken: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
    }

    failureStage = "link-supabase-account";
    const supabase = createAdminClient();
    const { error: linkError } = await supabase.rpc("link_legacy_supabase_account", {
      p_firebase_uid: decoded.uid,
      p_email: decoded.email,
    });
    if (linkError) {
      return NextResponse.json(
        { error: { code: "ACCOUNT_LINK_FAILED", message: "Could not safely connect this account to its existing Cirkitra projects. Please try again later." } },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    failureStage = "create-session-cookie";
    const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn: FIREBASE_SESSION_MAX_AGE_MS });
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(FIREBASE_SESSION_COOKIE, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(FIREBASE_SESSION_MAX_AGE_MS / 1000),
    });
    return response;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "UNKNOWN")
      : "UNKNOWN";
    console.error("[auth-session-failed]", {
      stage: failureStage,
      code,
      ...(failureStage === "verify-id-token"
        ? {
            reason: firebaseTokenFailureReason(error),
            ...(process.env.NODE_ENV === "development" ? { detail: safeFirebaseErrorDetail(error) } : {}),
          }
        : {}),
    });
    return NextResponse.json(
      { error: { code: "AUTH_SESSION_FAILED", message: "Could not verify your sign-in. Please sign in again." } },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "INVALID_ORIGIN", message: "Sign-out request must come from Cirkitra." } }, { status: 403 });
  }
  const response = new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  response.cookies.set(FIREBASE_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
