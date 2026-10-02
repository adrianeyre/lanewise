import { redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { ChevronDown, ChevronUp, FileCheck, Redo2, RotateCcw, Undo2 } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import type {
  CommandClient,
  ConflictedFile,
  ConflictReport,
  InProgressOperation,
  OpenedRepository,
  WholeFileChoice,
} from "../commands/api";
import { describeFailure } from "../repository/problems";
import { type ConflictHunk, type HunkChoice, hunkAt } from "./conflictHunks";
import {
  chooseHunk,
  describeHunkLines,
  goToHunk,
  hunksIn,
  putSuggestion,
  replaceResolution,
  resolutionEditor,
  sameHunk,
} from "./conflictEditors";
import { describeOperationError } from "./operationWords";
import { describeSides } from "./sideWords";
import type { ConflictRead } from "./useConflictedFile";
import { describeWholeFile, resolvedWhole, wholeFileOptions } from "./wholeFile";

/** The Conflict Hunk the Resolution's choices act on now: which it is of how many, and the text it's in. */
export interface HunkInResolution {
  text: string;
  hunk: ConflictHunk;
  index: number;
  count: number;
}

/** Where the Conflict Hunk the Resolution's choices act on is: which of how many, and its lines. */
export interface HunkPlace {
  index: number;
  count: number;
  startLine: number;
  endLine: number;
}

/**
 * The Resolution of the file chosen, as the AI Suggestion Widget reaches it:
 * to read the Conflict Hunk to ask about, and to put a Suggestion in place
 * of it, which only the user's Accept or Edit does.
 */
export interface ResolutionHandle {
  /** The Conflict Hunk the choices act on now, or `null` with none left. */
  current(): HunkInResolution | null;
  /** Every Conflict Hunk left, in order. */
  all(): HunkInResolution[];
  /** Where `hunk` is now, found by its sides as `put` finds it, or `null` once it's resolved. */
  find(hunk: ConflictHunk): HunkInResolution | null;
  /**
   * Puts `resolution` in place of `hunk`, if it's still in the Resolution,
   * as one change undo takes back, and says whether it was. With `edit`, the
   * lines put in are selected in the editor, which takes focus, to edit.
   */
  put(hunk: ConflictHunk, resolution: string, edit: boolean): boolean;
}

interface Props {
  commands: CommandClient;
  repository: OpenedRepository;
  operation: InProgressOperation;
  /** The conflicted file chosen in Conflicted files, or `null` with none, when the Widget is empty. */
  path: string | null;
  /** Its versions, or `null` while they're read. */
  read: ConflictRead | null;
  /** The Resolution of each file as the user left it on choosing another, which it starts from when chosen again. */
  drafts: Map<string, string>;
  /** Called once the Resolution is written and marked resolved. */
  onResolved: (path: string) => void;
  /** Says what was done, where it's still heard once this Widget is empty. */
  onSay: (said: string) => void;
  /** Called with the Resolution being edited, for the AI Suggestion Widget, and with `null` once there's none. */
  onEditor: (editor: ResolutionHandle | null) => void;
  /** Called with where the Conflict Hunk the choices act on is, as it changes, and `null` with none. */
  onHunk: (place: HunkPlace | null) => void;
}

/**
 * The Conflicts page's Resolution Widget (PRD §7.7): the conflicted file
 * chosen in Conflicted files as it is in the working tree, with its
 * Conflict Markers, in an editable CodeMirror editor. Each Conflict Hunk is
 * resolved by accepting Ours, Theirs or both, in either order, or by editing
 * it by hand, and every change can be undone, back to the file as Git left
 * it. Marking it resolved writes it to the working tree and stages it, and
 * isn't done while Conflict Markers are left, unless the user says to. A
 * file that can't be resolved as text is resolved as a whole instead: it's
 * said in words what each side did to it, with what Git reports, and one
 * side's version is kept, or the file deleted.
 */
export function ResolutionWidget({
  commands,
  repository,
  operation,
  path,
  read,
  drafts,
  onResolved,
  onSay,
  onEditor,
  onHunk,
}: Props) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <section className="surface resolution" aria-labelledby={headingId}>
      <h3 ref={heading} id={headingId} className="surface-heading" tabIndex={-1}>
        Resolution
      </h3>
      {path === null ? (
        <p className="surface-note">No file selected.</p>
      ) : read === null ? (
        <p role="status" className="file-status-summary">
          Reading “{path}”…
        </p>
      ) : !read.ok ? (
        <p role="alert" className="problem">
          {read.problem}
        </p>
      ) : resolvedWhole(read.file) ? (
        <WholeFile
          key={path}
          commands={commands}
          root={repository.root}
          operation={operation}
          path={path}
          file={read.file}
          onResolved={onResolved}
          onSay={onSay}
        />
      ) : (
        <Resolving
          key={path}
          commands={commands}
          root={repository.root}
          path={path}
          file={read.file}
          drafts={drafts}
          onResolved={onResolved}
          onSay={onSay}
          onEditor={onEditor}
          onHunk={onHunk}
        />
      )}
    </section>
  );
}

