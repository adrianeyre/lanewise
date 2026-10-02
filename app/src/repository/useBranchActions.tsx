import { type FormEvent, type ReactNode, useId, useState } from "react";

import type {
  BranchError,
  BranchToCheckOut,
  BranchToMerge,
  CommandClient,
  HistoryCommit,
  MergePreview,
  Merged,
  OpenedRepository,
} from "../commands/api";
import { Dialog } from "../ui/Dialog";
import { commits, describeBranchError } from "./branchProblems";
import { describeMergeError } from "./mergeProblems";
import { describeFailure } from "./problems";
import { describeRemoteDeleteError } from "./remoteWords";
import { placeOf, recordUndo, tipOf } from "./undo";

/** A commit a new branch can start at, as the dialog names it. */
export interface StartCommit {
  id: string;
  shortId: string;
  /** Its subject, if it's known. */
  summary: string | null;
}

/**
 * Where a new branch starts: at `HEAD` or `selected`, as the user chooses, or
 * at `commit`, with the name the dialog suggests, such as one made from an
 * Issue, if there is one.
 */
export type NewBranchStart =
  | { kind: "choose"; selected: StartCommit | null; name?: string }
  | { kind: "commit"; commit: StartCommit; name?: string };

/** A branch on a remote, as its remote-tracking branch here names it. */
export interface BranchOnRemote {
  /** The remote's name, such as `origin`. */
  remote: string;
  /** Its name on the remote, such as `topic`. */
  branch: string;
  /** Its remote-tracking branch's name, as its Label shows it: `origin/topic`. */
  name: string;
}

/** What was done, for the Widget to put focus back after it. */
export type BranchDone =
  | { kind: "created"; name: string }
  | { kind: "renamed"; from: string; to: string }
  | { kind: "deleted"; name: string }
  /** Deleted on its remote: `name` is its remote-tracking branch's, such as `origin/topic`. */
  | { kind: "deletedOnRemote"; name: string }
  | { kind: "checkedOut"; name: string }
  | { kind: "merged"; name: string };

export interface BranchActions {
  /** Asks for the new branch's name, then creates it. */
  create: (start: NewBranchStart) => void;
  /** Asks for a new name, then renames the local branch `name`. */
  rename: (name: string) => void;
  /** Deletes the local branch `name`, first asking if that would lose commits. */
  remove: (name: string) => void;
  /**
   * Asks first, then deletes `onRemote` on its remote, for everyone who
   * uses it, with its remote-tracking branch here; then the local branch
   * `alsoLocal`, if one is named, as `remove` does.
   */
  removeOnRemote: (onRemote: BranchOnRemote, alsoLocal?: string | null) => void;
  /** Checks `branch` out, first asking to stash uncommitted changes it would overwrite. */
  checkOut: (branch: BranchToCheckOut) => void;
  /**
   * Checks out the local branch `name` moved to the remote-tracking branch
   * `at`, as `checkOut` does, first asking unless `ahead`, the commits it
   * has that `at` doesn't, is 0: `null` if that isn't known.
   */
  moveTo: (name: string, at: string, ahead: number | null) => void;
  /** Asks first, then checks `commit` out with `HEAD` detached, as `checkOut` does. */
  checkOutCommit: (commit: StartCommit) => void;
  /** Shows what merging `branch` into the current branch would do, then merges it once the user confirms. */
  merge: (branch: BranchToMerge) => void;
  /** Whether an action is running, so no other is started. */
  busy: boolean;
  /** What the last action did, to announce. */
  said: string | null;
  /** Why the last action failed, if it did outside a dialog. */
  problem: string | null;
  /** The dialogs the actions open, to draw inside the Widget. */
  dialogs: ReactNode;
}

interface Options {
  commands: CommandClient;
  repository: OpenedRepository;
  /** Called once a ref has moved, so what shows the refs reads them again. */
  onChanged: () => void;
  onDone?: (done: BranchDone) => void;
}

type Asking =
  | { kind: "create"; start: NewBranchStart }
  | { kind: "rename"; name: string }
  | { kind: "unmerged"; error: Extract<BranchError, { kind: "unmerged" }> }
  | { kind: "wouldOverwrite"; branch: BranchToCheckOut; paths: string[] }
  | { kind: "checkOutCommit"; commit: StartCommit }
  | { kind: "moveTo"; name: string; at: string; ahead: number | null }
  | { kind: "deleteOnRemote"; onRemote: BranchOnRemote; alsoLocal: string | null }
  /** `moved` if the preview is a new one, since a branch moved after the last was shown. */
  | { kind: "merge"; branch: BranchToMerge; preview: MergePreview; moved: boolean };

