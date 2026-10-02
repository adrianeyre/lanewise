import type { CommandClient, CommandName, CommandRequest, GitProgress, Outcome } from "../commands/api";
import { type ActivityHandle, startActivity } from "./activity";
import { describeProgress, percentOf } from "./gitProgressWords";

type Words = { [N in CommandName]: ((request: CommandRequest<N>) => string) | null };

/** “main”, as a sentence names a branch. */
const quoted = (name: string) => `“${name}”`;

/**
 * What the Activity indicator says while each command runs, or `null` for
 * one it never shows: a long poll, which waits on purpose, the Logs, and
 * the key and gateway reads an AI request makes, which says what it's doing
 * itself. Every command is named, so a new one has to be given its words.
 */
const WORDS: Words = {
  checkGitSetup: () => "Checking the Git Setup…",
  openRepository: () => "Opening the repository…",
  fileStatus: () => "Reading the working tree's changes…",
  commitHistory: () => "Reading the history…",
  gatewayOf: null,
  saveGateway: () => "Saving the gateway…",
  forgetGateway: () => "Forgetting the gateway…",
  gatewayRequest: null,
  graphRowOf: () => "Finding the commit in the Commit graph…",
  graphWindow: () => "Reading the Commit graph…",
  commitDetails: () => "Reading the commit…",
  commitChanges: () => "Reading the commit's changes…",
  commitFileDiff: () => "Reading the diff…",
  stageFiles: () => "Staging…",
  unstageFiles: () => "Unstaging…",
  stageHunk: () => "Staging the Hunk…",
  unstageHunk: () => "Unstaging the Hunk…",
  commit: () => "Committing…",
  lastCommit: () => "Reading the last commit…",
  workingTreeFileDiff: () => "Reading the diff…",
  workingTreeChanges: null,
  branches: () => "Reading the branches and remotes…",
  createBranch: ({ name }) => `Creating the branch ${quoted(name)}…`,
  renameBranch: ({ from, to }) => `Renaming ${quoted(from)} to ${quoted(to)}…`,
  deleteBranch: ({ name }) => `Deleting the branch ${quoted(name)}…`,
  checkOut: ({ branch }) =>
    branch.kind === "commit"
      ? `Checking out commit ${branch.commit.slice(0, 7)}…`
      : branch.kind === "localAt"
        ? `Moving ${quoted(branch.name)} to ${quoted(branch.at)} and checking it out…`
        : `Checking out ${quoted(branch.name)}…`,
  createTag: ({ name }) => `Creating the tag ${quoted(name)}…`,
  deleteTag: ({ name }) => `Deleting the tag ${quoted(name)}…`,
  renameTag: ({ from, to }) => `Renaming the tag ${quoted(from)} to ${quoted(to)}…`,
  rewordCommit: () => "Changing the Commit Message…",
  cherryPick: () => "Cherry-picking…",
  revertCommit: () => "Reverting…",
  previewReset: () => "Working out what the Reset would do…",
  reset: () => "Resetting…",
  addRemote: ({ name }) => `Adding the remote ${quoted(name)}…`,
  renameRemote: ({ from, to }) => `Renaming the remote ${quoted(from)} to ${quoted(to)}…`,
  setRemoteUrl: ({ name }) => `Changing ${quoted(name)}'s URL…`,
  removeRemote: ({ name }) => `Removing the remote ${quoted(name)}…`,
  setUpstream: () => "Setting the Upstream…",
  previewMerge: () => "Working out what the merge would do…",
  merge: ({ branch }) => `Merging ${quoted(branch.name)}…`,
  mergeInProgress: () => "Reading the merge in progress…",
  abortMerge: () => "Aborting the merge…",
  stashes: () => "Reading the stashes…",
  createStash: () => "Stashing…",
  applyStash: () => "Applying the stash…",
  popStash: () => "Popping the stash…",
  dropStash: () => "Dropping the stash…",
  stashChanges: () => "Reading the stash's changes…",
  stashFileDiff: () => "Reading the diff…",
  stashApplyInProgress: () => "Reading the stash being applied…",
  startClone: () => "Starting the clone…",
  cloneProgress: null,
  cancelClone: () => "Cancelling the clone…",
  startFetch: () => "Starting the fetch…",
  startPull: () => "Starting the pull…",
  startPush: () => "Starting the push…",
  deleteRemoteBranch: ({ remote, branch }) => `Deleting ${quoted(branch)} on ${remote}…`,
  remoteProgress: null,
  cancelRemote: () => "Cancelling…",
  remoteOperation: null,
  rebaseInProgress: () => "Reading the rebase in progress…",
  abortRebase: () => "Aborting the rebase…",
  operationInProgress: () => "Reading the In-Progress Operation…",
  continueOperation: () => "Continuing…",
  skipCommit: () => "Skipping the commit…",
  abortOperation: () => "Aborting…",
  markResolved: () => "Marking it resolved…",
  markUnresolved: () => "Marking it unresolved…",
  conflictedFile: () => "Reading the conflicted file…",
  resolveConflict: () => "Saving the Resolution…",
  resolveWholeFile: () => "Saving the Whole-file choice…",
  detectHost: () => "Finding the Host…",
  signInToHost: ({ host }) => `Signing in to ${host}… Finish in your browser if it opens.`,
  hostRepositories: ({ host }) => `Listing your repositories on ${host}…`,
  hostOwners: ({ host }) => `Reading your organizations on ${host}…`,
  pullRequests: () => "Reading the open Pull Requests…",
  issueTrackerAccount: () => "Reading the Issue Tracker account…",
  saveIssueTrackerAccount: () => "Checking and saving the Issue Tracker account…",
  forgetIssueTrackerAccount: () => "Forgetting the Issue Tracker account…",
  issues: () => "Reading the Issues…",
  modelProviderKeyStored: null,
  modelProviderKey: null,
  saveModelProviderKey: () => "Saving the API key…",
  forgetModelProviderKey: () => "Forgetting the API key…",
  writeLog: null,
  diagnostics: () => "Gathering the Diagnostics…",
};

