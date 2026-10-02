import { expect, test } from "vitest";

import { clampWidth, DEFAULT_WIDTHS, maxWidth, MIN_WIDTHS, parseWidths } from "./columnWidths";

test("a column keeps its narrowest, and leaves the Commit graph its narrowest", () => {
  const widths = { sidebar: 256, detail: 384 };
  expect(maxWidth("sidebar", widths, 1440)).toBe(1440 - 384 - MIN_WIDTHS.centre);
  expect(clampWidth("sidebar", 50, widths, 1440)).toBe(MIN_WIDTHS.sidebar);
  expect(clampWidth("sidebar", 5000, widths, 1440)).toBe(1440 - 384 - MIN_WIDTHS.centre);
  expect(clampWidth("detail", 300.4, widths, 1440)).toBe(300);
  // Too narrow a window for both: never below its own narrowest.
  expect(maxWidth("detail", widths, 600)).toBe(MIN_WIDTHS.detail);
});

test("widths kept are read back, and anything else is the default", () => {
  expect(parseWidths('{"sidebar":300,"detail":400}')).toEqual({ sidebar: 300, detail: 400 });
  expect(parseWidths('{"sidebar":10,"detail":"wide"}')).toEqual(DEFAULT_WIDTHS);
  expect(parseWidths("not JSON")).toEqual(DEFAULT_WIDTHS);
  expect(parseWidths(null)).toEqual(DEFAULT_WIDTHS);
});
