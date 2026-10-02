import { expect, test } from "vitest";

import type { GitProgress } from "../commands/api";
import { type Announced, announcementOf, describeProgress } from "./gitProgressWords";

function update(phase: string, done: number, total: number | null, found: Partial<GitProgress> = {}) {
  const percent = total === null ? null : Math.floor((done / total) * 100);
  return { phase, remote: false, done, total, percent, finished: done === total, ...found };
}

test("progress is described in Git's words, with its percentage and counts", () => {
  expect(describeProgress(null, "Starting the clone…")).toBe("Starting the clone…");
  expect(describeProgress(update("Receiving objects", 450, 1000), "")).toBe("Receiving objects: 45% (450 of 1,000)");
  expect(describeProgress(update("Counting objects", 12, null, { remote: true }), "")).toBe(
    "Counting objects on the Host: 12",
  );
  expect(describeProgress(update("Resolving deltas", 1, 4, { percent: null }), "")).toBe(
    "Resolving deltas: 25% (1 of 4)",
  );
});

test("a new phase and each quarter of one is announced, and nothing in between", () => {
  const updates = [
    update("Counting objects", 5, null, { remote: true }),
    update("Counting objects", 9, null, { remote: true }),
    update("Receiving objects", 1, 100),
    update("Receiving objects", 24, 100),
    update("Receiving objects", 25, 100),
    update("Receiving objects", 49, 100),
    update("Receiving objects", 80, 100),
    update("Receiving objects", 100, 100),
    update("Resolving deltas", 100, 100),
  ];
  let last: Announced | null = null;
  const announced: string[] = [];
  for (const progress of updates) {
    const next = announcementOf(progress, last);
    if (next === null) continue;
    last = next;
    announced.push(next.text);
  }
  expect(announced).toEqual([
    "Counting objects on the Host…",
    "Receiving objects…",
    "Receiving objects: 25%",
    "Receiving objects: 75%",
    "Receiving objects: 100%",
    "Resolving deltas: 100%",
  ]);
});
