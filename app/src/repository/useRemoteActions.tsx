import { type FormEvent, type ReactNode, useId, useState } from "react";

import type { CommandClient, LocalBranch, OpenedRepository, Remote, RemoteBranch } from "../commands/api";
import { Dialog } from "../ui/Dialog";
import { describeFailure } from "./problems";
import { describeRemoteConfigError } from "./remoteConfigProblems";
import { NameField } from "./useBranchActions";

/** What was done, for the Widget to put focus back after it. */
export type RemoteDone =
  | { kind: "added"; name: string }
  | { kind: "renamed"; from: string; to: string }
  | { kind: "urlChanged"; name: string }
  | { kind: "removed"; name: string }
  | { kind: "upstreamSet"; branch: string };

export interface RemoteActions {
  /** Asks for the new remote's name and URL, then adds it. */
  add: () => void;
  /** Asks for a new name, then renames the remote. */
  rename: (remote: Remote) => void;
  /** Asks for a new URL, then changes the remote's. */
  changeUrl: (remote: Remote) => void;
  /**
   * Says what removing the remote does, naming `tracking`, the local
   * branches whose Upstream is on it, then removes it once the user confirms.
   */
  remove: (remote: Remote, tracking: string[]) => void;
  /** Asks which of `choices`, remote-tracking branches, is to be `branch`'s Upstream, then sets it. */
  setUpstream: (branch: LocalBranch, choices: RemoteBranch[]) => void;
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
  /** Called once a remote or an Upstream has changed, so what shows them reads them again. */
  onChanged: () => void;
  onDone?: (done: RemoteDone) => void;
}

type Asking =
  | { kind: "add" }
  | { kind: "rename"; remote: Remote }
  | { kind: "changeUrl"; remote: Remote }
  | { kind: "remove"; remote: Remote; tracking: string[] }
  | { kind: "setUpstream"; branch: LocalBranch; choices: RemoteBranch[] };

/**
 * Adding, renaming, changing the URL of and removing remotes, and setting a
 * local branch's Upstream, for the Branches & remotes Widget (PRD §7.6):
 * each asks what it needs in a dialog, runs its command, and says what it
 * did, or why it didn't. Removing a remote asks first, saying what goes with
 * it and what doesn't. Nothing is fetched or pushed: the Toolbar does that.
 */
