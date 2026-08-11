/** Credit packs — client-safe (prices are public information). */
export type CreditPack = {
  id: string;
  label: string;
  credits: number;
  /** Price in XOF (FCFA), the currency used by MTN MoMo & Moov Money in Benin. */
  amount: number;
  hint: string;
};

export const CREDIT_PACKS: CreditPack[] = [
  { id: "starter", label: "Découverte", credits: 40, amount: 500, hint: "~160 messages" },
  { id: "standard", label: "Standard", credits: 120, amount: 1000, hint: "~480 messages" },
  { id: "pro", label: "Pro", credits: 400, amount: 3000, hint: "~1 600 messages" },
];

export function findPack(id: string) {
  return CREDIT_PACKS.find((pack) => pack.id === id);
}

/** Credit cost of each action (Élisée GPT credits — unrelated to any Lovable balance). */
export const CREDIT_COST = {
  chat: 0.25,
  image: 1,
  imageEdit: 1,
} as const;
