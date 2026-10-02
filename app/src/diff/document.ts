import { type DiffHunk, NO_NEWLINE } from "../commands/api";

/** What a line of a {@link DiffDocument} is. */
export type DiffLineKind = "hunk" | "context" | "added" | "removed" | "noNewline";

/** Which file a line of a diff is from, for highlighting it as that file's code. */
export type DiffSideName = "old" | "new";

/**
 * One side's lines of a diff as a text of their own, without their `+`, `-`
 * or ` `, so it can be parsed as the file's language: the old file's lines in
 * the hunks, or the new file's.
 */
export interface DiffSideText {
  text: string;
  /** Where each of its lines starts in `text`. */
  starts: number[];
  /** The line of the document each of its lines is, from 1. */
  lines: number[];
}

/**
 * A unified diff as the Diff Widget shows it: each hunk's `@@` header, then its
 * lines, each starting with ` `, `+` or `-` as they come from the core, so the
 * marks are part of the text that is read out and copied, not only colour.
 */
export interface DiffDocument {
  text: string;
  /** What each line of `text` is, from its first line. */
  kinds: DiffLineKind[];
  /** The line each hunk's header is, from 1, in the hunks' order. */
  hunks: number[];
  /** Each line's number in the old file, or `null` for a line that isn't in it. */
  oldNumbers: (number | null)[];
  /** Each line's number in the new file, as `oldNumbers` has it. */
  newNumbers: (number | null)[];
  /**
   * The side each line is highlighted from, with its line in that side: the
   * new file for unchanged lines, which are in both.
   */
  sides: ({ side: DiffSideName; line: number } | null)[];
  old: DiffSideText;
  new: DiffSideText;
}

/** A hunk's header, as `git diff` writes it: `@@ -1,3 +1,4 @@`, with no `,1`. */
export function hunkHeader(hunk: DiffHunk): string {
  return `@@ -${range(hunk.oldStart, hunk.oldLines)} +${range(hunk.newStart, hunk.newLines)} @@`;
}

function range(start: number, lines: number): string {
  return lines === 1 ? `${start}` : `${start},${lines}`;
}

export function diffDocument(hunks: DiffHunk[]): DiffDocument {
  const lines: string[] = [];
  const kinds: DiffLineKind[] = [];
  const headers: number[] = [];
  const oldNumbers: (number | null)[] = [];
  const newNumbers: (number | null)[] = [];
  const sides: DiffDocument["sides"] = [];
  const old = sideText();
  const next = sideText();

  for (const hunk of hunks) {
    lines.push(hunkHeader(hunk));
    headers.push(lines.length);
    kinds.push("hunk");
    oldNumbers.push(null);
    newNumbers.push(null);
    sides.push(null);
    let oldLine = hunk.oldLines === 0 ? hunk.oldStart + 1 : hunk.oldStart;
    let newLine = hunk.newLines === 0 ? hunk.newStart + 1 : hunk.newStart;
    for (const line of hunk.lines) {
      const at = lines.length + 1;
      lines.push(line);
      const code = line.slice(1);
      if (line === NO_NEWLINE) {
        kinds.push("noNewline");
        oldNumbers.push(null);
        newNumbers.push(null);
        sides.push(null);
      } else if (line.startsWith("+")) {
        kinds.push("added");
        oldNumbers.push(null);
        newNumbers.push(newLine++);
        sides.push({ side: "new", line: next.add(code, at) });
      } else if (line.startsWith("-")) {
        kinds.push("removed");
        oldNumbers.push(oldLine++);
        newNumbers.push(null);
        sides.push({ side: "old", line: old.add(code, at) });
      } else {
        kinds.push("context");
        oldNumbers.push(oldLine++);
        newNumbers.push(newLine++);
        old.add(code, at);
        sides.push({ side: "new", line: next.add(code, at) });
      }
    }
  }

  return {
    text: lines.join("\n"),
    kinds,
    hunks: headers,
    oldNumbers,
    newNumbers,
    sides,
    old: old.done(),
    new: next.done(),
  };
}

function sideText() {
  const parts: string[] = [];
  const starts: number[] = [];
  const lines: number[] = [];
  let length = 0;
  return {
    /** Adds `code`, the document's line `at`, and gives its index in this side. */
    add(code: string, at: number): number {
      starts.push(length);
      lines.push(at);
      parts.push(code);
      length += code.length + 1;
      return starts.length - 1;
    },
    done(): DiffSideText {
      return { text: parts.join("\n"), starts, lines };
    },
  };
}
