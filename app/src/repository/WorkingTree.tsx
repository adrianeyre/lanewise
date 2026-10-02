import { Archive } from "lucide-react";
import { useId, useState } from "react";

import type { CommandClient, FileStatusEntry, OpenedRepository } from "../commands/api";
import type { CommitCheck } from "../ai/jevDecisions";
import { CommitForm } from "./CommitForm";
import { FileStatusList } from "./FileStatusList";
import { NewStashDialog } from "./NewStashDialog";
import { titleOf } from "./stashWords";

interface Props {
  commands: CommandClient;
  repository: OpenedRepository;
  /** Counts the times the working tree changed, on disk or in Lanewise. */
  refreshes: number;
  /** Why the working tree isn't watched for changes, if it isn't. */
  unwatched: string | null;
  /** The change chosen, whose diff the Diff Widget shows, or `null`. */
  selected: FileStatusEntry | null;
  onSelect: (entry: FileStatusEntry | null) => void;
  /** Called once files are staged, unstaged or stashed. */
  onChanged: () => void;
  /** Called once a commit is made or amended. */
  onCommitted: () => void;
  /** Jev's check of the staged changes before a commit, where it's on (ADR 0036). */
  checkWithJev?: ((message: string) => Promise<CommitCheck>) | null;
}

/**
 * The Working tree Widget (PRD §7.3): the changed files, to stage, unstage
 * and choose for the Diff Widget, and the Commit Message box that commits
 * the staged ones. "Stash changes" puts them all in a new stash instead, as
 * the Stashes Widget's "New stash" does, which is out of reach while there
 * are no stashes. It refreshes as the working tree changes on disk. Give it
 * a new `key` for each repository opened.
 */
export function WorkingTree({
  commands,
  repository,
  refreshes,
  unwatched,
  selected,
  onSelect,
  onChanged,
  onCommitted,
  checkWithJev = null,
}: Props) {
  const headingId = useId();
  const [stashing, setStashing] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  return (
    <section className="surface working-tree" aria-labelledby={headingId}>
      <div className="surface-header">
        <h3 id={headingId} className="surface-heading">
          Working tree
        </h3>
        <button
          type="button"
          className="button button-small"
          onClick={() => {
            setSaid(null);
            setStashing(true);
          }}
        >
          <Archive aria-hidden="true" className="button-icon" />
          Stash changes…
        </button>
      </div>
      <p role="status" className="visually-hidden">
        {said}
      </p>
      {unwatched !== null && <p className="surface-note">{unwatched}</p>}
      <FileStatusList
        commands={commands}
        repository={repository}
        refreshes={refreshes}
        selected={selected}
        onSelect={onSelect}
        onChanged={onChanged}
      />
      <CommitForm
        commands={commands}
        repository={repository}
        onCommitted={onCommitted}
        checkWithJev={checkWithJev}
      />
      <NewStashDialog
        commands={commands}
        repository={repository}
        open={stashing}
        onClose={() => setStashing(false)}
        onCreated={(stash) => {
          setStashing(false);
          setSaid(`Stashed your changes as “${titleOf(stash)}”.`);
          onChanged();
        }}
      />
    </section>
  );
}
