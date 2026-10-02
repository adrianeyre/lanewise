import type { GitRunError } from "../commands/api";
import { describeRepositoryError } from "./problems";

/** What was being done when `git` failed, to say what didn't happen. */
export type GitRun = "stage" | "unstage" | "stageHunk" | "unstageHunk" | "commit" | "amend" | "readLastCommit";

const didNot: Record<GitRun, string> = {
  stage: "The files weren't staged",
  unstage: "The files weren't unstaged",
  stageHunk: "The hunk wasn't staged",
  unstageHunk: "The hunk wasn't unstaged",
  commit: "Nothing was committed",
  amend: "The last commit wasn't amended",
  readLastCommit: "Lanewise couldn't read the last commit",
};

/**
 * What to tell the user when `git` failed at `run`. Git's own words, such
 * as a failing hook's output, are part of it, as Git wrote them.
 */
export function describeGitRunError(error: GitRunError, run: GitRun): string {
  switch (error.kind) {
    case "gitUnavailable":
      return `${didNot[run]}: Lanewise can't find a Git 2.40 or later to run. Install one, then open the repository again.`;
    case "nothingStaged":
      return "Nothing is staged, so there's nothing to commit. Stage the changes to commit first, or amend the last commit.";
    case "gitFailed":
      return `${didNot[run]}. ${exited(error.code)}${error.message === "" ? "" : `:\n${error.message}`}`;
    default:
      return describeRepositoryError(error);
  }
}

function exited(code: number | null): string {
  return code === null ? "Git was stopped" : `Git stopped with exit code ${code}`;
}
