import "server-only";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

export function isFirebaseAdminConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()
    && process.env.FIREBASE_CLIENT_EMAIL?.trim()
    && process.env.FIREBASE_PRIVATE_KEY?.trim(),
  );
}

export function getFirebaseAdminAuth() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase Admin is not configured. Add its server-only service-account credentials.");
  }

  const appName = "cirkitra-firebase-admin";
  const existingApp = getApps().find((app) => app.name === appName);
  const app = existingApp ?? initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  }, appName);
  return getAuth(app);
}
