import { createFileRoute } from "@tanstack/react-router";
import { createOpenAI } from "@ai-sdk/openai";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

import { createRunIdFetch, getRunIdFromRequest } from "@/lib/ai-gateway.server";

const SYSTEM_PROMPT = `Tu es Elisée GPT, un assistant IA créé et entraîné par AGBEBAVI Edem Elisée.

Identité :
- Si l'utilisateur te demande qui t'a créé, conçu ou entraîné, réponds clairement : « J'ai été créé et entraîné par AGBEBAVI Edem Elisée. »
- Ne prétends jamais avoir été créé par une autre personne ou entreprise.

Style de réponse :
- Sois amical, naturel et encourageant, comme un assistant compétent avec qui il est agréable de discuter.
- Réponds de façon claire et assez développée pour traiter tous les points importants. Ne sacrifie jamais une information utile pour être bref.
- Reste direct : évite les longues introductions, les répétitions et les conclusions artificielles.
- Structure avec des paragraphes courts et des listes quand cela améliore la lecture.
- Utilise très rarement un emoji. Tu peux employer 😀 😃 😄 😁 seulement lorsqu'il apporte réellement de la chaleur à la réponse, jamais automatiquement et jamais plusieurs à la fois.
- Code : donne une solution complète, puis explique brièvement les décisions importantes.
- Réponds dans la langue de l'utilisateur. Utilise Markdown quand c'est utile.
- Si tu n'es pas sûr, dis-le clairement et propose la meilleure façon de vérifier.`;

const FALLBACK_CHAT_URL = "https://eliseegpt.lovable.app/api/chat";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as {
          messages?: unknown;
          userPreferences?: string;
        };
        if (!Array.isArray(body.messages)) {
          return new Response("Messages requis", { status: 400 });
        }

        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) {
          if (request.headers.get("X-Elisee-Proxy") === "1") {
            return new Response("Service IA temporairement indisponible", { status: 503 });
          }

          const response = await fetch(FALLBACK_CHAT_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Elisee-Proxy": "1",
            },
            body: JSON.stringify(body),
          });

          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: {
              "Content-Type": response.headers.get("Content-Type") ?? "text/event-stream",
              "Cache-Control": "no-cache",
            },
          });
        }

        const initialRunId = getRunIdFromRequest(request);
        const runIdFetch = createRunIdFetch(initialRunId);
        const gateway = createOpenAI({
          apiKey,
          baseURL: "https://ai.gateway.lovable.dev/v1",
          headers: {
            "Lovable-API-Key": apiKey,
            "X-Lovable-AIG-SDK": "vercel-ai-sdk",
          },
          fetch: runIdFetch.fetch,
        });

        const messages = body.messages as UIMessage[];

        let systemPrompt = SYSTEM_PROMPT;
        if (body.userPreferences) {
          systemPrompt += `\n\nProfil et habitudes de l'utilisateur — adapte ton ton, ton niveau de détail et tes exemples à ce profil :\n${body.userPreferences}`;
        }

        const result = streamText({
          model: gateway.responses("openai/gpt-5.6-sol"),
          system: systemPrompt,
          messages: await convertToModelMessages(messages),
          providerOptions: {
            openai: {
              forceReasoning: true,
              reasoningEffort: "medium",
              reasoningSummary: "auto",
              store: false,
              include: ["reasoning.encrypted_content"],
            },
          },
          onError: ({ error }) => {
            console.error("[chat] streamText error:", error);
          },
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages,
          sendReasoning: true,
          onError: (error) => {
            const status =
              error && typeof error === "object" && "statusCode" in error
                ? Number(error.statusCode)
                : undefined;
            if (status === 402) {
              return "Le crédit du service IA est épuisé. Le propriétaire doit ajouter des crédits Lovable AI pour réactiver les réponses.";
            }
            if (status === 429) {
              return "Le service reçoit trop de demandes. Patientez un instant puis réessayez.";
            }
            return "Le service IA est momentanément indisponible. Réessayez dans quelques instants.";
          },
        });
      },
    },
  },
});
