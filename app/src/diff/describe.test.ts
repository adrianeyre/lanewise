import { expect, test } from "vitest";

import type { DiffContent, DiffSide, FileDiff } from "../commands/api";
import { describeDiff, size } from "./describe";

const file = (path: string): DiffSide => ({ path, mode: "file" });
const unchanged: DiffContent = { kind: "text", hunks: [] };
const changed: DiffContent = {
  kind: "text",
  hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-a", "+b"] }],
};

function diff(old: DiffSide | null, next: DiffSide | null, content: DiffContent = changed): FileDiff {
  return { old, new: next, content };
}

test("a changed text file needs no words: its lines say it all", () => {
  expect(describeDiff(diff(file("a.rs"), file("a.rs")), false)).toEqual([]);
});

test("an added or deleted file says what it is, and when it is empty", () => {
  expect(describeDiff(diff(null, file("a.rs")), false)).toEqual(["Added as a file."]);
  expect(describeDiff(diff(null, { path: "run.sh", mode: "executable" }, unchanged), false)).toEqual([
    "Added as an executable file.",
    "It is empty.",
  ]);
  expect(describeDiff(diff({ path: "link", mode: "symlink" }, null), false)).toEqual([
    "Deleted: it was a symbolic link.",
  ]);
});

test("a rename or a copy says where it came from", () => {
  expect(describeDiff(diff(file("old.rs"), file("new.rs"), unchanged), false)).toEqual([
    "Renamed from old.rs.",
    "Its content didn't change.",
  ]);
  expect(describeDiff(diff(file("old.rs"), file("new.rs")), true)).toEqual(["Copied from old.rs."]);
});

test("a mode change says what changed", () => {
  const executable: DiffSide = { path: "run.sh", mode: "executable" };
  expect(describeDiff(diff(file("run.sh"), executable, unchanged), false)).toEqual([
    "Made executable.",
    "Its content didn't change.",
  ]);
  expect(describeDiff(diff(executable, file("run.sh")), false)).toEqual(["No longer executable."]);
  expect(describeDiff(diff({ path: "a", mode: "symlink" }, file("a")), false)).toEqual([
    "Changed from a symbolic link to a file.",
  ]);
});

/** What a binary file of these sizes is described as. */
function binary(oldSize: number | null, newSize: number | null): string | undefined {
  const old = oldSize === null ? null : file("a.png");
  const next = newSize === null ? null : file("a.png");
  return describeDiff(diff(old, next, { kind: "binary", oldSize, newSize }), false).at(-1);
}

test("a binary file is described by its sizes", () => {
  expect(binary(1234, 3456)).toBe(
    "A binary file, so its changes aren't shown as lines. It was 1.2 KB and is now 3.5 KB.",
  );
  expect(binary(null, 1)).toBe("A binary file, so its changes aren't shown as lines. It is 1 byte.");
  expect(binary(2_000_000, null)).toBe("A binary file, so its changes aren't shown as lines. It was 2 MB.");
  expect(binary(10, 10)).toBe("A binary file, so its changes aren't shown as lines. It is still 10 bytes.");
});

/** What a submodule at these commits is described as. */
function submodule(old: string | null, next: string | null): string[] {
  return describeDiff(diff(null, null, { kind: "submodule", old, new: next }), false);
}

test("a submodule is described by the commits it was at", () => {
  const a = "a".repeat(40);
  const b = "b".repeat(40);

  expect(submodule(a, b)).toEqual(["A submodule, moved from commit aaaaaaa to commit bbbbbbb."]);
  expect(submodule(null, b)).toEqual(["A submodule, at commit bbbbbbb."]);
  expect(submodule(a, null)).toEqual(["A submodule, which was at commit aaaaaaa."]);
});

test("sizes are written in bytes, then in thousands", () => {
  expect(size(0)).toBe("0 bytes");
  expect(size(1)).toBe("1 byte");
  expect(size(999)).toBe("999 bytes");
  expect(size(1000)).toBe("1 KB");
  expect(size(1250)).toBe("1.3 KB");
  expect(size(999_960)).toBe("1 MB");
  expect(size(5_000_000_000)).toBe("5 GB");
  expect(size(7e15)).toBe("7000 TB");
});
