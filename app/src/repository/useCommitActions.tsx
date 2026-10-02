import { type FormEvent, type ReactNode, useId, useState } from "react";

import type {
  CommandClient,
  CommitActionError,
  HistoryCommit,
  OpenedRepository,
  Picked,
  ResetMode,
  ResetPreview,
} from "../commands/api";
import { Dialog } from "../ui/Dialog";
import { commits } from "./branchProblems";
import { NameField, type StartCommit } from "./useBranchActions";
import { describeFailure, describeRepositoryError } from "./problems";
import { recordUndo } from "./undo";

/**
 * What the Commit graph's commit menu does at a commit (ADR 0034), besides
 * the branch actions: tagging it, renaming and deleting its tags, changing
 * its message, cherry-picking and
 * reverting it, resetting the current branch to it, and copying its ID or
 * message.
 */
export interface CommitActions {
  /** Asks for the tag's name, and a message for an annotated one, then makes it at `commit`. */
  tag: (commit: StartCommit) => void;
  /** Asks first, then deletes the tag `name`. */
  deleteTag: (name: string) => void;
  /** Asks for a new name, then renames the tag `name`, at the same commit. */
  renameTag: (name: string) => void;
  /**
   * Asks for a new subject and body, filled in with the commit's own,
   * then gives the commit that message, making it again with every commit
   * after it on each local branch that has it.
   */
  reword: (commit: StartCommit) => void;
  /** Cherry-picks `commit` onto the current branch; one that conflicts is left for the Conflicts page. */
  cherryPick: (commit: StartCommit) => void;
  /** Reverts `commit` in a new commit; one that conflicts is left for the Conflicts page. */
  revert: (commit: StartCommit) => void;
  /** Shows what resetting the current branch to `commit` would leave, then resets it in `mode` once confirmed. */
  reset: (commit: StartCommit, mode: ResetMode) => void;
  /** Copies the commit's full ID, or its whole message, where the platform can copy. */
  copyId: ((commit: StartCommit) => void) | null;
  copyMessage: ((commit: StartCommit) => void) | null;
  /** Copies a branch's or tag's name, `what` saying which, such as “branch name”. */
  copyName: ((what: string, name: string) => void) | null;
  busy: boolean;
  /** What the last action did, to announce. */
  said: string | null;
  /** Why the last action failed, if it did outside a dialog. */
  problem: string | null;
  /** The dialogs the actions open. */
  dialogs: ReactNode;
}

interface Options {
  commands: CommandClient;
  repository: OpenedRepository;
  /** Called once a ref or the working tree has moved, so what shows them reads them again. */
  onChanged: () => void;
  /** Puts text on the clipboard; without it there's nothing to copy with. */
  copyText?: (text: string) => Promise<void>;
  /** Called with a commit whose message was changed, and the commit it was made again as. */
  onReworded?: (from: string, to: string) => void;
}

type Asking =
  | { kind: "tag"; commit: StartCommit }
  | { kind: "deleteTag"; name: string }
  | { kind: "renameTag"; name: string }
  | { kind: "reword"; commit: StartCommit; message: string }
  /** `moved` if `HEAD` moved after the last preview was shown. */
  | { kind: "reset"; commit: StartCommit; mode: ResetMode; preview: ResetPreview; moved: boolean };

/** What was being done when it failed, to say what didn't happen. */
type Run = "tag" | "deleteTag" | "renameTag" | "reword" | "cherryPick" | "revert" | "reset" | "copy";

const didNot: Record<Run, string> = {
  tag: "The tag wasn't made",
  deleteTag: "The tag wasn't deleted",
  renameTag: "The tag wasn't renamed",
  reword: "The message wasn't changed",
  cherryPick: "Nothing was cherry-picked",
  revert: "Nothing was reverted",
  reset: "The branch wasn't reset",
  copy: "Nothing was copied",
};

