"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  const attr = document.documentElement.dataset.theme;
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", cb);
  };
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, currentTheme, () => "light");
}

export function ThemeToggle() {
  const theme = useTheme();
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          window.localStorage.setItem("spareline.theme", next);
        } catch {
          // Storage unavailable: theme applies to this page view only.
        }
        listeners.forEach((l) => l());
      }}
      className="inline-flex h-10 w-10 items-center justify-center rounded-[8px] border border-line text-ink-2 hover:text-ink hover:bg-surface"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {theme === "dark" ? (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M13.5 9.8A5.6 5.6 0 0 1 6.2 2.5a5.6 5.6 0 1 0 7.3 7.3Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("spareline.theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t}}catch(e){}})();`;
