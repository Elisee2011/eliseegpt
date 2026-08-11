/**
 * KkiaPay — server only.
 * KkiaPay is a licensed Beninese payment aggregator supporting MTN MoMo and Moov Money.
 * Payments are collected on the merchant account; payouts go to the Mobile Money number
 * configured (and validated) in the KkiaPay merchant dashboard — never hardcoded here.
 */

export type KkiapayStatus = "SUCCESS" | "PENDING" | "FAILED" | "UNKNOWN";

export type KkiapayVerification = {
  status: KkiapayStatus;
  amount: number;
  raw: Record<string, unknown>;
};

function config() {
  const publicKey = process.env["KKIAPAY_PUBLIC_KEY"];
  const privateKey = process.env["KKIAPAY_PRIVATE_KEY"];
  const secret = process.env["KKIAPAY_SECRET"];
  const sandbox = (process.env["KKIAPAY_SANDBOX"] ?? "").toLowerCase() === "true";
  const missing = [
    ...(!publicKey ? ["KKIAPAY_PUBLIC_KEY"] : []),
    ...(!privateKey ? ["KKIAPAY_PRIVATE_KEY"] : []),
    ...(!secret ? ["KKIAPAY_SECRET"] : []),
  ];
  return { publicKey, privateKey, secret, sandbox, missing };
}

export function paymentPublicConfig() {
  const { publicKey, sandbox, missing } = config();
  return { publicKey: publicKey ?? null, sandbox, configured: missing.length === 0, missing };
}

export class PaymentNotConfiguredError extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`Variable(s) manquante(s) : ${missing.join(", ")}`);
    this.name = "PaymentNotConfiguredError";
    this.missing = missing;
  }
}

/** Asks KkiaPay for the real state of a transaction. The server never trusts the client. */
export async function verifyTransaction(transactionId: string): Promise<KkiapayVerification> {
  const { publicKey, privateKey, secret, sandbox, missing } = config();
  if (missing.length > 0) throw new PaymentNotConfiguredError(missing);

  const base = sandbox ? "https://api-sandbox.kkiapay.me" : "https://api.kkiapay.me";
  const response = await fetch(`${base}/api/v1/transactions/status`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": publicKey!,
      "x-private-key": privateKey!,
      "x-secret-key": secret!,
    },
    body: JSON.stringify({ transactionId }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    console.error("[kkiapay] verification failed", response.status);
    throw new Error(`kkiapay_http_${response.status}`);
  }

  const raw = (await response.json()) as Record<string, unknown>;
  const rawStatus = String(raw["status"] ?? raw["state"] ?? "").toUpperCase();
  const status: KkiapayStatus =
    rawStatus === "SUCCESS" || rawStatus === "SUCCESSFUL"
      ? "SUCCESS"
      : rawStatus === "PENDING" || rawStatus === "IN_PROGRESS"
        ? "PENDING"
        : rawStatus === "FAILED" || rawStatus === "CANCELLED" || rawStatus === "CANCELED"
          ? "FAILED"
          : "UNKNOWN";

  return { status, amount: Number(raw["amount"] ?? 0), raw };
}
