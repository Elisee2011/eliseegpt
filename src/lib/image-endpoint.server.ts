import { AllProvidersFailedError, NoProviderConfiguredError, createImage } from "@/lib/ai-router.server";
import { CREDIT_COST } from "@/lib/credit-packs";
import { InsufficientCreditsError, getUserFromRequest, refundCredits, spendCredits } from "@/lib/credits.server";

const MAX_INPUT_IMAGES = 4;

/** Shared handler for /api/image (generation) and /api/image/edit (editing). */
export async function handleImageRequest(request: Request, options: { edit: boolean }) {
  let body: { prompt?: unknown; images?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Requête invalide." }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || prompt.length > 4_000) {
    return Response.json({ error: "Décrivez l’image en moins de 4 000 caractères." }, { status: 400 });
  }

  const images = Array.isArray(body.images)
    ? body.images
        .filter((value): value is string => typeof value === "string" && value.startsWith("data:image/"))
        .slice(0, MAX_INPUT_IMAGES)
    : [];
  if (options.edit && images.length === 0) {
    return Response.json({ error: "Ajoutez au moins une image à modifier." }, { status: 400 });
  }

  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Connectez-vous pour générer des images." }, { status: 401 });
  }

  const cost = options.edit ? CREDIT_COST.imageEdit : CREDIT_COST.image;
  const reason = options.edit ? "image-edit" : "image";
  try {
    await spendCredits(user.id, cost, reason);
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return Response.json(
        { error: `Crédits Elisée GPT épuisés (solde : ${error.balance}). Rechargez depuis la page Crédits.` },
        { status: 402 },
      );
    }
    console.error("[image] credit error", error);
    return Response.json({ error: "Impossible de vérifier vos crédits." }, { status: 500 });
  }

  try {
    const result = await createImage(prompt, images);
    return Response.json(
      { imageUrl: result.dataUrl, provider: result.provider },
      { headers: { "X-AI-Provider": result.provider } },
    );
  } catch (error) {
    await refundCredits(user.id, cost, `refund:${reason}`);
    if (error instanceof NoProviderConfiguredError) {
      return Response.json({ error: "Variable manquante : OPENROUTER_API_KEY" }, { status: 503 });
    }
    if (error instanceof AllProvidersFailedError) {
      console.error("[image] all providers failed", error.attempts);
      return Response.json(
        { error: "Aucun fournisseur d’images n’est disponible. Aucun crédit n’a été débité." },
        { status: 503 },
      );
    }
    console.error("[image] unexpected error", error);
    return Response.json({ error: "La génération d’image a échoué. Aucun crédit n’a été débité." }, { status: 502 });
  }
}
