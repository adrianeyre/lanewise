import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test } from "vitest";

import { merges, replayMerge } from "./replay";

let dir: string;

/** `git` in the test's repository, as someone with no Git config of their own. */
function git(...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-C",
      dir,
      "-c",
      "user.name=Lanewise",
      "-c",
      "user.email=lanewise@example.test",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.autocrlf=false",
      ...args,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function write(path: string, lines: string[]) {
  writeFileSync(join(dir, path), `${lines.join("\n")}\n`);
}

/**
 * A repository whose last commit merges `theirs` into `main`, where both
 * changed the same line of `greet.py`, and both changed `uv.lock`: the
 * merge wrote a line of its own for the first, and took Theirs for the
 * second.
 */
function mergedRepository(): string {
  git("init", "-q", "-b", "main");
  write("greet.py", ["import os", "", "def greet():", "    pass"]);
  write("uv.lock", ["version = 1"]);
  git("add", ".");
  git("commit", "-q", "-m", "Start");
  git("switch", "-q", "-c", "theirs");
  write("greet.py", ["import os", "", "def greet(who=None):", "    pass"]);
  write("uv.lock", ["version = 3"]);
  git("commit", "-q", "-am", "Let greet take no one");
  git("switch", "-q", "main");
  write("greet.py", ["import os", "", "def greet(name):", "    pass"]);
  write("uv.lock", ["version = 2"]);
  git("commit", "-q", "-am", "Name the greeting");
  try {
    git("merge", "-q", "theirs");
  } catch {
    // It conflicts, as it's meant to.
  }
  write("greet.py", ["import os", "", "def greet(name, who=None):", "    pass"]);
  write("uv.lock", ["version = 3"]);
  git("commit", "-q", "-am", "Merge theirs");
  return git("rev-parse", "HEAD");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lanewise-replay-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("replays a merge to find its Conflict Hunk, Base and all, with what the merge committed", () => {
  const merge = mergedRepository();
  const gitDir = join(dir, ".git");
  expect(merges(gitDir, "HEAD", 10)).toEqual([merge]);
  const [ours, theirs] = [git("rev-parse", "HEAD^1"), git("rev-parse", "HEAD^2")];
  const base = git("merge-base", ours, theirs).slice(0, 7);
  // The lockfile is generated, so it isn't kept.
  expect(replayMerge(gitDir, merge, new Set(), 3)).toEqual([
    {
      merge,
      ours,
      theirs,
      oursSubject: "Name the greeting",
      theirsSubject: "Let greet take no one",
      path: "greet.py",
      firstLine: 1,
      lines: [
        "import os",
        "",
        `<<<<<<< ${ours}`,
        "def greet(name):",
        `||||||| ${base}`,
        "def greet():",
        "=======",
        "def greet(who=None):",
        `>>>>>>> ${theirs}`,
        "    pass",
      ],
      hunks: [{ line: 3, number: 1, of: 1, resolution: ["def greet(name, who=None):"], resolvedAs: "written" }],
    },
  ]);
});

test("keeps a Conflict Hunk met again once, and no more than it's allowed", () => {
  const merge = mergedRepository();
  const gitDir = join(dir, ".git");
  const seen = new Set<string>();
  expect(replayMerge(gitDir, merge, seen, 3)).toHaveLength(1);
  expect(replayMerge(gitDir, merge, seen, 3)).toEqual([]);
  expect(replayMerge(gitDir, merge, new Set(), 0)).toEqual([]);
});

test("finds nothing in a merge Git replays cleanly", () => {
  git("init", "-q", "-b", "main");
  write("a.txt", ["a"]);
  git("add", ".");
  git("commit", "-q", "-m", "Start");
  git("switch", "-q", "-c", "side");
  write("b.txt", ["b"]);
  git("add", ".");
  git("commit", "-q", "-m", "Add b");
  git("switch", "-q", "main");
  write("c.txt", ["c"]);
  git("add", ".");
  git("commit", "-q", "-m", "Add c");
  git("merge", "-q", "--no-edit", "side");
  expect(replayMerge(join(dir, ".git"), git("rev-parse", "HEAD"), new Set(), 3)).toEqual([]);
});
