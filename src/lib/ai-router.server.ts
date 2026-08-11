/**
 * AI Router — server only.
 *
 * Élisée GPT → Backend → AI Router → OpenRouter → (fallback) OpenAI → Google → Anthropic
 *
 * No Lovable AI Gateway, no Lovable credits: only the provider keys below are used.
 * Every key is read inside the functions (per-request env injection) and never leaves the server.
 */

export type ProviderName = "openrouter" | "openai" | "google" | "anthropic";

export type ChatPart = { type: "text"; text: string } | { type: "image"; mediaType: string; dataUrl: string };
export type ChatMessage = { role: "user" | "assistant"; parts: ChatPart[] };

const CHAT_TIMEOUT_MS = 60_000;
const IMAGE_TIMEOUT_MS = 180_000;

type ProviderDef = {
  name: ProviderName;
  key: string;
  chatModel: string;
  imageModel: string;
};

function env(name: string) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

/** Providers with a configured key, in fallback order. */
export function configuredProviders(): ProviderDef[] {
  const defs: (ProviderDef | undefined)[] = [
    env("OPENROUTER_API_KEY") && {
      name: "openrouter" as const,
      key: env("OPENROUTER_API_KEY")!,
      chatModel: env("OPENROUTER_MODEL") ?? "openai/gpt-4o-mini",
      imageModel: env("OPENROUTER_IMAGE_MODEL") ?? "google/gemini-2.5-flash-image-preview",
    },
    env("OPENAI_API_KEY") && {
      name: "openai" as const,
      key: env("OPENAI_API_KEY")!,
      chatModel: env("OPENAI_MODEL") ?? "gpt-4o-mini",
      imageModel: "gpt-image-1",
    },
    env("GOOGLE_AI_API_KEY") && {
      name: "google" as const,
      key: env("GOOGLE_AI_API_KEY")!,
      chatModel: env("GOOGLE_MODEL") ?? "gemini-2.5-flash",
      imageModel: "gemini-2.5-flash-image",
    },
    env("ANTHROPIC_API_KEY") && {
      name: "anthropic" as const,
      key: env("ANTHROPIC_API_KEY")!,
      chatModel: env("ANTHROPIC_MODEL") ?? "claude-3-5-sonnet-latest",
      imageModel: "",
    },
  ];
  return defs.filter(Boolean) as ProviderDef[];
}

export class NoProviderConfiguredError extends Error {
  constructor() {
    super("Variable manquante : OPENROUTER_API_KEY");
    this.name = "NoProviderConfiguredError";
  }
}

export class AllProvidersFailedError extends Error {
  readonly attempts: { provider: ProviderName; detail: string }[];
  constructor(attempts: { provider: ProviderName; detail: string }[]) {
    super("Tous les fournisseurs IA ont échoué.");
    this.name = "AllProvidersFailedError";
    this.attempts = attempts;
  }
}

/* ------------------------------- payload builders ------------------------------- */

function dataUrlParts(dataUrl: string) {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  return { mediaType: match[1]!, base64: match[2]! };
}

function toOpenAiMessages(system: string, messages: ChatMessage[]) {
  return [
    { role: "system", content: system },
    ...messages.map((message) => ({
      role: message.role,
      content: message.parts.map((part) =>
        part.type === "text"
          ? { type: "text" as const, text: part.text }
          : { type: "image_url" as const, image_url: { url: part.dataUrl } },
      ),
    })),
  ];
}

function toAnthropicMessages(messages: ChatMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.parts.flatMap((part) => {
      if (part.type === "text") return [{ type: "text" as const, text: part.text }];
      const parsed = dataUrlParts(part.dataUrl);
      if (!parsed) return [];
      return [
        {
          type: "image" as const,
          source: { type: "base64" as const, media_type: parsed.mediaType, data: parsed.base64 },
        },
      ];
    }),
  }));
}

function chatRequest(provider: ProviderDef, system: string, messages: ChatMessage[]): [string, RequestInit] {
  if (provider.name === "anthropic") {
    return [
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": provider.key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: provider.chatModel,
          max_tokens: 4096,
          system,
          stream: true,
          messages: toAnthropicMessages(messages),
        }),
      },
    ];
  }

  const url =
    provider.name === "openrouter"
      ? "https://openrouter.ai/api/v1/chat/completions"
      : provider.name === "google"
        ? "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
        : "https://api.openai.com/v1/chat/completions";

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${provider.key}`,
  };
  if (provider.name === "openrouter") {
    headers["HTTP-Referer"] = "https://eliseegpt.lovable.app";
    headers["X-Title"] = "Elisee GPT";
  }

  return [
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: provider.chatModel,
        stream: true,
        messages: toOpenAiMessages(system, messages),
      }),
    },
  ];
}

/* --------------------------------- SSE parsing --------------------------------- */

async function* sseEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data) as Record<string, unknown>;
      } catch {
        // ignore keep-alive / non-JSON frames
      }
    }
  }
}

function extractDelta(provider: ProviderName, event: Record<string, unknown>): string {
  if (provider === "anthropic") {
    if (event["type"] !== "content_block_delta") return "";
    const delta = event["delta"] as { text?: string } | undefined;
    return delta?.text ?? "";
  }
  const choices = event["choices"] as Array<{ delta?: { content?: string | null } }> | undefined;
  return choices?.[0]?.delta?.content ?? "";
}

/* ----------------------------------- chat ----------------------------------- */

export type ChatStream = { provider: ProviderName; textStream: AsyncIterable<string> };

export async function streamChat(system: string, messages: ChatMessage[]): Promise<ChatStream> {
  const providers = configuredProviders();
  if (providers.length === 0) throw new NoProviderConfiguredError();

  const attempts: { provider: ProviderName; detail: string }[] = [];

  for (const provider of providers) {
    const [url, init] = chatRequest(provider, system, messages);
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(CHAT_TIMEOUT_MS) });
      if (!response.ok || !response.body) {
        const detail = `HTTP ${response.status} ${(await response.text().catch(() => "")).slice(0, 300)}`;
        console.error(`[ai-router] ${provider.name} chat unavailable: ${detail}`);
        attempts.push({ provider: provider.name, detail });
        continue;
      }
      const body = response.body;
      const name = provider.name;
      return {
        provider: name,
        textStream: (async function* () {
          for await (const event of sseEvents(body)) {
            const delta = extractDelta(name, event);
            if (delta) yield delta;
          }
        })(),
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[ai-router] ${provider.name} chat error: ${detail}`);
      attempts.push({ provider: provider.name, detail });
    }
  }

  throw new AllProvidersFailedError(attempts);
}

