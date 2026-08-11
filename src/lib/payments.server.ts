import { verifyTransaction } from "@/lib/kkiapay.server";

export type SettleResult =
  | { state: "credited"; credits: number; balance: number; alreadyCredited: boolean }
  | { state: "pending" }
  | { state: "failed"; reason: string };

/**
 * Single source of truth for crediting: verifies the transaction with KkiaPay,
 * checks the amount against the stored order, then settles it exactly once.
 */
export async function settleVerifiedPayment(input: {
  orderId: string;
  transactionId: string;
  expectedUserId?: string;
}): Promise<SettleResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: order, error } = await supabaseAdmin
    .from("payment_orders")
    .select("id, user_id, amount, currency, credits, status")
    .eq("id", input.orderId)
    .maybeSingle();
  if (error) throw error;
  if (!order) return { state: "failed", reason: "unknown_order" };
  if (input.expectedUserId && order.user_id !== input.expectedUserId) {
    return { state: "failed", reason: "unknown_order" };
  }

  const verification = await verifyTransaction(input.transactionId);

  if (verification.status === "PENDING") return { state: "pending" };
  if (verification.status !== "SUCCESS") {
    await supabaseAdmin.rpc("fail_order", {
      _order_id: order.id,
      _status: "failed",
      _reason: `provider_status_${verification.status.toLowerCase()}`,
    });
    return { state: "failed", reason: "payment_not_successful" };
  }

  if (Math.round(verification.amount) < order.amount) {
    await supabaseAdmin.rpc("fail_order", {
      _order_id: order.id,
      _status: "failed",
      _reason: "amount_mismatch",
    });
    return { state: "failed", reason: "amount_mismatch" };
  }

  const { data: settled, error: settleError } = await supabaseAdmin.rpc("settle_payment", {
    _order_id: order.id,
    _transaction_id: input.transactionId,
    _paid_amount: Math.round(verification.amount),
  });
  if (settleError) throw settleError;

  const result = settled as { ok: boolean; already_credited?: boolean; credits?: number; balance?: number; reason?: string };
  if (!result.ok) return { state: "failed", reason: result.reason ?? "settlement_failed" };
  return {
    state: "credited",
    credits: Number(result.credits ?? 0),
    balance: Number(result.balance ?? 0),
    alreadyCredited: Boolean(result.already_credited),
  };
}