/**
 * Creating, renaming, deleting and checking out branches, for the Branches
 * & remotes Widget and the Commit graph: each asks what it needs in a
 * dialog, runs its command, and says what it did, or why it didn't. Deleting
 * a branch with commits no other ref has names them and asks first; a
 * checkout over uncommitted changes names them and offers to stash them.
 * A merge shows its preview first, and merges only as the user confirms
 * it; one Git stops with conflicts is left in progress, for the Repository
 * page's message about it to offer aborting.
 */
export function useBranchActions({ commands, repository, onChanged, onDone }: Options): BranchActions {
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // A problem with what the dialog asked, such as a name Git doesn't allow, shown in it.
  const [dialogProblem, setDialogProblem] = useState<string | null>(null);
  const root = repository.root;

  function ask(next: Asking | null) {
    setDialogProblem(null);
    setAsking(next);
  }

  /** Runs `attempt`, saying what went wrong if it threw. */
  async function running(attempt: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setSaid(null);
    setProblem(null);
    try {
      await attempt();
    } catch (failure) {
      ask(null);
      setProblem(describeFailure(failure));
    } finally {
      setBusy(false);
    }
  }

  function done(message: string, what: BranchDone) {
    ask(null);
    setSaid(message);
    onChanged();
    onDone?.(what);
  }

  const create = (name: string, start: StartCommit | null) =>
    running(async () => {
      const outcome = await commands.call("createBranch", { repository: root, name, start: start?.id ?? null });
      if (!outcome.ok) return setDialogProblem(describeBranchError(outcome.error, "create"));
      recordUndo(root, { kind: "createBranch", name, tip: start?.id ?? null });
      done(`Created branch “${name}” at ${start === null ? "HEAD" : start.shortId}.`, { kind: "created", name });
    });

  const rename = (from: string, to: string) =>
    running(async () => {
      const outcome = await commands.call("renameBranch", { repository: root, from, to });
      if (!outcome.ok) return setDialogProblem(describeBranchError(outcome.error, "rename"));
      done(`Renamed branch “${from}” to “${to}”.`, { kind: "renamed", from, to });
    });

  const remove = (name: string, confirmedTip: string | null) =>
    running(async () => {
      // Its tip, for Undo to make it again at.
      const tip = confirmedTip ?? (await tipOf(commands, root, name));
      const outcome = await commands.call("deleteBranch", { repository: root, name, confirmedTip });
      if (!outcome.ok) {
        if (outcome.error.kind === "unmerged") return ask({ kind: "unmerged", error: outcome.error });
        ask(null);
        return setProblem(describeBranchError(outcome.error, "delete"));
      }
      if (tip !== null) recordUndo(root, { kind: "deleteBranch", name, tip });
      const lost = confirmedTip === null || asking?.kind !== "unmerged" ? "" : ` ${commits(asking.error.count)} went with it.`;
      done(`Deleted branch “${name}”.${lost}`, { kind: "deleted", name });
    });

  const removeOnRemote = ({ remote, branch, name }: BranchOnRemote, alsoLocal: string | null) =>
    running(async () => {
      const outcome = await commands.call("deleteRemoteBranch", { repository: root, remote, branch });
      if (!outcome.ok) return setDialogProblem(describeRemoteDeleteError(outcome.error, name));
      const onRemote =
        outcome.value.kind === "alreadyGone"
          ? `“${branch}” was gone from ${remote} already, so only “${name}” was deleted here.`
          : `Deleted “${branch}” on ${remote}, and “${name}” with it.`;
      if (alsoLocal === null) return done(onRemote, { kind: "deletedOnRemote", name });
      const local = await commands.call("deleteBranch", { repository: root, name: alsoLocal, confirmedTip: null });
      if (!local.ok) {
        // The branch on the remote has gone, whatever happens to the local one.
        onChanged();
        setSaid(onRemote);
        if (local.error.kind === "unmerged") return ask({ kind: "unmerged", error: local.error });
        ask(null);
        return setProblem(describeBranchError(local.error, "delete"));
      }
      done(`${onRemote} Deleted branch “${alsoLocal}”.`, { kind: "deleted", name: alsoLocal });
    });

  const checkOut = (branch: BranchToCheckOut, stashFirst: boolean) =>
    running(async () => {
      // Where HEAD was, for Undo to go back to.
      const from = await placeOf(commands, root);
      const outcome = await commands.call("checkOut", { repository: root, branch, stashFirst });
      if (!outcome.ok) {
        if (outcome.error.kind === "wouldOverwrite") {
          return ask({ kind: "wouldOverwrite", branch, paths: outcome.error.paths });
        }
        ask(null);
        // A stash that was made is put back, so nothing changed.
        onChanged();
        return setProblem(describeBranchError(outcome.error, "checkOut"));
      }
      const { branch: checkedOut, stash } = outcome.value;
      const to = checkedOut !== null ? { kind: "branch" as const, name: checkedOut } : await placeOf(commands, root);
      if (from !== null && to !== null) recordUndo(root, { kind: "checkOut", from, to });
      const made =
        branch.kind === "remote"
          ? `, a new branch tracking “${branch.name}”`
          : branch.kind === "localAt"
            ? `, moved to “${branch.at}”`
            : "";
      const stashed = stash === null ? "" : ` Your uncommitted changes are in the stash “${stash}”.`;
      const shown = checkedOut === null ? `${checkOutName(branch)}, with HEAD detached on no branch` : `“${checkedOut}”`;
      done(`Checked out ${shown}${made}.${stashed}`, { kind: "checkedOut", name: checkedOut ?? checkOutName(branch) });
    });

  const showMerge = (branch: BranchToMerge) =>
    running(async () => {
      const outcome = await commands.call("previewMerge", { repository: root, branch });
      if (!outcome.ok) {
        ask(null);
        return setProblem(describeMergeError(outcome.error, "preview"));
      }
      ask({ kind: "merge", branch, preview: outcome.value, moved: false });
    });

  const merge = (branch: BranchToMerge, { head, tip, into }: MergePreview) =>
    running(async () => {
      const outcome = await commands.call("merge", { repository: root, branch, head, tip });
      if (!outcome.ok) {
        if (outcome.error.kind === "moved") {
          return ask({ kind: "merge", branch, preview: outcome.error.preview, moved: true });
        }
        return setDialogProblem(describeMergeError(outcome.error, "merge"));
      }
      done(describeMerged(outcome.value, branch.name, into), { kind: "merged", name: branch.name });
    });

  const dialogs = (
    <>
      <NewBranchDialog
        asking={asking?.kind === "create" ? asking.start : null}
        busy={busy}
        problem={dialogProblem}
        onCreate={(name, start) => void create(name, start)}
        onClose={() => ask(null)}
      />
      <RenameBranchDialog
        name={asking?.kind === "rename" ? asking.name : null}
        busy={busy}
        problem={dialogProblem}
        onRename={(from, to) => void rename(from, to)}
        onClose={() => ask(null)}
      />
      <UnmergedDialog
        error={asking?.kind === "unmerged" ? asking.error : null}
        busy={busy}
        onDelete={(name, tip) => void remove(name, tip)}
        onClose={() => ask(null)}
      />
      <DeleteOnRemoteDialog
        asking={asking?.kind === "deleteOnRemote" ? asking : null}
        busy={busy}
        problem={dialogProblem}
        onDelete={(onRemote, alsoLocal) => void removeOnRemote(onRemote, alsoLocal)}
        onClose={() => ask(null)}
      />
      <WouldOverwriteDialog
        asking={asking?.kind === "wouldOverwrite" ? asking : null}
        busy={busy}
        onStash={(branch) => void checkOut(branch, true)}
        onClose={() => ask(null)}
      />
      <CheckOutCommitDialog
        commit={asking?.kind === "checkOutCommit" ? asking.commit : null}
        busy={busy}
        onCheckOut={(commit) => void checkOut({ kind: "commit", commit: commit.id }, false)}
        onClose={() => ask(null)}
      />
      <MoveToDialog
        asking={asking?.kind === "moveTo" ? asking : null}
        busy={busy}
        onMove={(name, at) => void checkOut({ kind: "localAt", name, at }, false)}
        onClose={() => ask(null)}
      />
      <MergeDialog
        asking={asking?.kind === "merge" ? asking : null}
        busy={busy}
        problem={dialogProblem}
        onMerge={(branch, preview) => void merge(branch, preview)}
        onClose={() => ask(null)}
      />
    </>
  );

  return {
    create: (start) => {
      if (!busy) ask({ kind: "create", start });
    },
    rename: (name) => {
      if (!busy) ask({ kind: "rename", name });
    },
    remove: (name) => void remove(name, null),
    removeOnRemote: (onRemote, alsoLocal = null) => {
      if (!busy) ask({ kind: "deleteOnRemote", onRemote, alsoLocal });
    },
    checkOut: (branch) => void checkOut(branch, false),
    moveTo: (name, at, ahead) => {
      if (ahead === 0) void checkOut({ kind: "localAt", name, at }, false);
      else if (!busy) ask({ kind: "moveTo", name, at, ahead });
    },
    checkOutCommit: (commit) => {
      if (!busy) ask({ kind: "checkOutCommit", commit });
    },
    merge: (branch) => void showMerge(branch),
    busy,
    said,
    problem,
    dialogs,
  };
}

