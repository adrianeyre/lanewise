import type { MergeError } from "../commands/api";
import { commits } from "./branchProblems";
import { describeRepositoryError } from "./problems";

/** What was being done when merging failed, to say what didn't happen. */
export type MergeRun = "preview" | "merge" | "abort";

const didNot: Record<MergeRun, string> = {
  preview: "Nothing can be merged",
  merge: "Nothing was merged",
  abort: "The merge wasn't aborted",
};

/**
 * What to tell the user when `run` failed. `moved`, which the preview
 * dialog explains itself, is said briefly here for anywhere else it comes.
 * Git's own words are part of it, as Git wrote them.
 */
export function describeMergeError(error: MergeError, run: MergeRun): string {
  switch (error.kind) {
    case "branchNotFound":
      return `${didNot[run]}: there's no branch called “${error.name}” any more.`;
    case "noCommits":
      return `${didNot[run]}: the current branch has no commits yet to merge into.`;
    case "mergeInProgress":
      return `${didNot[run]}: a merge is in progress already. Finish it or abort it first.`;
    case "notMerging":
      return `${didNot[run]}: there's no merge in progress any more.`;
    case "moved":
      return `${didNot[run]}: a branch moved since the merge was shown. It would now bring in ${commits(error.preview.commits)}.`;
    case "fastForwardOnly":
      return `${didNot[run]}: your Git config allows only fast-forward merges, and this merge needs a merge commit.`;
    case "wouldOverwrite":
      return `${didNot[run]}: merging would overwrite your uncommitted changes to ${error.paths.join(", ")}. Commit or stash them first.`;
    case "gitUnavailable":
      return `${didNot[run]}: Lanewise can't find a Git 2.40 or later to run. Install one, then open the repository again.`;
    case "gitFailed":
      return `${didNot[run]}. ${error.code === null ? "Git was stopped" : `Git stopped with exit code ${error.code}`}${error.message === "" ? "" : `:\n${error.message}`}`;
    default:
      return describeRepositoryError(error);
  }
}
