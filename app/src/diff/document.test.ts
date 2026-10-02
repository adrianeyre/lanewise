import { expect, test } from "vitest";

import { NO_NEWLINE } from "../commands/api";
import { diffDocument, hunkHeader } from "./document";

test("a hunk's header is written as git writes it, leaving out a count of one", () => {
  expect(hunkHeader({ oldStart: 1, oldLines: 3, newStart: 1, newLines: 4, lines: [] })).toBe("@@ -1,3 +1,4 @@");
  expect(hunkHeader({ oldStart: 7, oldLines: 1, newStart: 7, newLines: 1, lines: [] })).toBe("@@ -7 +7 @@");
  expect(hunkHeader({ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: [] })).toBe("@@ -0,0 +1,2 @@");
});

test("each line keeps its mark, and is numbered in the files it is in", () => {
  const diff = diffDocument([
    { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [" a", "-b", "+B"] },
    { oldStart: 10, oldLines: 1, newStart: 10, newLines: 2, lines: [" j", "+k"] },
  ]);

  expect(diff.text).toBe("@@ -1,2 +1,2 @@\n a\n-b\n+B\n@@ -10 +10,2 @@\n j\n+k");
  expect(diff.kinds).toEqual(["hunk", "context", "removed", "added", "hunk", "context", "added"]);
  expect(diff.hunks).toEqual([1, 5]);
  expect(diff.oldNumbers).toEqual([null, 1, 2, null, null, 10, null]);
  expect(diff.newNumbers).toEqual([null, 1, null, 2, null, 10, 11]);
});

test("each side is its own text to highlight, and unchanged lines are highlighted from the new file", () => {
  const diff = diffDocument([
    { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [" fn a() {", "-  1", "+  2"] },
  ]);

  expect(diff.old).toEqual({ text: "fn a() {\n  1", starts: [0, 9], lines: [2, 3] });
  expect(diff.new).toEqual({ text: "fn a() {\n  2", starts: [0, 9], lines: [2, 4] });
  expect(diff.sides).toEqual([null, { side: "new", line: 0 }, { side: "old", line: 1 }, { side: "new", line: 1 }]);
});

test("a missing last newline is a line of its own, in neither file", () => {
  const diff = diffDocument([
    { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-a", NO_NEWLINE, "+a"] },
  ]);

  expect(diff.kinds).toEqual(["hunk", "removed", "noNewline", "added"]);
  expect(diff.oldNumbers).toEqual([null, 1, null, null]);
  expect(diff.newNumbers).toEqual([null, null, null, 1]);
  expect(diff.sides[2]).toBeNull();
  expect(diff.old.text).toBe("a");
});

test("an added file's lines are numbered from 1 in the new file only", () => {
  const diff = diffDocument([{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ["+a", "+b"] }]);

  expect(diff.oldNumbers).toEqual([null, null, null]);
  expect(diff.newNumbers).toEqual([null, 1, 2]);
  expect(diff.old.text).toBe("");
  expect(diff.old.starts).toEqual([]);
});

test("no hunks make an empty document", () => {
  expect(diffDocument([])).toMatchObject({ text: "", kinds: [] });
});
