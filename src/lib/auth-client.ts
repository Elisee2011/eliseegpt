import { supabase } from "@/integrations/supabase/client";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type SupabaseClient = ReturnType<typeof createClient<Database>>;

const CLOUD_URL = "https://xbqeyeppaiusuhwijjbh.supabase.co";
const CLOUD_PUBLISHABLE_KEY = "sb_publishable_LEqBQWJVTc0Xz3F5wnPy0w_oUDSzNbC";

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
    cached = supabase as SupabaseClient;
  } catch {
    cached = createClient<Database>(CLOUD_URL, CLOUD_PUBLISHABLE_KEY, {
      auth: {
        storage: typeof window !== "undefined" ? localStorage : undefined,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return cached;
}

export function isAuthConfigured(): boolean {
  return getSupabase() !== null;
}