/** What a checkout checks out, as a sentence names it: “main”, or commit abc1234. */
export function checkOutName(branch: BranchToCheckOut): string {
  return branch.kind === "commit" ? `commit ${branch.commit.slice(0, 7)}` : `“${branch.name}”`;
}

/** What a merge did, to announce. */
function describeMerged(merged: Merged, name: string, into: string | null): string {
  const target = into === null ? "HEAD" : `“${into}”`;
  switch (merged.kind) {
    case "upToDate":
      return `${target} has every commit “${name}” has already. Nothing was merged.`;
    case "fastForward":
      return `Fast-forwarded ${target} to “${name}”, bringing in ${commits(merged.commits)}.`;
    case "mergeCommit":
      return `Merged “${name}” into ${target} in merge commit ${merged.commit.slice(0, 7)}, bringing in ${commits(merged.commits)}.`;
    case "stopped":
      return merged.conflicts.length === 0
        ? `Git stopped merging “${name}” into ${target} before committing. The merge is in progress.`
        : `Merging “${name}” into ${target} stopped with conflicts in ${files(merged.conflicts.length)}. The merge is in progress.`;
  }
}

/** “1 file” or “3 files”. */
function files(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}

/** A commit as a dialog names it: its short ID, and its subject if known. */
function describeCommit(commit: StartCommit): string {
  return commit.summary === null ? commit.shortId : `${commit.shortId} “${commit.summary}”`;
}

