import { describe, expect, test } from "vitest";

import { conflictHunks, hasConflictMarkers, hunkAt, resolvedText } from "./conflictHunks";

/** A file Git left with two Conflict Hunks, the second with its base shown, as `diff3` shows it. */
const conflicted = [
  "fn lanes() {",
  "<<<<<<< HEAD",
  "    let lanes = 3;",
  "=======",
  "    let lanes = 4;",
  "    let spare = 1;",
  ">>>>>>> feature",
  "}",
  "<<<<<<< HEAD",
  "ours",
  "||||||| merged common ancestors",
  "base",
  "=======",
  "theirs",
  ">>>>>>> feature",
  "",
].join("\n");

describe("conflictHunks", () => {
  test("finds each Conflict Hunk with its sides, its lines and where it is", () => {
    const hunks = conflictHunks(conflicted);

    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({
      startLine: 2,
      endLine: 7,
      ours: ["    let lanes = 3;"],
      base: null,
      theirs: ["    let lanes = 4;", "    let spare = 1;"],
    });
    expect(conflicted.slice(hunks[0]!.from, hunks[0]!.to)).toBe(
      "<<<<<<< HEAD\n    let lanes = 3;\n=======\n    let lanes = 4;\n    let spare = 1;\n>>>>>>> feature\n",
    );
    expect(hunks[1]).toMatchObject({ startLine: 9, endLine: 15, ours: ["ours"], base: ["base"], theirs: ["theirs"] });
    expect(hunks[1]!.to).toBe(conflicted.length);
  });

  test("finds empty sides, and one that ends the text with no newline", () => {
    const text = "a\n<<<<<<<\n=======\ntheirs\n>>>>>>>";
    expect(conflictHunks(text)).toEqual([
      { from: 2, to: text.length, startLine: 2, endLine: 5, ours: [], base: null, theirs: ["theirs"] },
    ]);
  });

  test("markers that don't make a whole Conflict Hunk aren't one", () => {
    expect(conflictHunks("Title\n=======\n\ntext\n")).toEqual([]);
    expect(conflictHunks("<<<<<<< HEAD\nours\n>>>>>>> feature\n")).toEqual([]);
    expect(conflictHunks("<<<<<<< HEAD\nours\n=======\ntheirs\n")).toEqual([]);
    expect(conflictHunks("<<<<<<<< eight\n=======\n>>>>>>>> eight\n")).toEqual([]);
    // A second start, half typed, drops the first.
    const hunks = conflictHunks("<<<<<<< HEAD\nstray\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> x\n");
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ startLine: 3, ours: ["ours"] });
  });
});

describe("hasConflictMarkers", () => {
  test("finds any start, base or end marker, but not a lone =======", () => {
    expect(hasConflictMarkers(conflicted)).toBe(true);
    expect(hasConflictMarkers("a\n>>>>>>> feature\n")).toBe(true);
    expect(hasConflictMarkers("a\n||||||| base\n")).toBe(true);
    expect(hasConflictMarkers("Title\n=======\n")).toBe(false);
    expect(hasConflictMarkers("a <<<<<<< b\n")).toBe(false);
  });
});

describe("resolvedText", () => {
  const [first, second] = conflictHunks(conflicted) as [ReturnType<typeof conflictHunks>[0], ReturnType<typeof conflictHunks>[0]];
  const resolve = (hunk: typeof first, choice: Parameters<typeof resolvedText>[2]) =>
    conflicted.slice(0, hunk.from) + resolvedText(conflicted, hunk, choice) + conflicted.slice(hunk.to);

  test("takes ours, theirs, or both in either order", () => {
    expect(resolvedText(conflicted, first, "ours")).toBe("    let lanes = 3;\n");
    expect(resolvedText(conflicted, first, "theirs")).toBe("    let lanes = 4;\n    let spare = 1;\n");
    expect(resolvedText(conflicted, first, "oursThenTheirs")).toBe(
      "    let lanes = 3;\n    let lanes = 4;\n    let spare = 1;\n",
    );
    expect(resolvedText(conflicted, first, "theirsThenOurs")).toBe(
      "    let lanes = 4;\n    let spare = 1;\n    let lanes = 3;\n",
    );
    expect(resolve(second, "theirs")).toBe(
      "fn lanes() {\n<<<<<<< HEAD\n    let lanes = 3;\n=======\n    let lanes = 4;\n    let spare = 1;\n>>>>>>> feature\n}\ntheirs\n",
    );
  });

  test("leaves no newline where the Conflict Hunk ended the text without one", () => {
    const text = "a\n<<<<<<<\nours\n=======\ntheirs\n>>>>>>>";
    const [hunk] = conflictHunks(text);
    expect(resolvedText(text, hunk!, "oursThenTheirs")).toBe("ours\ntheirs");
    const empty = "a\n<<<<<<<\n=======\n>>>>>>>";
    expect(resolvedText(empty, conflictHunks(empty)[0]!, "ours")).toBe("");
  });
});

describe("hunkAt", () => {
  const hunks = conflictHunks(conflicted);

  test("is the Conflict Hunk the cursor is in, or the next, or else the last", () => {
    expect(hunkAt(hunks, 0)).toBe(0);
    expect(hunkAt(hunks, hunks[0]!.from + 5)).toBe(0);
    expect(hunkAt(hunks, hunks[0]!.to)).toBe(1);
    expect(hunkAt(hunks, conflicted.length)).toBe(1);
    expect(hunkAt([], 0)).toBeNull();
  });
});