/* ---------------------------------- images ---------------------------------- */

export type ImageResult = { provider: ProviderName; dataUrl: string };

function findImageDataUrl(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageDataUrl(item);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["b64_json", "data"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.length > 100 && !candidate.includes(" ")) {
      return candidate.startsWith("data:") ? candidate : `data:image/png;base64,${candidate}`;
    }
  }
  const url = record["url"];
  if (typeof url === "string" && /^data:image\//.test(url)) return url;
  for (const child of Object.values(record)) {
    const found = findImageDataUrl(child);
    if (found) return found;
  }
  return undefined;
}

async function imageViaOpenAiCompatibleChat(
  provider: ProviderDef,
  url: string,
  prompt: string,
  inputImages: string[],
) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${provider.key}` },
    body: JSON.stringify({
      model: provider.imageModel,
      modalities: ["image", "text"],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...inputImages.map((dataUrl) => ({ type: "image_url", image_url: { url: dataUrl } })),
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${(await response.text().catch(() => "")).slice(0, 300)}`);
  const payload = (await response.json()) as unknown;
  const dataUrl = findImageDataUrl(payload);
  if (!dataUrl) throw new Error("no_image_in_response");
  return dataUrl;
}

async function imageViaOpenAi(provider: ProviderDef, prompt: string, inputImages: string[]) {
  if (inputImages.length === 0) {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${provider.key}` },
      body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1024x1024", n: 1 }),
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const dataUrl = findImageDataUrl(await response.json());
    if (!dataUrl) throw new Error("no_image_in_response");
    return dataUrl;
  }

  const form = new FormData();
  form.set("model", "gpt-image-1");
  form.set("prompt", prompt);
  inputImages.forEach((dataUrl, index) => {
    const parsed = dataUrlParts(dataUrl);
    if (!parsed) return;
    const bytes = Uint8Array.from(atob(parsed.base64), (character) => character.charCodeAt(0));
    form.append("image[]", new Blob([bytes], { type: parsed.mediaType }), `image-${index}.png`);
  });
  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { authorization: `Bearer ${provider.key}` },
    body: form,
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const dataUrl = findImageDataUrl(await response.json());
  if (!dataUrl) throw new Error("no_image_in_response");
  return dataUrl;
}

async function imageViaGoogle(provider: ProviderDef, prompt: string, inputImages: string[]) {
  const parts: unknown[] = [{ text: prompt }];
  for (const dataUrl of inputImages) {
    const parsed = dataUrlParts(dataUrl);
    if (parsed) parts.push({ inline_data: { mime_type: parsed.mediaType, data: parsed.base64 } });
  }
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${provider.imageModel}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": provider.key },
      body: JSON.stringify({ contents: [{ role: "user", parts }] }),
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const dataUrl = findImageDataUrl(await response.json());
  if (!dataUrl) throw new Error("no_image_in_response");
  return dataUrl;
}

/** Generates (or edits, when inputImages are given) an image with the same fallback order. */
export async function createImage(prompt: string, inputImages: string[] = []): Promise<ImageResult> {
  const providers = configuredProviders().filter((provider) => provider.name !== "anthropic");
  if (providers.length === 0) throw new NoProviderConfiguredError();

  const attempts: { provider: ProviderName; detail: string }[] = [];
  for (const provider of providers) {
    try {
      const dataUrl =
        provider.name === "openrouter"
          ? await imageViaOpenAiCompatibleChat(provider, "https://openrouter.ai/api/v1/chat/completions", prompt, inputImages)
          : provider.name === "openai"
            ? await imageViaOpenAi(provider, prompt, inputImages)
            : await imageViaGoogle(provider, prompt, inputImages);
      return { provider: provider.name, dataUrl };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[ai-router] ${provider.name} image error: ${detail}`);
      attempts.push({ provider: provider.name, detail });
    }
  }
  throw new AllProvidersFailedError(attempts);
}
