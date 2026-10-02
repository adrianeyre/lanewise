/**
 * The conflict evaluation corpus (PRD §14): Conflict Hunks from real merges
 * in open-source repositories, each with its ground truth: what the merge
 * commit has in its place. `buildCorpus.ts` makes it by replaying each merge, and
 * `evaluate.ts` asks a Model Provider for a Suggestion for each Conflict Hunk.
 * This module is the corpus's shape and the pure parts of making it.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { type ConflictHunk, conflictHunks, hasConflictMarkers } from "../../src/conflicts/conflictHunks";
import { MOST_CONTEXT_LINES } from "../../src/ai/suggestionRequest";

/** One repository the corpus is replayed from, as `eval/repositories.json` lists it. */
export interface CorpusSource {
  /** Its name in the corpus, which names its file: lowercase letters, digits and dashes. */
  name: string;
  /** Where it's cloned from. */
  url: string;
  /** Its licence, as an SPDX identifier. */
  licence: string;
  /** Its licence's file, which is kept beside its part of the corpus. */
  licenceFile: string;
  /** The commit its merges are read back from, so the corpus is made again the same. */
  at: string;
  /** How many merges before `at` are replayed, newest first. */
  merges: number;
}

/**
 * How the merge commit resolved a Conflict Hunk: as one of the
 * choices the Resolution Widget offers, or `written`, as neither side had it.
 */
export type ResolvedAs = "ours" | "theirs" | "oursThenTheirs" | "theirsThenOurs" | "written";

/** One Conflict Hunk in a {@link CorpusFile}, with its ground truth. */
export interface CorpusHunk {
  /** The line, from 1 in the file's `lines`, of its `<<<<<<<`. */
  line: number;
  /** Which Conflict Hunk it is in the whole file, from 1, and how many the file has. */
  number: number;
  of: number;
  /** Its ground truth: the lines the merge commit has in its place. */
  resolution: string[];
  resolvedAs: ResolvedAs;
}

/** A conflicted file from one replayed merge, with the Conflict Hunks the corpus keeps from it. */
export interface CorpusFile {
  /** The merge commit, and its two parents: Ours, the first, and Theirs. */
  merge: string;
  ours: string;
  theirs: string;
  oursSubject: string | null;
  theirsSubject: string | null;
  path: string;
  /**
   * The line, from 1, in the whole conflicted file, that `lines` starts at.
   * Only enough of the file is kept for the most context Settings allows.
   */
  firstLine: number;
  /** The conflicted file's lines, with Conflict Markers as `diff3` shows them, Base and all. */
  lines: string[];
  hunks: CorpusHunk[];
}

/** One source's part of the corpus, as `eval/corpus/<name>.json` keeps it. */
export interface CorpusPart {
  source: CorpusSource;
  /** The `git --version` it was replayed with, since another Git may leave other Conflict Hunks. */
  git: string;
  files: CorpusFile[];
}

/** One Conflict Hunk of the corpus, found in its file, ready to ask about. */
export interface CorpusCase {
  source: string;
  file: CorpusFile;
  hunk: CorpusHunk;
  /** The conflicted text `file.lines` makes, and the Conflict Hunk in it. */
  text: string;
  conflict: ConflictHunk;
}

/**
 * The lines of `text`, without the empty one after its last newline. The
 * Resolution's text is split this way too (`putSuggestion`).
 */
