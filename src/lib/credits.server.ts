/** Élisée GPT credits — server only. Fully independent from any Lovable balance. */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type AuthedUser = { id: string; email: string | null };

/** Resolves the signed-in user from the request bearer token (validated with Supabase Auth). */
export async function getUserFromRequest(request: Request): Promise<AuthedUser | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"];
  if (!url || !key) return null;

  const client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

export class InsufficientCreditsError extends Error {
  readonly balance: number;
  constructor(balance: number) {
    super("Crédits Elisée GPT insuffisants.");
    this.name = "InsufficientCreditsError";
    this.balance = balance;
  }
}

export async function getBalance(userId: string): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("ensure_user_credits", { _user_id: userId });
  if (error) throw error;
  return Number(data ?? 0);
}

/** Debits credits atomically. Throws InsufficientCreditsError when the balance is too low. */
export async function spendCredits(userId: string, amount: number, reason: string): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("spend_credits", {
    _user_id: userId,
    _amount: amount,
    _reason: reason,
  });
  if (error) {
    if (error.message.includes("insufficient_credits")) {
      throw new InsufficientCreditsError(await getBalance(userId));
    }
    throw error;
  }
  return Number(data ?? 0);
}

/** Gives credits back when the AI call ultimately failed. */
export async function refundCredits(userId: string, amount: number, reason: string): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.rpc("refund_credits", { _user_id: userId, _amount: amount, _reason: reason });
  } catch (error) {
    console.error("[credits] refund failed", error);
  }
}
