import {
  ArrowRightLeft,
  FileExclamationPoint,
  FileMinus,
  FilePenLine,
  FilePlus,
  FileQuestionMark,
  type LucideIcon,
  Minus,
  Plus,
} from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import type {
  CommandClient,
  Cursor,
  FileChange,
  FileStatusEntry,
  OpenedRepository,
  Path,
  StagedFiles,
} from "../commands/api";
import { type PageRead, readPage } from "./paging";
import { describeFailure, describeRepositoryError } from "./problems";
import { describeGitRunError } from "./workingTreeProblems";

interface Props {
  commands: CommandClient;
  repository: OpenedRepository;
  /**
   * Counts the times the working tree changed. Each new count reads the
   * status again, and what's shown stays until it's read, so nothing flickers.
   */
  refreshes: number;
  /** The change chosen, whose diff the Diff Widget shows, or `null`. */
  selected: FileStatusEntry | null;
  /** Called with the change chosen, or `null` once the chosen one has gone. */
  onSelect: (entry: FileStatusEntry | null) => void;
  /** Called once files are staged or unstaged. */
  onChanged: () => void;
}

interface Section {
  title: "Conflicted" | "Staged" | "Unstaged";
  entries: FileStatusEntry[];
}

const changes: Record<FileChange["kind"], { label: string; icon: LucideIcon }> = {
  added: { label: "Added", icon: FilePlus },
  modified: { label: "Modified", icon: FilePenLine },
  deleted: { label: "Deleted", icon: FileMinus },
  renamed: { label: "Renamed", icon: ArrowRightLeft },
  untracked: { label: "Untracked", icon: FileQuestionMark },
  conflicted: { label: "Conflicted", icon: FileExclamationPoint },
};

/** The most entries one read of the status sends. */
const MOST_READ = 1000;

/**
 * The Working tree Widget's list of the repository's changed files, in
 * Conflicted, Staged and Unstaged sections, read a page at a time with "Show
 * more changes" while there are more. Each change can be chosen, to show its
 * diff, and staged or unstaged, and each section has "Stage all" or "Unstage
 * all"; a change's hunks are staged or unstaged in the Diff Widget. Give it a
 * new `key` for each repository opened, so it starts again from the first
 * page and drops whatever the last one was still reading.
 */
export function FileStatusList({ commands, repository, refreshes, selected, onSelect, onChanged }: Props) {
  const [entries, setEntries] = useState<FileStatusEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [staging, setStaging] = useState(false);
  const [stageProblem, setStageProblem] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  // Only the latest read is shown: a refresh overtakes the one before.
  const reads = useRef(0);
  const shown = useRef(0);
  const headingId = useId();

  const show = useCallback((read: PageRead<FileStatusEntry>) => {
    setLoading(false);
    if (read.ok) {
      const { items } = read.page;
      setEntries((listed) => (read.fromStart ? items : [...listed, ...items]));
      setNextCursor(read.page.nextCursor);
      setProblem(null);
    } else {
      setProblem(read.problem);
    }
  }, []);

  const read = useCallback(
    (cursor: Cursor | null, limit?: number) => {
      const n = ++reads.current;
      void readStatus(commands, repository.root, cursor, limit).then((result) => {
        if (n === reads.current) show(result);
      });
    },
    [commands, repository.root, show],
  );

  // The first page, then the status again after each change, as many
  // entries as are shown. `loading` starts true and the list empty, since
  // the list is drawn afresh for each repository.
  useEffect(() => {
    read(null, refreshes === 0 ? undefined : Math.min(MOST_READ, Math.max(200, shown.current)));
  }, [read, refreshes]);

  useEffect(() => {
    shown.current = entries.length;
  }, [entries]);

  // A chosen change that has gone, staged or unstaged, is followed to the
  // file's other entry, if it has one, so its diff stays in view. Before
  // the list is painted, so no frame shows it with nothing chosen.
  useLayoutEffect(() => {
    if (selected === null || loading) return;
    if (entries.some((entry) => same(entry, selected))) return;
    onSelect(entries.find((entry) => entry.path === selected.path && entry.change.kind !== "conflicted") ?? null);
  }, [entries, loading, selected, onSelect]);

  useEffect(() => {
    // "Show more changes" has gone with the last page: keep focus from
    // falling to the page's start.
    if (refocus.current && !loading) {
      refocus.current = false;
      if (nextCursor === null) list.current?.focus();
    }
  }, [loading, nextCursor]);

  function showMore() {
    if (loading || nextCursor === null) return;
    refocus.current = true;
    setLoading(true);
    read(nextCursor);
  }

  async function stage(stages: boolean, files: StagedFiles) {
    if (staging) return;
    setStaging(true);
    try {
      const outcome = await commands.call(stages ? "stageFiles" : "unstageFiles", {
        repository: repository.root,
        files,
      });
      if (outcome.ok) {
        setStageProblem(null);
        onChanged();
      } else {
        setStageProblem(describeGitRunError(outcome.error, stages ? "stage" : "unstage"));
      }
    } catch (failure) {
      setStageProblem(describeFailure(failure));
    } finally {
      setStaging(false);
    }
  }

  const sections: Section[] = [
    { title: "Conflicted" as const, entries: entries.filter((e) => e.change.kind === "conflicted") },
    { title: "Staged" as const, entries: entries.filter((e) => e.staged) },
    {
      title: "Unstaged" as const,
      entries: entries.filter((e) => !e.staged && e.change.kind !== "conflicted"),
    },
  ].filter((section) => section.entries.length > 0);

  return (
    <div
      className="file-status"
      ref={list}
      tabIndex={-1}
      aria-labelledby={headingId}
      aria-busy={staging}
      role="group"
    >
      <h4 id={headingId} className="surface-subheading">
        Changes
      </h4>
      <p role="status" className="file-status-summary">
        {summarise(loading, entries.length, nextCursor !== null, problem !== null)}
      </p>
      {problem !== null && (
        <p role="alert" className="problem">
          {problem}
        </p>
      )}
      {stageProblem !== null && (
        <p role="alert" className="problem problem-output">
          {stageProblem}
        </p>
      )}
      {sections.map((section) => (
        <FileStatusSection
          key={section.title}
          section={section}
          selected={selected}
          busy={staging}
          onSelect={onSelect}
          onStage={(files) => void stage(section.title === "Unstaged", files)}
        />
      ))}
      {nextCursor !== null && (
        <button
          type="button"
          className="button"
          aria-disabled={loading}
          onClick={showMore}
        >
          Show more changes
        </button>
      )}
    </div>
  );
}