/** What to tell the user when `run` failed. Git's own words are part of it, as Git wrote them. */
export function describeCommitActionError(error: CommitActionError, run: Run): string {
  switch (error.kind) {
    case "invalidTagName":
      return error.name.trim() === ""
        ? `${didNot[run]}: a tag needs a name.`
        : `${didNot[run]}: Git doesn't allow “${error.name}” as a tag name. Tag names can't have spaces, “..”, “~”, “^”, “:”, “?”, “*” or “[”, or start with “-”.`;
    case "tagExists":
      return `${didNot[run]}: there's already a tag called “${error.name}”.`;
    case "tagNotFound":
      return `${didNot[run]}: there's no tag called “${error.name}” any more.`;
    case "commitNotFound":
      return `${didNot[run]}: the repository no longer has commit ${error.commit.slice(0, 7)}.`;
    case "operationInProgress":
      return `${didNot[run]}: a merge, rebase, stash apply, cherry-pick or revert is in progress. Finish or abort it on the Conflicts page first.`;
    case "notOnLocalBranch":
      return `${didNot[run]}: no local branch has this commit. Check out a branch that has it first.`;
    case "emptyMessage":
      return `${didNot[run]}: a commit needs a message.`;
    case "headMoved":
      return `${didNot[run]}: HEAD has moved since the reset was shown.`;
    case "noCommits":
      return `${didNot[run]}: the repository has no commits yet.`;
    case "gitUnavailable":
      return `${didNot[run]}: Lanewise can't find a Git 2.40 or later to run. Install one, then open the repository again.`;
    case "gitFailed":
      return `${didNot[run]}. ${error.code === null ? "Git was stopped" : `Git stopped with exit code ${error.code}`}${error.message === "" ? "" : `:\n${error.message}`}`;
    default:
      return describeRepositoryError(error);
  }
}

/** A commit as a message names it: its short ID, and its subject if known. */
function describeCommit(commit: StartCommit): string {
  return commit.summary === null ? commit.shortId : `${commit.shortId} “${commit.summary}”`;
}

function files(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}

/** What a cherry-pick or revert did, to announce. */
function describePicked(picked: Picked, doing: "cherryPick" | "revert", commit: StartCommit): string {
  const done = doing === "cherryPick" ? "Cherry-picked" : "Reverted";
  const name = doing === "cherryPick" ? "Cherry-picking" : "Reverting";
  if (picked.kind === "committed") return `${done} ${describeCommit(commit)} in commit ${picked.commit.slice(0, 7)}.`;
  return `${name} ${describeCommit(commit)} stopped with conflicts in ${files(picked.conflicts.length)}. Resolve them on the Conflicts page.`;
}

const MODE_WORDS: Record<ResetMode, { label: string; note: string }> = {
  soft: { label: "Soft", note: "Moves the branch only. The changes since stay, staged." },
  mixed: { label: "Mixed", note: "Moves the branch and unstages. The changes since stay in the working tree, unstaged." },
  hard: {
    label: "Hard",
    note: "Moves the branch and puts the working tree back as the commit has it. The changes since, and every uncommitted change, are lost.",
  },
};

/**
 * The commit menu's actions besides the branches' (ADR 0034): each asks what
 * it needs in a dialog, runs its command through Git, and says what it did,
 * or why it didn't. A cherry-pick or revert Git stops with conflicts is left
 * in progress, and the Repository page shows the Conflicts page for it. A
 * reset shows the commits it would leave first, and resets only if `HEAD`
 * hasn't moved since.
 */