/** What Git reports about a conflicted file, such as a rename one side made that the other deleted, as Git says it. */
function Reports({ reports }: { reports: ConflictReport[] }) {
  const headingId = useId();
  if (reports.length === 0) return null;
  return (
    <div className="conflict-reports">
      <h4 id={headingId} className="surface-subheading">
        What Git reports
      </h4>
      <ul aria-labelledby={headingId}>
        {reports.map((report) => (
          <li key={report.message}>{report.message}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A conflicted file resolved as a whole, being binary, or deleted or
 * renamed away on one side: what each side did to it, in words and as Git
 * reports it, and a choice of keeping one side's version or deleting it,
 * which Mark resolved makes. There's no AI Suggestion for it (PRD §7.7).
 */
function WholeFile({
  commands,
  root,
  operation,
  path,
  file,
  onResolved,
  onSay,
}: {
  commands: CommandClient;
  root: string;
  operation: InProgressOperation;
  path: string;
  file: ConflictedFile;
  onResolved: (path: string) => void;
  onSay: (said: string) => void;
}) {
  const describedId = useId();
  const sidesId = useId();
  const choiceName = useId();
  const [chosen, setChosen] = useState<WholeFileChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const options = wholeFileOptions(file);
  const sides = describeSides(operation);

  async function markResolved() {
    if (busy) return;
    const option = options.find((each) => each.choice === chosen);
    if (option === undefined) {
      setProblem(`Choose what “${path}” becomes first.`);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await commands.call("resolveWholeFile", { repository: root, path, choice: option.choice });
      if (outcome.ok) {
        onSay(option.said(path));
        onResolved(path);
      } else {
        setProblem(describeOperationError(outcome.error, "resolveWhole"));
      }
    } catch (failure) {
      setProblem(describeFailure(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="resolution-body" aria-busy={busy || undefined}>
      <p className="diff-path">{path}</p>
      <p id={describedId} className="resolution-position">
        {describeWholeFile(file)}
      </p>
      <ul id={sidesId} className="whole-file-sides">
        <li>Ours: {sides.ours}</li>
        <li>Theirs: {sides.theirs}</li>
      </ul>
      <Reports reports={file.reports} />
      <fieldset className="whole-file-choices" aria-describedby={`${describedId} ${sidesId}`}>
        <legend>What “{path}” becomes</legend>
        {options.map((option) => (
          <label key={option.choice}>
            <input
              type="radio"
              name={choiceName}
              checked={chosen === option.choice}
              onChange={() => {
                setChosen(option.choice);
                setProblem(null);
              }}
            />
            {option.name}
          </label>
        ))}
      </fieldset>
      <p className="surface-note">
        Marking it resolved writes what you chose to the working tree and stages it. Mark unresolved, in Conflicted
        files, puts the conflict back to choose again.
      </p>
      <div className="resolution-controls">
        <div className="button-row">
          <button
            type="button"
            className="button"
            aria-disabled={busy || chosen === null || undefined}
            onClick={() => void markResolved()}
          >
            <FileCheck aria-hidden="true" className="button-icon" />
            Mark resolved
          </button>
        </div>
      </div>
      {problem !== null && (
        <p role="alert" className="problem problem-output">
          {problem}
        </p>
      )}
    </div>
  );
}

/** “1 Conflict Hunk” or “3 Conflict Hunks”. */
function hunks(count: number): string {
  return count === 1 ? "1 Conflict Hunk" : `${count} Conflict Hunks`;
}

/** “1 line” or “3 lines”. */
function lines(count: number): string {
  return count === 1 ? "1 line" : `${count} lines`;
}

const CHOICES: readonly { choice: HunkChoice; name: string; said: string }[] = [
  { choice: "ours", name: "Accept Ours", said: "Accepted Ours" },
  { choice: "theirs", name: "Accept Theirs", said: "Accepted Theirs" },
  { choice: "oursThenTheirs", name: "Accept both, Ours first", said: "Accepted both, Ours first," },
  { choice: "theirsThenOurs", name: "Accept both, Theirs first", said: "Accepted both, Theirs first," },
];

/** The Resolution of one file, read afresh for each: give it the file's path as its `key`. */
function Resolving({
  commands,
  root,
  path,
  file,
  drafts,
  onResolved,
  onSay,
  onEditor,
  onHunk,
}: {
  commands: CommandClient;
  root: string;
  path: string;
  file: ConflictedFile;
  drafts: Map<string, string>;
  onResolved: (path: string) => void;
  onSay: (said: string) => void;
  onEditor: (editor: ResolutionHandle | null) => void;
  onHunk: (place: HunkPlace | null) => void;
}) {
  const hintId = useId();
  const positionId = useId();
  const blockedId = useId();
  const overrideId = useId();
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [state, setState] = useState<EditorState | null>(null);
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The file as Git left it in the working tree, which Start over goes back to.
  const conflicted = file.working?.kind === "text" ? file.working.text : null;
  // For the AI Suggestion Widget: the editor, and where its Conflict Hunk is.
  const report = useRef({ onEditor, onHunk });
  useEffect(() => {
    report.current = { onEditor, onHunk };
  }, [onEditor, onHunk]);

  useEffect(() => {
    if (conflicted === null) return;
    const made = resolutionEditor(
      parent.current!,
      drafts.get(path) ?? conflicted,
      `Resolution of ${path}`,
      `${hintId} ${positionId}`,
      setState,
    );
    view.current = made;
    setState(made.state);
    report.current.onEditor({
      current() {
        const left = hunksIn(made.state).hunks;
        const index = hunkAt(left, made.state.selection.main.head);
        if (index === null) return null;
        return { text: made.state.doc.toString(), hunk: left[index]!, index, count: left.length };
      },
      all() {
        const left = hunksIn(made.state).hunks;
        const text = made.state.doc.toString();
        return left.map((hunk, index) => ({ text, hunk, index, count: left.length }));
      },
      find(hunk) {
        const found = sameHunk(made.state, hunk);
        if (found === null) return null;
        const left = hunksIn(made.state).hunks;
        return { text: made.state.doc.toString(), hunk: found, index: left.indexOf(found), count: left.length };
      },
      put(hunk, resolution, edit) {
        const found = sameHunk(made.state, hunk);
        if (found === null) return false;
        putSuggestion(made, found, resolution, edit);
        if (edit) made.focus();
        return true;
      },
    });
    return () => {
      // Kept for when the file is chosen again, as the user left it.
      drafts.set(path, made.state.doc.toString());
      report.current.onEditor(null);
      view.current = null;
      made.destroy();
    };
  }, [conflicted, drafts, path, hintId, positionId]);

  const found = state === null ? null : hunksIn(state);
  const left = found?.hunks ?? [];
  const markers = found?.markers ?? false;
  const current = state === null ? null : hunkAt(left, state.selection.main.head);
  const hunk = current === null ? null : left[current]!;
  const blocked = markers && !override;

  const count = left.length;
  const startLine = hunk?.startLine ?? null;
  const endLine = hunk?.endLine ?? null;
  // Said only as it changes, not on every keystroke.
  useEffect(() => {
    report.current.onHunk(
      current === null || startLine === null || endLine === null ? null : { index: current, count, startLine, endLine },
    );
  }, [current, count, startLine, endLine]);
  useEffect(() => () => report.current.onHunk(null), []);

  function say(words: string) {
    setProblem(null);
    setSaid(words);
  }

  /** Where `hunk` is, and what each side has, as it's said on going to it. */
  function describeHunk(at: ConflictHunk, index: number): string {
    const base = at.base === null ? "" : `, the Base ${lines(at.base.length)}`;
    return `Conflict Hunk ${index + 1} of ${left.length}, ${describeHunkLines(at)}: Ours has ${lines(at.ours.length)}${base}, Theirs ${lines(at.theirs.length)}.`;
  }

  function go(step: 1 | -1) {
    const editor = view.current;
    if (editor === null || left.length === 0) return;
    const head = editor.state.selection.main.head;
    const inside = left.findIndex((at) => at.from <= head && head < at.to);
    let index: number;
    if (inside !== -1) index = inside + step;
    else if (step === 1) index = left.findIndex((at) => at.from > head);
    else index = left.findLastIndex((at) => at.to <= head);
    // Past the last, it goes round to the first, and back from the first to the last.
    if (index < 0 || index >= left.length) index = step === 1 ? 0 : left.length - 1;
    goToHunk(editor, left[index]!);
    say(describeHunk(left[index]!, index));
  }

  function choose(choice: (typeof CHOICES)[number]) {
    const editor = view.current;
    if (editor === null || hunk === null) return;
    chooseHunk(editor, hunk, choice.choice);
    const remaining = hunksIn(editor.state).hunks.length;
    say(`${choice.said} at line ${hunk.startLine}. ${remaining === 0 ? "No Conflict Hunks left." : `${hunks(remaining)} left.`}`);
  }

  function takeWhole(side: "Ours" | "Theirs") {
    const editor = view.current;
    const version = side === "Ours" ? file.ours : file.theirs;
    if (editor === null || version?.kind !== "text") return;
    replaceResolution(editor, version.text);
    say(`Took all of ${side}, as the whole file. Undo takes this back.`);
  }

  function history(back: boolean) {
    const editor = view.current;
    if (editor === null) return;
    if (!(back ? undo(editor) : redo(editor))) return;
    say(`${back ? "Undone" : "Redone"}. ${hunks(hunksIn(editor.state).hunks.length)} left.`);
  }

  function startOver() {
    const editor = view.current;
    if (editor === null || conflicted === null) return;
    replaceResolution(editor, conflicted);
    say(`Started over from the file as Git left it: ${hunks(hunksIn(editor.state).hunks.length)}. Undo takes this back.`);
  }

  async function markResolved() {
    const editor = view.current;
    if (busy || editor === null) return;
    if (blocked) {
      setSaid(null);
      setProblem(
        `“${path}” still has Conflict Markers. Resolve each Conflict Hunk, or check “Mark resolved with Conflict Markers left in”.`,
      );
      return;
    }
    setBusy(true);
    setSaid(null);
    setProblem(null);
    const { doc } = editor.state;
    // Written with the line endings the file had.
    const content = conflicted?.includes("\r\n") ? doc.sliceString(0, doc.length, "\r\n") : doc.toString();
    try {
      const outcome = await commands.call("resolveConflict", { repository: root, path, content });
      if (outcome.ok) {
        onSay(`Wrote the Resolution of “${path}” and marked it resolved.`);
        onResolved(path);
      } else {
        setProblem(describeOperationError(outcome.error, "resolve"));
      }
    } catch (failure) {
      setProblem(describeFailure(failure));
    } finally {
      setBusy(false);
    }
  }

  function keyDown(event: KeyboardEvent) {
    if (event.key !== "F7" || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    go(event.shiftKey ? -1 : 1);
  }

  const position =
    left.length === 0
      ? markers
        ? "No whole Conflict Hunks left, but Conflict Markers are."
        : "No Conflict Hunks left."
      : `${hunks(left.length)} left. At Conflict Hunk ${current! + 1} of ${left.length}, ${describeHunkLines(hunk!)}.`;

  return (
    // F7 and Shift+F7 go between Conflict Hunks from anywhere in the Widget.
    <div className="resolution-body" onKeyDown={keyDown} aria-busy={busy || undefined}>
      <p className="diff-path">{path}</p>
      <Reports reports={file.reports} />
      <p id={hintId} className="surface-note">
        Choose what each Conflict Hunk becomes, take all of one side, or edit it by hand. F7 goes to the next Conflict
        Hunk and Shift+F7 to the previous one. Every change can be undone.
      </p>
      <p id={positionId} className="resolution-position">
        {position}
      </p>
      <div className="resolution-controls">
        <div className="button-row" role="group" aria-label="Go to a Conflict Hunk">
          <button
            type="button"
            className="button button-small"
            aria-keyshortcuts="Shift+F7"
            aria-disabled={left.length === 0 || undefined}
            onClick={() => go(-1)}
          >
            <ChevronUp aria-hidden="true" className="button-icon" />
            Previous conflict
          </button>
          <button
            type="button"
            className="button button-small"
            aria-keyshortcuts="F7"
            aria-disabled={left.length === 0 || undefined}
            onClick={() => go(1)}
          >
            <ChevronDown aria-hidden="true" className="button-icon" />
            Next conflict
          </button>
        </div>
        <div
          className="button-row"
          role="group"
          aria-label={hunk === null ? "Resolve a Conflict Hunk" : `Resolve Conflict Hunk ${current! + 1}, ${describeHunkLines(hunk)}`}
        >
          {CHOICES.map((choice) => (
            <button
              key={choice.choice}
              type="button"
              className="button button-small"
              aria-disabled={hunk === null || undefined}
              onClick={() => choose(choice)}
            >
              {choice.name}
            </button>
          ))}
        </div>
        <div className="button-row" role="group" aria-label="Take a whole side">
          {(["Ours", "Theirs"] as const).map((side) => (
            <button key={side} type="button" className="button button-small" onClick={() => takeWhole(side)}>
              Take all of {side}
            </button>
          ))}
        </div>
      </div>
      <div ref={parent} className="diff-editor conflict-editor resolution-editor" />
      <div className="resolution-controls">
        <div className="button-row" role="group" aria-label="Undo">
          <button
            type="button"
            className="button button-small"
            aria-disabled={state === null || undoDepth(state) === 0 || undefined}
            onClick={() => history(true)}
          >
            <Undo2 aria-hidden="true" className="button-icon" />
            Undo
          </button>
          <button
            type="button"
            className="button button-small"
            aria-disabled={state === null || redoDepth(state) === 0 || undefined}
            onClick={() => history(false)}
          >
            <Redo2 aria-hidden="true" className="button-icon" />
            Redo
          </button>
          <button type="button" className="button button-small" onClick={startOver}>
            <RotateCcw aria-hidden="true" className="button-icon" />
            Start over
          </button>
        </div>
        <div className="button-row">
          {markers && (
            <label className="resolution-override" htmlFor={overrideId}>
              <input
                id={overrideId}
                type="checkbox"
                checked={override}
                onChange={(event) => setOverride(event.target.checked)}
              />
              Mark resolved with Conflict Markers left in
            </label>
          )}
          <button
            type="button"
            className="button"
            aria-disabled={busy || blocked || undefined}
            aria-describedby={blocked ? blockedId : undefined}
            onClick={() => void markResolved()}
          >
            <FileCheck aria-hidden="true" className="button-icon" />
            Mark resolved
          </button>
        </div>
      </div>
      {blocked && (
        <p id={blockedId} className="surface-note">
          Conflict Markers are left in. Resolve each Conflict Hunk first, or check “Mark resolved with Conflict Markers
          left in” to write it as it is.
        </p>
      )}
      <p role="status" className="visually-hidden">
        {said}
      </p>
      {problem !== null && (
        <p role="alert" className="problem problem-output">
          {problem}
        </p>
      )}
    </div>
  );
}
