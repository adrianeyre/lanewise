import type { StashError } from "../commands/api";
import { describeFailure, describeRepositoryError } from "./problems";

/** What was being done when a stash command failed, to say what didn't happen. */
export type StashRun = "read" | "create" | "apply" | "pop" | "drop";

const didNot: Record<StashRun, string> = {
  read: "Lanewise couldn't read the stash",
  create: "Nothing was stashed",
  apply: "The stash wasn't applied",
  pop: "The stash wasn't popped",
  drop: "The stash wasn't dropped",
};

/**
 * What to tell the user when `run` failed. Git's own words are part of it,
 * as Git wrote them.
 */
export function describeStashError(error: StashError, run: StashRun): string {
  switch (error.kind) {
    case "stashNotFound":
      return `${didNot[run]}: it's no longer in the repository. It may have been dropped or popped elsewhere.`;
    case "noCommits":
      return `${didNot[run]}: the current branch has no commits yet to stash changes against. Make the first commit first.`;
    case "nothingToStash":
      return `${didNot[run]}: there are no uncommitted changes to stash.`;
    case "inProgress":
      return `${didNot[run]}: a merge, rebase or stash apply is in progress. Finish it first.`;
    case "wouldOverwrite":
      return `${didNot[run]}: it would overwrite your uncommitted changes to ${error.paths.join(", ")}, so Git didn't. Nothing has changed. Commit or stash them first.`;
    case "fileNotFound":
      return `This stash has no file ${error.path}. Choose another in the Stashes Widget.`;
    case "gitUnavailable":
      return `${didNot[run]}: Lanewise can't find a Git 2.40 or later to run. Install one, then open the repository again.`;
    case "invalidCursor":
      return describeFailure("The core refused a cursor it gave.");
    case "gitFailed":
      return `${didNot[run]}. ${error.code === null ? "Git was stopped" : `Git stopped with exit code ${error.code}`}${error.message === "" ? "" : `:\n${error.message}`}`;
    default:
      return describeRepositoryError(error);
  }
}