export function useCommitActions({ commands, repository, onChanged, copyText, onReworded }: Options): CommitActions {
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dialogProblem, setDialogProblem] = useState<string | null>(null);
  const root = repository.root;

  function ask(next: Asking | null) {
    setDialogProblem(null);
    setAsking(next);
  }

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

  function done(message: string) {
    ask(null);
    setSaid(message);
    onChanged();
  }

  const tag = (name: string, commit: StartCommit, message: string) =>
    running(async () => {
      const outcome = await commands.call("createTag", {
        repository: root,
        name,
        commit: commit.id,
        message: message.trim() === "" ? null : message,
      });
      if (!outcome.ok) return setDialogProblem(describeCommitActionError(outcome.error, "tag"));
      done(`Made ${message.trim() === "" ? "tag" : "annotated tag"} “${name}” at ${describeCommit(commit)}.`);
    });

  const deleteTag = (name: string) =>
    running(async () => {
      const outcome = await commands.call("deleteTag", { repository: root, name });
      if (!outcome.ok) {
        ask(null);
        return setProblem(describeCommitActionError(outcome.error, "deleteTag"));
      }
      done(`Deleted tag “${name}”.`);
    });

  const renameTag = (from: string, to: string) =>
    running(async () => {
      const outcome = await commands.call("renameTag", { repository: root, from, to });
      if (!outcome.ok) return setDialogProblem(describeCommitActionError(outcome.error, "renameTag"));
      done(`Renamed tag “${from}” to “${to}”.`);
    });

  const reword = (commit: StartCommit, message: string) =>
    running(async () => {
      const outcome = await commands.call("rewordCommit", { repository: root, commit: commit.id, message });
      if (!outcome.ok) return setDialogProblem(describeCommitActionError(outcome.error, "reword"));
      const { branches, detached } = outcome.value;
      onReworded?.(commit.id, outcome.value.commit);
      const moved = [...branches.map((branch) => `“${branch}”`), ...(detached ? ["HEAD"] : [])].join(", ");
      done(
        `Changed the message of ${commit.shortId}: it's commit ${outcome.value.commit.slice(0, 7)} now${moved === "" ? "" : `, on ${moved}`}.`,
      );
    });

  /** Reads `commit`'s message, then asks for its new one. */
  const askReword = (commit: StartCommit) =>
    running(async () => {
      const outcome = await commands.call("commitDetails", { repository: root, commit: commit.id });
      if (!outcome.ok) return setProblem(`${didNot.reword}: the repository no longer has commit ${commit.shortId}.`);
      ask({ kind: "reword", commit, message: outcome.value.message });
    });

  const pick = (doing: "cherryPick" | "revert", commit: StartCommit) =>
    running(async () => {
      const outcome = await commands.call(doing === "cherryPick" ? "cherryPick" : "revertCommit", {
        repository: root,
        commit: commit.id,
      });
      if (!outcome.ok) return setProblem(describeCommitActionError(outcome.error, doing));
      done(describePicked(outcome.value, doing, commit));
    });

  /** Asks what resetting to `commit` would do, and shows it to confirm. */
  async function previewReset(commit: StartCommit, mode: ResetMode, moved: boolean) {
    const outcome = await commands.call("previewReset", { repository: root, commit: commit.id });
    if (!outcome.ok) {
      ask(null);
      return setProblem(describeCommitActionError(outcome.error, "reset"));
    }
    ask({ kind: "reset", commit, mode, preview: outcome.value, moved });
  }

  const reset = (commit: StartCommit, mode: ResetMode, preview: ResetPreview) =>
    running(async () => {
      const outcome = await commands.call("reset", { repository: root, commit: commit.id, mode, head: preview.head });
      if (!outcome.ok) {
        // Shown afresh, as HEAD is now, to confirm again.
        if (outcome.error.kind === "headMoved") return previewReset(commit, mode, true);
        return setDialogProblem(describeCommitActionError(outcome.error, "reset"));
      }
      const branch = preview.branch === null ? "HEAD" : `“${preview.branch}”`;
      recordUndo(root, { kind: "reset", branch: preview.branch, mode, from: preview.head, to: commit.id });
      done(`Reset ${branch} to ${describeCommit(commit)} (${MODE_WORDS[mode].label.toLowerCase()}).`);
    });

  const copy = (what: string, text: () => Promise<string>) =>
    running(async () => {
      await copyText!(await text());
      setSaid(`Copied the ${what}.`);
    });

  const message = async (commit: StartCommit) => {
    const outcome = await commands.call("commitDetails", { repository: root, commit: commit.id });
    if (!outcome.ok) throw new Error(`The repository no longer has commit ${commit.shortId}.`);
    return outcome.value.message;
  };

  const dialogs = (
    <>
      <TagDialog
        commit={asking?.kind === "tag" ? asking.commit : null}
        busy={busy}
        problem={dialogProblem}
        onTag={(name, commit, text) => void tag(name, commit, text)}
        onClose={() => ask(null)}
      />
      <DeleteTagDialog
        name={asking?.kind === "deleteTag" ? asking.name : null}
        busy={busy}
        onDelete={(name) => void deleteTag(name)}
        onClose={() => ask(null)}
      />
      <RenameTagDialog
        name={asking?.kind === "renameTag" ? asking.name : null}
        busy={busy}
        problem={dialogProblem}
        onRename={(from, to) => void renameTag(from, to)}
        onClose={() => ask(null)}
      />
      <RewordDialog
        asking={asking?.kind === "reword" ? asking : null}
        busy={busy}
        problem={dialogProblem}
        onReword={(commit, text) => void reword(commit, text)}
        onClose={() => ask(null)}
      />
      <ResetDialog
        asking={asking?.kind === "reset" ? asking : null}
        busy={busy}
        problem={dialogProblem}
        onReset={(commit, mode, preview) => void reset(commit, mode, preview)}
        onClose={() => ask(null)}
      />
    </>
  );

  return {
    tag: (commit) => {
      if (!busy) ask({ kind: "tag", commit });
    },
    deleteTag: (name) => {
      if (!busy) ask({ kind: "deleteTag", name });
    },
    renameTag: (name) => {
      if (!busy) ask({ kind: "renameTag", name });
    },
    reword: (commit) => void askReword(commit),
    cherryPick: (commit) => void pick("cherryPick", commit),
    revert: (commit) => void pick("revert", commit),
    reset: (commit, mode) => void running(() => previewReset(commit, mode, false)),
    copyId: copyText ? (commit) => void copy("commit ID", async () => commit.id) : null,
    copyMessage: copyText ? (commit) => void copy("commit message", () => message(commit)) : null,
    copyName: copyText ? (what, name) => void copy(what, async () => name) : null,
    busy,
    said,
    problem,
    dialogs,
  };
}

