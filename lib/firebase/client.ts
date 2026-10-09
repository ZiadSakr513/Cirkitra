"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

import { getFirebasePublicConfig } from "./config";

export function getFirebaseAuth() {
  const config = getFirebasePublicConfig();
  if (!config) throw new Error("Firebase Auth is not configured. Add the Firebase web configuration to the environment.");

  const app = getApps().length ? getApp() : initializeApp(config);
  return getAuth(app);
}
