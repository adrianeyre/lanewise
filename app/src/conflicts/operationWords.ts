import type { HistoryCommit, InProgressOperation, OperationError } from "../commands/api";
import { describeRepositoryError } from "../repository/problems";
import { titleOf } from "../repository/stashWords";

/** What's being done when an In-Progress Operation command fails, to say what didn't happen. */
export type OperationRun = "continue" | "skip" | "abort" | "mark" | "unmark" | "read" | "resolve" | "resolveWhole";

/** What the In-Progress Operation is called in a sentence: "merge", "rebase", "stash pop", "stash apply", "cherry-pick" or "revert". */
export function operationNoun(operation: InProgressOperation): string {
  switch (operation.kind) {
    case "merge":
      return "merge";
    case "rebase":
      return "rebase";
    case "stashApply":
      return operation.pop ? "stash pop" : "stash apply";
    case "cherryPick":
      return "cherry-pick";
    case "revert":
      return "revert";
  }
}

/** The In-Progress Operation Widget's heading: "Merge in progress". */
export function operationHeading(operation: InProgressOperation): string {
  const noun = operationNoun(operation);
  return `${noun[0]!.toUpperCase()}${noun.slice(1)} in progress`;
}

/** A branch a commit's Labels name, quoted, or else the commit by its short ID. */
export function named(commit: HistoryCommit): string {
  const label = commit.labels.find(({ kind }) => kind === "branch" || kind === "remoteBranch");
  return label === undefined ? `commit ${commit.shortId}` : `“${label.name}”`;
}

/**
 * Which operation Git stopped partway, with what: `Merging “feature” into
 * “main”`, `Rebasing “main” onto “origin/main”, commit 3 of 7` or
 * `Popping stash “Work”`.
 */
export function describeOperation(operation: InProgressOperation): string {
  switch (operation.kind) {
    case "merge": {
      const merging = operation.merging.length === 0 ? "a commit" : operation.merging.map(named).join(" and ");
      return `Merging ${merging} into ${operation.into === null ? "HEAD" : `“${operation.into}”`}`;
    }
    case "rebase": {
      const { branch, onto, step, steps } = operation;
      const rebasing = branch === null ? "Rebasing HEAD" : `Rebasing “${branch}”`;
      const target = onto === null ? "" : ` onto ${named(onto)}`;
      const at = step === null ? "" : steps === null ? `, commit ${step}` : `, commit ${step} of ${steps}`;
      return `${rebasing}${target}${at}`;
    }
    case "stashApply": {
      const doing = operation.pop ? "Popping" : "Applying";
      return operation.stash === null ? `${doing} a stash` : `${doing} stash “${titleOf(operation.stash)}”`;
    }
    case "cherryPick":
    case "revert": {
      const doing = operation.kind === "cherryPick" ? "Cherry-picking" : "Reverting";
      const commit = operation.commit === null ? "a commit" : `commit ${operation.commit.shortId} “${operation.commit.summary}”`;
      const into = operation.into === null ? "HEAD" : `“${operation.into}”`;
      return `${doing} ${commit} ${operation.kind === "cherryPick" ? "onto" : "on"} ${into}`;
    }
  }
}

/** “1 file” or “3 files”. */
export function files(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}

/** Where the In-Progress Operation stands: its files conflicted still, or none. */
export function describeStanding(operation: InProgressOperation): string {
  const { conflicts } = operation;
  if (conflicts.length > 0) {
    return `${describeOperation(operation)}, stopped with conflicts in ${files(conflicts.length)}.`;
  }
  return `${describeOperation(operation)}. Nothing is conflicted: continue to finish it, or abort it.`;
}

