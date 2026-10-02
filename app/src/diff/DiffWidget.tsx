import { Columns2, Rows2, X } from "lucide-react";
import {
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  lazy,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  type CommandClient,
  type CommitFile,
  type CommitFileDiffError,
  type DiffHunk,
  type FileDiff,
  type FileStatusEntry,
  MAX_DIFF_LINES,
  type OpenedRepository,
  type Path,
  type StageHunkError,
  type WorkingTreeFileDiffError,
} from "../commands/api";
import { describeFailure, describeRepositoryError } from "../repository/problems";
import { describeStashError } from "../repository/stashProblems";
import { describeGitRunError } from "../repository/workingTreeProblems";
import { describeDiff } from "./describe";
import { isDiffLimit, readDiffLimit, writeDiffLimit } from "./limit";
import { SplitDiff } from "./SplitDiff";
import { type DiffView, readDiffView, writeDiffView } from "./view";

// CodeMirror, and the languages it highlights, only load with the first diff shown: the first screen has none.
const DiffEditor = lazy(async () => ({ default: (await import("./DiffEditor")).DiffEditor }));

/** The file whose diff the Diff Widget shows. */
export type DiffSubject =
  /** A file chosen in Commit details, as the commit changed it. */
  | { kind: "commit"; commit: string; file: CommitFile }
  /** A change chosen in the Working tree Widget, staged or not. */
  | { kind: "workingTree"; entry: FileStatusEntry }
  /** A file chosen in the Stashes Widget, as the stash changed it from the commit it was made on. */
  | { kind: "stash"; stash: string; file: CommitFile };

interface Props {
  commands: CommandClient;
  repository: OpenedRepository;
  /** The file chosen, or `null` with none chosen, when the Widget is empty. */
  subject: DiffSubject | null;
  /**
   * Counts the times the working tree changed. A working tree file's diff is
   * read again with each, and the diff shown stays until it's read.
   */
  refreshes?: number;
  /** Called once a hunk has been staged or unstaged, for the rest to read again. */
  onChanged?: () => void;
  /** Called by its close button, and Escape, to put the Commit graph back in its place. */
  onClose?: () => void;
}

/**
 * The Diff Widget: the diff of the file chosen in Commit details or the
 * Stashes Widget, or of the change chosen in the Working tree Widget. It
 * shows it split, the file as it was beside the file as it is, removed lines
 * red and added ones green (ADR 0033), or unified, in a read-only CodeMirror
 * editor highlighted as the file's language (ADR 0006), whichever the user
 * chose last; each line keeps its `+` or `-` mark. What its lines can't
 * show, such as a rename, a mode change or a binary file, it says in words.
 * A diff longer than the user's limit waits to be asked for. A working tree
 * change's hunks can each be staged or unstaged, and the diff read again
 * then changes in place. Its close button and Escape close it. With no file
 * chosen it draws only its heading.
 */
export function DiffWidget({
  commands,
  repository,
  subject,
  refreshes = 0,
  onChanged = () => {},
  onClose,
}: Props) {
  const headingId = useId();
  // What the last hunk staged or unstaged did, said here, where it outlasts the diff it was in.
  const [said, setSaid] = useState("");
  // The path whose editor had focus when its hunk was staged or unstaged. The
  // last hunk takes the change to the file's other entry, which the Working
  // tree Widget then chooses, and its editor takes the focus on.
  const [refocus, setRefocus] = useState<string | null>(null);
  const [view, setView] = useState<DiffView>(readDiffView);

  function choose(wanted: DiffView) {
    writeDiffView(wanted);
    setView(wanted);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape" || !onClose || event.defaultPrevented) return;
    event.preventDefault();
    onClose();
  }

  function leave(event: FocusEvent) {
    // Moved on elsewhere, not lost to an editor that has gone.
    if (event.relatedTarget !== null && !event.currentTarget.contains(event.relatedTarget)) setRefocus(null);
  }

  return (
    <section className="surface diff" aria-labelledby={headingId} onBlur={leave} onKeyDown={onKeyDown}>
      <div className="surface-header">
        <h3 id={headingId} className="surface-heading">
          Diff
        </h3>
        {subject !== null && <p className="diff-path">{fileOf(subject).path}</p>}
        <div className="diff-views" role="group" aria-label="Diff view">
          <button
            type="button"
            className="icon-button"
            aria-pressed={view === "split"}
            title="Split: before and after side by side"
            onClick={() => choose("split")}
          >
            <Columns2 aria-hidden="true" className="button-icon" />
            <span className="visually-hidden">Split</span>
          </button>
          <button
            type="button"
            className="icon-button"
            aria-pressed={view === "unified"}
            title="Unified: one column"
            onClick={() => choose("unified")}
          >
            <Rows2 aria-hidden="true" className="button-icon" />
            <span className="visually-hidden">Unified</span>
          </button>
        </div>
        {onClose && (
          <button type="button" className="icon-button" aria-label="Close the diff" title="Close (Esc)" onClick={onClose}>
            <X aria-hidden="true" className="button-icon" />
          </button>
        )}
      </div>
      {subject === null ? (
        <p className="surface-note">No file selected.</p>
      ) : (
        <SelectedDiff
          key={keyOf(subject)}
          commands={commands}
          root={repository.root}
          subject={subject}
          view={view}
          refreshes={subject.kind === "workingTree" ? refreshes : 0}
          focusOnOpen={refocus === fileOf(subject).path}
          onHunkChanged={(words, focused) => {
            setSaid(words);
            setRefocus(focused ? fileOf(subject).path : null);
            onChanged();
          }}
          onStale={onChanged}
        />
      )}
      <p role="status" className="visually-hidden">
        {said}
      </p>
    </section>
  );
}