export function useRemoteActions({ commands, repository, onChanged, onDone }: Options): RemoteActions {
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // A problem with what the dialog asked, such as a name Git doesn't allow, shown in it.
  const [dialogProblem, setDialogProblem] = useState<string | null>(null);
  // Whether it's about the name, in the dialog adding a remote, rather than the URL.
  const [problemOnName, setProblemOnName] = useState(false);
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

  function done(message: string, what: RemoteDone) {
    ask(null);
    setSaid(message);
    onChanged();
    onDone?.(what);
  }

  const add = (name: string, url: string) =>
    running(async () => {
      const outcome = await commands.call("addRemote", { repository: root, name, url });
      if (!outcome.ok) {
        const { kind } = outcome.error;
        setProblemOnName(kind === "invalidName" || kind === "alreadyExists");
        return setDialogProblem(describeRemoteConfigError(outcome.error, "add"));
      }
      done(`Added remote “${name}”. Fetch to see its branches.`, { kind: "added", name });
    });

  const rename = (from: string, to: string) =>
    running(async () => {
      const outcome = await commands.call("renameRemote", { repository: root, from, to });
      if (!outcome.ok) return setDialogProblem(describeRemoteConfigError(outcome.error, "rename"));
      done(`Renamed remote “${from}” to “${to}”.`, { kind: "renamed", from, to });
    });

  const changeUrl = (name: string, url: string) =>
    running(async () => {
      const outcome = await commands.call("setRemoteUrl", { repository: root, name, url });
      if (!outcome.ok) return setDialogProblem(describeRemoteConfigError(outcome.error, "setUrl"));
      done(`Changed remote “${name}”'s URL to ${url}.`, { kind: "urlChanged", name });
    });

  const remove = (name: string) =>
    running(async () => {
      const outcome = await commands.call("removeRemote", { repository: root, name });
      if (!outcome.ok) {
        ask(null);
        return setProblem(describeRemoteConfigError(outcome.error, "remove"));
      }
      done(`Removed remote “${name}”.`, { kind: "removed", name });
    });

  const setUpstream = (branch: string, upstream: string) =>
    running(async () => {
      const outcome = await commands.call("setUpstream", { repository: root, branch, upstream });
      if (!outcome.ok) return setDialogProblem(describeRemoteConfigError(outcome.error, "setUpstream"));
      done(`“${branch}”'s Upstream is ${upstream} now.`, { kind: "upstreamSet", branch });
    });

  const close = () => ask(null);
  const dialogs = (
    <>
      <Dialog open={asking?.kind === "add"} onClose={close} title="Add remote" closeLabel="Cancel adding the remote">
        {asking?.kind === "add" && (
          <AddRemoteForm
            busy={busy}
            problem={dialogProblem}
            problemOnName={problemOnName}
            onAdd={(name, url) => void add(name, url)} onClose={close} />
        )}
      </Dialog>
      <Dialog
        open={asking?.kind === "rename"}
        onClose={close}
        title={asking?.kind === "rename" ? `Rename remote “${asking.remote.name}”` : "Rename remote"}
        closeLabel="Cancel renaming the remote"
      >
        {asking?.kind === "rename" && (
          <RenameRemoteForm
            from={asking.remote.name}
            busy={busy}
            problem={dialogProblem}
            onRename={(from, to) => void rename(from, to)}
            onClose={close}
          />
        )}
      </Dialog>
      <Dialog
        open={asking?.kind === "changeUrl"}
        onClose={close}
        title={asking?.kind === "changeUrl" ? `Change remote “${asking.remote.name}”'s URL` : "Change URL"}
        closeLabel="Cancel changing the URL"
      >
        {asking?.kind === "changeUrl" && (
          <ChangeUrlForm
            remote={asking.remote}
            busy={busy}
            problem={dialogProblem}
            onChange={(name, url) => void changeUrl(name, url)}
            onClose={close}
          />
        )}
      </Dialog>
      <Dialog
        open={asking?.kind === "remove"}
        onClose={close}
        title={asking?.kind === "remove" ? `Remove remote “${asking.remote.name}”?` : "Remove remote"}
        closeLabel="Close, keeping the remote"
      >
        {asking?.kind === "remove" && (
          <RemoveRemoteBody
            remote={asking.remote}
            tracking={asking.tracking}
            busy={busy}
            onRemove={(name) => void remove(name)}
            onClose={close}
          />
        )}
      </Dialog>
      <Dialog
        open={asking?.kind === "setUpstream"}
        onClose={close}
        title={asking?.kind === "setUpstream" ? `Set “${asking.branch.name}”'s Upstream` : "Set Upstream"}
        closeLabel="Cancel setting the Upstream"
      >
        {asking?.kind === "setUpstream" && (
          <SetUpstreamForm
            branch={asking.branch}
            choices={asking.choices}
            busy={busy}
            problem={dialogProblem}
            onSet={(branch, upstream) => void setUpstream(branch, upstream)}
            onClose={close}
          />
        )}
      </Dialog>
    </>
  );

  return {
    add: () => {
      if (!busy) ask({ kind: "add" });
    },
    rename: (remote) => {
      if (!busy) ask({ kind: "rename", remote });
    },
    changeUrl: (remote) => {
      if (!busy) ask({ kind: "changeUrl", remote });
    },
    remove: (remote, tracking) => {
      if (!busy) ask({ kind: "remove", remote, tracking });
    },
    setUpstream: (branch, choices) => {
      if (!busy) ask({ kind: "setUpstream", branch, choices });
    },
    busy,
    said,
    problem,
    dialogs,
  };
}

interface FormProps {
  busy: boolean;
  problem: string | null;
  onClose: () => void;
}

/** The dialog's submit button, and Cancel. */
function Actions({ busy, submit, onClose }: { busy: boolean; submit: string; onClose: () => void }) {
  return (
    <div className="dialog-actions">
      <button type="submit" className="button" aria-disabled={busy || undefined}>
        {submit}
      </button>
      <button type="button" className="button" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}

function AddRemoteForm({
  busy,
  problem,
  problemOnName,
  onAdd,
  onClose,
}: FormProps & { problemOnName: boolean; onAdd: (name: string, url: string) => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy) onAdd(name.trim(), url.trim());
  }

  return (
    <form className="branch-form" onSubmit={submit}>
      <NameField label="Name" value={name} onChange={setName} problem={problemOnName ? problem : null} />
      <NameField label="URL" value={url} onChange={setUrl} problem={problemOnName ? null : problem} autofocus={false} />
      <p>Such as https://example.com/project.git. Nothing is fetched from it until you fetch.</p>
      <Actions busy={busy} submit="Add remote" onClose={onClose} />
    </form>
  );
}

function RenameRemoteForm({
  from,
  busy,
  problem,
  onRename,
  onClose,
}: FormProps & { from: string; onRename: (from: string, to: string) => void }) {
  const [to, setTo] = useState(from);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy) onRename(from, to.trim());
  }

  return (
    <form className="branch-form" onSubmit={submit}>
      <NameField label="New name" value={to} onChange={setTo} problem={problem} />
      <p>Its remote-tracking branches, and the Upstreams of the branches that track it, are renamed with it.</p>
      <Actions busy={busy} submit="Rename remote" onClose={onClose} />
    </form>
  );
}

