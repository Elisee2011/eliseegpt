import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import logoFull from "@/assets/elisee-gpt-logo.png.asset.json";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Connexion — Elisée GPT" },
      {
        name: "description",
        content:
          "Connectez-vous avec Google pour sauvegarder vos discussions Elisée GPT sur votre compte.",
      },
      { property: "og:title", content: "Connexion — Elisée GPT" },
      {
        property: "og:description",
        content: "Connectez-vous avec Google pour sauvegarder vos discussions Elisée GPT.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (user) void navigate({ to: "/", replace: true });
  }, [user, navigate]);

  const signIn = async () => {
    setPending(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setPending(false);
      toast.error("Connexion Google impossible");
      return;
    }
    if (result.redirected) return;
    void navigate({ to: "/", replace: true });
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-8 shadow-2xl">
        <img
          src={logoFull.url}
          alt="Logo Elisée GPT"
          className="h-20 w-auto"
          width={160}
          height={160}
        />

        <h1 className="mt-6 text-2xl font-semibold">Connexion</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Connectez-vous avec Google pour retrouver et sauvegarder vos discussions. Sans compte,
          rien n&apos;est enregistré.
        </p>

        <Button
          className="mt-6 h-12 w-full gap-3 text-sm font-medium"
          onClick={signIn}
          disabled={pending || loading}
        >
          <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 11v2.6h6.1c-.25 1.5-1.8 4.4-6.1 4.4A6 6 0 1 1 12 6c1.7 0 3 .6 3.9 1.4l2-1.9A9 9 0 1 0 21 12c0-.5 0-.7-.1-1z"
            />
          </svg>
          {pending ? "Connexion…" : "Continuer avec Google"}
        </Button>

        <Button
          variant="ghost"
          className="mt-3 h-11 w-full gap-2 text-sm text-muted-foreground"
          onClick={() => void navigate({ to: "/" })}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Continuer sans compte
        </Button>
      </div>
    </main>
  );
}
