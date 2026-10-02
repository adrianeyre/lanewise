import { Download, FolderOpen, ListTree, X } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import type { CommandClient, Path } from "../commands/api";
import { BrowseRepositories } from "../hosts/BrowseRepositories";
import type { HostsState } from "../hosts/useHosts";
import type { LinkOpener } from "../legal/ExternalLink";
import { describeFailure } from "../repository/problems";
import { SignInFailureHelp } from "../signIn/SignInFailureHelp";
import { NOT_CLONED } from "./cloneProblems";
import { repositoryName } from "./cloneUrl";
import { GitProgressBar } from "../ui/GitProgressBar";
import { describeProgress } from "../ui/gitProgressWords";
import type { CloneState } from "./useClone";

interface Props extends LinkOpener {
  commands: CommandClient;
  clone: CloneState;
  /** The Hosts to browse for a repository, and who each signed in. */
  hosts: HostsState;
  /** Asks the user for a folder, with the platform's own dialog: `null` if they cancel it. */
  chooseFolder(title: string): Promise<Path | null>;
  /** Counts the times focus is asked for, from the File menu's "Clone repository…". */
  focusRequest?: number;
  /** The folder to clone into until another is chosen: the base folder Settings has, if it has one. */
  baseFolder?: string | null;
}

type Field = "url" | "parent" | "name";

/**
 * The Welcome screen's Clone (PRD §7.1): a repository's URL, HTTPS or SSH,
 * and the folder to clone it into, with a name that follows the URL until
 * the user changes it. While it clones, Git's progress shows, and is
 * announced politely, and Cancel stops it and removes what it made. Git signs
 * in with the user's credential helpers or SSH agent; Lanewise never asks for
 * a password, or keeps one (PRD §9.2). A Sign-in Failure is explained with
 * how to fix it (PRD §9.3). Browse repositories signs in to a Tier 2 Host,
 * such as GitHub.com, GitLab.com, Bitbucket or Azure DevOps, and lists the
 * repositories there to choose from (PRD §9.1).
 */
