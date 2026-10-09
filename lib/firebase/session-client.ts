"use client";

import type { User } from "firebase/auth";
import { signOut } from "firebase/auth";

import { getFirebaseAuth } from "./client";

type SessionResponse = { refreshToken?: boolean; error?: { code?: string; message?: string } };

export class FirebaseSessionError extends Error {
  code: string;

  constructor(message: string, code = "AUTH_SESSION_FAILED") {
    super(message);
    this.name = "FirebaseSessionError";
    this.code = code;
  }
}

const syncedTokens = new Map<string, string>();
const pendingSyncs = new Map<string, Promise<string>>();

async function createServerSession(idToken: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ idToken }),
      signal: controller.signal,
    });
    const result = await response.json().catch((error: unknown) => {
      if (controller.signal.aborted) throw error;
      return {};
    }) as SessionResponse;
    if (!response.ok) {
      throw new FirebaseSessionError(result.error?.message ?? "Could not start your Cirkitra session.", result.error?.code);
    }
    return result;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new FirebaseSessionError("Cirkitra took too long to finish signing you in. Check your connection and try again.", "AUTH_SESSION_TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function syncFirebaseSession(user: User, forceSync = false): Promise<string> {
  const existing = pendingSyncs.get(user.uid);
  if (existing) return existing;

  const sync = (async () => {
    let idToken = await user.getIdToken();
    if (!forceSync && syncedTokens.get(user.uid) === idToken) return idToken;

    const result = await createServerSession(idToken);
    if (result.refreshToken) {
      idToken = await user.getIdToken(true);
      const refreshed = await createServerSession(idToken);
      if (refreshed.refreshToken) throw new FirebaseSessionError("Could not finish setting up your sign-in. Please try again.");
    }

    syncedTokens.set(user.uid, idToken);
    return idToken;
  })();

  pendingSyncs.set(user.uid, sync);
  try {
    return await sync;
  } finally {
    pendingSyncs.delete(user.uid);
  }
}

export async function clearFirebaseSession(user?: User | null) {
  const response = await fetch("/api/auth/session", {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!response.ok) throw new FirebaseSessionError("Could not securely end your Cirkitra session.");
  if (user) syncedTokens.delete(user.uid);
}

export async function signOutFromCirkitra() {
  const auth = getFirebaseAuth();
  await clearFirebaseSession(auth.currentUser);
  await signOut(auth);
}
