import { createFileRoute } from "@tanstack/react-router";

import { ChatApp } from "@/components/chat/chat-app";

export const Route = createFileRoute("/c/$conversationId")({
  head: () => ({
    meta: [
      { title: "Discussion — Lumen" },
      { name: "description", content: "Votre discussion sauvegardée avec l'assistant IA Lumen." },
      { property: "og:title", content: "Discussion — Lumen" },
      { property: "og:description", content: "Votre discussion sauvegardée avec l'assistant IA Lumen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ConversationPage,
});

function ConversationPage() {
  const { conversationId } = Route.useParams();
  return <ChatApp conversationId={conversationId} />;
}
