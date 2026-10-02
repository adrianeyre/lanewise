import { expect, test } from "vitest";

import { changedLines, describeChanges, mergedLines, removedLines } from "./conflictEditors";

test("a side's lines changed from the Base are found and said in words, removals too", () => {
  const base = "a\nb\nc\nd\ne\n";
  expect(changedLines(base, base)).toEqual([]);
  expect(describeChanges([])).toBe("The same as the Base.");

  const changes = changedLines(base, "a\nB\nc\nd\ne\nf\ng\n");
  expect(changes).toEqual([
    { from: 2, to: 2 },
    { from: 6, to: 7 },
  ]);
  expect(describeChanges(changes)).toBe("Changed from the Base: line 2 and lines 6–7.");

  const removed = changedLines(base, "a\nb\ne\n");
  expect(removed).toEqual([{ from: 3, to: 2 }]);
  expect(describeChanges([{ from: 1, to: 0 }, ...removed, { from: 5, to: 5 }])).toBe(
    "Changed from the Base: lines removed at the start, lines removed after line 2 and line 5.",
  );
  // Line endings don't count as changes.
  expect(changedLines(base, base.replaceAll("\n", "\r\n"))).toEqual([]);
});

test("the Base's lines a side removed or changed are numbered in the Base, and a side that only added removed none", () => {
  const base = "a\nb\nc\nd\ne\n";
  expect(removedLines(base, base)).toEqual([]);
  expect(removedLines(base, "a\nB\nc\nd\ne\n")).toEqual([{ from: 2, to: 2 }]);
  expect(removedLines(base, "a\ne\n")).toEqual([{ from: 2, to: 4 }]);
  expect(removedLines(base, "a\nb\nnew\nc\nd\ne\n")).toEqual([]);
});

test("the lines Ours and Theirs removed or changed are merged into runs, each line once", () => {
  expect(mergedLines([{ from: 2, to: 3 }], [{ from: 3, to: 5 }, { from: 9, to: 9 }])).toEqual([
    { from: 2, to: 5 },
    { from: 9, to: 9 },
  ]);
  expect(mergedLines()).toEqual([]);
});
