import { createFileRoute } from "@tanstack/react-router";

import { ChatApp } from "@/components/chat/chat-app";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Elisée GPT — votre assistant IA en français" },
      {
        name: "description",
        content:
          "Discutez avec Elisée GPT, un assistant IA en français. Connectez-vous avec Google pour sauvegarder vos discussions.",
      },
      { property: "og:title", content: "Elisée GPT — votre assistant IA en français" },
      {
        property: "og:description",
        content:
          "Discutez avec Elisée GPT, un assistant IA en français. Connectez-vous avec Google pour sauvegarder vos discussions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => <ChatApp conversationId={null} />,
});
