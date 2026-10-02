import { PencilLine, X } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";

import type {
  CommandClient,
  CommitDetailsError,
  CommitFile,
  CommitSignature,
  Cursor,
  DetailedCommit,
  OpenedRepository,
  Path,
} from "../commands/api";
import { Avatar } from "../avatars/Avatar";
import { Copyable } from "../ui/Copyable";
import { ChangedFiles } from "./ChangedFiles";
import { type PageRead, readPage } from "./paging";
import { describeFailure, describeRepositoryError } from "./problems";
import { absoluteTime, machineTime, relativeTime, useNow } from "./time";
import { useCommitActions } from "./useCommitActions";

interface Props {
  commands: CommandClient;
  repository: OpenedRepository;
  /** The selected commit's full ID, or `null` with none selected, when the Widget is empty. */
  commit: string | null;
  /** The path of the changed file chosen, whose diff the Diff Widget shows, or `null`. */
  selectedFile: string | null;
  onSelectFile: (file: CommitFile) => void;
  /** Called by its close button, to show the working tree's changes in its place. */
  onShowWorkingTree?: () => void;
  /** Called once the commit's message is changed, moving the branches that have it. */
  onChanged?: () => void;
  /** Called with the commit whose message was changed, and the commit it was made again as, to select. */
  onReworded?: (from: string, to: string) => void;
}

// TODO(M2): the commit's children, and moving to a parent or child in the
// Commit graph (ADR 0005).
/**
 * The Commit details Widget: the selected commit's whole message, its
 * author and committer with their dates, its parents, and the files it
 * changed against its first parent, read a page at a time. Choosing a file
 * shows its diff in the Diff Widget. Its "Edit message" button changes the
 * commit's subject and body, and a click on its ID, or a parent's,
 * copies it. With no commit selected it draws only
 * its heading, and the page hides it. Its close button shows the working
 * tree's changes in its place.
 */
export function CommitDetails({
  commands,
  repository,
  commit,
  selectedFile,
  onSelectFile,
  onShowWorkingTree,
  onChanged = () => {},
  onReworded,
}: Props) {
  const headingId = useId();
  const more = useCommitActions({ commands, repository, onChanged, onReworded });
  return (
    <section className="surface commit-details" aria-labelledby={headingId} aria-busy={more.busy || undefined}>
      <div className="surface-header">
        <h3 id={headingId} className="surface-heading">
          Commit details
        </h3>
        {commit !== null && (
          <button
            type="button"
            className="button button-small"
            aria-disabled={more.busy || undefined}
            onClick={() => more.reword({ id: commit, shortId: commit.slice(0, 7), summary: null })}
          >
            <PencilLine aria-hidden="true" className="button-icon" />
            Edit message…
          </button>
        )}
        {onShowWorkingTree && commit !== null && (
          <button
            type="button"
            className="icon-button"
            aria-label="Close commit details, showing the working tree"
            title="Show the working tree"
            onClick={onShowWorkingTree}
          >
            <X aria-hidden="true" className="button-icon" />
          </button>
        )}
      </div>
      <p role="status" className="visually-hidden">
        {more.said}
      </p>
      {more.problem !== null && (
        <p role="alert" className="problem problem-output">
          {more.problem}
        </p>
      )}
      {commit === null ? (
        <p className="surface-note">No commit selected.</p>
      ) : (
        <SelectedCommit
          key={commit}
          commands={commands}
          root={repository.root}
          commit={commit}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
        />
      )}
      {more.dialogs}
    </section>
  );
}

type DetailsRead = { ok: true; details: DetailedCommit } | { ok: false; problem: string };

/** One commit's details, read afresh for each commit: give it the commit as its `key`. */
function SelectedCommit({
  commands,
  root,
  commit,
  selectedFile,
  onSelectFile,
}: {
  commands: CommandClient;
  root: Path;
  commit: string;
  selectedFile: string | null;
  onSelectFile: (file: CommitFile) => void;
}) {
  const [read, setRead] = useState<DetailsRead | null>(null);
  const now = useNow();
  const readFiles = useCallback(
    (cursor: Cursor | null) => readChanges(commands, root, commit, cursor),
    [commands, root, commit],
  );

  useEffect(() => {
    let current = true;
    void readDetails(commands, root, commit).then((result) => {
      if (current) setRead(result);
    });
    return () => {
      current = false;
    };
  }, [commands, root, commit]);

  if (read === null) {
    return (
      <p role="status" className="file-status-summary">
        Reading the commit…
      </p>
    );
  }
  if (!read.ok) {
    return (
      <p role="alert" className="problem">
        {read.problem}
      </p>
    );
  }
  const { details } = read;
  const [summary, ...rest] = details.message.split("\n");
  const body = rest.join("\n").trim();
  return (
    <>
      <div className="commit-message">
        <p className="commit-summary">{summary}</p>
        {body !== "" && <p className="commit-body">{body}</p>}
      </div>
      <dl className="commit-facts">
        <dt>Commit</dt>
        <dd>
          <Copyable text={details.id} what="commit ID" className="commit-id">
            {details.id}
          </Copyable>
        </dd>
        <dt>Author</dt>
        <dd>
          <Signature signature={details.author} now={now} />
        </dd>
        <dt>Committer</dt>
        <dd>
          <Signature signature={details.committer} now={now} />
        </dd>
        <dt>{details.parents.length === 1 ? "Parent" : "Parents"}</dt>
        <dd>
          {details.parents.length === 0 ? (
            "None: this is a first commit."
          ) : (
            <ul className="commit-parents">
              {details.parents.map((parent) => (
                <li key={parent.id}>
                  <Copyable text={parent.id} what="commit ID">
                    {parent.shortId}
                  </Copyable>
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
      <ChangedFiles read={readFiles} selectedFile={selectedFile} onSelectFile={onSelectFile} />
    </>
  );
}

function Signature({ signature, now }: { signature: CommitSignature; now: number }) {
  return (
    <>
      <Avatar name={signature.name} email={signature.email} />{" "}
      <span className="commit-person">{signature.name}</span>{" "}
      <span className="commit-email">&lt;{signature.email}&gt;</span>
      <br />
      <time dateTime={machineTime(signature.time)}>{absoluteTime(signature.time)}</time>
      <span className="commit-when"> ({relativeTime(signature.time, now)})</span>
    </>
  );
}

async function readDetails(
  commands: CommandClient,
  repository: Path,
  commit: string,
): Promise<DetailsRead> {
  try {
    const outcome = await commands.call("commitDetails", { repository, commit });
    if (outcome.ok) return { ok: true, details: outcome.value };
    return { ok: false, problem: describeCommitError(outcome.error) };
  } catch (failure) {
    return { ok: false, problem: describeFailure(failure) };
  }
}

function readChanges(
  commands: CommandClient,
  repository: Path,
  commit: string,
  cursor: Cursor | null,
): Promise<PageRead<CommitFile>> {
  return readPage(
    (at) => commands.call("commitChanges", { repository, commit, page: { cursor: at } }),
    cursor,
    describeCommitError,
  );
}

function describeCommitError(error: CommitDetailsError): string {
  if (error.kind === "commitNotFound") {
    return "This commit is no longer in the repository. Choose another in the Commit graph.";
  }
  return describeRepositoryError(error);
}
