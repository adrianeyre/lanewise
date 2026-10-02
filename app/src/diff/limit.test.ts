import { expect, test } from "vitest";

import type { LocalStore } from "../settings/localSettings";
import { DEFAULT_DIFF_LIMIT, isDiffLimit, readDiffLimit, writeDiffLimit } from "./limit";

function memory(): LocalStore & { kept: Map<string, string> } {
  const kept = new Map<string, string>();
  return {
    kept,
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => void kept.set(key, value),
  };
}

test("a limit is a whole number of lines, from 1 to the most any diff sends", () => {
  expect(isDiffLimit(1)).toBe(true);
  expect(isDiffLimit(200_000)).toBe(true);
  expect(isDiffLimit(0)).toBe(false);
  expect(isDiffLimit(200_001)).toBe(false);
  expect(isDiffLimit(2.5)).toBe(false);
  expect(isDiffLimit(Number.NaN)).toBe(false);
});

test("the limit is kept, and is the default until one is", () => {
  const store = memory();
  expect(readDiffLimit(store)).toBe(DEFAULT_DIFF_LIMIT);

  writeDiffLimit(250, store);
  expect(store.kept.get("lanewise.diff-limit")).toBe("250");
  expect(readDiffLimit(store)).toBe(250);
});

test("a kept limit that isn't one, or no local storage at all, gives the default", () => {
  const store = memory();
  for (const kept of ["", "lots", "-3", "1e9", "12.5"]) {
    store.kept.set("lanewise.diff-limit", kept);
    expect(readDiffLimit(store)).toBe(DEFAULT_DIFF_LIMIT);
  }
  expect(readDiffLimit(null)).toBe(DEFAULT_DIFF_LIMIT);
  expect(() => writeDiffLimit(10, null)).not.toThrow();
});
