import { useCallback, useState } from "react";

import { HISTORY_COLUMNS_KEY, readLocal, writeLocal } from "../settings/localSettings";

/** The Commit graph's columns that can be resized; the subject takes the room the others leave. */
export type HistoryColumn = "labels" | "graph" | "author" | "date" | "id";

export const HISTORY_COLUMNS: readonly HistoryColumn[] = ["labels", "graph", "author", "date", "id"];

/** The widths made by hand, in CSS pixels: a column not in it sizes to fit what it shows. */
export type HistoryWidths = Partial<Record<HistoryColumn, number>>;

/** The narrowest and widest each column may be, in `rem`, whether made by hand or sized to fit. */
export const HISTORY_LIMITS: Record<HistoryColumn, { min: number; max: number }> = {
  labels: { min: 2, max: 30 },
  graph: { min: 1.5, max: 40 },
  author: { min: 2, max: 24 },
  date: { min: 2, max: 16 },
  id: { min: 2, max: 16 },
};

/** `width`, in pixels, kept between `column`'s narrowest and widest at `rem` pixels to the `rem`. */
export function clampHistoryWidth(column: HistoryColumn, width: number, rem: number): number {
  const { min, max } = HISTORY_LIMITS[column];
  return Math.round(Math.min(max * rem, Math.max(min * rem, width)));
}

/** The widths kept, leaving out any that aren't positive numbers, so those size to fit. */
export function parseHistoryWidths(kept: string | null): HistoryWidths {
  try {
    const parsed: unknown = kept === null ? null : JSON.parse(kept);
    if (typeof parsed !== "object" || parsed === null) return {};
    const widths: HistoryWidths = {};
    for (const column of HISTORY_COLUMNS) {
      const value = (parsed as Record<string, unknown>)[column];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) widths[column] = Math.round(value);
    }
    return widths;
  } catch {
    return {};
  }
}

/**
 * The Commit graph's column widths made by hand, kept on this machine for
 * every repository: `fit` gives a column back to sizing itself to fit.
 */
export function useHistoryWidths(): {
  widths: HistoryWidths;
  resize(column: HistoryColumn, width: number): void;
  fit(column: HistoryColumn): void;
} {
  const [widths, setWidths] = useState(() => parseHistoryWidths(readLocal(HISTORY_COLUMNS_KEY)));
  const keep = useCallback((change: (widths: HistoryWidths) => HistoryWidths) => {
    setWidths((previous) => {
      const next = change(previous);
      if (JSON.stringify(next) === JSON.stringify(previous)) return previous;
      writeLocal(HISTORY_COLUMNS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  const resize = useCallback(
    (column: HistoryColumn, width: number) => keep((previous) => ({ ...previous, [column]: Math.round(width) })),
    [keep],
  );
  const fit = useCallback(
    (column: HistoryColumn) =>
      keep((previous) => {
        const rest = { ...previous };
        delete rest[column];
        return rest;
      }),
    [keep],
  );
  return { widths, resize, fit };
}

/** Measures text in a font, as `font` in CSS writes it: `null` where nothing can measure, as in a test. */
export type Measure = (text: string, font: string) => number | null;

let measuring: OffscreenCanvasRenderingContext2D | null | undefined;

/** Measures text on an offscreen canvas, where there is one. */
export const measureText: Measure = (text, font) => {
  if (measuring === undefined) {
    measuring = typeof OffscreenCanvas === "undefined" ? null : new OffscreenCanvas(1, 1).getContext("2d");
  }
  if (measuring === null) return null;
  measuring.font = font;
  return measuring.measureText(text).width;
};

/** How wide `text` is in `font`, `size` pixels high: measured, or else guessed from how many characters it has. */
export function textWidth(text: string, font: string, size: number, measure: Measure = measureText): number {
  return measure(text, `${font}`) ?? text.length * size * 0.6;
}
