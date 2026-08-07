import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Lock, Mail } from "lucide-react";
import logoFull from "@/assets/elisee-gpt-logo.png.asset.json";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { lovable } from "@/integrations/lovable/index";
import { getSupabase, isAuthConfigured } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Connexion — Elisée GPT" },
      {
        name: "description",
        content:
          "Connectez-vous ou créez un compte Elisée GPT pour sauvegarder vos discussions et bénéficier d'un assistant adapté à vos habitudes.",
      },
      { property: "og:title", content: "Connexion — Elisée GPT" },
      {
        property: "og:description",
        content: "Connectez-vous pour sauvegarder vos discussions Elisée GPT.",
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
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (user) void navigate({ to: "/", replace: true });
  }, [user, navigate]);

  const submitEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    if (password.length < 6) {
      toast.error("Le mot de passe doit faire au moins 6 caractères");
      return;
    }
    setPending(true);
    try {
      const supabase = getSupabase();
      if (!supabase) throw new Error("La connexion n'est pas disponible sur ce déploiement.");
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        toast.success("Compte créé ! Vous êtes connecté.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      }
      void navigate({ to: "/", replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur de connexion";
      toast.error(message);
    } finally {
      setPending(false);
    }
  };

  const signInGoogle = async () => {
    if (!isAuthConfigured()) {
      toast.error("La connexion n'est pas disponible sur ce déploiement.");
      return;
    }
    setPending(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) throw result.error;
      if (result.redirected) return;
      void navigate({ to: "/", replace: true });
    } catch {
      toast.error("Connexion Google impossible");
      setPending(false);
    }
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

        <h1 className="mt-6 text-2xl font-semibold">
          {mode === "signin" ? "Connexion" : "Créer un compte"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {mode === "signin"
            ? "Connectez-vous pour retrouver vos discussions et un assistant adapté à vous."
            : "Créez un compte pour sauvegarder vos discussions et personnaliser l'assistant."}
        </p>

        <form onSubmit={submitEmail} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Adresse e-mail</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="vous@exemple.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-9"
                disabled={pending || loading}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Mot de passe</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-9"
                disabled={pending || loading}
                required
              />
            </div>
          </div>

          <Button
            type="submit"
            className="h-12 w-full text-sm font-medium"
            disabled={pending || loading}
          >
            {pending
              ? "Veuillez patienter…"
              : mode === "signin"
                ? "Se connecter"
                : "Créer mon compte"}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="mt-3 w-full text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {mode === "signin"
            ? "Pas encore de compte ? S'inscrire"
            : "Vous avez déjà un compte ? Se connecter"}
        </button>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">ou</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <Button
          variant="outline"
          className="h-12 w-full gap-3 text-sm font-medium"
          onClick={signInGoogle}
          disabled={pending || loading}
        >
          <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 11v2.6h6.1c-.25 1.5-1.8 4.4-6.1 4.4A6 6 0 1 1 12 6c1.7 0 3 .6 3.9 1.4l2-1.9A9 9 0 1 0 21 12c0-.5 0-.7-.1-1z"
            />
          </svg>
          Continuer avec Google
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
