import { expect, test } from "vitest";

import { NO_NEWLINE } from "../commands/api";
import { splitHunk } from "./split";

const side = (number: number, text: string, kind: "context" | "removed" | "added", noNewline = false) => ({
  number,
  text,
  kind,
  noNewline,
});

test("a line both files have is on both sides, numbered in each", () => {
  expect(splitHunk({ oldStart: 3, oldLines: 1, newStart: 5, newLines: 1, lines: [" same"] })).toEqual([
    { old: side(3, "same", "context"), new: side(5, "same", "context") },
  ]);
});

test("removed lines sit beside the added lines after them, with a gap on the shorter side", () => {
  const rows = splitHunk({
    oldStart: 1,
    oldLines: 4,
    newStart: 1,
    newLines: 3,
    lines: [" a", "-b", "-c", "+B", " d", "+e", "-f"],
  });

  expect(rows).toEqual([
    { old: side(1, "a", "context"), new: side(1, "a", "context") },
    { old: side(2, "b", "removed"), new: side(2, "B", "added") },
    { old: side(3, "c", "removed"), new: null },
    { old: side(4, "d", "context"), new: side(3, "d", "context") },
    // An addition then a removal are two runs, not one pair.
    { old: null, new: side(4, "e", "added") },
    { old: side(5, "f", "removed"), new: null },
  ]);
});

test("a file added from nothing is all on the new side, and its missing last newline is marked", () => {
  expect(splitHunk({ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ["+one", "+two", NO_NEWLINE] })).toEqual([
    { old: null, new: side(1, "one", "added") },
    { old: null, new: side(2, "two", "added", true) },
  ]);
});
