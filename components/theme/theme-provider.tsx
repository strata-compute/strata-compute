"use client";

import * as React from "react";
import {
  DEFAULT_THEME,
  isThemePreference,
  THEME_COLOR,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from "./theme";

interface ThemeContextValue {
  /** What the reader chose: dark, light or system. */
  preference: ThemePreference;
  /** What that resolves to right now. */
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
  /** True once the client has read storage — until then, render the default. */
  ready: boolean;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function readStored(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(raw) ? raw : DEFAULT_THEME;
  } catch {
    // private mode or blocked storage — the default is still correct
    return DEFAULT_THEME;
  }
}

/**
 * Owns the theme for the whole document.
 *
 * The attribute is already on <html> before React mounts (see ThemeScript),
 * so this provider's job is continuity, not initialisation: keep state in
 * step with storage, follow the OS while the preference is "system", and
 * write changes back.
 *
 * State starts at the same value the server rendered, which is why the first
 * client render always agrees with the HTML it is hydrating.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] =
    React.useState<ThemePreference>(DEFAULT_THEME);
  const [resolved, setResolved] = React.useState<ResolvedTheme>("dark");
  const [ready, setReady] = React.useState(false);

  // adopt the stored preference after hydration
  React.useEffect(() => {
    const stored = readStored();
    setPreferenceState(stored);
    setResolved(stored === "system" ? systemTheme() : stored);
    setReady(true);
  }, []);

  // while the preference is "system", track the OS
  React.useEffect(() => {
    if (preference !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const sync = () => setResolved(query.matches ? "light" : "dark");
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [preference]);

  // keep another tab of the same app in step
  React.useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const next = isThemePreference(event.newValue)
        ? event.newValue
        : DEFAULT_THEME;
      setPreferenceState(next);
      setResolved(next === "system" ? systemTheme() : next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // project the resolved theme onto the document
  React.useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    if (root.getAttribute("data-theme") === resolved) return;

    // brief cross-fade, scoped to this switch only
    root.setAttribute("data-theme-animating", "");
    root.setAttribute("data-theme", resolved);
    root
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", THEME_COLOR[resolved]);

    const timer = window.setTimeout(
      () => root.removeAttribute("data-theme-animating"),
      200,
    );
    return () => window.clearTimeout(timer);
  }, [resolved, ready]);

  const setPreference = React.useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    setResolved(next === "system" ? systemTheme() : next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // the theme still applies for this session
    }
  }, []);

  const value = React.useMemo(
    () => ({ preference, resolved, setPreference, ready }),
    [preference, resolved, setPreference, ready],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return context;
}
