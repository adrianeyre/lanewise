/**
 * Replays a repository's merges with the system `git` to find the Conflict
 * Hunks they had, each with its ground truth in the merge commit (ADR 0027).
 * `git merge-tree --write-tree` merges each merge's two parents again
 * without a working tree, with `merge.conflictStyle=diff3` so each Conflict
 * Hunk shows its Base, and writes the files it leaves conflicted, markers
 * and all, as blobs.
 */

import { execFileSync } from "node:child_process";

import { type CorpusFile, excerpt, hunkKey, keepsPath, keptHunks, resolvedAs } from "./corpus";

/** The most lines a conflicted file may have for its Conflict Hunks to be kept. */
const MOST_FILE_LINES = 20_000;

/** `git` with `args` in the repository at `gitDir`, its output as text. It throws if Git fails, unless `ok` takes its exit code. */
export function git(gitDir: string, args: readonly string[], ok: readonly number[] = [0]): string {
  try {
    return execFileSync("git", ["--git-dir", gitDir, "-c", "core.quotePath=false", ...args], {
      encoding: "utf8",
      maxBuffer: 1 << 30,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (failure) {
    const { status, stdout } = failure as { status: number | null; stdout?: string };
    if (status !== null && ok.includes(status) && stdout !== undefined) return stdout;
    throw failure;
  }
}

/** Up to `count` merges of two parents that `at` has, newest first. */
export function merges(gitDir: string, at: string, count: number): string[] {
  const listed = git(gitDir, ["rev-list", "--merges", "--max-parents=2", `--max-count=${count}`, at]);
  return listed.split("\n").filter((line) => line !== "");
}

/** A blob's text, or `null` where it's binary, as Git tells it: with a NUL in its first 8000 bytes. */
function textOf(gitDir: string, blob: string): string | null {
  const bytes = execFileSync("git", ["--git-dir", gitDir, "cat-file", "blob", blob], { maxBuffer: 1 << 30 });
  if (bytes.subarray(0, 8000).includes(0)) return null;
  return bytes.toString("utf8");
}

/** The blob at `path` in `commit`'s tree, or `null` where it has none. */
function blobAt(gitDir: string, commit: string, path: string): string | null {
  const listed = git(gitDir, ["ls-tree", "-z", commit, "--", path]).split("\0")[0] ?? "";
  const [info = ""] = listed.split("\t");
  const [, type, blob] = info.split(" ");
  return type === "blob" && blob !== undefined ? blob : null;
}

function subject(gitDir: string, commit: string): string | null {
  const said = git(gitDir, ["log", "-1", "--format=%s", commit]).trim();
  return said === "" ? null : said;
}

/**
 * The conflicted files `merge` had, each with the Conflict Hunks the corpus
 * keeps from it, up to `limit` of them in all, but none whose key is in
 * `seen`, which it adds each one's to. A merge Git replays without a
 * conflict has none.
 */
export function replayMerge(gitDir: string, merge: string, seen: Set<string>, limit: number): CorpusFile[] {
  const [ours = "", theirs = ""] = git(gitDir, ["rev-list", "--parents", "-n", "1", merge]).trim().split(" ").slice(1);
  // Exit code 1 is a merge with conflicts; the tree is written even so.
  const written = git(
    gitDir,
    ["-c", "merge.conflictStyle=diff3", "merge-tree", "--write-tree", "--name-only", "-z", "--no-messages", ours, theirs],
    [0, 1],
  );
  const [tree = "", ...paths] = written.split("\0");
  const conflicted = [...new Set(paths.filter((path) => path !== ""))];
  const files: CorpusFile[] = [];
  let room = limit;
  for (const path of conflicted.filter(keepsPath)) {
    if (room <= 0) break;
    const conflictedBlob = blobAt(gitDir, tree, path);
    const committed = blobAt(gitDir, merge, path);
    if (conflictedBlob === null || committed === null) continue;
    const text = textOf(gitDir, conflictedBlob);
    const result = textOf(gitDir, committed);
    if (text === null || result === null || text.split("\n").length > MOST_FILE_LINES) continue;
    const diff = git(gitDir, ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--histogram", "-U0", conflictedBlob, committed]);
    const kept = keptHunks(text, result, diff)
      .filter(({ hunk }) => !seen.has(hunkKey(path, hunk)))
      .slice(0, room);
    if (kept.length === 0) continue;
    for (const { hunk } of kept) seen.add(hunkKey(path, hunk));
    room -= kept.length;
    const { firstLine, lines, starts } = excerpt(
      text,
      kept.map(({ hunk }) => hunk),
    );
    files.push({
      merge,
      ours,
      theirs,
      oursSubject: subject(gitDir, ours),
      theirsSubject: subject(gitDir, theirs),
      path,
      firstLine,
      lines,
      hunks: kept.map(({ hunk, number, of, resolution }, index) => ({
        line: starts[index] ?? 0,
        number,
        of,
        resolution,
        resolvedAs: resolvedAs(hunk, resolution),
      })),
    });
  }
  return files;
}
