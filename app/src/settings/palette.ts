import { useEffect, useState } from "react";

import { PALETTE_KEY, readLocal, writeLocal } from "./localSettings";

/**
 * A palette: the page's and panels' colours, its accent and the gradient
 * behind the title bar, the Tabs and the Welcome screen, in the Theme shown,
 * light or dark. `styles.css` has each palette's tokens for both themes,
 * which `contrast.test.ts` holds to WCAG 2.2 AA as it does the Theme's own.
 */
export type Palette = "default" | "ocean" | "forest" | "plum" | "ember" | "midnight" | "rose";

/** Settings' swatches, in its order, each with what it looks like. */
export const PALETTES: readonly { id: Palette; label: string; note: string }[] = [
  { id: "default", label: "Lanewise", note: "Grey, with a blue accent" },
  { id: "ocean", label: "Ocean", note: "Sea blue" },
  { id: "forest", label: "Forest", note: "Green" },
  { id: "plum", label: "Plum", note: "Purple" },
  { id: "ember", label: "Ember", note: "Warm orange" },
  { id: "midnight", label: "Midnight", note: "Deep indigo" },
  { id: "rose", label: "Rose", note: "Pink" },
];

const IDS = new Set<string>(PALETTES.map(({ id }) => id));

/** The saved palette; `default` if there is none, or it's one this version doesn't know. */
export function readPalette(): Palette {
  const saved = readLocal(PALETTE_KEY);
  return saved !== null && IDS.has(saved) ? (saved as Palette) : "default";
}

/** Draws the page in `palette`, as `index.html`'s script does before first paint: none for `default`. */
export function showPalette(palette: Palette, root = document.documentElement): void {
  if (palette === "default") delete root.dataset.palette;
  else root.dataset.palette = palette;
}

/** The palette, and a way to choose another, which is shown at once and kept for the next launch. */
export function usePalette(): { palette: Palette; choose(palette: Palette): void } {
  const [palette, setPalette] = useState(readPalette);

  useEffect(() => showPalette(palette), [palette]);

  function choose(chosen: Palette) {
    writeLocal(PALETTE_KEY, chosen);
    setPalette(chosen);
  }

  return { palette, choose };
}
