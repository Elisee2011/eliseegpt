import { useEffect, useState } from "react";

const STORAGE_KEY = "elisee-gpt-theme";

export function ThemeToggle() {
  const [light, setLight] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const isLight = saved === "light";
    setLight(isLight);
    document.documentElement.classList.toggle("light", isLight);
  }, []);

  const toggle = () => {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light", next);
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
