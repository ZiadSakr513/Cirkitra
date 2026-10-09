import "server-only";

import { cookies } from "next/headers";
import type { DecodedIdToken } from "firebase-admin/auth";

import { isAllowedEmailAddress } from "../../functions/email-domain-policy.mjs";
import { getFirebaseAdminAuth } from "./admin";

export const FIREBASE_SESSION_COOKIE = "__cirkitra_session";
export const FIREBASE_SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export async function verifyFirebaseSessionCookie(value: string | undefined): Promise<DecodedIdToken | null> {
  if (!value) return null;
  try {
    const decoded = await getFirebaseAdminAuth().verifySessionCookie(value, true);
    return decoded.email_verified === true && isAllowedEmailAddress(decoded.email) ? decoded : null;
  } catch {
    return null;
  }
}

export async function getFirebaseSession(): Promise<DecodedIdToken | null> {
  const cookieStore = await cookies();
  return verifyFirebaseSessionCookie(cookieStore.get(FIREBASE_SESSION_COOKIE)?.value);
}
