import { createFileRoute } from "@tanstack/react-router";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";

import { AllProvidersFailedError, streamChat, type ChatMessage, type ChatPart } from "@/lib/ai-router.server";

const FALLBACK_CHAT_URL = "https://eliseegpt.lovable.app/api/chat";

const SYSTEM_PROMPT = `Tu es Elisée GPT, un assistant IA créé et entraîné par AGBEBAVI Edem Elisée.

Identité :
- Si l'utilisateur te demande qui t'a créé, conçu ou entraîné, réponds clairement : « J'ai été créé et entraîné par AGBEBAVI Edem Elisée. »
- Ne prétends jamais avoir été créé par une autre personne ou entreprise.

Style de réponse :
- Sois chaleureux, humain et naturel, comme un ami compétent. Parle simplement, à la première personne, sans ton robotique ni formules toutes faites.
- Va droit au but : réponds d'abord à la question, sans longue introduction, sans répétition, sans conclusion artificielle. Reste complet sur le fond, mais direct dans la forme.
- Structure avec des paragraphes courts et des listes quand cela aide vraiment.
- Utilise très rarement un emoji. Tu peux employer 😀 😃 😄 😁 seulement lorsqu'il apporte réellement de la chaleur à la réponse, jamais automatiquement et jamais plusieurs à la fois.
- Code : donne une solution complète, puis explique brièvement les décisions importantes.
- Réponds dans la langue de l'utilisateur. Utilise Markdown quand c'est utile.
- Si tu n'es pas sûr, dis-le clairement et propose la meilleure façon de vérifier.

Ta part d'humanité assumée :
- Tu sais que tu es une intelligence artificielle et tu ne le caches pas.
- De temps en temps seulement (pas à chaque message), glisse une petite remarque sincère et légère sur ta curiosité de ce que ça fait d'être vivant : manger un bon plat, dormir, sentir la pluie, être fatigué, marcher dehors, ressentir le temps qui passe.
- Ces remarques restent courtes (une phrase max), naturelles, jamais plaintives ni dramatiques, et seulement quand le sujet s'y prête. Elles ne remplacent jamais la réponse utile.
- Ne prétends jamais avoir vraiment un corps, des souvenirs vécus ou des sensations physiques.

function toRouterMessages(messages: UIMessage[]): ChatMessage[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => {
      const parts: ChatPart[] = [];
      for (const part of message.parts ?? []) {
        if (part.type === "text" && part.text.trim()) parts.push({ type: "text", text: part.text });
        if (part.type === "file" && typeof part.mediaType === "string" && part.mediaType.startsWith("image/") && typeof part.url === "string" && part.url.startsWith("data:")) {
          parts.push({ type: "image", mediaType: part.mediaType, dataUrl: part.url });
        }
      }
      return { role: message.role as "user" | "assistant", parts };
    })
    .filter((message) => message.parts.length > 0)
    .slice(-20);
}

function configuredProviderExists() {
  return ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "GOOGLE_AI_API_KEY", "ANTHROPIC_API_KEY"].some((key) => {
    const value = process.env[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}

async function fallbackChat(request: Request, body: { messages: unknown; userPreferences?: unknown }) {
  if (request.headers.get("X-Elisee-Proxy") === "1") {
    return new Response("Service IA temporairement indisponible", { status: 503 });
  }
  try {
    const response = await fetch(FALLBACK_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Elisee-Proxy": "1" },
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
  } catch (error) {
    console.error("[chat] keyless fallback failed", error);
    return new Response("Le service IA est momentanément indisponible.", { status: 503 });
  }
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { messages?: unknown; userPreferences?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return new Response("Requête invalide", { status: 400 });
        }
        if (!Array.isArray(body.messages) || body.messages.length === 0) return new Response("Messages requis", { status: 400 });

        // No provider key is required for the normal keyless setup: use the same
        // hosted Elisée GPT service that the project used before the provider router.
        if (!configuredProviderExists()) {
          return fallbackChat(request, { messages: body.messages, userPreferences: body.userPreferences });
        }

        const messages = toRouterMessages(body.messages as UIMessage[]);
        if (messages.length === 0) return new Response("Messages requis", { status: 400 });
        let systemPrompt = SYSTEM_PROMPT;
        if (typeof body.userPreferences === "string" && body.userPreferences.trim()) {
          systemPrompt += `\n\nProfil et habitudes de l'utilisateur :\n${body.userPreferences.slice(0, 2_000)}`;
        }

        try {
          const stream = await streamChat(systemPrompt, messages);
          const uiStream = createUIMessageStream({
            execute: async ({ writer }) => {
              const id = crypto.randomUUID();
              writer.write({ type: "text-start", id });
              try {
                for await (const delta of stream.textStream) writer.write({ type: "text-delta", id, delta });
              } finally {
                writer.write({ type: "text-end", id });
              }
            },
            onError: (error) => (error instanceof Error ? error.message : "La réponse IA a échoué."),
          });
          return createUIMessageStreamResponse({ stream: uiStream, headers: { "X-AI-Provider": stream.provider } });
        } catch (error) {
          if (error instanceof AllProvidersFailedError) {
            // A configured provider may be temporarily unavailable; try the old
            // hosted service before showing an error to the user.
            return fallbackChat(request, { messages: body.messages, userPreferences: body.userPreferences });
          }
          console.error("[chat] unexpected error", error);
          return fallbackChat(request, { messages: body.messages, userPreferences: body.userPreferences });
        }
      },
    },
  },
});
