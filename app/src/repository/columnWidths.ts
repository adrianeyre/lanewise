import { useCallback, useState } from "react";

import { COLUMN_WIDTHS_KEY, readLocal, writeLocal } from "../settings/localSettings";

/** One of the Repository page's columns that can be resized: the left, with the branches, or the right. */
export type ResizableColumn = "sidebar" | "detail";

/** How wide the left and right columns are, in CSS pixels: the Commit graph takes the rest. */
export type ColumnWidths = Record<ResizableColumn, number>;

/** As wide as they are until the user changes them. */
export const DEFAULT_WIDTHS: ColumnWidths = { sidebar: 256, detail: 384 };

/** The narrowest each column may be, the Commit graph's included, so each Widget stays usable. */
export const MIN_WIDTHS: ColumnWidths & { centre: number } = { sidebar: 192, detail: 272, centre: 320 };

/** How far a key moves a column's edge: an arrow key, and Shift with an arrow key or Page Up and Down. */
export { BIG_STEP, STEP } from "../ui/Splitter";

/**
 * The widest `column` may be in a layout `total` pixels wide, beside the
 * other column as wide as `widths` has it, leaving the Commit graph its
 * narrowest. Never less than its own narrowest.
 */
export function maxWidth(column: ResizableColumn, widths: ColumnWidths, total: number): number {
  const other = column === "sidebar" ? widths.detail : widths.sidebar;
  return Math.max(MIN_WIDTHS[column], Math.round(total - other - MIN_WIDTHS.centre));
}

/** `width` for `column`, kept between its narrowest and widest. */
export function clampWidth(column: ResizableColumn, width: number, widths: ColumnWidths, total: number): number {
  return Math.round(Math.min(maxWidth(column, widths, total), Math.max(MIN_WIDTHS[column], width)));
}

/** The widths kept, or the defaults for any that aren't, or aren't numbers. */
export function parseWidths(kept: string | null): ColumnWidths {
  try {
    const parsed: unknown = kept === null ? null : JSON.parse(kept);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_WIDTHS;
    const read = (column: ResizableColumn) => {
      const value = (parsed as Record<string, unknown>)[column];
      return typeof value === "number" && Number.isFinite(value) && value >= MIN_WIDTHS[column]
        ? Math.round(value)
        : DEFAULT_WIDTHS[column];
    };
    return { sidebar: read("sidebar"), detail: read("detail") };
  } catch {
    return DEFAULT_WIDTHS;
  }
}

/**
 * The Repository page's column widths, kept on this machine for every
 * repository, as each is dragged or moved from the keyboard.
 */
export function useColumnWidths(): {
  widths: ColumnWidths;
  resize(column: ResizableColumn, width: number): void;
  reset(column: ResizableColumn): void;
} {
  const [widths, setWidths] = useState(() => parseWidths(readLocal(COLUMN_WIDTHS_KEY)));
  const keep = useCallback((change: (widths: ColumnWidths) => ColumnWidths) => {
    setWidths((previous) => {
      const next = change(previous);
      if (next.sidebar === previous.sidebar && next.detail === previous.detail) return previous;
      writeLocal(COLUMN_WIDTHS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  const resize = useCallback(
    (column: ResizableColumn, width: number) => keep((previous) => ({ ...previous, [column]: Math.round(width) })),
    [keep],
  );
  const reset = useCallback(
    (column: ResizableColumn) => keep((previous) => ({ ...previous, [column]: DEFAULT_WIDTHS[column] })),
    [keep],
  );
  return { widths, resize, reset };
}
