import type {
  NewUpstream,
  PullMode,
  Pulled,
  Pushed,
  RemoteError,
  RemoteOperationKind,
  Upstream,
} from "../commands/api";
import { describeSignInFailure } from "../signIn/signInWords";
import { commits } from "./branchProblems";
import { describeFailure, describeRepositoryError } from "./problems";

/** A fetch's, pull's or push's name in a sentence: `fetch`. */
export const operationName: Record<RemoteOperationKind, string> = { fetch: "fetch", pull: "pull", push: "push" };

/** What's said as it starts, and until Git gives its progress. */
export function describeStarting(
  kind: RemoteOperationKind,
  mode: PullMode | null,
  setUpstream: NewUpstream | null = null,
): string {
  switch (kind) {
    case "fetch":
      return "Fetching…";
    case "push":
      return setUpstream === null ? "Pushing…" : `Pushing to ${setUpstream.remote}/${setUpstream.branch}…`;
    case "pull":
      return mode === null ? "Pulling…" : `Pulling ${pullModeWords[mode]}…`;
  }
}

/** A Pull Mode picked for one pull, as in "Pull with rebase". */
export const pullModeWords: Record<PullMode, string> = {
  merge: "with merge",
  rebase: "with rebase",
  fastForwardOnly: "fast-forward only",
};

/**
 * An Upstream and how far the branch is from it, in words: the text
 * alternative to its arrows and counts. `2 commits ahead of origin/main and
 * 1 behind`.
 */
export function describeUpstream({ name, ahead, behind, gone }: Upstream): string {
  if (gone) return `Its Upstream, ${name}, is gone from the remote`;
  if (ahead === 0 && behind === 0) return `Up to date with ${name}`;
  if (behind === 0) return `${commits(ahead)} ahead of ${name}`;
  if (ahead === 0) return `${commits(behind)} behind ${name}`;
  return `${commits(ahead)} ahead of ${name} and ${behind} behind`;
}

/** What a pull did, to say once it's done. */
export function describePulled(pulled: Pulled): string {
  switch (pulled.kind) {
    case "upToDate":
      return "Pulled: already up to date.";
    case "updated":
      return `Pulled ${commits(pulled.commits)}.`;
    case "stopped": {
      const doing = pulled.operation === "rebase" ? "rebasing" : "merging";
      const files = pulled.conflicts.length === 1 ? "1 file" : `${pulled.conflicts.length} files`;
      return pulled.conflicts.length === 0
        ? `The pull stopped partway through ${doing}, and the ${pulled.operation} is still in progress.${pulled.messages === "" ? "" : ` Git said:\n${pulled.messages}`}`
        : `The pull stopped partway through ${doing}, with conflicts in ${files}. The ${pulled.operation} is still in progress.`;
    }
  }
}

/** What a push did, to say once it's done: with `setUpstream`, where it went, now the Upstream. */
export function describePushed(pushed: Pushed, setUpstream: NewUpstream | null = null): string {
  const upstream =
    setUpstream === null ? "" : ` ${setUpstream.remote}/${setUpstream.branch} is the branch's Upstream now.`;
  if (pushed.kind === "upToDate") return `Pushed: already up to date.${upstream}`;
  return `${pushed.commits === null ? "Pushed." : `Pushed ${commits(pushed.commits)}.`}${upstream}`;
}

/** What didn't happen when a fetch, pull or push failed: "Nothing was fetched". */
export const didNot: Record<RemoteOperationKind, string> = {
  fetch: "Nothing was fetched",
  pull: "Nothing was pulled",
  push: "Nothing was pushed",
};

/**
 * What to tell the user when a fetch, pull or push didn't start, or didn't
 * finish. Git's own words are part of it, as Git wrote them, unless it's a
 * Sign-in Failure, which is explained instead.
 */
