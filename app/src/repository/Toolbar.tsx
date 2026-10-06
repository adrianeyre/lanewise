import {
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUpFromLine,
  Archive,
  CloudDownload,
  GitBranch,
  GitBranchPlus,
  Redo2,
  SkipForward,
  Undo2,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import type {
  BranchesAndRemotes,
  CommandClient,
  NewUpstream,
  OpenedRepository,
  PullMode,
  RemoteOperationKind,
  Stash,
} from "../commands/api";
import type { LinkOpener } from "../legal/ExternalLink";
import { SignInFailureHelp } from "../signIn/SignInFailureHelp";
import { Copyable } from "../ui/Copyable";
import { GitProgressBar } from "../ui/GitProgressBar";
import { describeProgress } from "../ui/gitProgressWords";
import { Menu, type MenuItem } from "../ui/Menu";
import { describeFailure, describeRepositoryError } from "./problems";
import { PushUpstreamDialog } from "./PushUpstreamDialog";
import { describeStarting, didNot, operationName, pullModeWords } from "./remoteWords";
import { UpstreamCounts } from "./UpstreamCounts";
import { NewStashDialog } from "./NewStashDialog";
import { describeStashError } from "./stashProblems";
import { titleOf } from "./stashWords";
import { describeStep, recordUndo, redo, undo, useUndoHistory } from "./undo";
import { useBranchActions } from "./useBranchActions";
import { useRemoteOperation } from "./useRemoteOperation";

interface Props extends LinkOpener {
  commands: CommandClient;
  repository: OpenedRepository;
  /** Counts the times the working tree or its refs changed, on disk or in Lanewise. */
  refreshes: number;
  /** Called once a fetch, pull or push finishes, or is cancelled. */
  onChanged: () => void;
  /** Whether to fetch as it's drawn, as when its Tab is chosen: Settings' Fetch when a Tab is shown. */
  fetchOnShow?: boolean;
  /**
   * Whether the page's Commit graph has its first window, or couldn't read
   * one. Until then it waits to look for a fetch, pull or push running, or
   * to fetch, so `git` doesn't take the CPU the first screen needs (ADR 0043).
   */
  historyRead?: boolean;
  /** The repository's name and folder, drawn on the row under the buttons, beside the current branch. */
  heading?: ReactNode;
  /** The commit selected in the Commit graph, which Branch offers to start a new branch at. */
  selectedCommit?: string | null;
  /** The repository's stashes, newest first, the first of which Pop pops. */
  stashes?: readonly Stash[];
}

/** Whether `target` takes text, where Ctrl+Z and the like are its own. */
function takesText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, textarea, select, .cm-editor") !== null;
}

const PULL_MODES: readonly PullMode[] = ["merge", "rebase", "fastForwardOnly"];

// TODO(#50): force push with lease, and its warning (PRD §7.6, P1).
/**
 * The Repository page's Toolbar (PRD §7.6): the current branch, how far it
 * is ahead of and behind its Upstream, and Fetch, Pull and Push, each run by
 * `git` with its progress and Cancel; a fetch has Skip, to carry on while
 * it finishes in the background, and Close, to stop it. Pull follows the Git config; its menu
 * picks a Pull Mode for one pull instead. Pushing a branch with no Upstream
 * asks where to push it, and sets that as its Upstream. A push the remote
 * rejects says why and offers to pull. Starting one moves focus to its
 * Cancel, or a fetch's Close, and once it has gone, back to the button that started it. It
 * reads the branches again as the refs change. A Sign-in Failure is
 * explained with how to fix it (PRD §9.3). With `fetchOnShow` it fetches as
 * it's drawn, as when its Tab is chosen.
 */
