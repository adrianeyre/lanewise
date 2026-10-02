import { Archive, ArchiveRestore, Ellipsis } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import type { CommandClient, CommitFile, Cursor, OpenedRepository, Path, Stash } from "../commands/api";
import { Copyable } from "../ui/Copyable";
import { Dialog } from "../ui/Dialog";
import { Menu } from "../ui/Menu";
import { ChangedFiles } from "./ChangedFiles";
import { NewStashDialog } from "./NewStashDialog";
import { readPage } from "./paging";
import { describeFailure } from "./problems";
import { describeStashError } from "./stashProblems";
import { titleOf } from "./stashWords";
import { absoluteTime, machineTime, relativeTime, useNow } from "./time";
import { recordUndo } from "./undo";
import { SectionHeading, useSectionOpen } from "../ui/Section";

interface Props {
  commands: CommandClient;
  repository: OpenedRepository;
  /** Counts the times the working tree or its refs changed, on disk or in Lanewise. */
  refreshes: number;
  /** The stash selected, by its `id`, whose files are listed, or `null`. */
  selected: string | null;
  /** Called with the stash selected, or `null` once the one selected has gone. */
  onSelect: (stash: string | null) => void;
  /** The path of the selected stash's file chosen, whose diff the Diff Widget shows, or `null`. */
  selectedFile: string | null;
  onSelectFile: (stash: string, file: CommitFile) => void;
  /** Called with the stashes each time they're read, for the Commit graph to draw them. */
  onStashes: (stashes: readonly Stash[]) => void;
  /** Called once a stash is made, applied, popped or dropped. */
  onChanged: () => void;
}

type Asking = { kind: "create" } | { kind: "drop"; stash: Stash };

/** Where focus goes once the list is read again after a pop or drop took the row that had it. */
type Refocus = { index: number };

/**
 * The Stashes Widget (PRD §7.5): the stashes, newest first, each with its
 * message, the branch it was made on and when. "New stash" stashes the
 * uncommitted changes, with a message or not and the untracked files or
 * not. Each stash's menu applies it, keeping it, pops it, or drops it once
 * the user confirms. Selecting one lists the files it changed, each of
 * which shows its diff in the Diff Widget. An apply or pop that stops with
 * conflicts is left in progress, for the Conflicts page to resolve. What each action did is announced. It reads the list again as the
 * refs change, telling the page, whose Commit graph draws them. Give it a new
 * `key` for each repository opened.
 */
