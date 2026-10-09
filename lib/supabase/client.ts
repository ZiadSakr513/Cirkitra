"use client";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { onAuthStateChanged, type User } from "firebase/auth";

import { getFirebaseAuth } from "../firebase/client";
import { syncFirebaseSession } from "../firebase/session-client";
import { getSupabasePublicConfig } from "./config";
import type { Database } from "./database.types";

let browserClient: ReturnType<typeof createSupabaseClient<Database>> | undefined;

async function getCurrentFirebaseUser() {
  const auth = getFirebaseAuth();
  if (auth.currentUser) return auth.currentUser;

  return new Promise<User | null>((resolve) => {
    let unsubscribe: () => void = () => {};
    unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

export function createClient() {
  if (browserClient) return browserClient;

  const config = getSupabasePublicConfig();
  if (!config) throw new Error("Supabase is not configured. Add its public URL and publishable key to the environment.");

  browserClient = createSupabaseClient<Database>(config.url, config.key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    accessToken: async () => {
      const user = await getCurrentFirebaseUser();
      if (!user?.emailVerified) return null;
      return syncFirebaseSession(user);
    },
  });
  return browserClient;
}