/** Whether `a` and `b` are the same change: the same file, staged or not. */
function same(a: FileStatusEntry, b: FileStatusEntry): boolean {
  return a.path === b.path && a.staged === b.staged && a.change.kind === b.change.kind;
}

/** Reads the page of `repository`'s status at `cursor`, or says why it couldn't. */
function readStatus(
  commands: CommandClient,
  repository: Path,
  cursor: Cursor | null,
  limit?: number,
): Promise<PageRead<FileStatusEntry>> {
  return readPage(
    (at) => commands.call("fileStatus", { repository, page: { cursor: at, limit } }),
    cursor,
    describeRepositoryError,
  );
}

function summarise(loading: boolean, count: number, more: boolean, failed: boolean): string {
  if (loading) return count === 0 ? "Reading the working tree…" : "Reading more changes…";
  if (failed && count === 0) return "";
  if (count === 0) return "No changes: the working tree matches the last commit.";
  const counted = count === 1 ? "1 change" : `${count} changes`;
  return more ? `Showing the first ${counted}.` : `${counted}.`;
}

/** The paths staging or unstaging `entry` takes: a rename's `from` too. */
function pathsOf(entry: FileStatusEntry): string[] {
  return entry.change.kind === "renamed" ? [entry.path, entry.change.from] : [entry.path];
}

function FileStatusSection({
  section,
  selected,
  busy,
  onSelect,
  onStage,
}: {
  section: Section;
  selected: FileStatusEntry | null;
  busy: boolean;
  onSelect: (entry: FileStatusEntry) => void;
  onStage: (files: StagedFiles) => void;
}) {
  const headingId = useId();
  const staged = section.title === "Staged";
  const stages = section.title !== "Conflicted";
  return (
    <section className="file-status-section" aria-labelledby={headingId}>
      <div className="file-status-section-header">
        <h5 id={headingId} className="file-status-section-heading">
          {section.title}
        </h5>
        {stages && (
          <button
            type="button"
            className="button button-small"
            aria-disabled={busy}
            onClick={() => {
              if (!busy) onStage({ kind: "all" });
            }}
          >
            {staged ? (
              <Minus aria-hidden="true" className="button-icon" />
            ) : (
              <Plus aria-hidden="true" className="button-icon" />
            )}
            {staged ? "Unstage all" : "Stage all"}
          </button>
        )}
      </div>
      <ul className="file-status-entries">
        {section.entries.map((entry) => (
          <FileStatusItem
            key={entry.path}
            entry={entry}
            selected={selected !== null && same(entry, selected)}
            busy={busy}
            onSelect={onSelect}
            onStage={() => onStage({ kind: "paths", paths: pathsOf(entry) })}
          />
        ))}
      </ul>
    </section>
  );
}

function FileStatusItem({
  entry,
  selected,
  busy,
  onSelect,
  onStage,
}: {
  entry: FileStatusEntry;
  selected: boolean;
  busy: boolean;
  onSelect: (entry: FileStatusEntry) => void;
  onStage: () => void;
}) {
  const { label, icon: Icon } = changes[entry.change.kind];
  const described = (
    <>
      <Icon aria-hidden="true" className="change-icon" />
      {/* Spaced, so the path and change are read as two words. */}
      <span className="file-status-path">{entry.path}</span>{" "}
      <span className="change-label">
        {label}
        {entry.change.kind === "renamed" && (
          <>
            {" from "}
            <span className="file-status-path">{entry.change.from}</span>
          </>
        )}
      </span>
    </>
  );
  // A conflicted file is resolved on the Conflicts page, shown in this page's
  // place while its In-Progress Operation is. TODO: a cherry-pick or
  // revert's, which the Conflicts page doesn't take yet (PRD §7.7, P1).
  if (entry.change.kind === "conflicted") {
    return (
      <li className={`file-status-row change-${entry.change.kind}`}>
        <span className="file-status-entry">{described}</span>
      </li>
    );
  }
  return (
    <li className={`file-status-row change-${entry.change.kind}`}>
      <button
        type="button"
        className="file-status-entry changed-file"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(entry)}
      >
        {described}
      </button>
      <button
        type="button"
        className="button button-small"
        aria-disabled={busy}
        // Named with the file, so each reads apart from the rest.
        aria-label={`${entry.staged ? "Unstage" : "Stage"} ${entry.path}`}
        onClick={() => {
          if (!busy) onStage();
        }}
      >
        {entry.staged ? "Unstage" : "Stage"}
      </button>
    </li>
  );
}
