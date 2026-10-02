import type { ConflictedFile, WholeFileChoice } from "../commands/api";

/**
 * Whether a conflicted file is resolved as a whole, by keeping one side's
 * version or deleting it, rather than Conflict Hunk by Conflict Hunk: when a
 * side deleted it, or renamed it away, or when Ours, Theirs or the working
 * tree's file isn't text Lanewise can show. It has no Three-way view, and no
 * AI Suggestion (PRD §7.7).
 */
export function resolvedWhole(file: ConflictedFile): boolean {
  return file.ours?.kind !== "text" || file.theirs?.kind !== "text" || file.working?.kind !== "text";
}

/** Whether Git reports a rename among the file's conflicts. */
function renamed(file: ConflictedFile): boolean {
  return file.reports.some((report) => report.kind.startsWith("rename"));
}

/**
 * What happened to a file resolved as a whole, in words: `Ours deleted this
 * file, and Theirs changed it.`, say, or, with a rename Git reports, `Ours
 * deleted this file, and Theirs renamed it here.`
 */
export function describeWholeFile(file: ConflictedFile): string {
  const { base, ours, theirs, working } = file;
  if (ours === null && theirs === null) {
    return "Neither Ours nor Theirs has this file any more: each deleted it or renamed it.";
  }
  if (ours === null || theirs === null) {
    const [gone, kept] = ours === null ? ["Ours", "Theirs"] : ["Theirs", "Ours"];
    if (base === null) {
      return `Only ${kept} has this file${renamed(file) ? ", having renamed a file to it" : ""}. ${gone} doesn't.`;
    }
    return `${gone} deleted this file, and ${kept} ${renamed(file) ? "renamed it here" : "changed it"}.`;
  }
  const notText = [ours.kind === "text" ? null : "Ours", theirs.kind === "text" ? null : "Theirs"].filter(
    (side) => side !== null,
  );
  if (notText.length > 0) {
    return `Ours and Theirs each changed this file, and ${notText.length === 2 ? "neither is" : `${notText[0]} isn't`} text Lanewise can show: it's binary, not UTF-8, a symbolic link or a submodule.`;
  }
  return working === null
    ? "Ours and Theirs each changed this file, and it's gone from the working tree, so there are no Conflict Markers to resolve."
    : "Ours and Theirs each changed this file, and in the working tree it isn't text Lanewise can show.";
}

/** One whole-file choice: what it's called, and what's said once it's made. */
export interface WholeFileOption {
  choice: WholeFileChoice;
  name: string;
  /** Said of the file at `path` once it's resolved so. */
  said: (path: string) => string;
}

/**
 * The whole-file choices a conflicted file has: keeping each side that has a
 * version of it, and deleting it, where a side already did or renamed it
 * away.
 */
export function wholeFileOptions(file: ConflictedFile): WholeFileOption[] {
  const oneSided = file.ours === null || file.theirs === null;
  const keep = (choice: "ours" | "theirs", side: string): WholeFileOption => ({
    choice,
    name: oneSided ? `Keep the file, as ${side} has it` : `Keep ${side}`,
    said: (path) => `Kept “${path}” as ${side} has it, and marked it resolved.`,
  });
  const options: WholeFileOption[] = [];
  if (file.ours !== null) options.push(keep("ours", "Ours"));
  if (file.theirs !== null) options.push(keep("theirs", "Theirs"));
  if (oneSided) {
    options.push({
      choice: "delete",
      name: "Delete the file",
      said: (path) => `Deleted “${path}”, and marked it resolved.`,
    });
  }
  return options;
}
