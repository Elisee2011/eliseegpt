import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowUp, LogOut, MessageSquarePlus, PanelLeft, Paperclip, Trash2, X } from "lucide-react";
import logoMark from "@/assets/elisee-gpt-mark.png.asset.json";
import { toast } from "sonner";

import { Markdown } from "./markdown";
import { useAuth } from "@/hooks/use-auth";
import { getSupabase } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

type Conversation = {
  id: string;
  title: string;
  messages: UIMessage[];
  updatedAt: number;
};

const STORAGE_KEY = "elisee-gpt-conversations";

function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Conversation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveConversations(conversations: Conversation[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch {
    // storage full or unavailable — silently ignore
  }
}

function uid() {
  return crypto.randomUUID();
}

function textOf(message: UIMessage) {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

type Attachment = { id: string; name: string; mediaType: string; url: string };

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function imagesOf(message: UIMessage) {
  return message.parts.filter(
    (part): part is Extract<UIMessage["parts"][number], { type: "file" }> =>
      part.type === "file" && typeof part.mediaType === "string" && part.mediaType.startsWith("image/"),
  );
}

export function ChatApp({ conversationId }: { conversationId: string | null }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setConversations(loadConversations());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveConversations(conversations);
  }, [conversations, hydrated]);

  useEffect(() => {
    if (conversationId) setCollapsed(true);
  }, [conversationId]);

  const signOut = async () => {
    await getSupabase()?.auth.signOut();
    void navigate({ to: "/" });
  };

  const signIn = () => {
    void navigate({ to: "/auth" });
  };

  const createConversation = useCallback(() => {
    const id = uid();
    const conversation: Conversation = {
      id,
      title: "Nouvelle discussion",
      messages: [],
      updatedAt: Date.now(),
    };
    setConversations((prev) => [conversation, ...prev]);
    void navigate({ to: "/c/$conversationId", params: { conversationId: id } });
    return id;
  }, [navigate]);

  const deleteConversation = useCallback(
    (id: string) => {
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (id === conversationId) void navigate({ to: "/" });
    },
    [conversationId, navigate],
  );

  const updateConversation = useCallback((id: string, updater: (c: Conversation) => Conversation) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? updater(c) : c)));
  }, []);

  // Auto-create a conversation on first visit (guest mode)
  useEffect(() => {
    if (!hydrated || conversationId) return;
    if (conversations.length === 0) {
      createConversation();
    } else {
      const first = conversations[0];
      if (first) {
        void navigate({
          to: "/c/$conversationId",
          params: { conversationId: first.id },
          replace: true,
        });
      }
    }
  }, [hydrated, conversationId, conversations.length, createConversation, navigate]);

  const current = conversations.find((c) => c.id === conversationId) ?? null;

  if (!hydrated) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Chargement…
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside
        className={`hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-3 transition-[width] duration-300 ease-out md:flex ${
          collapsed ? "w-[4.5rem] items-center" : "w-72"
        }`}
      >
        <div className={`flex items-center py-3 ${collapsed ? "justify-center" : "gap-2 px-2"}`}>
          <button
            type="button"
            aria-label={collapsed ? "Déplier le menu" : "Replier le menu"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
            className="grid size-10 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            {collapsed ? (
              <img src={logoMark.url} alt="Elisée GPT" className="size-6" width={24} height={24} />
            ) : (
              <PanelLeft className="size-5" aria-hidden="true" />
            )}
          </button>
          {!collapsed && (
            <span className="truncate font-display text-lg font-semibold tracking-tight">
              Elisée GPT
            </span>
          )}
        </div>

        <Button
          variant="secondary"
          className={`mt-2 gap-2 ${collapsed ? "size-11 justify-center rounded-xl p-0" : "w-full justify-start"}`}
          onClick={() => createConversation()}
          title="Nouvelle discussion"
          aria-label="Nouvelle discussion"
        >
          <MessageSquarePlus className="size-4" aria-hidden="true" />
          {!collapsed && "Nouvelle discussion"}
        </Button>

        <div className="mt-4 w-full flex-1 space-y-1 overflow-y-auto">
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`group flex items-center gap-1 rounded-xl px-1 transition-colors ${
                conversation.id === conversationId
                  ? "bg-sidebar-accent"
                  : "hover:bg-sidebar-accent/60"
              } ${collapsed ? "justify-center" : ""}`}
            >
              <Link
                to="/c/$conversationId"
                params={{ conversationId: conversation.id }}
                title={conversation.title}
                className={`text-sm text-sidebar-foreground ${
                  collapsed
                    ? "grid size-11 place-items-center font-semibold uppercase"
                    : "flex-1 truncate px-2 py-2"
                }`}
              >
                {collapsed ? conversation.title.trim().charAt(0) || "•" : conversation.title}
              </Link>
              {!collapsed && (
                <button
                  type="button"
                  aria-label="Supprimer la discussion"
                  onClick={() => deleteConversation(conversation.id)}
                  className="rounded-lg p-2 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
          {!collapsed && conversations.length === 0 && (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              Vos discussions apparaîtront ici.
            </p>
          )}
        </div>

        <div className="w-full border-t border-sidebar-border pt-3">
          {user ? (
            <>
              {!collapsed && (
                <p className="truncate px-2 text-xs text-muted-foreground">{user.email}</p>
              )}
              <Button
                variant="ghost"
                className={`mt-1 gap-2 text-sm ${collapsed ? "size-11 justify-center p-0" : "w-full justify-start"}`}
                onClick={signOut}
                title="Se déconnecter"
                aria-label="Se déconnecter"
              >
                <LogOut className="size-4" aria-hidden="true" />
                {!collapsed && "Se déconnecter"}
              </Button>
            </>
          ) : (
            <Button
              className={`${collapsed ? "size-11 justify-center p-0" : "w-full"}`}
              onClick={signIn}
              disabled={loading}
              title="Se connecter"
              aria-label="Se connecter"
            >
              {collapsed ? <LogOut className="size-4 rotate-180" aria-hidden="true" /> : "Se connecter"}
            </Button>
          )}
        </div>
      </aside>

      <ChatWindow
        key={conversationId ?? "guest"}
        conversationId={conversationId}
        initialMessages={current?.messages ?? []}
        onMessagesChange={(messages) => {
          if (!conversationId) return;
          updateConversation(conversationId, (c) => ({
            ...c,
            messages,
            updatedAt: Date.now(),
            title:
              messages.length > 0 && c.title === "Nouvelle discussion"
                ? textOf(messages[0]!).slice(0, 60) || c.title
                : c.title,
          }));
        }}
        onSignIn={signIn}
      />
    </div>
  );
}

