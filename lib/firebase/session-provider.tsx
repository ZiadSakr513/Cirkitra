"use client";

import { onIdTokenChanged } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { safeNextPath } from "../auth/redirect";
import { getFirebaseAuth } from "./client";
import { syncFirebaseSession } from "./session-client";

export function FirebaseSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let isInitialAuthState = true;
    try {
      unsubscribe = onIdTokenChanged(getFirebaseAuth(), (user) => {
        const isInitial = isInitialAuthState;
        isInitialAuthState = false;
        if (!user?.emailVerified) return;
        void syncFirebaseSession(user).then(() => {
          if (window.location.pathname === "/auth") {
            if (isInitial) {
              const next = new URLSearchParams(window.location.search).get("next");
              window.location.replace(safeNextPath(next, "/projects"));
            }
            return;
          }
          router.refresh();
        }).catch(() => {
          // Protected routes remain blocked unless the server session is valid.
        });
      });
    } catch {
      // Public pages still work when account credentials are not configured.
    }

    return () => unsubscribe?.();
  }, [router]);

  return children;
}
