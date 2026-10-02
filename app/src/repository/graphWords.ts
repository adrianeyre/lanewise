import type { GraphRow } from "../commands/api";

/**
 * A row's place in the Commit graph, in words, for those who can't see the
 * canvas: "merge of feature/x into main", "on main, where feature/y branches
 * off", "a parent 250 commits below". `index` is the row's own. Empty when
 * the graph says nothing about it, as for a commit on an unnamed branch.
 */
export function describePlace(row: GraphRow, index: number): string {
  const words: string[] = [];
  if (row.merged.length > 0) {
    const merged = mergedNames(row);
    words.push(row.line === null ? `merge of ${merged}` : `merge of ${merged} into ${row.line}`);
  } else if (row.line !== null) {
    words.push(`on ${row.line}`);
  }
  if (row.branchesOff.length > 0) {
    const verb = row.branchesOff.length === 1 ? "branches" : "branch";
    words.push(`where ${names(row.branchesOff)} ${verb} off`);
  }
  for (const parent of row.farParents) {
    words.push(`a parent ${commits(parent - index)} below`);
  }
  for (const child of row.farChildren) {
    words.push(`a child ${commits(index - child)} above`);
  }
  return words.join(", ");
}

/**
 * The branches a merge merges. A branch deleted since has no line, but a
 * two-parent merge's summary usually names it, as `git merge` and Hosts
 * write it.
 */
function mergedNames(row: GraphRow): string {
  if (row.merged.length === 1 && row.merged[0] === null) {
    const named =
      /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(row.summary) ??
      /^Merge pull request #\d+ from (\S+)/.exec(row.summary);
    if (named) return named[1]!;
  }
  return names(row.merged);
}

/** "feature/x", "feature/x and feature/y", "feature/x, feature/y and an unnamed branch". */
function names(lines: (string | null)[]): string {
  const named = lines.filter((line) => line !== null);
  const unnamed = lines.length - named.length;
  const all = [...named];
  if (unnamed === 1) all.push("an unnamed branch");
  if (unnamed > 1) all.push(`${unnamed} unnamed branches`);
  return all.length === 1 ? all[0]! : `${all.slice(0, -1).join(", ")} and ${all.at(-1)!}`;
}

function commits(count: number): string {
  return count === 1 ? "1 commit" : `${count} commits`;
}
