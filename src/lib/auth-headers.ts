import { supabase } from "@/integrations/supabase/client";

/** Bearer header for the /api/* endpoints (server re-validates the token). */
export async function authHeaders(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}