interface NameFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  problem: string | null;
  /** Whether it takes focus as its dialog opens: the first field in it does. */
  autofocus?: boolean;
}

/**
 * A name box, such as a branch's or a remote's, which takes focus as its
 * dialog opens, and the problem with what's in it.
 */
export function NameField({ label, value, onChange, problem, autofocus = true }: NameFieldProps) {
  const fieldId = useId();
  const problemId = useId();
  return (
    <div className="branch-field">
      <label htmlFor={fieldId}>{label}</label>
      <input
        id={fieldId}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={problem !== null}
        aria-describedby={problem === null ? undefined : problemId}
        data-autofocus={autofocus || undefined}
      />
      {problem !== null && (
        <p id={problemId} role="alert" className="problem problem-output">
          {problem}
        </p>
      )}
    </div>
  );
}

interface NewBranchProps {
  asking: NewBranchStart | null;
  busy: boolean;
  problem: string | null;
  onCreate: (name: string, start: StartCommit | null) => void;
  onClose: () => void;
}

function NewBranchDialog({ asking, busy, problem, onCreate, onClose }: NewBranchProps) {
  return (
    <Dialog open={asking !== null} onClose={onClose} title="New branch" closeLabel="Cancel the new branch">
      {asking !== null && (
        <NewBranchForm asking={asking} busy={busy} problem={problem} onCreate={onCreate} onClose={onClose} />
      )}
    </Dialog>
  );
}

