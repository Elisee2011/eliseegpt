import { createFileRoute } from "@tanstack/react-router";

/**
 * Diagnostic endpoint: tells which AI engines are reachable from the current
 * deployment (Lovable, Vercel, …) without ever exposing a key value.
 */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const keys = [
          "OPENROUTER_API_KEY",
          "OPENAI_API_KEY",
          "GOOGLE_AI_API_KEY",
          "ANTHROPIC_API_KEY",
          "LOVABLE_API_KEY",
        ];
        const configured = keys.filter((key) => {
          const value = process.env[key];
          return typeof value === "string" && value.trim().length > 0;
        });

        return Response.json({
          ok: true,
          runtime: process.env["VERCEL"] ? "vercel" : "other",
          chatEngines: configured.filter((key) => key !== "LOVABLE_API_KEY"),
          imageEngines: configured,
          hostedFallback: configured.length === 0,
          supabaseConfigured: Boolean(
            process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"],
          ),
        });
      },
    },
  },
});
