/**
 * Conflict Hunks in a Resolution's text: each run of lines Git's conflict
 * markers surround, `<<<<<<<` before ours, `|||||||` before the base when
 * `merge.conflictStyle` shows it, `=======` before theirs and `>>>>>>>` after,
 * and the choices that replace one with ours, theirs or both. Pure, over
 * text with `\n` between lines, as CodeMirror gives it.
 */

/** One Conflict Hunk, where it is in the text and what each side has. */
export interface ConflictHunk {
  /** Where its `<<<<<<<` line starts. */
  from: number;
  /** Just past its `>>>>>>>` line and the newline after it, if there is one. */
  to: number;
  /** The line numbers, from 1, of its `<<<<<<<` and `>>>>>>>` lines. */
  startLine: number;
  endLine: number;
  /** Each side's lines, without their newlines. `base` is `null` when the markers don't show it. */
  ours: string[];
  base: string[] | null;
  theirs: string[];
}

/** How a Conflict Hunk is resolved from its sides. */
export type HunkChoice = "ours" | "theirs" | "oursThenTheirs" | "theirsThenOurs";

const START = /^<{7}(?: |$)/;
const BASE = /^\|{7}(?: |$)/;
const SEPARATOR = /^={7}$/;
const END = /^>{7}(?: |$)/;

/**
 * The Conflict Hunks in `text`, in order. Markers that don't make a whole
 * Conflict Hunk, in the right order, aren't one: a `=======` alone is a
 * Markdown heading's underline as often as not.
 */
export function conflictHunks(text: string): ConflictHunk[] {
  const hunks: ConflictHunk[] = [];
  let open: (Omit<ConflictHunk, "to" | "endLine"> & { section: "ours" | "base" | "theirs" }) | null = null;
  let at = 0;
  let number = 0;
  while (at <= text.length) {
    const newline = text.indexOf("\n", at);
    const end = newline === -1 ? text.length : newline;
    const line = text.slice(at, end);
    const next = newline === -1 ? text.length : newline + 1;
    number++;
    if (START.test(line)) {
      // A second start drops the first: markers typed in by hand, half done.
      open = { from: at, startLine: number, ours: [], base: null, theirs: [], section: "ours" };
    } else if (open !== null) {
      if (open.section === "ours" && BASE.test(line)) {
        open.section = "base";
        open.base = [];
      } else if (open.section !== "theirs" && SEPARATOR.test(line)) {
        open.section = "theirs";
      } else if (END.test(line)) {
        if (open.section === "theirs") {
          const { section: _, ...hunk } = open;
          hunks.push({ ...hunk, to: next, endLine: number });
        }
        open = null;
      } else if (open.section === "base") {
        open.base!.push(line);
      } else {
        open[open.section].push(line);
      }
    }
    if (newline === -1) break;
    at = next;
  }
  return hunks;
}

/**
 * Whether `text` still has a line that starts as a conflict marker other
 * than `=======`, whether or not it makes a whole Conflict Hunk.
 */
export function hasConflictMarkers(text: string): boolean {
  return text.split("\n").some((line) => START.test(line) || BASE.test(line) || END.test(line));
}

/**
 * The text that resolves `hunk` in `text` by `choice`: ours, theirs, or
 * both, in either order. A Conflict Hunk that ends the text without a
 * newline is replaced with text that doesn't end in one either.
 */
export function resolvedText(text: string, hunk: ConflictHunk, choice: HunkChoice): string {
  const lines =
    choice === "ours"
      ? hunk.ours
      : choice === "theirs"
        ? hunk.theirs
        : choice === "oursThenTheirs"
          ? [...hunk.ours, ...hunk.theirs]
          : [...hunk.theirs, ...hunk.ours];
  const replaced = lines.map((line) => `${line}\n`).join("");
  const endsText = hunk.to === text.length && !text.endsWith("\n");
  return endsText ? replaced.slice(0, -1) : replaced;
}

/**
 * The Conflict Hunk the choices act on for a cursor at `position`: the one
 * it's in, or else the next after it, or else the last. `null` with none.
 */
export function hunkAt(hunks: readonly ConflictHunk[], position: number): number | null {
  if (hunks.length === 0) return null;
  const index = hunks.findIndex((hunk) => position < hunk.to);
  return index === -1 ? hunks.length - 1 : index;
}
