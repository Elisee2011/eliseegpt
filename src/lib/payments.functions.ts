import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CREDIT_PACKS, findPack } from "@/lib/credit-packs";

/** Public payment configuration (KkiaPay public key only — never a secret key). */
export const getPaymentConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { paymentPublicConfig } = await import("@/lib/kkiapay.server");
    const config = paymentPublicConfig();
    return { ...config, packs: CREDIT_PACKS };
  });

/** Current balance + history. */
export const getMyCredits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getBalance } = await import("@/lib/credits.server");
    const balance = await getBalance(context.userId);
    const [{ data: orders }, { data: ledger }] = await Promise.all([
      context.supabase
        .from("payment_orders")
        .select("id, pack, amount, currency, credits, status, created_at, paid_at, failure_reason")
        .order("created_at", { ascending: false })
        .limit(10),
      context.supabase
        .from("credit_ledger")
        .select("id, delta, reason, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    return { balance, orders: orders ?? [], ledger: ledger ?? [] };
  });

/** Creates a pending order server-side: the amount and credits come from the server, never the client. */
export const createOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { packId: string }) => z.object({ packId: z.string().min(1).max(40) }).parse(input))
  .handler(async ({ data, context }) => {
    const pack = findPack(data.packId);
    if (!pack) throw new Error("Pack inconnu.");

    const { paymentPublicConfig } = await import("@/lib/kkiapay.server");
    const config = paymentPublicConfig();
    if (!config.configured) {
      throw new Error(`Paiement non configuré. Variable(s) manquante(s) : ${config.missing.join(", ")}`);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order, error } = await supabaseAdmin
      .from("payment_orders")
      .insert({
        user_id: context.userId,
        pack: pack.id,
        amount: pack.amount,
        credits: pack.credits,
        currency: "XOF",
        provider: "kkiapay",
      })
      .select("id, pack, amount, currency, credits, status")
      .single();
    if (error) throw error;

    return { order, publicKey: config.publicKey, sandbox: config.sandbox };
  });

/**
 * Confirms a payment. The client only reports a transaction id; the server asks KkiaPay
 * for the real status, checks the amount, then credits exactly once (unique transaction id).
 */
export const confirmPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string; transactionId: string }) =>
    z
      .object({ orderId: z.string().uuid(), transactionId: z.string().min(4).max(120) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { settleVerifiedPayment } = await import("@/lib/payments.server");
    return settleVerifiedPayment({
      orderId: data.orderId,
      transactionId: data.transactionId,
      expectedUserId: context.userId,
    });
  });

/** Marks an order as failed/cancelled. Never adds credits. */
export const closeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string; status: "failed" | "cancelled"; reason?: string }) =>
    z
      .object({
        orderId: z.string().uuid(),
        status: z.enum(["failed", "cancelled"]),
        reason: z.string().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order } = await supabaseAdmin
      .from("payment_orders")
      .select("id, user_id, status")
      .eq("id", data.orderId)
      .maybeSingle();
    if (!order || order.user_id !== context.userId) throw new Error("Commande inconnue.");
    await supabaseAdmin.rpc("fail_order", {
      _order_id: data.orderId,
      _status: data.status,
      _reason: data.reason ?? data.status,
    });
    return { ok: true };
  });
