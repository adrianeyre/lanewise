import { type DiffHunk, NO_NEWLINE } from "../commands/api";

/** One side of a line in the split view: its number in its file and its text, without the `+`, `-` or space. */
export interface SplitSide {
  number: number;
  text: string;
  /** `removed` on the old side, `added` on the new, `context` on both for a line they share. */
  kind: "context" | "removed" | "added";
  /** Whether the file ends here without a newline. */
  noNewline: boolean;
}

/** A row of the split view: the old file's line on the left and the new file's on the right, either missing. */
export interface SplitRow {
  old: SplitSide | null;
  new: SplitSide | null;
}

/**
 * A hunk's lines side by side, as the split view draws them (ADR 0033): a
 * line both files have is on both sides; a run of removed lines is beside
 * the run of added lines that follows it, line for line, with a gap on
 * whichever side has fewer; and each is numbered as it is in its own file.
 */
export function splitHunk(hunk: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = [];
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  // The run of changes being paired: removed lines, then the added lines after them.
  let removed: SplitSide[] = [];
  let added: SplitSide[] = [];
  // The side the last line was on, for a "no newline" marker to follow.
  let last: SplitSide[] = [];

  const flush = () => {
    for (let at = 0; at < Math.max(removed.length, added.length); at++) {
      rows.push({ old: removed[at] ?? null, new: added[at] ?? null });
    }
    removed = [];
    added = [];
  };

  for (const line of hunk.lines) {
    if (line === NO_NEWLINE) {
      for (const side of last) side.noNewline = true;
      continue;
    }
    const text = line.slice(1);
    if (line.startsWith("-")) {
      // A removal after additions starts a new run.
      if (added.length > 0) flush();
      const side: SplitSide = { number: oldLine++, text, kind: "removed", noNewline: false };
      removed.push(side);
      last = [side];
    } else if (line.startsWith("+")) {
      const side: SplitSide = { number: newLine++, text, kind: "added", noNewline: false };
      added.push(side);
      last = [side];
    } else {
      flush();
      const old: SplitSide = { number: oldLine++, text, kind: "context", noNewline: false };
      const shared: SplitSide = { number: newLine++, text, kind: "context", noNewline: false };
      rows.push({ old, new: shared });
      last = [old, shared];
    }
  }
  flush();
  return rows;
}
