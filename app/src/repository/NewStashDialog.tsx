import { type FormEvent, useId, useState } from "react";

import type { CommandClient, OpenedRepository, Stash } from "../commands/api";
import { Dialog } from "../ui/Dialog";
import { describeFailure } from "./problems";
import { describeStashError } from "./stashProblems";
import { recordUndo } from "./undo";

interface Props {
  commands: CommandClient;
  repository: OpenedRepository;
  open: boolean;
  onClose: () => void;
  /** Called with the stash made, once the uncommitted changes are in it. */
  onCreated: (stash: Stash) => void;
}

/**
 * Asks for a new stash's message, which it can go without, and whether to
 * stash the untracked files too, then stashes the uncommitted changes with
 * `git stash push`. What went wrong, such as there being nothing to stash,
 * is said in it. The Stashes Widget and the Working tree Widget each open
 * it.
 */
export function NewStashDialog({ commands, repository, open, onClose, onCreated }: Props) {
  return (
    <Dialog open={open} onClose={onClose} title="Stash changes" closeLabel="Cancel stashing">
      {open && <NewStashForm commands={commands} repository={repository} onClose={onClose} onCreated={onCreated} />}
    </Dialog>
  );
}

function NewStashForm({ commands, repository, onClose, onCreated }: Omit<Props, "open">) {
  const [message, setMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const messageId = useId();
  const noteId = useId();
  const problemId = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await commands.call("createStash", {
        repository: repository.root,
        message: message.trim() === "" ? null : message.trim(),
        includeUntracked,
      });
      if (outcome.ok) {
        const { id, message: made } = outcome.value;
        recordUndo(repository.root, { kind: "stash", id, message: made, includeUntracked });
        return onCreated(outcome.value);
      }
      setProblem(describeStashError(outcome.error, "create"));
    } catch (failure) {
      setProblem(describeFailure(failure));
    }
    setBusy(false);
  }

  return (
    <form className="branch-form" onSubmit={(event) => void submit(event)} aria-busy={busy || undefined}>
      <p>
        Stashing puts your uncommitted changes aside, staged or not, and leaves the working tree as the last commit
        has it. Apply or pop the stash to bring them back.
      </p>
      <div className="branch-field">
        <label htmlFor={messageId}>Message (optional)</label>
        <input
          id={messageId}
          type="text"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          autoComplete="off"
          aria-describedby={noteId}
          data-autofocus
        />
        <p id={noteId} className="surface-note">
          Left blank, Git names it after the commit it's made on.
        </p>
      </div>
      <label className="stash-untracked">
        <input
          type="checkbox"
          checked={includeUntracked}
          onChange={(event) => setIncludeUntracked(event.target.checked)}
        />
        Include untracked files
      </label>
      {problem !== null && (
        <p id={problemId} role="alert" className="problem problem-output">
          {problem}
        </p>
      )}
      <div className="dialog-actions">
        <button
          type="submit"
          className="button"
          aria-disabled={busy || undefined}
          aria-describedby={problem === null ? undefined : problemId}
        >
          Stash changes
        </button>
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
