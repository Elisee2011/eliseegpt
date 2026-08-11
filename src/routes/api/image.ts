import { createFileRoute } from "@tanstack/react-router";

import { AllProvidersFailedError, NoProviderConfiguredError, createImage } from "@/lib/ai-router.server";
import { CREDIT_COST } from "@/lib/credit-packs";
import { InsufficientCreditsError, getUserFromRequest, refundCredits, spendCredits } from "@/lib/credits.server";

export const Route = createFileRoute("/api/image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleImageRequest } = await import("@/lib/image-endpoint.server");
        return handleImageRequest(request, { edit: false });
      },
    },
  },
});

// Re-exported helpers keep the bundle graph small; see src/lib/image-endpoint.server.ts
void createImage;
void AllProvidersFailedError;
void NoProviderConfiguredError;
void CREDIT_COST;
void InsufficientCreditsError;
void getUserFromRequest;
void refundCredits;
void spendCredits;
