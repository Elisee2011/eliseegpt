import { createFileRoute } from "@tanstack/react-router";

const IMAGE_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/images/generations";
const FALLBACK_IMAGE_URL = "https://eliseegpt.lovable.app/api/image";

export const Route = createFileRoute("/api/image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { prompt?: unknown };
        try {
          body = (await request.json()) as { prompt?: unknown };
        } catch {
          return Response.json({ error: "Requête invalide." }, { status: 400 });
        }

        const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
        if (!prompt || prompt.length > 4_000) {
          return Response.json({ error: "Décrivez l’image à générer en moins de 4 000 caractères." }, { status: 400 });
        }

        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) {
          if (request.headers.get("X-Elisee-Proxy") === "1") {
            return Response.json({ error: "Service de génération indisponible." }, { status: 503 });
          }
          return fetch(FALLBACK_IMAGE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Elisee-Proxy": "1" },
            body: JSON.stringify({ prompt }),
          });
        }

        const upstream = await fetch(IMAGE_GATEWAY_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Lovable-API-Key": apiKey,
            "X-Lovable-AIG-SDK": "fetch",
          },
          body: JSON.stringify({
            model: "google/gemini-3-pro-image",
            prompt,
            stream: true,
          }),
        });

        if (!upstream.ok) {
          if (upstream.status === 402) {
            return Response.json(
              { error: "Le crédit du service IA est épuisé. Le propriétaire doit ajouter des crédits Lovable AI." },
              { status: 402 },
            );
          }
          if (upstream.status === 429) {
            return Response.json({ error: "Trop de demandes. Réessayez dans un instant." }, { status: 429 });
          }
          console.error("[image] gateway error", upstream.status, await upstream.text());
          return Response.json({ error: "La génération d’image a échoué. Réessayez." }, { status: 502 });
        }

        return new Response(upstream.body, {
          status: 200,
          headers: {
            "Content-Type": upstream.headers.get("Content-Type") ?? "text/event-stream",
            "Cache-Control": "no-cache",
          },
        });
      },
    },
  },
});