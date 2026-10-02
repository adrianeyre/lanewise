import { expect, test } from "vitest";

import { changeBetween } from "./editor";

test("the change between two diffs is only what lies between the text they share at each end", () => {
  const before = "@@ -1 +1 @@\n-a\n+b\n@@ -9 +9 @@\n-i\n+j\n@@ -20 +20 @@\n-t\n+u";
  const after = "@@ -1 +1 @@\n-a\n+b\n@@ -20 +19 @@\n-t\n+u";
  const change = changeBetween(before, after);

  expect(before.slice(0, change.from) + change.insert + before.slice(change.to)).toBe(after);
  // The first hunk and the last one's lines stay as they are.
  expect(change.from).toBeGreaterThanOrEqual("@@ -1 +1 @@\n-a\n+b\n@@ -".length);
  expect(before.length - change.to).toBeGreaterThanOrEqual(" @@\n-t\n+u".length);
});

test("the same text is no change, and text with nothing in common is all of it", () => {
  expect(changeBetween("abc", "abc")).toEqual({ from: 3, to: 3, insert: "" });
  expect(changeBetween("abc", "xyz")).toEqual({ from: 0, to: 3, insert: "xyz" });
  expect(changeBetween("", "new")).toEqual({ from: 0, to: 0, insert: "new" });
  // Where the ends overlap, as `aa` to `aaa`, each character is counted once.
  expect(changeBetween("aa", "aaa")).toEqual({ from: 2, to: 2, insert: "a" });
  expect(changeBetween("aaa", "aa")).toEqual({ from: 2, to: 3, insert: "" });
});