/** Whether `url` has credentials in it, which the core hides as `***`. */
function hasHiddenCredentials(url: string): boolean {
  return url.includes("://***@");
}

function ChangeUrlForm({
  remote,
  busy,
  problem,
  onChange,
  onClose,
}: FormProps & { remote: Remote; onChange: (name: string, url: string) => void }) {
  // Its credentials are hidden, so the URL shown isn't one to keep.
  const hidden = remote.url !== null && hasHiddenCredentials(remote.url);
  const [url, setUrl] = useState(hidden ? "" : (remote.url ?? ""));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy) onChange(remote.name, url.trim());
  }

  return (
    <form className="branch-form" onSubmit={submit}>
      {hidden && (
        <p>
          Its URL, {remote.url}, has credentials in it, which Lanewise doesn't show. Enter the whole of the new
          URL.
        </p>
      )}
      <NameField label="URL" value={url} onChange={setUrl} problem={problem} />
      {remote.pushUrl !== null && (
        <p>It pushes to a URL of its own, {remote.pushUrl}, which doesn't change.</p>
      )}
      <Actions busy={busy} submit="Change URL" onClose={onClose} />
    </form>
  );
}

interface RemoveProps {
  remote: Remote;
  tracking: string[];
  busy: boolean;
  onRemove: (name: string) => void;
  onClose: () => void;
}

/** Says what removing a remote does, and what it doesn't, before it's removed. */
function RemoveRemoteBody({ remote, tracking, busy, onRemove, onClose }: RemoveProps) {
  const count = remote.branches.length;
  const going =
    count === 0
      ? "It has no remote-tracking branches in this repository."
      : `Its ${count === 1 ? "remote-tracking branch goes" : `${count} remote-tracking branches go`} from this repository.`;
  const tracks = tracking.length === 1 ? "1 local branch tracks it" : `${tracking.length} local branches track it`;
  return (
    <div className="branch-form">
      <p className="warning">
        {going}
        {tracking.length > 0 && ` ${tracks}, and will have no Upstream:`}
      </p>
      {tracking.length > 0 && (
        <ul className="branch-lost">
          {tracking.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      )}
      <p>Nothing on the remote changes, and no local branch is deleted. You can add the remote again later.</p>
      <div className="dialog-actions">
        <button
          type="button"
          className="button"
          aria-disabled={busy || undefined}
          onClick={() => {
            if (!busy) onRemove(remote.name);
          }}
        >
          Remove remote
        </button>
        <button type="button" className="button" onClick={onClose}>
          Keep the remote
        </button>
      </div>
    </div>
  );
}

function SetUpstreamForm({
  branch,
  choices,
  busy,
  problem,
  onSet,
  onClose,
}: FormProps & { branch: LocalBranch; choices: RemoteBranch[]; onSet: (branch: string, upstream: string) => void }) {
  const [upstream, setUpstream] = useState(() => defaultUpstream(branch, choices));
  const fieldId = useId();
  const problemId = useId();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy && upstream !== "") onSet(branch.name, upstream);
  }

  if (choices.length === 0) {
    return (
      <div className="branch-form">
        <p>
          There are no remote-tracking branches to choose from. Add a remote and fetch from it, or push “{branch.name}”
          from the Toolbar, which offers to set its Upstream as it goes.
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
      <div className="branch-field">
        <label htmlFor={fieldId}>Upstream</label>
        <select
          id={fieldId}
          value={upstream}
          onChange={(event) => setUpstream(event.target.value)}
          aria-invalid={problem !== null}
          aria-describedby={problem === null ? undefined : problemId}
          data-autofocus
        >
          {choices.map((choice) => (
            <option key={choice.name} value={choice.name}>
              {choice.name}
            </option>
          ))}
        </select>
        {problem !== null && (
          <p id={problemId} role="alert" className="problem problem-output">
            {problem}
          </p>
        )}
      </div>
      <p>
        {branch.upstream === null
          ? `“${branch.name}” pulls from and pushes to it from now on.`
          : `It's ${branch.upstream.name} now. “${branch.name}” pulls from and pushes to the one chosen from now on.`}
      </p>
      <Actions busy={busy} submit="Set Upstream" onClose={onClose} />
    </form>
  );
}

/** The Upstream the dialog starts at: the branch's own, or one of the same name, on `origin` first. */
function defaultUpstream(branch: LocalBranch, choices: RemoteBranch[]): string {
  const own = branch.upstream?.name;
  if (own !== undefined && choices.some((choice) => choice.name === own)) return own;
  const named = choices.filter((choice) => choice.branch === branch.name);
  const chosen = named.find((choice) => choice.name === `origin/${branch.name}`) ?? named[0] ?? choices[0];
  return chosen?.name ?? "";
}