export function describeRemoteError(error: RemoteError, kind: RemoteOperationKind): string {
  switch (error.kind) {
    case "noRemotes":
      return `${didNot[kind]}: the repository has no remotes. Add one in the Branches & remotes Widget.`;
    case "noCommits":
      return `${didNot[kind]}: the current branch has no commits yet.`;
    case "detached":
      return `${didNot[kind]}: HEAD is detached, on no branch. Check out a branch first.`;
    case "noUpstream":
      return kind === "push"
        ? `${didNot[kind]}: “${error.branch}” has no Upstream. Push it and set one, choosing where it goes.`
        : `${didNot[kind]}: “${error.branch}” has no Upstream. Set one from its menu in the Branches & remotes Widget.`;
    case "remoteNotFound":
      return `${didNot[kind]}: there's no remote called “${error.remote}” any more.`;
    case "invalidName":
      return error.name.trim() === ""
        ? `${didNot[kind]}: the branch on the remote needs a name.`
        : `${didNot[kind]}: Git doesn't allow “${error.name}” as a branch name. Branch names can't have spaces, “..”, “~”, “^”, “:”, “?”, “*” or “[”, or start with “-”.`;
    case "upstreamGone":
      return `${didNot[kind]}: “${error.branch}”'s Upstream, ${error.upstream}, was deleted on the remote.`;
    case "operationInProgress":
      return `${didNot[kind]}: a merge, rebase or other operation is in progress, or a file is still conflicted. Finish it or abort it first.`;
    case "wouldOverwrite":
      return `${didNot[kind]}: pulling would overwrite your uncommitted changes to ${error.paths.join(", ")}. Commit or stash them first.`;
    case "noPullMode":
      return `${didNot[kind]}: the branch and ${error.upstream} have diverged, and your Git config doesn't say whether to merge or rebase. Pull with merge or with rebase instead.`;
    case "notFastForward":
      return `${didNot[kind]}: the branch and ${error.upstream} have diverged, so it can't be fast-forwarded. Pull with merge or with rebase instead.`;
    case "rejected":
      return `The push was rejected: ${error.upstream} has commits the branch doesn't. Pull them in first, then push again.`;
    case "alreadyRunning":
      return `${didNot[kind]}: a ${operationName[error.running]} is running in the repository already.`;
    case "operationNotFound":
      return describeFailure(`The core no longer knows the ${operationName[kind]} it started.`);
    case "gitUnavailable":
      return `${didNot[kind]}: Lanewise can't find a Git 2.40 or later to run. Install one, then open the repository again.`;
    case "signInFailed":
      return describeSignInFailure(didNot[kind], error.failure);
    case "gitFailed":
      return `The ${operationName[kind]} failed. ${error.code === null ? "Git was stopped" : `Git stopped with exit code ${error.code}`}${error.message === "" ? "." : `:\n${error.message}`}`;
    default:
      return describeRepositoryError(error);
  }
}

/**
 * What to tell the user when deleting `name`, a remote-tracking branch such
 * as `origin/topic`, on its remote failed. Git's own words are part of it,
 * as Git wrote them, such as the remote's reason for refusing, unless it's
 * a Sign-in Failure, which is explained instead.
 */
export function describeRemoteDeleteError(error: RemoteError, name: string): string {
  const didNotDelete = `“${name}” wasn't deleted on its remote`;
  switch (error.kind) {
    case "remoteNotFound":
      return `${didNotDelete}: there's no remote called “${error.remote}” any more.`;
    case "invalidName":
      return `${didNotDelete}: Git doesn't allow “${error.name}” as a branch name.`;
    case "gitUnavailable":
      return `${didNotDelete}: Lanewise can't find a Git 2.40 or later to run. Install one, then open the repository again.`;
    case "signInFailed":
      return describeSignInFailure(didNotDelete, error.failure);
    case "gitFailed":
      return `${didNotDelete}. The remote may protect it, or it may be the remote's default branch. ${error.code === null ? "Git was stopped" : `Git stopped with exit code ${error.code}`}${error.message === "" ? "." : `:\n${error.message}`}`;
    default:
      return describeRemoteError(error, "push").replace(didNot.push, didNotDelete);
  }
}
