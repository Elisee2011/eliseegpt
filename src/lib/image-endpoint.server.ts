import { AllProvidersFailedError, createImage } from "@/lib/ai-router.server";

const MAX_INPUT_IMAGES = 4;
const FALLBACK_IMAGE_URL = "https://eliseegpt.lovable.app/api/image";

/** Shared handler for image generation and editing. No app credits or payment system is used. */
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
    ? body.images.filter((value): value is string => typeof value === "string" && value.startsWith("data:image/")).slice(0, MAX_INPUT_IMAGES)
    : [];
  if (options.edit && images.length === 0) {
    return Response.json({ error: "Ajoutez au moins une image à modifier." }, { status: 400 });
  }

  const hasProviderKey = ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "GOOGLE_AI_API_KEY"].some((key) => {
    const value = process.env[key];
    return typeof value === "string" && value.trim().length > 0;
  });

  // The old hosted service supports keyless image generation. It only accepts a
  // prompt, so never silently pretend it can edit an uploaded image.
  if (!hasProviderKey) {
    if (options.edit || images.length > 0) {
      return Response.json({ error: "La modification d’image nécessite actuellement un moteur d’édition configuré." }, { status: 503 });
    }
    if (request.headers.get("X-Elisee-Proxy") === "1") {
      return Response.json({ error: "Service de génération indisponible." }, { status: 503 });
    }
    try {
      return await fetch(FALLBACK_IMAGE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Elisee-Proxy": "1" },
        body: JSON.stringify({ prompt }),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      console.error("[image] keyless fallback failed", error);
      return Response.json({ error: "La génération d’image est momentanément indisponible." }, { status: 503 });
    }
  }

  try {
    const result = await createImage(prompt, images);
    return Response.json({ imageUrl: result.dataUrl, provider: result.provider }, { headers: { "X-AI-Provider": result.provider } });
  } catch (error) {
    if (error instanceof AllProvidersFailedError) {
      console.error("[image] all providers failed", error.attempts);
      if (!options.edit && images.length === 0 && request.headers.get("X-Elisee-Proxy") !== "1") {
        try {
          return await fetch(FALLBACK_IMAGE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Elisee-Proxy": "1" },
            body: JSON.stringify({ prompt }),
            signal: AbortSignal.timeout(180_000),
          });
        } catch (fallbackError) {
          console.error("[image] hosted fallback failed", fallbackError);
        }
      }
      return Response.json({ error: "Aucun service d’image n’est disponible actuellement." }, { status: 503 });
    }
    console.error("[image] unexpected error", error);
    return Response.json({ error: "La génération d’image a échoué." }, { status: 502 });
  }
}
