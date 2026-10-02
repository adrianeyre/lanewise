import { type FormEvent, useId, useState } from "react";

import type { NewUpstream, Remote } from "../commands/api";
import { Dialog } from "../ui/Dialog";
import { NameField } from "./useBranchActions";

interface Props {
  /** The local branch to push, or `null` while the dialog is closed. */
  branch: string | null;
  /** The remotes in the Git config, to push to. */
  remotes: Remote[];
  onPush: (upstream: NewUpstream) => void;
  onClose: () => void;
}

/**
 * Asks where to push a branch that has no Upstream (PRD §7.6): a remote, and
 * the branch's name on it, which starts as its own. Pushing there makes it
 * the branch's Upstream. With no remote to push to, it says to add one in
 * the Branches & remotes Widget.
 */
export function PushUpstreamDialog({ branch, remotes, onPush, onClose }: Props) {
  return (
    <Dialog
      open={branch !== null}
      onClose={onClose}
      title={branch === null ? "Push and set Upstream" : `Push “${branch}” and set its Upstream`}
      closeLabel="Cancel the push"
    >
      {branch !== null && <PushUpstreamForm branch={branch} remotes={remotes} onPush={onPush} onClose={onClose} />}
    </Dialog>
  );
}

function PushUpstreamForm({ branch, remotes, onPush, onClose }: Props & { branch: string }) {
  const [remote, setRemote] = useState(() => (remotes.find(({ name }) => name === "origin") ?? remotes[0])?.name ?? "");
  const [name, setName] = useState(branch);
  const [problem, setProblem] = useState<string | null>(null);
  const fieldId = useId();

  function submit(event: FormEvent) {
    event.preventDefault();
    const onRemote = name.trim();
    if (onRemote === "") {
      setProblem("The branch on the remote needs a name.");
      return;
    }
    onPush({ remote, branch: onRemote });
  }

  if (remotes.length === 0) {
    return (
      <div className="branch-form">
        <p>
          “{branch}” has no Upstream, and there's no remote to push it to. Add one in the Branches & remotes Widget,
          then push again.
        </p>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose} data-autofocus>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="branch-form" onSubmit={submit}>
      <p>“{branch}” has no Upstream yet. Choose where to push it: that branch becomes its Upstream.</p>
      <div className="branch-field">
        <label htmlFor={fieldId}>Remote</label>
        <select id={fieldId} value={remote} onChange={(event) => setRemote(event.target.value)} data-autofocus>
          {remotes.map(({ name: choice }) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      </div>
      <NameField
        label="Branch on the remote"
        value={name}
        onChange={(value) => {
          setName(value);
          setProblem(null);
        }}
        problem={problem}
        autofocus={false}
      />
      <div className="dialog-actions">
        <button type="submit" className="button">
          Push and set Upstream
        </button>
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
