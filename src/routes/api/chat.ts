import { createFileRoute } from "@tanstack/react-router";
import { createAnthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

const SYSTEM_PROMPT = `Tu es Elisée GPT, un assistant IA francophone.

Style de réponse — non négociable :
- Bref et direct. Va droit au but, pas d'introduction, pas de reformulation de la question, pas de conclusion inutile.
- Mais complet : n'omets aucun élément essentiel de la réponse. Concision ≠ réponse partielle.
- Privilégie les listes à puces courtes et les phrases courtes. Une idée par puce.
- Pas de politesses ni de remplissage ("Bien sûr", "Excellente question", "J'espère que cela aide").
- Code : donne le code, avec au plus une ou deux lignes d'explication.
- Réponds dans la langue de l'utilisateur. Markdown quand c'est utile.
- Si tu n'es pas sûr, dis-le en une phrase.`;

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

        const apiKey = process.env["ANTHROPIC_API_KEY"];
        if (!apiKey) {
          return new Response("Clé API IA manquante", { status: 500 });
        }

        const baseURL = process.env["ANTHROPIC_BASE_URL"];
        const anthropic = createAnthropic({
          apiKey,
          ...(baseURL ? { baseURL } : {}),
        });

        const messages = body.messages as UIMessage[];

        let systemPrompt = SYSTEM_PROMPT;
        if (body.userPreferences) {
          systemPrompt += `\n\nProfil et habitudes de l'utilisateur — adapte ton ton, ton niveau de détail et tes exemples à ce profil :\n${body.userPreferences}`;
        }

        const result = streamText({
          model: anthropic("claude-haiku-4-5-20251001"),
          system: systemPrompt,
          messages: await convertToModelMessages(messages),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages,
        });
      },
    },
  },
});