/** Names a subject, so each is read afresh. */
function keyOf(subject: DiffSubject): string {
  switch (subject.kind) {
    case "commit":
      return `commit\n${subject.commit}\n${subject.file.path}`;
    case "stash":
      return `stash\n${subject.stash}\n${subject.file.path}`;
    case "workingTree":
      return `workingTree\n${subject.entry.staged}\n${subject.entry.path}`;
  }
}

/** The subject's path, where it was if it moved, and whether it was copied. */
function fileOf(subject: DiffSubject): { path: string; from: string | null; copied: boolean } {
  if (subject.kind !== "workingTree") {
    const { path, change } = subject.file;
    const from = change.kind === "renamed" || change.kind === "copied" ? change.from : null;
    return { path, from, copied: change.kind === "copied" };
  }
  const { path, change } = subject.entry;
  return { path, from: change.kind === "renamed" ? change.from : null, copied: false };
}

type DiffRead =
  | { ok: true; diff: FileDiff }
  /** `gone` if the working tree change is no longer there. */
  | { ok: false; problem: string; gone?: boolean };

/** One file's diff, read afresh for each file: give it {@link keyOf} its subject as its `key`. */
function SelectedDiff({
  commands,
  root,
  subject,
  view,
  refreshes,
  focusOnOpen,
  onHunkChanged,
  onStale,
}: {
  commands: CommandClient;
  root: Path;
  subject: DiffSubject;
  view: DiffView;
  refreshes: number;
  /** Whether the editor takes focus once it's shown. */
  focusOnOpen: boolean;
  /** Called with what was done once a hunk is staged or unstaged, and whether the editor had focus. */
  onHunkChanged: (said: string, focused: boolean) => void;
  /** Called when the diff shown is found to be out of date, for it to be read again. */
  onStale: () => void;
}) {
  const [limit, setLimit] = useState(readDiffLimit);
  const [read, setRead] = useState<DiffRead | null>(null);
  // Asked for past the limit, the editor takes focus from the prompt that asked.
  const [asked, setAsked] = useState(focusOnOpen);
  const [hunkProblem, setHunkProblem] = useState<string | null>(null);
  // One hunk at a time: another is only sent from the diff read after this one.
  const changing = useRef(false);
  const { path, from, copied } = fileOf(subject);
  const commit = subject.kind === "commit" ? subject.commit : null;
  const stash = subject.kind === "stash" ? subject.stash : null;
  const staged = subject.kind === "workingTree" && subject.entry.staged;

  const refreshed = useRef(refreshes);

  useEffect(() => {
    let current = true;
    const refresh = refreshes !== refreshed.current;
    refreshed.current = refreshes;
    const reading =
      stash !== null
        ? readStashDiff(commands, { repository: root, stash, path, from, limit })
        : commit === null
          ? readWorkingTreeDiff(commands, { repository: root, path, from, staged, limit })
          : readDiff(commands, { repository: root, commit, path, from, limit });
    void reading.then((result) => {
      if (!current) return;
      // Read again after a change and found unchanged, the editor is kept
      // as it is, scrolled where it was. Found gone, as when its last hunk
      // is staged, it's kept until the Working tree Widget follows the
      // change to the file's other entry, or to none.
      const kept = (shown: DiffRead) => sameRead(shown, result) || (!result.ok && result.gone === true);
      setRead((shown) => (refresh && shown !== null && kept(shown) ? shown : result));
      if (refresh) changing.current = false;
    });
    return () => {
      current = false;
    };
  }, [commands, root, commit, stash, path, from, staged, limit, refreshes]);

  function showAll() {
    setAsked(true);
    setRead(null);
    setLimit(MAX_DIFF_LINES);
  }

  function changeLimit(wanted: number) {
    writeDiffLimit(wanted);
    setAsked(true);
    setLimit(wanted);
  }

  async function changeHunk(hunk: DiffHunk, focused: boolean) {
    if (changing.current) return;
    changing.current = true;
    try {
      const outcome = staged
        ? await commands.call("unstageHunk", { repository: root, path, from, hunk })
        : await commands.call("stageHunk", { repository: root, path, hunk });
      if (outcome.ok) {
        setHunkProblem(null);
        // Held until the diff is read again, which this asks for.
        onHunkChanged(`${staged ? "Unstaged" : "Staged"} the hunk at line ${firstLine(hunk)} of ${path}.`, focused);
        return;
      }
      setHunkProblem(describeStageHunkError(outcome.error, staged));
      if (outcome.error.kind === "hunkNotFound") onStale();
    } catch (failure) {
      setHunkProblem(describeFailure(failure));
    }
    changing.current = false;
  }

  return (
    <>
      {subject.kind === "workingTree" && (
        <p className="surface-note">
          {staged ? "Staged: from the last commit to what's staged." : "Unstaged: from what's staged to the working tree."}
        </p>
      )}
      {hunkProblem !== null && (
        <p role="alert" className="problem problem-output">
          {hunkProblem}
        </p>
      )}
      {read === null ? (
        <p role="status" className="file-status-summary">
          Reading the diff…
        </p>
      ) : !read.ok ? (
        <p role="alert" className="problem">
          {read.problem}
        </p>
      ) : (
        <ShownDiff
          diff={read.diff}
          view={view}
          path={path}
          copied={copied}
          limit={limit}
          focus={asked}
          staged={subject.kind === "workingTree" ? staged : null}
          onHunk={(hunk, focused) => void changeHunk(hunk, focused)}
          onShowAll={showAll}
          onChangeLimit={changeLimit}
        />
      )}
    </>
  );
}

