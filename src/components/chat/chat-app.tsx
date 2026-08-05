import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, LogOut, MessageSquarePlus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Markdown } from "./markdown";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";

type ConversationRow = { id: string; title: string; updated_at: string };

function textOf(message: UIMessage) {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

function toUIMessage(row: { id: string; role: string; content: string }): UIMessage {
  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    parts: [{ type: "text", text: row.content }],
  };
}

export function ChatApp({ conversationId }: { conversationId: string | null }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const conversations = useQuery({
    queryKey: ["conversations", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, title, updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ConversationRow[];
    },
  });

  const history = useQuery({
    queryKey: ["messages", conversationId],
    enabled: !!user && !!conversationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, role, content")
        .eq("conversation_id", conversationId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map(toUIMessage);
    },
  });

  const createConversation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Non connecté");
      const { data, error } = await supabase
        .from("conversations")
        .insert({ user_id: user.id })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      void queryClient.invalidateQueries({ queryKey: ["conversations", user?.id] });
      void navigate({ to: "/c/$conversationId", params: { conversationId: id } });
    },
    onError: () => toast.error("Impossible de créer la discussion"),
  });

  const deleteConversation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("conversations").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      void queryClient.invalidateQueries({ queryKey: ["conversations", user?.id] });
      if (id === conversationId) void navigate({ to: "/" });
    },
    onError: () => toast.error("Suppression impossible"),
  });

  const signIn = async () => {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("Connexion Google impossible");
      return;
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    void queryClient.clear();
    void navigate({ to: "/" });
  };

  const ready = !conversationId || !user || history.isSuccess;

  // Signed-in users always work inside a saved conversation: reuse the newest
  // empty one, otherwise create a fresh one.
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (conversationId || !user || bootstrapped.current || !conversations.isSuccess) return;
    bootstrapped.current = true;
    void (async () => {
      const newest = conversations.data[0];
      if (newest) {
        const { count } = await supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", newest.id);
        if (!count) {
          void navigate({
            to: "/c/$conversationId",
            params: { conversationId: newest.id },
            replace: true,
          });
          return;
        }
      }
      createConversation.mutate();
    })();
  }, [conversationId, user, conversations.isSuccess, conversations.data, navigate, createConversation]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-3 md:flex">
        <div className="flex items-center gap-2 px-2 py-3">
          <Sparkles className="size-5 text-primary" />
          <span className="font-display text-lg font-semibold tracking-tight">Lumen</span>
        </div>

        {user ? (
          <>
            <Button
              variant="secondary"
              className="mt-2 w-full justify-start gap-2"
              onClick={() => createConversation.mutate()}
              disabled={createConversation.isPending}
            >
              <MessageSquarePlus className="size-4" />
              Nouvelle discussion
            </Button>

            <div className="mt-4 flex-1 space-y-1 overflow-y-auto">
              {(conversations.data ?? []).map((conversation) => (
                <div
                  key={conversation.id}
                  className={`group flex items-center gap-1 rounded-xl px-1 transition-colors ${
                    conversation.id === conversationId
                      ? "bg-sidebar-accent"
                      : "hover:bg-sidebar-accent/60"
                  }`}
                >
                  <Link
                    to="/c/$conversationId"
                    params={{ conversationId: conversation.id }}
                    className="flex-1 truncate px-2 py-2 text-sm text-sidebar-foreground"
                  >
                    {conversation.title}
                  </Link>
                  <button
                    type="button"
                    aria-label="Supprimer la discussion"
                    onClick={() => deleteConversation.mutate(conversation.id)}
                    className="rounded-lg p-2 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
              {conversations.isSuccess && conversations.data.length === 0 && (
                <p className="px-2 py-4 text-xs text-muted-foreground">
                  Vos discussions sauvegardées apparaîtront ici.
                </p>
              )}
            </div>

            <div className="border-t border-sidebar-border pt-3">
              <p className="truncate px-2 text-xs text-muted-foreground">{user.email}</p>
              <Button
                variant="ghost"
                className="mt-1 w-full justify-start gap-2 text-sm"
                onClick={signOut}
              >
                <LogOut className="size-4" />
                Se déconnecter
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-4 flex flex-1 flex-col justify-between">
            <p className="px-2 text-sm leading-relaxed text-muted-foreground">
              Connectez-vous avec Google pour sauvegarder vos discussions. Sans compte, rien
              n&apos;est enregistré.
            </p>
            <Button className="w-full" onClick={signIn} disabled={loading}>
              Continuer avec Google
            </Button>
          </div>
        )}
      </aside>

      {ready ? (
        <ChatWindow
          key={conversationId ?? "guest"}
          conversationId={conversationId}
          userId={user?.id ?? null}
          initialMessages={history.data ?? []}
          onPersisted={() => {
            void queryClient.invalidateQueries({ queryKey: ["conversations", user?.id] });
          }}
          onSignIn={signIn}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Chargement…
        </div>
      )}
    </div>
  );
}

function ChatWindow({
  conversationId,
  userId,
  initialMessages,
  onPersisted,
  onSignIn,
}: {
  conversationId: string | null;
  userId: string | null;
  initialMessages: UIMessage[];
  onPersisted: () => void;
  onSignIn: () => void;
}) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);

  const saves = useRef(false);
  const persists = !!conversationId && !!userId;

  const { messages, sendMessage, status } = useChat({
    id: conversationId ?? "guest",
    messages: initialMessages,
    transport,
    onError: () => toast.error("La réponse de l'IA a échoué. Réessayez."),
    onFinish: ({ message }) => {
      if (!persists) return;
      const content = textOf(message);
      if (!content) return;
      void supabase
        .from("messages")
        .insert({
          conversation_id: conversationId!,
          user_id: userId!,
          role: "assistant",
          content,
        })
        .then(({ error }) => {
          if (error) toast.error("La réponse n'a pas pu être sauvegardée");
          else onPersisted();
        });
    },
  });

  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationId, status]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  const submit = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void sendMessage({ text });

    if (!persists) return;
    const { error } = await supabase
      .from("messages")
      .insert({ conversation_id: conversationId!, user_id: userId!, role: "user", content: text });
    if (error) {
      toast.error("Votre message n'a pas pu être sauvegardé");
      return;
    }
    if (!saves.current && messages.length === 0) {
      saves.current = true;
      await supabase
        .from("conversations")
        .update({ title: text.slice(0, 60) })
        .eq("id", conversationId!);
    }
    onPersisted();
  };

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2 md:hidden">
          <Sparkles className="size-4 text-primary" />
          <span className="font-display font-semibold">Lumen</span>
        </div>
        <p className="ml-auto text-xs text-muted-foreground">
          {persists ? "Discussion sauvegardée sur votre compte" : "Mode invité — rien n'est sauvegardé"}
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
              {!persists && (
                <button
                  type="button"
                  onClick={onSignIn}
                  className="mt-5 text-sm text-primary underline underline-offset-4"
                >
                  Se connecter avec Google pour garder l&apos;historique
                </button>
              )}
            </div>
          )}

          {messages.map((message) => {
            const text = textOf(message);
            const reasoning = message.parts
              .filter((part) => part.type === "reasoning")
              .map((part) => ("text" in part ? part.text : ""))
              .join("\n")
              .trim();

            if (message.role === "user") {
              return (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-user-bubble px-4 py-3 text-user-bubble-foreground">
                    {text}
                  </div>
                </div>
              );
            }

            return (
              <div key={message.id} className="space-y-2">
                {reasoning && (
                  <details className="rounded-2xl bg-card/60 px-4 py-2 text-xs text-muted-foreground">
                    <summary className="cursor-pointer select-none">Raisonnement</summary>
                    <p className="mt-2 whitespace-pre-wrap">{reasoning}</p>
                  </details>
                )}
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
          className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-3xl border border-border bg-card p-2 shadow-lg"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="Écrivez votre message…"
            className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button type="submit" size="icon" className="size-10 shrink-0 rounded-full" disabled={busy || !input.trim()}>
            <ArrowUp className="size-4" />
          </Button>
        </form>
      </div>
    </main>
  );
}