export function linesOf(text: string): string[] {
  const lines = text.split(/\r\n?|\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/**
 * The lines of the old file that a `git diff -U0` from it leaves unchanged,
 * each mapped to its line in the new file, both from 1. `oldLines` is how
 * many lines the old file has.
 */
export function unchangedLines(diff: string, oldLines: number): Map<number, number> {
  const unchanged = new Map<number, number>();
  let old = 1;
  let shift = 0;
  const keep = (upTo: number) => {
    for (; old <= upTo; old++) unchanged.set(old, old + shift);
  };
  for (const [, from, count = "1", , added = "1"] of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(from);
    const removed = Number(count);
    // With none removed, `start` is the line the new ones come after.
    keep(removed === 0 ? start : start - 1);
    old += removed;
    shift += Number(added) - removed;
  }
  keep(oldLines);
  return unchanged;
}

/**
 * The committed lines in place of `hunk`, a Conflict Hunk of `conflicted`,
 * in `result`, the merge commit's file, found by `unchanged` from
 * {@link unchangedLines}. That's only certain where the lines just before
 * and just after it are left as they were, or it starts or ends the file:
 * otherwise it's `null`.
 */
export function groundTruth(
  hunk: ConflictHunk,
  conflictedLines: number,
  result: readonly string[],
  unchanged: ReadonlyMap<number, number>,
): string[] | null {
  const before = hunk.startLine === 1 ? 0 : unchanged.get(hunk.startLine - 1);
  const after = hunk.endLine === conflictedLines ? result.length + 1 : unchanged.get(hunk.endLine + 1);
  if (before === undefined || after === undefined || after <= before) return null;
  return result.slice(before, after - 1);
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

/** How `resolution` resolved `hunk`. */
export function resolvedAs(hunk: ConflictHunk, resolution: readonly string[]): ResolvedAs {
  if (same(resolution, hunk.ours)) return "ours";
  if (same(resolution, hunk.theirs)) return "theirs";
  if (same(resolution, [...hunk.ours, ...hunk.theirs])) return "oursThenTheirs";
  if (same(resolution, [...hunk.theirs, ...hunk.ours])) return "theirsThenOurs";
  return "written";
}

/** The most lines a side of a kept Conflict Hunk, or its ground truth, may have, so a request stays small. */
export const MOST_HUNK_LINES = 80;

/** Files that are made by a tool, not written, whose Conflict Hunks no one resolves by reading them. */
const GENERATED = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|uv\.lock|poetry\.lock|Pipfile\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/;

/** Whether the Conflict Hunks at `path` are kept at all: not those of a generated file, such as a lockfile. */
export function keepsPath(path: string): boolean {
  return !GENERATED.test(path);
}

/**
 * The Conflict Hunks of `conflicted`, the file Git left at `path`, that the
 * corpus keeps, each with the lines `result`, the committed file, has in
 * its place, and `diff`, a `git diff -U0` from one to the other. It keeps
 * those whose ground truth is certain and has no Conflict Markers, and
 * whose sides and ground truth are each at most {@link MOST_HUNK_LINES} long.
 */
export function keptHunks(
  conflicted: string,
  result: string,
  diff: string,
): { hunk: ConflictHunk; number: number; of: number; resolution: string[] }[] {
  const conflictedLines = linesOf(conflicted).length;
  const resultLines = linesOf(result);
  const unchanged = unchangedLines(diff, conflictedLines);
  const hunks = conflictHunks(conflicted);
  return hunks.flatMap((hunk, index) => {
    const resolution = groundTruth(hunk, conflictedLines, resultLines, unchanged);
    if (resolution === null || hasConflictMarkers(resolution.join("\n"))) return [];
    const sides = [hunk.ours, hunk.theirs, hunk.base ?? [], resolution];
    if (sides.some((side) => side.length > MOST_HUNK_LINES)) return [];
    return [{ hunk, number: index + 1, of: hunks.length, resolution }];
  });
}

/**
 * The part of `conflicted`'s lines kept for `hunks`: from the most context
 * Settings allows before the first to the most after the last, with the
 * line, from 1, it starts at, and each Conflict Hunk's line in it.
 */
export function excerpt(
  conflicted: string,
  hunks: readonly ConflictHunk[],
): { firstLine: number; lines: string[]; starts: number[] } {
  const lines = linesOf(conflicted);
  const first = Math.max(1, Math.min(...hunks.map(({ startLine }) => startLine)) - MOST_CONTEXT_LINES);
  const last = Math.min(lines.length, Math.max(...hunks.map(({ endLine }) => endLine)) + MOST_CONTEXT_LINES);
  return {
    firstLine: first,
    lines: lines.slice(first - 1, last),
    starts: hunks.map(({ startLine }) => startLine - first + 1),
  };
}

/** A key for a Conflict Hunk by its path and sides, so one met again in a later merge is kept once. */
export function hunkKey(path: string, hunk: ConflictHunk): string {
  return JSON.stringify([path, hunk.ours, hunk.base, hunk.theirs]);
}

/**
 * Each Conflict Hunk of `part` found again in its file, in order. A
 * Conflict Hunk that isn't where the corpus says it is has been edited by
 * hand, and is an error.
 */
export function corpusCases(part: CorpusPart): CorpusCase[] {
  return part.files.flatMap((file) => {
    const text = `${file.lines.join("\n")}\n`;
    const found = conflictHunks(text);
    return file.hunks.map((hunk) => {
      const conflict = found.find(({ startLine }) => startLine === hunk.line);
      if (conflict === undefined) {
        throw new Error(`${part.source.name}: ${file.path} at ${file.merge} has no Conflict Hunk at line ${hunk.line}.`);
      }
      return { source: part.source.name, file, hunk, text, conflict };
    });
  });
}

/** Each source's part of the corpus in `corpusDir`, by name. */
export function readCorpus(corpusDir: string): CorpusPart[] {
  return readdirSync(corpusDir)
    .filter((name) => name.endsWith(".json"))
    .toSorted()
    .map((name) => JSON.parse(readFileSync(join(corpusDir, name), "utf8")) as CorpusPart);
}
