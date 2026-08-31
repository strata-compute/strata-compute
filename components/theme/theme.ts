/**
 * Theme vocabulary, shared by the pre-paint script, the provider and the
 * toggle so the three cannot drift apart.
 */

export type ThemePreference = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

/** Dark is the product's default. An absent preference is dark, not system. */
export const DEFAULT_THEME: ThemePreference = "dark";

export const THEME_STORAGE_KEY = "strata-theme";

export const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "dark" || value === "light" || value === "system";
}

/** Browser-tab chrome colour, matched to each theme's page background. */
export const THEME_COLOR: Record<ResolvedTheme, string> = {
  dark: "#080A09",
  light: "#F7F8F7",
};
