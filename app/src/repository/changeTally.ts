import type { FileStatusEntry } from "../commands/api";

/**
 * How many of the working tree's changes are staged, unstaged and
 * conflicted, as the Working tree Widget last read them, for the Commit
 * graph's Working tree row to show. `more` is whether there are more than
 * were read, so the counts are at least what they say.
 */
export interface ChangeTally {
  staged: number;
  unstaged: number;
  conflicted: number;
  more: boolean;
}

/** The tally of `entries`, the first of more if `more`. */
export function tallyOf(entries: readonly FileStatusEntry[], more: boolean): ChangeTally {
  let staged = 0;
  let unstaged = 0;
  let conflicted = 0;
  for (const entry of entries) {
    if (entry.change.kind === "conflicted") conflicted++;
    else if (entry.staged) staged++;
    else unstaged++;
  }
  return { staged, unstaged, conflicted, more };
}

/** Whether anything is waiting to be committed, or resolved. */
export function hasChanges(tally: ChangeTally): boolean {
  return tally.staged + tally.unstaged + tally.conflicted > 0 || tally.more;
}

/** The tally's counts that aren't nought, each as the row shows it, such as "3 staged" or "1000+ unstaged". */
export function countsOf(tally: ChangeTally): { kind: "conflicted" | "staged" | "unstaged"; words: string }[] {
  const plus = tally.more ? "+" : "";
  return (["conflicted", "staged", "unstaged"] as const)
    .filter((kind) => tally[kind] > 0)
    .map((kind) => ({ kind, words: `${tally[kind]}${plus} ${kind}` }));
}

/** The Working tree row's name, such as "Uncommitted changes: 3 staged, 5 unstaged". */
export function describeTally(tally: ChangeTally | null): string {
  if (tally === null) return "Working tree changes";
  if (!hasChanges(tally)) return "No uncommitted changes";
  const counts = countsOf(tally).map((count) => count.words);
  return counts.length === 0 ? "Uncommitted changes" : `Uncommitted changes: ${counts.join(", ")}`;
}