function ShownDiff({
  diff,
  view,
  path,
  copied,
  limit,
  focus,
  staged,
  onHunk,
  onShowAll,
  onChangeLimit,
}: {
  diff: FileDiff;
  view: DiffView;
  path: string;
  copied: boolean;
  limit: number;
  focus: boolean;
  /** For a working tree change, whether it's staged; `null` for a commit's file, whose hunks stay as they are. */
  staged: boolean | null;
  onHunk: (hunk: DiffHunk, focused: boolean) => void;
  onShowAll: () => void;
  onChangeLimit: (lines: number) => void;
}) {
  const facts = describeDiff(diff, copied);
  const { content } = diff;
  return (
    <>
      {facts.length > 0 && (
        <ul className="diff-facts">
          {facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      )}
      {content.kind === "text" && content.hunks.length > 0 && view === "split" && (
        <SplitDiff hunks={content.hunks} path={path} focus={focus} staged={staged} onHunk={onHunk} />
      )}
      {content.kind === "text" && content.hunks.length > 0 && view === "unified" && (
        <Suspense
          fallback={
            <p role="status" className="file-status-summary">
              Reading the diff…
            </p>
          }
        >
          <DiffEditor hunks={content.hunks} path={path} focus={focus} staged={staged} onHunk={onHunk} />
        </Suspense>
      )}
      {content.kind === "tooLarge" && (
        <TooLarge {...content} limit={limit} onShowAll={onShowAll} onChangeLimit={onChangeLimit} />
      )}
    </>
  );
}

const count = new Intl.NumberFormat("en-GB");

function lines(n: number): string {
  return n === 1 ? "1 line" : `${count.format(n)} lines`;
}

/** Asks before showing a diff over the limit, and lets the limit change. */
function TooLarge({
  lines: length,
  added,
  removed,
  showable,
  limit,
  onShowAll,
  onChangeLimit,
}: {
  lines: number;
  added: number;
  removed: number;
  showable: boolean;
  limit: number;
  onShowAll: () => void;
  onChangeLimit: (lines: number) => void;
}) {
  const promptId = useId();
  const limitId = useId();
  const [draft, setDraft] = useState(String(limit));
  const [problem, setProblem] = useState<string | null>(null);
  const size = `This diff is ${lines(length)} long: ${lines(added)} added and ${lines(removed)} removed.`;

  if (!showable) {
    return (
      <p className="diff-prompt">
        {size} That is more than the {lines(MAX_DIFF_LINES)} Lanewise can show.
      </p>
    );
  }

  function save(event: FormEvent) {
    event.preventDefault();
    const wanted = Number(draft);
    if (draft.trim() === "" || !isDiffLimit(wanted)) {
      setProblem(`Enter a whole number of lines from 1 to ${count.format(MAX_DIFF_LINES)}.`);
      return;
    }
    setProblem(null);
    onChangeLimit(wanted);
  }

  // TODO: Settings sets the limit too (PRD §7.9, M1).
  return (
    <div className="diff-prompt" role="group" aria-labelledby={promptId}>
      <p id={promptId}>
        {size} Lanewise asks before showing a diff over {lines(limit)}, since a long one can take a
        moment to show.
      </p>
      <button type="button" className="button" onClick={onShowAll}>
        Show the diff
      </button>
      <form className="diff-limit" onSubmit={save} noValidate>
        <label htmlFor={limitId}>Ask before showing a diff over</label>
        <input
          id={limitId}
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_DIFF_LINES}
          step={1}
          value={draft}
          aria-describedby={problem === null ? undefined : `${limitId}-problem`}
          aria-invalid={problem !== null}
          onChange={(event) => setDraft(event.target.value)}
        />
        <span>lines</span>
        <button type="submit" className="button">
          Save
        </button>
      </form>
      {problem !== null && (
        <p id={`${limitId}-problem`} role="alert" className="problem">
          {problem}
        </p>
      )}
    </div>
  );
}