function ChatWindow({
  conversationId,
  initialMessages,
  onMessagesChange,
  onSignIn,
}: {
  conversationId: string | null;
  initialMessages: UIMessage[];
  onMessagesChange: (messages: UIMessage[]) => void;
  onSignIn: () => void;
}) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const onMessagesChangeRef = useRef(onMessagesChange);
  onMessagesChangeRef.current = onMessagesChange;
  const lastSyncedRef = useRef<string>("");

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
      }),
    [],
  );

  const { messages, sendMessage, status } = useChat({
    id: conversationId ?? "guest",
    messages: initialMessages,
    transport,
    onError: (error) => {
      const message = error.message.trim();
      toast.error(message || "La réponse de l'IA a échoué. Réessayez.");
    },
    onFinish: () => {
      // messages is up-to-date at this point; we sync in the effect below
    },
  });

  // Sync messages back to parent whenever they change
  useEffect(() => {
    if (messages.length === 0) return;
    const signature = JSON.stringify(messages);
    if (signature === lastSyncedRef.current) return;
    lastSyncedRef.current = signature;
    onMessagesChangeRef.current(messages);
  }, [messages]);

  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationId, status]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  const submit = () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || busy) return;
    setInput("");
    const files = attachments.map((attachment) => ({
      type: "file" as const,
      mediaType: attachment.mediaType,
      filename: attachment.name,
      url: attachment.url,
    }));
    setAttachments([]);
    void sendMessage({ text, files });
  };

  const addFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    const next: Attachment[] = [];
    for (const file of images) {
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error(`${file.name} dépasse 5 Mo.`);
        continue;
      }
      try {
        next.push({
          id: uid(),
          name: file.name || "image.png",
          mediaType: file.type,
          url: await readAsDataUrl(file),
        });
      } catch {
        toast.error(`Impossible de lire ${file.name}.`);
      }
    }
    if (next.length > 0) setAttachments((prev) => [...prev, ...next].slice(0, 6));
  };

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2 md:hidden">
          <img src={logoMark.url} alt="Elisée GPT" className="size-6" width={24} height={24} />
          <span className="font-display font-semibold">Elisée GPT</span>
        </div>
        <p className="ml-auto text-xs text-muted-foreground">
          Discussions sauvegardées sur cet appareil
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto w-full max-w-3xl space-y-6">
          {messages.length === 0 && (
            <div className="pt-16 text-center">
              <h1 className="text-3xl font-semibold">Comment puis-je vous aider ?</h1>
              <p className="mt-3 text-sm text-muted-foreground">
                Posez une question, demandez un résumé, du code, une idée…
              </p>
              {!conversationId && (
                <button
                  type="button"
                  onClick={onSignIn}
                  className="mt-5 text-sm text-primary underline underline-offset-4"
                >
                  Se connecter pour synchroniser vos discussions
                </button>
              )}
            </div>
          )}

          {messages.map((message) => {
            const text = textOf(message);
            const images = imagesOf(message);

            if (message.role === "user") {
              return (
                <div key={message.id} className="flex flex-col items-end gap-2">
                  {images.length > 0 && (
                    <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
                      {images.map((image, index) => (
                        <img
                          key={`${message.id}-img-${index}`}
                          src={image.url}
                          alt={image.filename ?? "Image envoyée"}
                          className="max-h-64 rounded-2xl border border-border object-cover"
                        />
                      ))}
                    </div>
                  )}
                  {text && (
                    <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-user-bubble px-4 py-3 text-user-bubble-foreground">
                      {text}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div key={message.id} className="space-y-2">
                {text && <Markdown>{text}</Markdown>}
              </div>
            );
          })}

          {status === "submitted" && (
            <div className="flex gap-1.5 pl-1">
              <span className="size-2 animate-bounce rounded-full bg-primary [animation-delay:-0.2s]" />
              <span className="size-2 animate-bounce rounded-full bg-primary [animation-delay:-0.1s]" />
              <span className="size-2 animate-bounce rounded-full bg-primary" />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="px-4 pb-6">
        <form
          className="mx-auto flex w-full max-w-3xl flex-col gap-2 rounded-3xl border border-border bg-card p-2 shadow-lg"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void addFiles(event.dataTransfer?.files ?? null);
          }}
        >
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-2 pt-1">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="relative">
                  <img
                    src={attachment.url}
                    alt={attachment.name}
                    className="size-16 rounded-xl border border-border object-cover"
                  />
                  <button
                    type="button"
                    aria-label={`Retirer ${attachment.name}`}
                    onClick={() =>
                      setAttachments((prev) => prev.filter((item) => item.id !== attachment.id))
                    }
                    className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-background text-muted-foreground shadow ring-1 ring-border hover:text-destructive"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              void addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 shrink-0 rounded-full"
            onClick={() => fileInputRef.current?.click()}
            title="Ajouter une image"
            aria-label="Ajouter une image"
          >
            <Paperclip className="size-4" aria-hidden="true" />
          </Button>
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            onChange={(event) => setInput(event.target.value)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData?.files ?? []);
              if (files.some((file) => file.type.startsWith("image/"))) {
                event.preventDefault();
                void addFiles(files);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Écrivez votre message…"
            className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button
            type="submit"
            size="icon"
            className="size-10 shrink-0 rounded-full"
            disabled={busy || (!input.trim() && attachments.length === 0)}
          >
            <ArrowUp className="size-4" />
          </Button>
          </div>
        </form>
      </div>
    </main>
  );
}
