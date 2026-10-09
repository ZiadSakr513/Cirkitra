import { getFirebasePublicConfig } from "../firebase/config";
import { isFirebaseAdminConfigured } from "../firebase/admin";
import { getSupabasePublicConfig } from "../supabase/config";
import { isSupabaseAdminConfigured } from "../supabase/admin";

export function isAccountAccessConfigured() {
  return Boolean(
    getFirebasePublicConfig()
    && isFirebaseAdminConfigured()
    && getSupabasePublicConfig()
    && isSupabaseAdminConfigured(),
  );
}
