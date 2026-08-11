import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/image/edit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleImageRequest } = await import("@/lib/image-endpoint.server");
        return handleImageRequest(request, { edit: true });
      },
    },
  },
});
