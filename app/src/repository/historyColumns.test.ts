import { expect, test } from "vitest";

import { clampHistoryWidth, parseHistoryWidths, textWidth } from "./historyColumns";

test("widths kept are read back, and any that aren't positive numbers size to fit", () => {
  expect(parseHistoryWidths(null)).toEqual({});
  expect(parseHistoryWidths("not JSON")).toEqual({});
  expect(parseHistoryWidths(JSON.stringify({ labels: 120.4, author: -3, date: "wide", id: 60, other: 5 }))).toEqual({
    labels: 120,
    id: 60,
  });
});

test("a width is kept between its column's narrowest and widest", () => {
  expect(clampHistoryWidth("labels", 1, 16)).toBe(32);
  expect(clampHistoryWidth("labels", 10_000, 16)).toBe(480);
  expect(clampHistoryWidth("author", 150, 16)).toBe(150);
});

test("text is measured where it can be, and guessed from its length where it can't", () => {
  expect(textWidth("main", "12px sans-serif", 12, () => 25)).toBe(25);
  expect(textWidth("main", "12px sans-serif", 10, () => null)).toBe(24);
});
