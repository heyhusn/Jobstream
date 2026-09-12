import { useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "jobspy-theme";

export function applyTheme(choice: ThemeChoice) {
  if (choice === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", choice);
  }
}

/** Read once, synchronously, before first paint — see main.tsx. */
export function getStoredTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // localStorage unavailable (private mode, etc.) — fall through to system.
  }
  return "system";
}

/**
 * Minor m33: a real three-way toggle (light / dark / system), not
 * just a light/dark switch — "system" is the default so this never
 * overrides someone's OS preference unless they explicitly ask.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeChoice>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Best-effort; the toggle still works for this tab even if it can't persist.
    }
  }, [theme]);

  return { theme, setTheme: setThemeState };
}