async function readDiff(
  commands: CommandClient,
  request: { repository: Path; commit: string; path: string; from: string | null; limit: number },
): Promise<DiffRead> {
  try {
    const outcome = await commands.call("commitFileDiff", request);
    if (outcome.ok) return { ok: true, diff: outcome.value };
    return { ok: false, problem: describeDiffError(outcome.error) };
  } catch (failure) {
    return { ok: false, problem: describeFailure(failure) };
  }
}

async function readStashDiff(
  commands: CommandClient,
  request: { repository: Path; stash: string; path: string; from: string | null; limit: number },
): Promise<DiffRead> {
  try {
    const outcome = await commands.call("stashFileDiff", request);
    if (outcome.ok) return { ok: true, diff: outcome.value };
    return { ok: false, problem: describeStashError(outcome.error, "read") };
  } catch (failure) {
    return { ok: false, problem: describeFailure(failure) };
  }
}

function sameRead(a: DiffRead, b: DiffRead): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function readWorkingTreeDiff(
  commands: CommandClient,
  request: { repository: Path; path: string; from: string | null; staged: boolean; limit: number },
): Promise<DiffRead> {
  try {
    const outcome = await commands.call("workingTreeFileDiff", request);
    if (outcome.ok) return { ok: true, diff: outcome.value };
    return {
      ok: false,
      problem: describeWorkingTreeDiffError(outcome.error),
      gone: outcome.error.kind === "changeNotFound",
    };
  } catch (failure) {
    return { ok: false, problem: describeFailure(failure) };
  }
}

function describeWorkingTreeDiffError(error: WorkingTreeFileDiffError): string {
  if (error.kind === "changeNotFound") {
    return `${error.path} no longer has this change. Choose another in the Working tree.`;
  }
  return describeRepositoryError(error);
}

/** The first line of `hunk` in the file it changed to, or where it was if it has none there. */
function firstLine(hunk: DiffHunk): number {
  return hunk.newLines === 0 ? Math.max(hunk.newStart, 1) : hunk.newStart;
}

function describeStageHunkError(error: StageHunkError, staged: boolean): string {
  if (error.kind === "hunkNotFound") {
    return `${error.path} has changed since this diff was read, so the hunk wasn't ${staged ? "unstaged" : "staged"}. The diff shows it as it is now.`;
  }
  return describeGitRunError(error, staged ? "unstageHunk" : "stageHunk");
}

function describeDiffError(error: CommitFileDiffError): string {
  if (error.kind === "commitNotFound") {
    return "This commit is no longer in the repository. Choose another in the Commit graph.";
  }
  if (error.kind === "fileNotFound") {
    return `This commit has no file ${error.path}. Choose another in Commit details.`;
  }
  return describeRepositoryError(error);
}
