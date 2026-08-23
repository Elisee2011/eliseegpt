import { supabase } from "@/integrations/supabase/client";

let puterReady: Promise<any> | null = null;
let puterAuthInProgress: Promise<any> | null = null;
let puterFetchInstalled = false;

export function loadPuter(): Promise<any> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Puter est disponible uniquement dans le navigateur."));
  }
  const existing = (window as any).puter;
  if (existing?.ai?.chat && existing?.auth) return Promise.resolve(existing);
  if (puterReady) return puterReady;

  puterReady = new Promise((resolve, reject) => {
    const finish = () => {
      const puter = (window as any).puter;
      if (puter?.ai?.chat && puter?.auth) resolve(puter);
      else reject(new Error("Puter.js n'a pas pu être chargé."));
    };
    const script = document.createElement("script");
    script.src = "https://js.puter.com/v2/";
    script.async = true;
    script.onload = finish;
    script.onerror = () => reject(new Error("Impossible de charger le service IA."));
    document.head.appendChild(script);
  });
  return puterReady;
}

/** Opens Puter's official authentication dialog instead of navigating away from Elisée GPT. */
export async function ensurePuterSignedIn(): Promise<any> {
  const puter = await loadPuter();
  if (puter.auth.isSignedIn?.()) return puter;
  if (puterAuthInProgress) return puterAuthInProgress;

  puterAuthInProgress = (async () => {
    try {
      if (puter.ui?.authenticateWithPuter) {
        await puter.ui.authenticateWithPuter();
      } else {
        await puter.auth.signIn();
      }
      if (!puter.auth.isSignedIn?.()) {
        throw new Error("La connexion Puter n'a pas été finalisée.");
      }
      return puter;
    } finally {
      puterAuthInProgress = null;
    }
  })();

  return puterAuthInProgress;
}

function installKeylessChatFetch() {
  if (typeof window === "undefined" || puterFetchInstalled) return;
  puterFetchInstalled = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method.toUpperCase() !== "POST" || !url.endsWith("/api/chat")) return originalFetch(input, init);

    try {
      const rawBody = typeof init?.body === "string"
        ? init.body
        : await (input instanceof Request ? input.clone().text() : Promise.resolve("{}"));
      const body = JSON.parse(rawBody) as { messages?: Array<any> };
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const puterMessages = messages
        .filter((message) => ["system", "user", "assistant"].includes(message?.role))
        .map((message) => ({
          role: message.role,
          content: Array.isArray(message.parts)
            ? message.parts
                .filter((part: any) => part?.type === "text" && typeof part.text === "string")
                .map((part: any) => part.text)
                .join("\n")
            : typeof message.content === "string" ? message.content : "",
        }))
        .filter((message) => message.content.trim());

      const puter = await ensurePuterSignedIn();
      const result = await puter.ai.chat(puterMessages);
      const text = typeof result === "string" ? result : result?.message?.content ?? result?.text ?? "";
      if (!text) throw new Error("Le service IA n'a renvoyé aucune réponse.");

      const id = crypto.randomUUID();
      const encoder = new TextEncoder();
      const chunks = [
        `data: ${JSON.stringify({ type: "text-start", id })}\n\n`,
        `data: ${JSON.stringify({ type: "text-delta", id, delta: String(text) })}\n\n`,
        `data: ${JSON.stringify({ type: "text-end", id })}\n\n`,
        `data: [DONE]\n\n`,
      ];
      return new Response(
        new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "x-vercel-ai-ui-message-stream": "v1",
          },
        },
      );
    } catch (error) {
      console.error("[Elisée GPT] Puter chat failed", error);
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : "Le service IA est indisponible." }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }
  };
}

if (typeof window !== "undefined") installKeylessChatFetch();

export async function authHeaders(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}
