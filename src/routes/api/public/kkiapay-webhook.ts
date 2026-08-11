import { createFileRoute } from "@tanstack/react-router";

/**
 * KkiaPay webhook. Public URL (external caller), so it trusts nothing from the body:
 * it re-verifies every transaction against the KkiaPay API before crediting, and
 * crediting itself is idempotent on the transaction id.
 */
export const Route = createFileRoute("/api/public/kkiapay-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expectedSecret = process.env["KKIAPAY_WEBHOOK_SECRET"];
        if (expectedSecret) {
          const provided =
            request.headers.get("x-kkiapay-secret") ??
            new URL(request.url).searchParams.get("secret") ??
            "";
          if (provided !== expectedSecret) return new Response("Invalid signature", { status: 401 });
        }

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return new Response("Invalid body", { status: 400 });
        }

        const transactionId = String(body["transactionId"] ?? body["transaction_id"] ?? "").trim();
        const orderId = String(body["data"] ?? body["orderId"] ?? "").trim();
        if (!transactionId || !/^[0-9a-f-]{36}$/i.test(orderId)) {
          return new Response("Missing transaction reference", { status: 400 });
        }

        try {
          const { settleVerifiedPayment } = await import("@/lib/payments.server");
          const result = await settleVerifiedPayment({ orderId, transactionId });
          return Response.json({ state: result.state });
        } catch (error) {
          console.error("[kkiapay-webhook] settlement error", error);
          return new Response("Settlement error", { status: 500 });
        }
      },
    },
  },
});