export function CloneForm({
  commands,
  clone,
  hosts,
  chooseFolder,
  onOpenLink,
  focusRequest = 0,
  baseFolder = null,
}: Props) {
  const { status } = clone;
  const running = status.kind === "running";
  const headingId = useId();
  const urlId = useId();
  const urlNoteId = useId();
  const parentId = useId();
  const nameId = useId();
  const nameNoteId = useId();
  const problemId = useId();
  const phaseId = useId();
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState(baseFolder ?? "");
  const [name, setName] = useState("");
  // The name follows the URL until the user types one of their own.
  const [named, setNamed] = useState(false);
  const [missing, setMissing] = useState<Field | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const urlField = useRef<HTMLInputElement>(null);
  const parentField = useRef<HTMLInputElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const wasRunning = useRef(running);

  // Asked for from the title bar's File menu, the URL takes focus.
  useEffect(() => {
    if (focusRequest > 0) urlField.current?.focus();
  }, [focusRequest]);

  // Focus follows the clone: to Cancel as it starts, and back to the form once it stops.
  useEffect(() => {
    if (running && !wasRunning.current) cancelButton.current?.focus();
    else if (!running && wasRunning.current && status.kind !== "idle") urlField.current?.focus();
    wasRunning.current = running;
  }, [running, status.kind]);

  const cancelling = running && status.cancelling;

  function changeUrl(value: string) {
    setUrl(value);
    if (!named) setName(repositoryName(value));
    if (missing === "url") setMissing(null);
  }

  async function choose() {
    try {
      const folder = await chooseFolder("Clone into");
      if (folder === null) return;
      setParent(folder);
      if (missing === "parent") setMissing(null);
    } catch (failure) {
      setProblem(describeFailure(failure));
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (running) return;
    const empty = (["url", "parent", "name"] as const).find(
      (field) => ({ url, parent, name })[field].trim() === "",
    );
    setMissing(empty ?? null);
    if (empty !== undefined) {
      setProblem(
        {
          url: "Enter the URL of the repository to clone.",
          parent: "Choose a folder to clone into.",
          name: "Enter a name for the new folder.",
        }[empty],
      );
      ({ url: urlField, parent: parentField, name: nameField })[empty].current?.focus();
      return;
    }
    setProblem(null);
    clone.start(url.trim(), parent.trim(), name.trim());
  }

  const shownProblem =
    problem ?? (status.kind === "failed" ? status.problem : running ? status.problem : null);
  const signInFailed =
    problem === null && status.kind === "failed" && status.error?.kind === "signInFailed" ? status.error : null;
  const invalid = (field: Field) => missing === field || undefined;
  const described = (field: Field, note?: string) =>
    [note, missing === field ? problemId : undefined].filter(Boolean).join(" ") || undefined;

  return (
    <section className="clone" aria-labelledby={headingId}>
      <h2 id={headingId} className="clone-heading">
        Clone a repository
      </h2>
      <form className="clone-form" noValidate onSubmit={submit} aria-busy={running || undefined}>
        <div className="branch-field">
          <label htmlFor={urlId}>Repository URL</label>
          <div className="clone-folder">
            <input
              ref={urlField}
              id={urlId}
              type="text"
              inputMode="url"
              value={url}
              onChange={(event) => changeUrl(event.target.value)}
              readOnly={running}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-invalid={invalid("url")}
              aria-describedby={described("url", urlNoteId)}
            />
            <button
              type="button"
              className="button"
              aria-haspopup="dialog"
              aria-disabled={running || undefined}
              onClick={() => {
                if (!running) setBrowsing(true);
              }}
            >
              <ListTree aria-hidden="true" className="button-icon" />
              Browse repositories…
            </button>
          </div>
          <p id={urlNoteId} className="surface-note">
            HTTPS or SSH, such as https://github.com/adrianeyre/lanewise.git or
            git@github.com:adrianeyre/lanewise.git. Git signs in with your credential helper or SSH agent; Lanewise
            never asks for a password.
          </p>
        </div>
        <div className="branch-field">
          <label htmlFor={parentId}>Clone into</label>
          <div className="clone-folder">
            <input
              ref={parentField}
              id={parentId}
              type="text"
              value={parent}
              onChange={(event) => {
                setParent(event.target.value);
                if (missing === "parent") setMissing(null);
              }}
              readOnly={running}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={invalid("parent")}
              aria-describedby={described("parent")}
            />
            <button
              type="button"
              className="button"
              aria-disabled={running || undefined}
              onClick={() => {
                if (!running) void choose();
              }}
            >
              <FolderOpen aria-hidden="true" className="button-icon" />
              Choose a folder…
            </button>
          </div>
        </div>
        <div className="branch-field">
          <label htmlFor={nameId}>Folder name</label>
          <input
            ref={nameField}
            id={nameId}
            type="text"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setNamed(event.target.value !== "");
              if (missing === "name") setMissing(null);
            }}
            readOnly={running}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={invalid("name")}
            aria-describedby={described("name", nameNoteId)}
          />
          <p id={nameNoteId} className="surface-note">
            A new folder in the one above, or an empty one.
          </p>
        </div>
        {signInFailed !== null ? (
          <div id={problemId} role="alert" className="problem">
            <SignInFailureHelp
              lead={NOT_CLONED}
              failure={signInFailed.failure}
              message={signInFailed.message}
              onOpenLink={onOpenLink}
            />
          </div>
        ) : (
          shownProblem !== null && (
            <p id={problemId} role="alert" className="problem problem-output">
              {shownProblem}
            </p>
          )
        )}
        <div className="clone-actions">
          <button
            type="submit"
            className="button"
            aria-disabled={running || undefined}
            aria-describedby={shownProblem === null ? undefined : problemId}
          >
            <Download aria-hidden="true" className="button-icon" />
            Clone
          </button>
        </div>
      </form>
      {status.kind === "cancelled" && (
        <p className="surface-note">The clone was cancelled, and what it had made was removed.</p>
      )}
      {running && (
        <div className="clone-progress">
          <p id={phaseId} className="clone-phase">
            {cancelling ? "Cancelling the clone…" : describeProgress(status.progress, "Starting the clone…")}
          </p>
          {status.destination !== null && <p className="clone-destination">Into {status.destination}</p>}
          <GitProgressBar progress={status.progress} labelledBy={phaseId} />
          <div className="clone-actions">
            <button
              ref={cancelButton}
              type="button"
              className="button"
              aria-disabled={cancelling || undefined}
              onClick={clone.cancel}
            >
              <X aria-hidden="true" className="button-icon" />
              Cancel clone
            </button>
          </div>
        </div>
      )}
      <p role="status" className="visually-hidden">
        {clone.announcement}
      </p>
      <BrowseRepositories
        commands={commands}
        hosts={hosts}
        open={browsing}
        onClose={() => setBrowsing(false)}
        url={url}
        onChoose={changeUrl}
        onOpenLink={onOpenLink}
      />
    </section>
  );
}