function NewBranchForm({ asking, busy, problem, onCreate, onClose }: NewBranchProps & { asking: NewBranchStart }) {
  const [name, setName] = useState(asking.name ?? "");
  const [atSelected, setAtSelected] = useState(asking.kind === "choose" && asking.selected !== null);
  const choiceName = useId();
  const start = asking.kind === "commit" ? asking.commit : atSelected ? asking.selected : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy) onCreate(name.trim(), start);
  }

  return (
    <form className="branch-form" onSubmit={submit}>
      <NameField label="Branch name" value={name} onChange={setName} problem={problem} />
      {asking.kind === "commit" && <p>It starts at commit {describeCommit(asking.commit)}, and isn't checked out.</p>}
      {asking.kind === "choose" && asking.selected === null && (
        <p>It starts at HEAD, where you are now, and isn't checked out.</p>
      )}
      {asking.kind === "choose" && asking.selected !== null && (
        <fieldset className="branch-start">
          <legend>Start it at</legend>
          <label>
            <input type="radio" name={choiceName} checked={!atSelected} onChange={() => setAtSelected(false)} />
            HEAD, where you are now
          </label>
          <label>
            <input type="radio" name={choiceName} checked={atSelected} onChange={() => setAtSelected(true)} />
            The commit selected in the Commit graph, {describeCommit(asking.selected)}
          </label>
        </fieldset>
      )}
      <div className="dialog-actions">
        <button type="submit" className="button" aria-disabled={busy || undefined}>
          Create branch
        </button>
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

interface RenameProps {
  name: string | null;
  busy: boolean;
  problem: string | null;
  onRename: (from: string, to: string) => void;
  onClose: () => void;
}

function RenameBranchDialog({ name, busy, problem, onRename, onClose }: RenameProps) {
  return (
    <Dialog
      open={name !== null}
      onClose={onClose}
      title={name === null ? "Rename branch" : `Rename “${name}”`}
      closeLabel="Cancel renaming"
    >
      {name !== null && <RenameForm from={name} busy={busy} problem={problem} onRename={onRename} onClose={onClose} />}
    </Dialog>
  );
}

function RenameForm({
  from,
  busy,
  problem,
  onRename,
  onClose,
}: Omit<RenameProps, "name"> & { from: string }) {
  const [to, setTo] = useState(from);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy) onRename(from, to.trim());
  }

  return (
    <form className="branch-form" onSubmit={submit}>
      <NameField label="New name" value={to} onChange={setTo} problem={problem} />
      <div className="dialog-actions">
        <button type="submit" className="button" aria-disabled={busy || undefined}>
          Rename branch
        </button>
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

interface UnmergedProps {
  error: Extract<BranchError, { kind: "unmerged" }> | null;
  busy: boolean;
  onDelete: (name: string, tip: string) => void;
  onClose: () => void;
}

/** Asks before deleting a branch whose commits no other ref has, naming them. */
function UnmergedDialog({ error, busy, onDelete, onClose }: UnmergedProps) {
  return (
    <Dialog
      open={error !== null}
      onClose={onClose}
      title={error === null ? "Delete branch" : `Delete “${error.name}”?`}
      closeLabel="Close, keeping the branch"
    >
      {error !== null && (
        <div className="branch-form">
          <p className="warning">
            “{error.name}” has {commits(error.count)} that no other branch, remote-tracking branch or tag has.
            Deleting it loses {error.count === 1 ? "it" : "them"}:
          </p>
          <ul className="branch-lost">
            {error.commits.map((commit: HistoryCommit) => (
              <li key={commit.id}>
                <span className="commit-id">{commit.shortId}</span> {commit.summary}{" "}
                <span className="branch-lost-author">by {commit.author}</span>
              </li>
            ))}
          </ul>
          {error.count > error.commits.length && <p>and {commits(error.count - error.commits.length)} older.</p>}
          <div className="dialog-actions">
            <button
              type="button"
              className="button"
              aria-disabled={busy || undefined}
              onClick={() => {
                if (!busy) onDelete(error.name, error.tip);
              }}
            >
              Delete and lose {commits(error.count)}
            </button>
            <button type="button" className="button" onClick={onClose}>
              Keep the branch
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

interface DeleteOnRemoteProps {
  asking: { onRemote: BranchOnRemote; alsoLocal: string | null } | null;
  busy: boolean;
  problem: string | null;
  onDelete: (onRemote: BranchOnRemote, alsoLocal: string | null) => void;
  onClose: () => void;
}

/**
 * Asks before deleting a branch on its remote, which goes for everyone who
 * uses the remote, and the local branch with it, if that was chosen too.
 */
function DeleteOnRemoteDialog({ asking, busy, problem, onDelete, onClose }: DeleteOnRemoteProps) {
  const problemId = useId();
  const title =
    asking === null
      ? "Delete branch on its remote"
      : asking.alsoLocal === null
        ? `Delete “${asking.onRemote.branch}” on ${asking.onRemote.remote}?`
        : `Delete “${asking.alsoLocal}” and “${asking.onRemote.name}”?`;
  return (
    <Dialog open={asking !== null} onClose={onClose} title={title} closeLabel="Close, keeping the branch">
      {asking !== null && (
        <div className="branch-form">
          <p className="warning">
            This deletes “{asking.onRemote.branch}” on {asking.onRemote.remote} for everyone who uses it, and
            “{asking.onRemote.name}” here.
            {asking.alsoLocal !== null && <> Then it deletes your local branch “{asking.alsoLocal}”.</>} A branch
            deleted on a remote can only be pushed there again from a copy that still has its commits.
          </p>
          {problem !== null && (
            <p id={problemId} role="alert" className="problem problem-output">
              {problem}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="button button-danger"
              aria-disabled={busy || undefined}
              aria-describedby={problem === null ? undefined : problemId}
              onClick={() => {
                if (!busy) onDelete(asking.onRemote, asking.alsoLocal);
              }}
            >
              {busy
                ? "Deleting…"
                : asking.alsoLocal === null
                  ? `Delete on ${asking.onRemote.remote}`
                  : `Delete on ${asking.onRemote.remote} and locally`}
            </button>
            {/* Focus starts on keeping it: a branch deleted on a remote goes for everyone. */}
            <button type="button" className="button" data-autofocus onClick={onClose}>
              Keep the branch
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

interface WouldOverwriteProps {
  asking: { branch: BranchToCheckOut; paths: string[] } | null;
  busy: boolean;
  onStash: (branch: BranchToCheckOut) => void;
  onClose: () => void;
}

/**
 * Explains why a checkout was refused, naming the changes in the way, and
 * offers to stash them first. The Stashes Widget lists the stash made, to
 * apply or pop on the branch checked out or back where it was made.
 */
function WouldOverwriteDialog({ asking, busy, onStash, onClose }: WouldOverwriteProps) {
  const name = asking === null ? "" : checkOutName(asking.branch);
  return (
    <Dialog
      open={asking !== null}
      onClose={onClose}
      title={asking === null ? "Check out" : `Check out ${name}?`}
      closeLabel="Cancel the checkout"
    >
      {asking !== null && (
        <div className="branch-form">
          <p className="warning">
            Checking out {name} would overwrite your uncommitted changes to{" "}
            {asking.paths.length === 1 ? "this file" : `these ${asking.paths.length} files`}, so Git didn't. Nothing
            has changed.
          </p>
          <ul className="branch-overwritten">
            {asking.paths.map((path) => (
              <li key={path} className="file-status-path">
                {path}
              </li>
            ))}
          </ul>
          <p>
            Stashing puts every uncommitted change aside, untracked files too, and leaves the working tree clean, so{" "}
            {name} can be checked out. The changes stay in the stash until you apply it. Or commit them first.
          </p>
          <div className="dialog-actions">
            <button
              type="button"
              className="button"
              aria-disabled={busy || undefined}
              onClick={() => {
                if (!busy) onStash(asking.branch);
              }}
            >
              Stash changes and check out
            </button>
            <button type="button" className="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

interface CheckOutCommitProps {
  commit: StartCommit | null;
  busy: boolean;
  onCheckOut: (commit: StartCommit) => void;
  onClose: () => void;
}

/** Asks before checking a commit out, saying what a detached `HEAD` means. */
function CheckOutCommitDialog({ commit, busy, onCheckOut, onClose }: CheckOutCommitProps) {
  return (
    <Dialog
      open={commit !== null}
      onClose={onClose}
      title={commit === null ? "Check out commit" : `Check out commit ${commit.shortId}?`}
      closeLabel="Cancel the checkout"
    >
      {commit !== null && (
        <div className="branch-form">
          <p>
            HEAD will be detached at commit {describeCommit(commit)}, on no branch. Commits made there belong to no
            branch until you make one, so make a branch first if you mean to keep working from it.
          </p>
          <div className="dialog-actions">
            <button
              type="button"
              className="button"
              aria-disabled={busy || undefined}
              onClick={() => {
                if (!busy) onCheckOut(commit);
              }}
            >
              Check out with HEAD detached
            </button>
            <button type="button" className="button" onClick={onClose} data-autofocus>
              Cancel
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

interface MoveToProps {
  asking: { name: string; at: string; ahead: number | null } | null;
  busy: boolean;
  onMove: (name: string, at: string) => void;
  onClose: () => void;
}

/**
 * Asks before moving a local branch to a remote-tracking branch as it's
 * checked out, when it has commits the remote-tracking branch doesn't, or
 * may have: they're no longer on it once it's moved.
 */
function MoveToDialog({ asking, busy, onMove, onClose }: MoveToProps) {
  return (
    <Dialog
      open={asking !== null}
      onClose={onClose}
      title={asking === null ? "Move branch" : `Move “${asking.name}” to “${asking.at}”?`}
      closeLabel="Cancel, leaving the branch where it is"
    >
      {asking !== null && (
        <div className="branch-form">
          <p>
            {asking.ahead === null
              ? `“${asking.name}” may have commits “${asking.at}” doesn't.`
              : `“${asking.name}” has ${commits(asking.ahead)} “${asking.at}” doesn't.`}{" "}
            Checking it out at “{asking.at}” takes them off it: only a branch or tag of their own keeps them, so make
            one first if you mean to keep them. Uncommitted changes stay, unless the checkout would overwrite them.
          </p>
          <div className="dialog-actions">
            <button
              type="button"
              className="button"
              aria-disabled={busy || undefined}
              onClick={() => {
                if (!busy) onMove(asking.name, asking.at);
              }}
            >
              Move and check out
            </button>
            <button type="button" className="button" onClick={onClose} data-autofocus>
              Cancel
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

interface MergeProps {
  asking: { branch: BranchToMerge; preview: MergePreview; moved: boolean } | null;
  busy: boolean;
  problem: string | null;
  onMerge: (branch: BranchToMerge, preview: MergePreview) => void;
  onClose: () => void;
}

/**
 * What merging a branch would do, as the Git config has it: a fast-forward
 * or a merge commit, and how many commits it brings in. It merges only as
 * the user confirms it, and says so when there's nothing to merge or the
 * Git config refuses it.
 */
function MergeDialog({ asking, busy, problem, onMerge, onClose }: MergeProps) {
  const name = asking?.branch.name ?? "";
  const preview = asking?.preview;
  const into = preview === undefined || preview.into === null ? "HEAD" : `“${preview.into}”`;
  const bringing = preview === undefined ? "" : `bringing in ${commits(preview.commits)}`;
  const mergeable = preview?.kind === "fastForward" || preview?.kind === "mergeCommit";
  return (
    <Dialog
      open={asking !== null}
      onClose={onClose}
      title={asking === null ? "Merge" : `Merge “${name}” into ${into}?`}
      closeLabel="Cancel the merge"
    >
      {asking !== null && preview !== undefined && (
        <div className="branch-form">
          {asking.moved && (
            <p className="warning">
              A branch moved since the merge was shown, so nothing was merged. This is what merging does now.
            </p>
          )}
          {preview.kind === "upToDate" && (
            <p>
              {into} has every commit “{name}” has already. There's nothing to merge.
            </p>
          )}
          {preview.kind === "fastForward" && (
            <p>
              <strong>A fast-forward.</strong> {into} moves forward to “{name}”, {bringing}. No merge commit is made.
            </p>
          )}
          {preview.kind === "mergeCommit" && (
            <p>
              <strong>A merge commit.</strong> A new commit on {into} joins it with “{name}”, {bringing}.
              {preview.insteadOfFastForward && " A fast-forward would do, but your Git config asks for a merge commit."}
            </p>
          )}
          {preview.kind === "fastForwardOnly" && (
            <p className="warning">
              Your Git config allows only fast-forward merges, but {into} has commits “{name}” doesn't, so merging it
              needs a merge commit. Nothing can be merged.
            </p>
          )}
          {problem !== null && (
            <p role="alert" className="problem problem-output">
              {problem}
            </p>
          )}
          <div className="dialog-actions">
            {mergeable && (
              <button
                type="button"
                className="button"
                aria-disabled={busy || undefined}
                onClick={() => {
                  if (!busy) onMerge(asking.branch, preview);
                }}
              >
                {preview.kind === "fastForward" ? `Fast-forward ${into}` : "Merge"}
              </button>
            )}
            <button type="button" className="button" onClick={onClose}>
              {mergeable ? "Cancel" : "Close"}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
