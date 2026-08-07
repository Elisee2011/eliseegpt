import { supabase } from "@/integrations/supabase/client";

type SupabaseClient = typeof supabase;

let cached: SupabaseClient | null | undefined;

/**
 * Returns the backend client, or null when its environment variables are not
 * configured (e.g. an external deployment without the auth env vars).
 * Keeps the app usable instead of crashing the whole page.
 */
export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  try {
    // Touching a property initializes the underlying client (and throws if unconfigured).
    void supabase.auth;
    cached = supabase;
  } catch {
    cached = null;
  }
  return cached;
}

export function isAuthConfigured(): boolean {
  return getSupabase() !== null;
}