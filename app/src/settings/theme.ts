import { useEffect, useState } from "react";

import { readLocal, THEME_KEY, writeLocal } from "./localSettings";

/** The Theme the user chose: `system` follows the OS's light or dark setting as it changes. */
export type ThemePreference = "system" | "light" | "dark";

/** The theme shown, one of the two `styles.css` has tokens for. */
export type Theme = "light" | "dark";

/** Settings' choices, in its order. */
export const THEME_PREFERENCES: readonly { id: ThemePreference; label: string; note: string }[] = [
  { id: "system", label: "System", note: "Light or dark, as your operating system is set" },
  { id: "light", label: "Light", note: "Dark text on light backgrounds" },
  { id: "dark", label: "Dark", note: "Light text on dark backgrounds" },
];

/** The OS is set to dark. `index.html`'s script asks the same. */
const OS_DARK = "(prefers-color-scheme: dark)";

/** The saved Theme; `system` if there is none, or it's one this version doesn't know. */
export function readThemePreference(): ThemePreference {
  const saved = readLocal(THEME_KEY);
  return saved === "light" || saved === "dark" ? saved : "system";
}

function osTheme(): Theme {
  return typeof matchMedia === "function" && matchMedia(OS_DARK).matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference): Theme {
  return preference === "system" ? osTheme() : preference;
}

/**
 * Draws the page in `theme`: `data-theme` picks its tokens in `styles.css`,
 * and `color-scheme` gives the webview's own canvas, scrollbars and controls
 * the same, as `index.html`'s script does before first paint.
 */
export function showTheme(theme: Theme, root = document.documentElement): void {
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

interface Options {
  /**
   * Tells the shell's own window, such as the Desktop App's title bar, the
   * Theme chosen: `null` to follow the OS (`Platform.showTheme`).
   */
  onChosen(theme: Theme | null): void;
}

/**
 * The Theme, and a way to choose another, which is shown at once and kept
 * for the next launch. With `system`, the page follows the OS as it changes.
 */
export function useTheme({ onChosen }: Options): {
  preference: ThemePreference;
  choose(preference: ThemePreference): void;
} {
  const [preference, setPreference] = useState(readThemePreference);

  useEffect(() => {
    onChosen(preference === "system" ? null : preference);
  }, [preference, onChosen]);

  useEffect(() => {
    const show = () => showTheme(resolveTheme(preference));
    show();
    if (preference !== "system" || typeof matchMedia !== "function") return;
    const os = matchMedia(OS_DARK);
    os.addEventListener("change", show);
    return () => os.removeEventListener("change", show);
  }, [preference]);

  function choose(chosen: ThemePreference) {
    writeLocal(THEME_KEY, chosen);
    setPreference(chosen);
  }

  return { preference, choose };
}
