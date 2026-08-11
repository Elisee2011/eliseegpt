import { createFileRoute } from "@tanstack/react-router";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";

import {
  AllProvidersFailedError,
  NoProviderConfiguredError,
  streamChat,
  type ChatMessage,
  type ChatPart,
} from "@/lib/ai-router.server";
import { CREDIT_COST } from "@/lib/credit-packs";
import { InsufficientCreditsError, getUserFromRequest, refundCredits, spendCredits } from "@/lib/credits.server";

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

function toRouterMessages(messages: UIMessage[]): ChatMessage[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => {
      const parts: ChatPart[] = [];
      for (const part of message.parts ?? []) {
        if (part.type === "text" && part.text.trim()) parts.push({ type: "text", text: part.text });
        if (
          part.type === "file" &&
          typeof part.mediaType === "string" &&
          part.mediaType.startsWith("image/") &&
          typeof part.url === "string" &&
          part.url.startsWith("data:")
        ) {
          parts.push({ type: "image", mediaType: part.mediaType, dataUrl: part.url });
        }
      }
      return { role: message.role as "user" | "assistant", parts };
    })
    .filter((message) => message.parts.length > 0)
    .slice(-20);
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
        if (!Array.isArray(body.messages) || body.messages.length === 0) {
          return new Response("Messages requis", { status: 400 });
        }

        const user = await getUserFromRequest(request);
        if (!user) {
          return new Response("Connectez-vous pour discuter avec Elisée GPT.", { status: 401 });
        }

        const messages = toRouterMessages(body.messages as UIMessage[]);
        if (messages.length === 0) return new Response("Messages requis", { status: 400 });

        let systemPrompt = SYSTEM_PROMPT;
        if (typeof body.userPreferences === "string" && body.userPreferences.trim()) {
          systemPrompt += `\n\nProfil et habitudes de l'utilisateur :\n${body.userPreferences.slice(0, 2_000)}`;
        }

        // 1. Debit Élisée GPT credits (Supabase) before calling any provider.
        try {
          await spendCredits(user.id, CREDIT_COST.chat, "chat");
        } catch (error) {
          if (error instanceof InsufficientCreditsError) {
            return new Response(
              `Crédits Elisée GPT épuisés (solde : ${error.balance}). Rechargez depuis la page Crédits.`,
              { status: 402 },
            );
          }
          console.error("[chat] credit error", error);
          return new Response("Impossible de vérifier vos crédits. Réessayez.", { status: 500 });
        }

        // 2. Call the AI Router (OpenRouter first, then the configured fallbacks).
        let stream: Awaited<ReturnType<typeof streamChat>>;
        try {
          stream = await streamChat(systemPrompt, messages);
        } catch (error) {
          await refundCredits(user.id, CREDIT_COST.chat, "refund:chat");
          if (error instanceof NoProviderConfiguredError) {
            return new Response("Variable manquante : OPENROUTER_API_KEY", { status: 503 });
          }
          if (error instanceof AllProvidersFailedError) {
            console.error("[chat] all providers failed", error.attempts);
            return new Response("Aucun fournisseur IA n'est disponible actuellement. Aucun crédit n'a été débité.", {
              status: 503,
            });
          }
          console.error("[chat] unexpected error", error);
          return new Response("Le service IA est momentanément indisponible.", { status: 503 });
        }

        const uiStream = createUIMessageStream({
          execute: async ({ writer }) => {
            const id = crypto.randomUUID();
            writer.write({ type: "text-start", id });
            let received = false;
            try {
              for await (const delta of stream.textStream) {
                received = true;
                writer.write({ type: "text-delta", id, delta });
              }
            } finally {
              writer.write({ type: "text-end", id });
            }
            if (!received) {
              await refundCredits(user.id, CREDIT_COST.chat, "refund:chat-empty");
              throw new Error("La réponse IA est arrivée vide. Aucun crédit n'a été débité.");
            }
          },
          onError: (error) => (error instanceof Error ? error.message : "La réponse IA a échoué."),
        });

        return createUIMessageStreamResponse({
          stream: uiStream,
          headers: { "X-AI-Provider": stream.provider },
        });
      },
    },
  },
});
