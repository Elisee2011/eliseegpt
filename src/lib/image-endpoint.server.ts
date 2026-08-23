import { AllProvidersFailedError, NoProviderConfiguredError, createImage } from "@/lib/ai-router.server";

const MAX_INPUT_IMAGES = 4;

/** Shared handler for image generation and editing. No credits or payment system is used. */
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

  try {
    const result = await createImage(prompt, images);
    return Response.json(
      { imageUrl: result.dataUrl, provider: result.provider },
      { headers: { "X-AI-Provider": result.provider } },
    );
  } catch (error) {
    if (error instanceof NoProviderConfiguredError) {
      return Response.json({ error: "Variable manquante : OPENROUTER_API_KEY" }, { status: 503 });
    }
    if (error instanceof AllProvidersFailedError) {
      console.error("[image] all providers failed", error.attempts);
      return Response.json({ error: "Aucun fournisseur d’images n’est disponible." }, { status: 503 });
    }
    console.error("[image] unexpected error", error);
    return Response.json({ error: "La génération d’image a échoué." }, { status: 502 });
  }
}