/** What Continue does, for the operation in progress. */
export function describeContinue(operation: InProgressOperation): string {
  switch (operation.kind) {
    case "merge":
      return "Continue commits the merge, with Git's own message.";
    case "rebase":
      return "Continue commits this commit as resolved and replays the rest, stopping again at one that conflicts. Skip leaves this commit out.";
    case "stashApply":
      return operation.pop
        ? "Continue keeps the stash's changes in the working tree, as a pop with no conflicts would have, and drops the stash."
        : "Continue keeps the stash's changes in the working tree, as an apply with no conflicts would have, and keeps the stash.";
    case "cherryPick":
      return "Continue commits the cherry-pick, with the commit's own message. Skip leaves the commit out.";
    case "revert":
      return "Continue commits the revert, with Git's own message. Skip leaves the revert out.";
  }
}

/** What Abort undoes, for its confirmation. */
export function describeAbort(operation: InProgressOperation): string {
  switch (operation.kind) {
    case "merge":
      return "Aborting puts the branch, index and working tree back as they were before the merge, with git merge --abort. Every resolution made so far is lost.";
    case "rebase":
      return `Aborting puts ${operation.branch === null ? "HEAD" : `“${operation.branch}”`} back where it was before the rebase, with git rebase --abort. The commits replayed so far, and every resolution made so far, are lost.`;
    case "stashApply":
      return operation.stash === null
        ? "Aborting puts back the files the stash changed. For one started outside Lanewise, whose stash Lanewise doesn't know, it runs git reset --merge, which unstages any changes staged before it too, and leaves the stash's untracked files. Every resolution made so far is lost. The stash is kept."
        : `Aborting puts the files the stash changed back as they were before the ${operation.pop ? "pop" : "apply"}, staged or not, removes the untracked files it added, and keeps the stash. Every resolution made so far is lost. Your other changes stay.`;
    case "cherryPick":
      return `Aborting puts ${operation.into === null ? "HEAD" : `“${operation.into}”`} and the working tree back as they were before the cherry-pick, with git cherry-pick --abort. Every resolution made so far is lost.`;
    case "revert":
      return `Aborting puts ${operation.into === null ? "HEAD" : `“${operation.into}”`} and the working tree back as they were before the revert, with git revert --abort. Every resolution made so far is lost.`;
  }
}

const didNot: Record<OperationRun, string> = {
  continue: "The In-Progress Operation didn't continue",
  skip: "The commit wasn't skipped",
  abort: "The In-Progress Operation wasn't aborted",
  mark: "Nothing was marked resolved",
  unmark: "Nothing was marked unresolved",
  read: "The conflicted file couldn't be shown",
  resolve: "The Resolution wasn't written or marked resolved",
  resolveWhole: "The file wasn't resolved",
};

/** What to tell the user when `run` failed. Git's own words are part of it, as Git wrote them. */
export function describeOperationError(error: OperationError, run: OperationRun): string {
  switch (error.kind) {
    case "notInProgress":
      return `${didNot[run]}: there's no merge, rebase, stash apply, cherry-pick or revert in progress any more.`;
    case "unresolved":
      return `${didNot[run]}: ${error.conflicts.length === 1 ? `“${error.conflicts[0]}” is` : `${files(error.conflicts.length)} are`} still conflicted. Mark every file resolved first.`;
    case "notRebasing":
      return `${didNot[run]}: only a rebase, cherry-pick or revert has commits to skip.`;
    case "notConflicted":
      return `${didNot[run]}: “${error.path}” isn't conflicted any more. It may have been marked resolved elsewhere.`;
    case "notText":
      return `${didNot[run]}: “${error.path}” is a symbolic link or a folder in the working tree, not a file to write text to.`;
    case "noVersion":
      return `${didNot[run]}: ${error.side === "ours" ? "Ours" : "Theirs"} has no version of “${error.path}” to keep.`;
    case "file":
      return `${didNot[run]}: Lanewise couldn't read or write “${error.path}”: ${error.message}`;
    case "gitUnavailable":
      return `${didNot[run]}: Lanewise can't find a Git 2.40 or later to run. Install one, then open the repository again.`;
    case "gitFailed":
      return `${didNot[run]}. ${error.code === null ? "Git was stopped" : `Git stopped with exit code ${error.code}`}${error.message === "" ? "" : `:\n${error.message}`}`;
    default:
      return describeRepositoryError(error);
  }
}