export function StashesWidget({
  commands,
  repository,
  refreshes,
  selected,
  onSelect,
  selectedFile,
  onSelectFile,
  onStashes,
  onChanged,
}: Props) {
  const [list, setList] = useState<Stash[] | null>(null);
  const [unread, setUnread] = useState<string | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const headingId = useId();
  // A section of the left column's accordion.
  const [stashesOpen, toggleStashes] = useSectionOpen("stashes");
  const stashesId = useId();
  const container = useRef<HTMLElement>(null);
  const newStash = useRef<HTMLButtonElement>(null);
  const refocus = useRef<Refocus | null>(null);
  const now = useNow();
  const root = repository.root;
  // Called from effects, which shouldn't run again for a new callback.
  const callbacks = useRef({ onSelect, onStashes });
  useEffect(() => {
    callbacks.current = { onSelect, onStashes };
  }, [onSelect, onStashes]);

  useEffect(() => {
    let current = true;
    const refresh = refreshes > 0;
    commands.call("stashes", { repository: root }).then(
      (outcome) => {
        if (!current) return;
        if (outcome.ok) {
          // Read again after a change and found the same, as after most
          // changes on disk, the list is kept as it is, not drawn again.
          const read = outcome.value;
          setList((shown) => (refresh && shown !== null && JSON.stringify(shown) === JSON.stringify(read) ? shown : read));
          setUnread(null);
        } else setUnread(describeStashError(outcome.error, "read"));
      },
      (failure: unknown) => {
        if (current) setUnread(describeFailure(failure));
      },
    );
    return () => {
      current = false;
    };
  }, [commands, root, refreshes]);

  useEffect(() => {
    if (list === null) return;
    callbacks.current.onStashes(list);
    // The stash selected was popped or dropped, here or elsewhere.
    if (selected !== null && !list.some((stash) => stash.id === selected)) callbacks.current.onSelect(null);
  }, [list, selected]);

  // A stash popped or dropped took its row, and focus, with it: focus moves
  // on to the row that took its place, in the same commit, or to New stash with none left.
  useLayoutEffect(() => {
    const wanted = refocus.current;
    if (wanted === null || list === null) return;
    refocus.current = null;
    const rows = container.current?.querySelectorAll<HTMLElement>(".stash-select") ?? [];
    (rows[Math.min(wanted.index, rows.length - 1)] ?? newStash.current)?.focus();
  }, [list]);

  /** Runs `attempt`, saying what went wrong if it threw. */
  async function running(attempt: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setSaid(null);
    setProblem(null);
    try {
      await attempt();
    } catch (failure) {
      setProblem(describeFailure(failure));
    } finally {
      setBusy(false);
    }
  }

  const apply = (stash: Stash, pop: boolean) =>
    running(async () => {
      const name = titleOf(stash);
      const outcome = await commands.call(pop ? "popStash" : "applyStash", { repository: root, stash: stash.id });
      if (!outcome.ok) {
        setProblem(describeStashError(outcome.error, pop ? "pop" : "apply"));
        if (outcome.error.kind === "stashNotFound") onChanged();
        return;
      }
      if (outcome.value.kind === "stopped") {
        const { conflicts } = outcome.value;
        setSaid(
          `Git stopped ${pop ? "popping" : "applying"} “${name}” with conflicts in ${counted(conflicts.length)}. ` +
            "Resolve them on the Conflicts page.",
        );
      } else if (pop) {
        recordUndo(root, { kind: "popStash", message: stash.message });
        refocus.current = { index: stash.index };
        setSaid(`Popped “${name}”: its changes are back in the working tree, and it's no longer stashed.`);
      } else setSaid(`Applied “${name}”: its changes are back in the working tree, and it's still stashed.`);
      onChanged();
    });

  const drop = (stash: Stash) =>
    running(async () => {
      const outcome = await commands.call("dropStash", { repository: root, stash: stash.id });
      setAsking(null);
      if (!outcome.ok) {
        setProblem(describeStashError(outcome.error, "drop"));
        if (outcome.error.kind === "stashNotFound") onChanged();
        return;
      }
      refocus.current = { index: stash.index };
      setSaid(`Dropped “${titleOf(stash)}”.`);
      onChanged();
    });

  const shown = list?.find((stash) => stash.id === selected) ?? null;
  return (
    <section ref={container} className="surface stashes" aria-labelledby={headingId} aria-busy={busy || undefined}>
      <div className="surface-header">
        <SectionHeading level={3} open={stashesOpen} onToggle={toggleStashes} controls={stashesId} labelId={headingId}>
          Stashes
        </SectionHeading>
        <button
          ref={newStash}
          type="button"
          className="button button-small"
          aria-disabled={busy || undefined}
          onClick={() => {
            if (!busy) setAsking({ kind: "create" });
          }}
        >
          <Archive aria-hidden="true" className="button-icon" />
          New stash…
        </button>
      </div>
      <p role="status" className="file-status-summary">
        {said}
      </p>
      {problem !== null && (
        <p role="alert" className="problem problem-output">
          {problem}
        </p>
      )}
      {unread !== null && (
        <p role="alert" className="problem">
          {unread}
        </p>
      )}
      {stashesOpen && (
        <div id={stashesId}>
        {list !== null && list.length === 0 && <p className="surface-note">No stashes.</p>}
        {list !== null && list.length > 0 && (
          <ul className="stash-list">
            {list.map((stash) => (
              <li key={stash.id} className="stash-row">
                <button
                  type="button"
                  className="stash-select"
                  aria-current={stash.id === selected ? "true" : undefined}
                  onClick={() => onSelect(stash.id)}
                >
                  <ArchiveRestore aria-hidden="true" className="button-icon stash-icon" />
                  <span className="stash-words">
                    <span className="stash-message">{titleOf(stash)}</span>{" "}
                    <span className="stash-facts">
                      {stash.branch === null ? "On a detached HEAD" : `On ${stash.branch}`},{" "}
                      <time dateTime={machineTime(stash.time)} title={absoluteTime(stash.time)}>
                        {relativeTime(stash.time, now)}
                      </time>
                      {stash.untracked && ", with untracked files"}
                    </span>
                  </span>
                </button>
                <Menu
                  label={<Ellipsis aria-hidden="true" className="button-icon" />}
                  ariaLabel={`Actions for ${titleOf(stash)}`}
                  items={[
                    { kind: "action", id: "apply", label: "Apply", onSelect: () => void apply(stash, false) },
                    { kind: "action", id: "pop", label: "Pop", onSelect: () => void apply(stash, true) },
                    {
                      kind: "action",
                      id: "drop",
                      label: "Drop…",
                      onSelect: () => {
                        if (!busy) setAsking({ kind: "drop", stash });
                      },
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
        </div>
      )}
      {shown !== null && (
        <SelectedStash
          key={shown.id}
          commands={commands}
          root={root}
          stash={shown}
          selectedFile={selectedFile}
          onSelectFile={(file) => onSelectFile(shown.id, file)}
        />
      )}
      <NewStashDialog
        commands={commands}
        repository={repository}
        open={asking?.kind === "create"}
        onClose={() => setAsking(null)}
        onCreated={(stash) => {
          setAsking(null);
          setProblem(null);
          setSaid(`Stashed your changes as “${titleOf(stash)}”.`);
          onChanged();
        }}
      />
      <DropDialog
        stash={asking?.kind === "drop" ? asking.stash : null}
        busy={busy}
        onDrop={(stash) => void drop(stash)}
        onClose={() => setAsking(null)}
      />
    </section>
  );
}

/** The selected stash's details and the files it changed, read afresh for each: give it the stash's `id` as its `key`. */
export function SelectedStash({
  commands,
  root,
  stash,
  selectedFile,
  onSelectFile,
}: {
  commands: CommandClient;
  root: Path;
  stash: Stash;
  selectedFile: string | null;
  onSelectFile: (file: CommitFile) => void;
}) {
  const headingId = useId();
  const id = stash.id;
  const read = useCallback(
    (cursor: Cursor | null) =>
      readPage(
        (at) => commands.call("stashChanges", { repository: root, stash: id, page: { cursor: at } }),
        cursor,
        (error) => describeStashError(error, "read"),
      ),
    [commands, root, id],
  );
  return (
    <section className="stash-selected" aria-labelledby={headingId}>
      <h4 id={headingId} className="surface-subheading">
        {titleOf(stash)}
      </h4>
      <p className="surface-note">
        <code>stash@{`{${stash.index}}`}</code>, made on commit{" "}
        <Copyable text={stash.base.id} what="commit ID" className="commit-id">
          {stash.base.shortId}
        </Copyable>{" "}
        {stash.base.summary}, <time dateTime={machineTime(stash.time)}>{absoluteTime(stash.time)}</time>.
      </p>
      <ChangedFiles
        read={read}
        selectedFile={selectedFile}
        onSelectFile={onSelectFile}
      />
    </section>
  );
}

interface DropProps {
  stash: Stash | null;
  busy: boolean;
  onDrop: (stash: Stash) => void;
  onClose: () => void;
}

/** Asks before dropping a stash, whose changes go with it. */
function DropDialog({ stash, busy, onDrop, onClose }: DropProps) {
  return (
    <Dialog
      open={stash !== null}
      onClose={onClose}
      title={stash === null ? "Drop stash" : `Drop “${titleOf(stash)}”?`}
      closeLabel="Close, keeping the stash"
    >
      {stash !== null && (
        <div className="branch-form">
          <p className="warning">
            Dropping this stash deletes the changes in it, which Lanewise can't bring back. Apply it first to keep
            them.
          </p>
          <div className="dialog-actions">
            <button
              type="button"
              className="button"
              aria-disabled={busy || undefined}
              onClick={() => {
                if (!busy) onDrop(stash);
              }}
            >
              Drop stash
            </button>
            <button type="button" className="button" onClick={onClose} data-autofocus>
              Keep the stash
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function counted(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}
