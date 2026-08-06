import { createFileRoute } from "@tanstack/react-router";
import { createOpenAI } from "@ai-sdk/openai";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

import {
  createRunIdFetch,
  getRunIdFromRequest,
  runIdResponseHeaders,
} from "@/lib/ai-gateway.server";

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
        const body = (await request.json()) as { messages?: unknown };
        if (!Array.isArray(body.messages)) {
          return new Response("Messages requis", { status: 400 });
        }

        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) {
          return new Response("LOVABLE_API_KEY manquante", { status: 500 });
        }

        const initialRunId = getRunIdFromRequest(request);
        const runIdFetch = createRunIdFetch(initialRunId);
        const lovable = createOpenAI({
          baseURL: "https://ai.gateway.lovable.dev/v1",
          apiKey,
          headers: {
            "Lovable-API-Key": apiKey,
            "X-Lovable-AIG-SDK": "vercel-ai-sdk",
          },
          fetch: runIdFetch.fetch as unknown as typeof fetch,
        });

        const messages = body.messages as UIMessage[];
        const result = streamText({
          model: lovable.responses("openai/gpt-5.6-sol"),
          system: SYSTEM_PROMPT,
          messages: await convertToModelMessages(messages),
          providerOptions: {
            openai: {
              forceReasoning: true,
              reasoningEffort: "low",
              reasoningSummary: "auto",
              store: false,
              include: ["reasoning.encrypted_content"],
            },
          },
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages,
          sendReasoning: true,
          headers: runIdResponseHeaders(initialRunId),
        });
      },
    },
  },
});