interface TagProps {
  commit: StartCommit | null;
  busy: boolean;
  problem: string | null;
  onTag: (name: string, commit: StartCommit, message: string) => void;
  onClose: () => void;
}

function TagDialog({ commit, busy, problem, onTag, onClose }: TagProps) {
  return (
    <Dialog open={commit !== null} onClose={onClose} title="New tag" closeLabel="Cancel the new tag">
      {commit !== null && <TagForm commit={commit} busy={busy} problem={problem} onTag={onTag} onClose={onClose} />}
    </Dialog>
  );
}

/** A tag's name, and a message, which makes it an annotated tag, for the commit it's made at. */
function TagForm({ commit, busy, problem, onTag, onClose }: TagProps & { commit: StartCommit }) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const messageId = useId();
  const noteId = useId();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy) onTag(name.trim(), commit, message);
  }

  return (
    <form className="branch-form" onSubmit={submit}>
      <NameField label="Tag name" value={name} onChange={setName} problem={problem} />
      <div className="branch-field">
        <label htmlFor={messageId}>Message (optional)</label>
        <textarea
          id={messageId}
          className="tag-message"
          rows={3}
          value={message}
          aria-describedby={noteId}
          onChange={(event) => setMessage(event.target.value)}
        />
        <p id={noteId} className="surface-note">
          With a message it's an annotated tag, with who made it and when; without one, a lightweight tag.
        </p>
      </div>
      <p>It's made at commit {describeCommit(commit)}.</p>
      <div className="dialog-actions">
        <button type="submit" className="button" aria-disabled={busy || undefined}>
          Create tag
        </button>
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

interface DeleteTagProps {
  name: string | null;
  busy: boolean;
  onDelete: (name: string) => void;
  onClose: () => void;
}

/** Asks before deleting a tag. */
function DeleteTagDialog({ name, busy, onDelete, onClose }: DeleteTagProps) {
  return (
    <Dialog
      open={name !== null}
      onClose={onClose}
      title={name === null ? "Delete tag" : `Delete tag “${name}”?`}
      closeLabel="Close, keeping the tag"
    >
      {name !== null && (
        <div className="branch-form">
          <p>
            Deleting “{name}” removes the tag from this repository, not from any remote it was pushed to. The commit
            it names stays.
          </p>
          <div className="dialog-actions">
            <button
              type="button"
              className="button"
              aria-disabled={busy || undefined}
              onClick={() => {
                if (!busy) onDelete(name);
              }}
            >
              Delete tag
            </button>
            <button type="button" className="button" onClick={onClose} data-autofocus>
              Keep the tag
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

interface RenameTagProps {
  name: string | null;
  busy: boolean;
  problem: string | null;
  onRename: (from: string, to: string) => void;
  onClose: () => void;
}

/** Asks for a tag's new name. */
function RenameTagDialog({ name, busy, problem, onRename, onClose }: RenameTagProps) {
  return (
    <Dialog
      open={name !== null}
      onClose={onClose}
      title={name === null ? "Rename tag" : `Rename tag “${name}”`}
      closeLabel="Cancel the rename"
    >
      {name !== null && (
        <RenameTagForm key={name} name={name} busy={busy} problem={problem} onRename={onRename} onClose={onClose} />
      )}
    </Dialog>
  );
}

function RenameTagForm({ name, busy, problem, onRename, onClose }: RenameTagProps & { name: string }) {
  const [to, setTo] = useState(name);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy) onRename(name, to.trim());
  }

  return (
    <form className="branch-form" onSubmit={submit}>
      <NameField label="New name" value={to} onChange={setTo} problem={problem} />
      <p>
        It stays at the same commit, with its message if it has one. A tag already pushed keeps its old name on the
        remote.
      </p>
      <div className="dialog-actions">
        <button type="submit" className="button" aria-disabled={busy || undefined}>
          Rename tag
        </button>
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

interface RewordProps {
  asking: { commit: StartCommit; message: string } | null;
  busy: boolean;
  problem: string | null;
  onReword: (commit: StartCommit, message: string) => void;
  onClose: () => void;
}

/** Asks for a commit's new subject and body, filled in with its own. */
function RewordDialog({ asking, busy, problem, onReword, onClose }: RewordProps) {
  return (
    <Dialog
      open={asking !== null}
      onClose={onClose}
      title={asking === null ? "Edit commit message" : `Edit the message of commit ${asking.commit.shortId}`}
      closeLabel="Cancel, keeping the message"
    >
      {asking !== null && (
        <RewordForm
          key={asking.commit.id}
          asking={asking}
          busy={busy}
          problem={problem}
          onReword={onReword}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

/** A Commit Message's subject, its first line, and its body, the rest. */
export function splitMessage(message: string): { subject: string; body: string } {
  const [subject = "", ...rest] = message.split("\n");
  return { subject: subject.trim(), body: rest.join("\n").trim() };
}

/** The whole Commit Message a subject and body make: the body after a blank line, if there is one. */
export function joinMessage(subject: string, body: string): string {
  const rest = body.trim();
  return rest === "" ? subject.trim() : `${subject.trim()}\n\n${rest}`;
}

function RewordForm({
  asking,
  busy,
  problem,
  onReword,
  onClose,
}: Omit<RewordProps, "asking"> & { asking: NonNullable<RewordProps["asking"]> }) {
  const [message, setMessage] = useState(() => splitMessage(asking.message));
  const subjectId = useId();
  const bodyId = useId();
  const problemId = useId();
  const noteId = useId();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy) onReword(asking.commit, joinMessage(message.subject, message.body));
  }

  return (
    <form className="branch-form" onSubmit={submit}>
      <div className="branch-field">
        <label htmlFor={subjectId}>Subject</label>
        <input
          id={subjectId}
          type="text"
          value={message.subject}
          aria-invalid={problem !== null || undefined}
          aria-describedby={problem !== null ? problemId : undefined}
          onChange={(event) => setMessage({ ...message, subject: event.target.value })}
          data-autofocus
        />
      </div>
      <div className="branch-field">
        <label htmlFor={bodyId}>Body (optional)</label>
        <textarea
          id={bodyId}
          className="tag-message"
          rows={5}
          value={message.body}
          onChange={(event) => setMessage({ ...message, body: event.target.value })}
        />
      </div>
      <p id={noteId}>
        The commit is made again with this message, and so is every commit after it on each local branch that has
        it, so their IDs change. Their changes, authors and dates stay. A branch already pushed needs a force push
        after.
      </p>
      {problem !== null && (
        <p id={problemId} role="alert" className="problem problem-output">
          {problem}
        </p>
      )}
      <div className="dialog-actions">
        <button type="submit" className="button" aria-disabled={busy || undefined} aria-describedby={noteId}>
          Change message
        </button>
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

interface ResetProps {
  asking: { commit: StartCommit; mode: ResetMode; preview: ResetPreview; moved: boolean } | null;
  busy: boolean;
  problem: string | null;
  onReset: (commit: StartCommit, mode: ResetMode, preview: ResetPreview) => void;
  onClose: () => void;
}

/**
 * Asks before resetting the current branch to a commit: how, soft, mixed or
 * hard, and the commits the branch would leave that nothing else has,
 * named, as deleting a branch names them.
 */
function ResetDialog({ asking, busy, problem, onReset, onClose }: ResetProps) {
  const branch = asking === null ? "" : asking.preview.branch === null ? "HEAD" : `“${asking.preview.branch}”`;
  return (
    <Dialog
      open={asking !== null}
      onClose={onClose}
      title={asking === null ? "Reset" : `Reset ${branch} to ${asking.commit.shortId}?`}
      closeLabel="Cancel the reset"
    >
      {asking !== null && (
        <ResetForm key={asking.preview.head} asking={asking} branch={branch} busy={busy} problem={problem} onReset={onReset} onClose={onClose} />
      )}
    </Dialog>
  );
}

function ResetForm({
  asking,
  branch,
  busy,
  problem,
  onReset,
  onClose,
}: Omit<ResetProps, "asking"> & { asking: NonNullable<ResetProps["asking"]>; branch: string }) {
  const [mode, setMode] = useState<ResetMode>(asking.mode);
  const name = useId();
  const { preview, commit } = asking;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy) onReset(commit, mode, preview);
  }

  return (
    <form className="branch-form" onSubmit={submit}>
      {asking.moved && <p role="status">HEAD has moved since this was shown, so here it is again, as it is now.</p>}
      <p>
        {branch} moves from {preview.head.slice(0, 7)} to {describeCommit(commit)}.
      </p>
      <fieldset className="branch-start">
        <legend>How</legend>
        {(Object.keys(MODE_WORDS) as ResetMode[]).map((each) => (
          <label key={each}>
            <input type="radio" name={name} checked={mode === each} onChange={() => setMode(each)} />
            <span>
              <strong>{MODE_WORDS[each].label}</strong>: {MODE_WORDS[each].note}
            </span>
          </label>
        ))}
      </fieldset>
      {preview.count > 0 && (
        <>
          <p className="warning">
            {branch} would leave {commits(preview.count)} that no other branch, remote-tracking branch or tag has:
          </p>
          <ul className="branch-lost">
            {preview.lost.map((each: HistoryCommit) => (
              <li key={each.id}>
                <span className="commit-id">{each.shortId}</span> {each.summary}{" "}
                <span className="branch-lost-author">by {each.author}</span>
              </li>
            ))}
          </ul>
          {preview.count > preview.lost.length && <p>and {commits(preview.count - preview.lost.length)} older.</p>}
        </>
      )}
      {mode === "hard" && preview.uncommitted && (
        <p className="warning">A hard reset also loses every uncommitted change in the working tree.</p>
      )}
      {problem !== null && (
        <p role="alert" className="problem problem-output">
          {problem}
        </p>
      )}
      <div className="dialog-actions">
        <button type="submit" className="button" aria-disabled={busy || undefined}>
          Reset {branch} ({MODE_WORDS[mode].label.toLowerCase()})
        </button>
        <button type="button" className="button" onClick={onClose} data-autofocus>
          Cancel
        </button>
      </div>
    </form>
  );
}
