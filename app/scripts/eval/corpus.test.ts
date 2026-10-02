import { expect, test } from "vitest";

import { conflictHunks } from "../../src/conflicts/conflictHunks";
import { MOST_CONTEXT_LINES } from "../../src/ai/suggestionRequest";
import {
  type CorpusPart,
  MOST_HUNK_LINES,
  corpusCases,
  excerpt,
  groundTruth,
  keepsPath,
  keptHunks,
  linesOf,
  resolvedAs,
  unchangedLines,
} from "./corpus";

/** A file Git left with one Conflict Hunk, its Base shown, between a line before and two after. */
const CONFLICTED = [
  "import os",
  "<<<<<<< ours",
  "def greet(name):",
  "||||||| base",
  "def greet():",
  "=======",
  "def greet(who=None):",
  ">>>>>>> theirs",
  "    pass",
  "",
].join("\n");

test("reads the lines a -U0 diff leaves unchanged, and where each went", () => {
  // Lines 3 and 4 made one, then two new lines after line 7, of 10.
  const diff = ["diff --git a/x b/x", "@@ -3,2 +3 @@", "-c", "-d", "+cd", "@@ -7,0 +7,2 @@", "+new", "+new"].join("\n");
  expect([...unchangedLines(diff, 10)]).toEqual([
    [1, 1],
    [2, 2],
    [5, 4],
    [6, 5],
    [7, 6],
    [8, 9],
    [9, 10],
    [10, 11],
  ]);
  // A header without counts is one line each.
  expect([...unchangedLines("@@ -2 +2 @@\n-b\n+B", 3)]).toEqual([
    [1, 1],
    [3, 3],
  ]);
  expect([...unchangedLines("", 2)]).toEqual([
    [1, 1],
    [2, 2],
  ]);
});

test("pins a Conflict Hunk's ground truth between the unchanged lines round it", () => {
  const [hunk] = conflictHunks(CONFLICTED);
  const result = ["import os", "def greet(name, who=None):", "    pass"];
  // The Conflict Hunk's lines 2 to 8 became line 2.
  const unchanged = new Map([
    [1, 1],
    [9, 3],
  ]);
  expect(groundTruth(hunk!, 9, result, unchanged)).toEqual(["def greet(name, who=None):"]);
  // Taken out altogether.
  expect(groundTruth(hunk!, 9, ["import os", "    pass"], new Map([[1, 1], [9, 2]]))).toEqual([]);
  // Where a line round it changed too, the ground truth isn't certain.
  expect(groundTruth(hunk!, 9, result, new Map([[1, 1]]))).toBeNull();
  expect(groundTruth(hunk!, 9, result, new Map([[9, 3]]))).toBeNull();
});

test("pins one that starts or ends the file at the file's start or end", () => {
  const [hunk] = conflictHunks("<<<<<<< ours\na\n=======\nb\n>>>>>>> theirs\n");
  expect(groundTruth(hunk!, 5, ["a", "b"], new Map())).toEqual(["a", "b"]);
});

test("says how the merge resolved a Conflict Hunk", () => {
  const [hunk] = conflictHunks(CONFLICTED);
  expect(resolvedAs(hunk!, ["def greet(name):"])).toBe("ours");
  expect(resolvedAs(hunk!, ["def greet(who=None):"])).toBe("theirs");
  expect(resolvedAs(hunk!, ["def greet(name):", "def greet(who=None):"])).toBe("oursThenTheirs");
  expect(resolvedAs(hunk!, ["def greet(who=None):", "def greet(name):"])).toBe("theirsThenOurs");
  expect(resolvedAs(hunk!, ["def greet(name, who=None):"])).toBe("written");
});

test("keeps the Conflict Hunks whose ground truth is certain, clean and short", () => {
  const result = "import os\ndef greet(name, who=None):\n    pass\n";
  const diff = "@@ -2,7 +2 @@\n";
  expect(keptHunks(CONFLICTED, result, diff)).toEqual([
    { hunk: conflictHunks(CONFLICTED)[0], number: 1, of: 1, resolution: ["def greet(name, who=None):"] },
  ]);
  // Committed with its Conflict Markers left in.
  const markers = "import os\n<<<<<<< ours\ndef greet(name):\n=======\n>>>>>>> theirs\n    pass\n";
  expect(keptHunks(CONFLICTED, markers, "@@ -2,7 +2,4 @@\n")).toEqual([]);
  // A side too long to ask about.
  const long = Array.from({ length: MOST_HUNK_LINES + 1 }, (_, index) => `line ${index}`);
  const tooLong = ["<<<<<<< ours", ...long, "=======", "b", ">>>>>>> theirs", ""].join("\n");
  expect(keptHunks(tooLong, "b\n", `@@ -1,${MOST_HUNK_LINES + 4} +1 @@\n`)).toEqual([]);
});

test("leaves out generated files, such as lockfiles", () => {
  expect(keepsPath("src/app.py")).toBe(true);
  expect(keepsPath("Cargo.toml")).toBe(true);
  for (const path of ["uv.lock", "web/package-lock.json", "Cargo.lock", "pnpm-lock.yaml", "go.sum"]) {
    expect(keepsPath(path)).toBe(false);
  }
});

test("keeps as much of a file round its Conflict Hunks as the most context Settings allows", () => {
  const padding = Array.from({ length: MOST_CONTEXT_LINES + 10 }, (_, index) => `line ${index}`);
  const text = [...padding, ...linesOf(CONFLICTED), ...padding].join("\n");
  const kept = excerpt(text, conflictHunks(text));
  // Its `<<<<<<<` is line 212, after the padding and `import os`, and it ends at line 218.
  expect(kept.firstLine).toBe(12);
  expect(kept.lines).toHaveLength(MOST_CONTEXT_LINES * 2 + 7);
  expect(kept.starts).toEqual([MOST_CONTEXT_LINES + 1]);
  expect(kept.lines[kept.starts[0]! - 1]).toBe("<<<<<<< ours");
  // A short file is kept whole.
  expect(excerpt(CONFLICTED, conflictHunks(CONFLICTED))).toEqual({ firstLine: 1, lines: linesOf(CONFLICTED), starts: [2] });
});

function part(line: number): CorpusPart {
  return {
    source: { name: "demo", url: "https://example.test/demo", licence: "MIT", licenceFile: "LICENSE", at: "a".repeat(40), merges: 1 },
    git: "git version 2.47.3",
    files: [
      {
        merge: "m".repeat(40),
        ours: "o".repeat(40),
        theirs: "t".repeat(40),
        oursSubject: "Name the greeting",
        theirsSubject: "Let greet take no one",
        path: "greet.py",
        firstLine: 1,
        lines: linesOf(CONFLICTED),
        hunks: [{ line, number: 1, of: 1, resolution: ["def greet(name, who=None):"], resolvedAs: "written" }],
      },
    ],
  };
}

test("finds each Conflict Hunk of the corpus again in its file", () => {
  const [found] = corpusCases(part(2));
  expect(found?.source).toBe("demo");
  expect(found?.conflict.ours).toEqual(["def greet(name):"]);
  expect(found?.conflict.base).toEqual(["def greet():"]);
  expect(found?.text).toBe(CONFLICTED);
  expect(() => corpusCases(part(3))).toThrow("demo: greet.py at mmmm");
});