/** What a fetch, pull or push says before Git gives its progress. */
const REMOTE_WORDS = { fetch: "Fetching…", pull: "Pulling…", push: "Pushing…" } as const;

/** Says how Git is going on `activity`, in Git's words, with its percentage where Git knows it. */
function gitProgress(activity: ActivityHandle, progress: GitProgress | null, starting: string) {
  activity.update(describeProgress(progress, starting), progress === null ? null : percentOf(progress));
}

/** Ends the Activity of the clone, fetch, pull or push `key` in `running`, if it has one. */
function endOf(running: Map<number, ActivityHandle>, key: number) {
  running.get(key)?.end();
  running.delete(key);
}

/**
 * A client that shows every command it sends in the Activity indicator
 * while it runs, as {@link WORDS} says, so anything that takes time says
 * what it's doing. A clone, fetch, pull or push runs on after its start
 * command answers, so its Activity stays until its long poll says it's
 * done, showing Git's progress as it goes.
 */
export function trackCommands(commands: CommandClient): CommandClient {
  // The clones, fetches, pulls and pushes running, by their number.
  const clones = new Map<number, ActivityHandle>();
  const remotes = new Map<number, ActivityHandle>();
  return {
    async call<N extends CommandName>(name: N, request: CommandRequest<N>): Promise<Outcome<N>> {
      const words = (WORDS[name] as ((request: CommandRequest<N>) => string) | null) ?? null;
      const activity = words === null ? null : startActivity(words(request));
      let outcome: Outcome<N>;
      try {
        outcome = await commands.call(name, request);
      } catch (failure) {
        if (name === "cloneProgress") endOf(clones, (request as CommandRequest<"cloneProgress">).clone);
        if (name === "remoteProgress") endOf(remotes, (request as CommandRequest<"remoteProgress">).operation);
        throw failure;
      } finally {
        activity?.end();
      }
      follow(name, request, outcome);
      return outcome;
    },
  };

  function follow<N extends CommandName>(name: N, request: CommandRequest<N>, outcome: Outcome<N>) {
    if (name === "startClone" && outcome.ok) {
      const { clone } = (outcome as Outcome<"startClone"> & { ok: true }).value;
      clones.get(clone)?.end();
      clones.set(clone, startActivity("Starting the clone…"));
    } else if ((name === "startFetch" || name === "startPull" || name === "startPush" || name === "remoteOperation") && outcome.ok) {
      const started = (outcome as Outcome<"startFetch"> & { ok: true }).value;
      if (started === null || remotes.has(started.operation)) return;
      remotes.set(started.operation, startActivity(REMOTE_WORDS[started.kind]));
    } else if (name === "cloneProgress") {
      const { clone } = request as CommandRequest<"cloneProgress">;
      const activity = clones.get(clone);
      if (activity === undefined) return;
      const report = outcome as Outcome<"cloneProgress">;
      if (report.ok && report.value.state.kind === "running") {
        gitProgress(activity, report.value.state.progress, "Starting the clone…");
      } else endOf(clones, clone);
    } else if (name === "remoteProgress") {
      const { operation } = request as CommandRequest<"remoteProgress">;
      const activity = remotes.get(operation);
      if (activity === undefined) return;
      const report = outcome as Outcome<"remoteProgress">;
      if (report.ok && report.value.state.kind === "running") {
        gitProgress(activity, report.value.state.progress, "Starting…");
      } else endOf(remotes, operation);
    } else if ((name === "cancelClone" || name === "cancelRemote") && !outcome.ok) {
      // Nothing to cancel: it had gone already.
      if (name === "cancelClone") endOf(clones, (request as CommandRequest<"cancelClone">).clone);
      else endOf(remotes, (request as CommandRequest<"cancelRemote">).operation);
    }
  }
}