export function Toolbar({
  commands,
  repository,
  refreshes,
  onChanged,
  onOpenLink,
  fetchOnShow = false,
  historyRead = true,
  heading = null,
  selectedCommit = null,
  stashes = [],
}: Props) {
  const [list, setList] = useState<BranchesAndRemotes | null>(null);
  const [unread, setUnread] = useState<string | null>(null);
  const remote = useRemoteOperation(commands, repository, onChanged, { fetchOnShow, ready: historyRead });
  const phaseId = useId();
  const fetchButton = useRef<HTMLButtonElement>(null);
  const pullButton = useRef<HTMLButtonElement>(null);
  const pushButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  /** Set by starting one here, rather than finding one running. */
  const started = useRef(false);
  const wasRunning = useRef<RemoteOperationKind | null>(null);
  /** The branch the push dialog asks about, while it's open. */
  const [asking, setAsking] = useState<string | null>(null);
  /** Where to push once the dialog has closed and given focus back. */
  const queued = useRef<NewUpstream | null>(null);
  const branches = useBranchActions({ commands, repository, onChanged });
  const history = useUndoHistory(repository.root);
  const [stashing, setStashing] = useState(false);
  /** Undo, Redo or Pop, while it runs. */
  const [acting, setActing] = useState(false);
  /** What Undo, Redo, Branch, Stash or Pop did last, or why it didn't. */
  const [done, setDone] = useState<{ said: string } | { problem: string } | null>(null);

  async function act(run: () => Promise<{ ok: true; said: string } | { ok: false; problem: string } | null>) {
    if (acting) return;
    setActing(true);
    setDone(null);
    try {
      const outcome = await run();
      if (outcome === null) return;
      setDone(outcome.ok ? { said: outcome.said } : { problem: outcome.problem });
      onChanged();
    } catch (failure) {
      setDone({ problem: describeFailure(failure) });
    } finally {
      setActing(false);
    }
  }
  const lastUndo = history.undo.at(-1);
  const lastRedo = history.redo.at(-1);
  const runUndo = () => {
    if (lastUndo !== undefined) void act(() => undo(commands, repository.root));
  };
  const runRedo = () => {
    if (lastRedo !== undefined) void act(() => redo(commands, repository.root));
  };
  const newest = stashes.find((stash) => stash.index === 0) ?? stashes[0];
  const pop = () => {
    if (newest === undefined) return;
    void act(async () => {
      const outcome = await commands.call("popStash", { repository: repository.root, stash: newest.id });
      const name = titleOf(newest);
      if (!outcome.ok) return { ok: false, problem: describeStashError(outcome.error, "pop") };
      if (outcome.value.kind === "stopped") {
        return {
          ok: false,
          problem: `Git stopped popping “${name}” with conflicts. Resolve them on the Conflicts page.`,
        };
      }
      recordUndo(repository.root, { kind: "popStash", message: newest.message });
      return { ok: true, said: `Popped “${name}”: its changes are back in the working tree.` };
    });
  };

  // Ctrl+Z (⌘Z) undoes, and Ctrl+Shift+Z or Ctrl+Y (⇧⌘Z) redoes, anywhere on the page but where text is typed.
  const keys = useRef({ runUndo, runRedo });
  useEffect(() => {
    keys.current = { runUndo, runRedo };
  });
  useEffect(() => {
    const pressed = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.defaultPrevented || takesText(event.target)) return;
      if (document.querySelector("dialog[open]") !== null) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) keys.current.runUndo();
      else if ((key === "z" && event.shiftKey) || (key === "y" && !event.metaKey)) keys.current.runRedo();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", pressed);
    return () => window.removeEventListener("keydown", pressed);
  }, []);

  useEffect(() => {
    let current = true;
    const refresh = refreshes > 0;
    commands.call("branches", { repository: repository.root }).then(
      (outcome) => {
        if (!current) return;
        if (outcome.ok) {
          // Read again and found the same, the Toolbar is kept as it is, not drawn again.
          const read = outcome.value;
          setList((shown) => (refresh && JSON.stringify(shown) === JSON.stringify(read) ? shown : read));
          setUnread(null);
        } else setUnread(describeRepositoryError(outcome.error));
      },
      (failure: unknown) => {
        if (current) setUnread(describeFailure(failure));
      },
    );
    return () => {
      current = false;
    };
  }, [commands, repository.root, refreshes]);

  const { status } = remote;
  const running = status.kind === "running";
  const operation = status.kind === "running" ? status.operation : null;

  useLayoutEffect(() => {
    if (operation !== null && wasRunning.current === null && started.current) cancelButton.current?.focus();
    // Cancel went with it: focus goes back to the button that started it, unless it has moved on.
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (operation === null && wasRunning.current !== null && lost) {
      ({ fetch: fetchButton, pull: pullButton, push: pushButton })[wasRunning.current].current?.focus();
    }
    started.current = false;
    wasRunning.current = operation;
  });

  const start = (kind: RemoteOperationKind, mode: PullMode | null = null, setUpstream: NewUpstream | null = null) => {
    if (running) return;
    started.current = true;
    remote.start(kind, mode, setUpstream);
  };
  const pull = (mode: PullMode | null) => start("pull", mode);
  const branch = list?.detached === null ? (list.local.find(({ current }) => current) ?? null) : null;
  const askWhereToPush = (name: string) => {
    if (!running) setAsking(name);
  };
  // A branch known to have no Upstream is asked where to push to first.
  const push = () => (branch !== null && branch.upstream === null ? askWhereToPush(branch.name) : start("push"));

  // Started once the dialog has closed and put focus back, so the push's Cancel can take it.
  useEffect(() => {
    const upstream = queued.current;
    if (upstream === null || asking !== null) return;
    queued.current = null;
    start("push", null, upstream);
  });
  const pullModes: MenuItem[] = PULL_MODES.map((mode) => ({
    kind: "action",
    id: mode,
    label: `Pull ${pullModeWords[mode]}`,
    onSelect: () => pull(mode),
  }));
  const offer = status.kind === "failed" ? status.error?.kind : undefined;
  const said = status.kind === "done" ? status.said : null;
  /** The branch a push found had no Upstream, to offer to push and set one. */
  const unpushed =
    status.kind === "failed" && status.operation === "push" && status.error?.kind === "noUpstream"
      ? status.error.branch
      : null;

  return (
    <section className="toolbar" aria-label="Toolbar" aria-busy={running || undefined}>
      <div className="toolbar-buttons">
        <div className="toolbar-group" role="group" aria-label="Undo and redo">
          <button
            type="button"
            className="button"
            aria-disabled={lastUndo === undefined || acting || undefined}
            title={lastUndo === undefined ? "Nothing to undo" : `Undo ${describeStep(lastUndo)}`}
            onClick={runUndo}
          >
            <Undo2 aria-hidden="true" className="button-icon" />
            Undo
            {lastUndo !== undefined && <span className="visually-hidden">: {describeStep(lastUndo)}</span>}
          </button>
          <button
            type="button"
            className="button"
            aria-disabled={lastRedo === undefined || acting || undefined}
            title={lastRedo === undefined ? "Nothing to redo" : `Redo ${describeStep(lastRedo)}`}
            onClick={runRedo}
          >
            <Redo2 aria-hidden="true" className="button-icon" />
            Redo
            {lastRedo !== undefined && <span className="visually-hidden">: {describeStep(lastRedo)}</span>}
          </button>
        </div>
        <div className="toolbar-group" role="group" aria-label="Fetch, pull and push">
        <button
          ref={fetchButton}
          type="button"
          className="button"
          aria-disabled={running || undefined}
          onClick={() => start("fetch")}
        >
          <CloudDownload aria-hidden="true" className="button-icon" />
          Fetch
        </button>
        <div className="split-button">
          <button
            ref={pullButton}
            type="button"
            className="button"
            aria-disabled={running || undefined}
            onClick={() => pull(null)}
          >
            <ArrowDownToLine aria-hidden="true" className="button-icon" />
            Pull
          </button>
          <Menu label={null} ariaLabel="Choose how to pull" items={pullModes} />
        </div>
        <button
          ref={pushButton}
          type="button"
          className="button"
          aria-disabled={running || undefined}
          onClick={push}
        >
          <ArrowUpFromLine aria-hidden="true" className="button-icon" />
          Push
        </button>
        </div>
        <div className="toolbar-group" role="group" aria-label="Branches and stashes">
          <button
            type="button"
            className="button"
            aria-disabled={branches.busy || undefined}
            onClick={() => {
              if (branches.busy) return;
              setDone(null);
              branches.create({
                kind: "choose",
                selected: selectedCommit === null ? null : { id: selectedCommit, shortId: selectedCommit.slice(0, 7), summary: null },
              });
            }}
          >
            <GitBranchPlus aria-hidden="true" className="button-icon" />
            Branch
          </button>
          <button
            type="button"
            className="button"
            onClick={() => {
              setDone(null);
              setStashing(true);
            }}
          >
            <Archive aria-hidden="true" className="button-icon" />
            Stash
          </button>
          <button
            type="button"
            className="button"
            aria-disabled={newest === undefined || acting || undefined}
            title={newest === undefined ? "No stash to pop" : `Pop “${titleOf(newest)}”`}
            onClick={pop}
          >
            <ArchiveRestore aria-hidden="true" className="button-icon" />
            Pop
          </button>
        </div>
        <p role="status" className="toolbar-done" title={done !== null && "said" in done ? done.said : undefined}>
          {done !== null && "said" in done ? done.said : (branches.said ?? "")}
        </p>
      </div>
      {done !== null && "problem" in done && (
        <p role="alert" className="problem toolbar-problem">
          {done.problem}
        </p>
      )}
      {branches.problem !== null && (
        <p role="alert" className="problem toolbar-problem">
          {branches.problem}
        </p>
      )}
      <div className="repository-bar">
        {heading}
        <div className="toolbar-status">
          <div className="toolbar-row">
            <p className="toolbar-branch">
              <GitBranch aria-hidden="true" className="button-icon branch-icon" />
              {list !== null && list.detached !== null && (
                <span>
                  HEAD detached at{" "}
                  <Copyable text={list.detached} what="commit ID">
                    {list.detached.slice(0, 7)}
                  </Copyable>
                </span>
              )}
              {branch !== null && list?.detached === null && (
                <>
                  <span className="visually-hidden">Current branch: </span>
                  <Copyable text={branch.name} what="branch name" className="toolbar-branch-name">
                    {branch.name}
                  </Copyable>
                  {branch.upstream === null ? (
                    <span className="surface-note">No Upstream</span>
                  ) : (
                    <UpstreamCounts upstream={branch.upstream} named />
                  )}
                </>
              )}
            </p>
            <div className="toolbar-middle">
              {status.kind === "running" && (
                <div className="toolbar-progress">
                  <p id={phaseId} className="toolbar-phase">
                    {status.cancelling
                      ? `Cancelling the ${operationName[status.operation]}…`
                      : describeProgress(status.progress, describeStarting(status.operation, status.mode, status.setUpstream))}
                  </p>
                  <GitProgressBar progress={status.progress} labelledBy={phaseId} />
                  {status.operation === "fetch" ? (
                    <>
                      {/* Skip leaves it running in the background; Close stops it. */}
                      <button
                        type="button"
                        className="button button-small"
                        aria-label="Skip fetch"
                        title="Carry on while the fetch finishes in the background"
                        aria-disabled={status.cancelling || undefined}
                        onClick={() => {
                          if (!status.cancelling) remote.skip();
                        }}
                      >
                        <SkipForward aria-hidden="true" className="button-icon" />
                        Skip
                      </button>
                      <button
                        ref={cancelButton}
                        type="button"
                        className="button button-small"
                        aria-label="Close fetch"
                        title="Stop the fetch"
                        aria-disabled={status.cancelling || undefined}
                        onClick={remote.cancel}
                      >
                        <X aria-hidden="true" className="button-icon" />
                        Close
                      </button>
                    </>
                  ) : (
                    <button
                      ref={cancelButton}
                      type="button"
                      className="button button-small"
                      aria-disabled={status.cancelling || undefined}
                      onClick={remote.cancel}
                    >
                      <X aria-hidden="true" className="button-icon" />
                      Cancel {operationName[status.operation]}
                    </button>
                  )}
                </div>
              )}
              {/* What the last one did, beside the branch, on the Toolbar's one row; in full on hover. */}
              <p role="status" className="toolbar-said" title={said ?? undefined}>
                {said}
              </p>
            </div>
          </div>
          {unread !== null && (
            <p role="alert" className="problem">
              {unread}
            </p>
          )}
          {status.kind === "running" && status.problem !== null && (
            <p role="alert" className="problem problem-output">
              {status.problem}
            </p>
          )}
          {status.kind === "failed" && (
            <div className="toolbar-failed">
              {status.error?.kind === "signInFailed" ? (
                <div role="alert" className="problem">
                  <SignInFailureHelp
                    lead={didNot[status.operation]}
                    failure={status.error.failure}
                    message={status.error.message}
                    onOpenLink={onOpenLink}
                  />
                </div>
              ) : (
                <p role="alert" className="problem problem-output">
                  {status.problem}
                </p>
              )}
              {offer === "rejected" && branch?.upstream !== null && (
                <div className="toolbar-offers">
                  <button type="button" className="button button-small" onClick={() => pull(null)}>
                    <ArrowDownToLine aria-hidden="true" className="button-icon" />
                    Pull
                  </button>
                </div>
              )}
              {unpushed !== null && (
                <div className="toolbar-offers">
                  <button type="button" className="button button-small" onClick={() => askWhereToPush(unpushed)}>
                    <ArrowUpFromLine aria-hidden="true" className="button-icon" />
                    Push and set Upstream…
                  </button>
                </div>
              )}
              {(offer === "noPullMode" || offer === "notFastForward") && (
                <div className="toolbar-offers">
                  {(["merge", "rebase"] as const).map((mode) => (
                    <button key={mode} type="button" className="button button-small" onClick={() => pull(mode)}>
                      <ArrowDownToLine aria-hidden="true" className="button-icon" />
                      Pull {pullModeWords[mode]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <p role="status" className="visually-hidden">
        {remote.announcement}
      </p>
      <PushUpstreamDialog
        branch={asking}
        remotes={list?.remotes.filter(({ configured }) => configured) ?? []}
        onPush={(upstream) => {
          queued.current = upstream;
          setAsking(null);
        }}
        onClose={() => setAsking(null)}
      />
      {branches.dialogs}
      <NewStashDialog
        commands={commands}
        repository={repository}
        open={stashing}
        onClose={() => setStashing(false)}
        onCreated={(stash) => {
          setStashing(false);
          setDone({ said: `Stashed your changes as “${titleOf(stash)}”.` });
          onChanged();
        }}
      />
    </section>
  );
}
