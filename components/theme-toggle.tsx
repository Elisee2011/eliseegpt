import { useEffect, useState } from "react";

const STORAGE_KEY = "elisee-gpt-theme";
const LIGHT_THEME: Record<string, string> = {
  "--background": "oklch(0.88 0.008 250)",
  "--foreground": "oklch(0.2 0.012 250)",
  "--card": "oklch(0.93 0.006 250)",
  "--card-foreground": "oklch(0.2 0.012 250)",
  "--popover": "oklch(0.95 0.005 250)",
  "--popover-foreground": "oklch(0.2 0.012 250)",
  "--secondary": "oklch(0.82 0.008 250)",
  "--secondary-foreground": "oklch(0.22 0.012 250)",
  "--muted": "oklch(0.83 0.008 250)",
  "--muted-foreground": "oklch(0.42 0.012 250)",
  "--accent": "oklch(0.78 0.012 250)",
  "--accent-foreground": "oklch(0.2 0.012 250)",
  "--border": "oklch(0.72 0.01 250)",
  "--input": "oklch(0.72 0.01 250)",
  "--sidebar": "oklch(0.84 0.008 250)",
  "--sidebar-foreground": "oklch(0.22 0.012 250)",
  "--sidebar-accent": "oklch(0.78 0.01 250)",
  "--sidebar-accent-foreground": "oklch(0.2 0.012 250)",
  "--sidebar-border": "oklch(0.74 0.01 250)",
  "--user-bubble": "oklch(0.72 0.06 255)",
  "--user-bubble-foreground": "oklch(0.16 0.012 250)",
};

function applyTheme(light: boolean) {
  const root = document.documentElement;
  root.classList.toggle("light", light);
  for (const [name, value] of Object.entries(LIGHT_THEME)) {
    if (light) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
}

export function ThemeToggle() {
  const [light, setLight] = useState(false);

  useEffect(() => {
    const isLight = localStorage.getItem(STORAGE_KEY) === "light";
    setLight(isLight);
    applyTheme(isLight);
  }, []);

  const toggle = () => {
    const next = !light;
    setLight(next);
    applyTheme(next);
    localStorage.setItem(STORAGE_KEY, next ? "light" : "dark");
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={light ? "Activer le mode sombre" : "Activer le mode clair"}
      title={light ? "Mode sombre" : "Mode clair"}
      className="fixed right-4 top-4 z-50 grid size-10 place-items-center rounded-full border border-border bg-card text-foreground shadow-lg transition-colors hover:bg-accent"
    >
      <span aria-hidden="true" className="text-lg">
        {light ? "🌙" : "☀️"}
      </span>
    </button>
  );
}
