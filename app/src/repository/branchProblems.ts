import type { BranchError } from "../commands/api";
import { describeRepositoryError } from "./problems";

/** What was being done to a branch when it failed, to say what didn't happen. */
export type BranchRun = "create" | "rename" | "delete" | "checkOut";

const didNot: Record<BranchRun, string> = {
  create: "The branch wasn't created",
  rename: "The branch wasn't renamed",
  delete: "The branch wasn't deleted",
  checkOut: "Nothing was checked out",
};

/**
 * What to tell the user when `run` failed. The errors a dialog explains
 * itself, `unmerged` and `wouldOverwrite`, are said briefly here for
 * anywhere else they come. Git's own words are part of it, as Git wrote
 * them.
 */
export function describeBranchError(error: BranchError, run: BranchRun): string {
  switch (error.kind) {
    case "invalidName":
      return error.name.trim() === ""
        ? `${didNot[run]}: a branch needs a name.`
        : `${didNot[run]}: Git doesn't allow “${error.name}” as a branch name. Branch names can't have spaces, “..”, “~”, “^”, “:”, “?”, “*” or “[”, or start with “-”.`;
    case "alreadyExists":
      return `${didNot[run]}: there's already a branch called “${error.name}”.`;
    case "branchNotFound":
      return `${didNot[run]}: there's no branch called “${error.name}” any more.`;
    case "commitNotFound":
      return `${didNot[run]}: the repository no longer has commit ${error.commit.slice(0, 7)}.`;
    case "isCurrent":
      return `${didNot[run]}: “${error.name}” is the current branch. Check out another branch first.`;
    case "unmerged":
      return `${didNot[run]}: “${error.name}” has ${commits(error.count)} that no other branch or tag has.`;
    case "wouldOverwrite":
      return `${didNot[run]}: it would overwrite your uncommitted changes to ${error.paths.join(", ")}.`;
    case "gitUnavailable":
      return `${didNot[run]}: Lanewise can't find a Git 2.40 or later to run. Install one, then open the repository again.`;
    case "gitFailed":
      return `${didNot[run]}. ${error.code === null ? "Git was stopped" : `Git stopped with exit code ${error.code}`}${error.message === "" ? "" : `:\n${error.message}`}`;
    default:
      return describeRepositoryError(error);
  }
}

/** “1 commit” or “3 commits”. */
export function commits(count: number): string {
  return count === 1 ? "1 commit" : `${count} commits`;
}
