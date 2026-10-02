import { defaultKeymap, history, historyKeymap, isolateHistory, standardKeymap } from "@codemirror/commands";
import { Chunk } from "@codemirror/merge";
import { EditorState, type Range, StateField, Text } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  gutter,
  GutterMarker,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";

import { type ConflictHunk, conflictHunks, type HunkChoice, hasConflictMarkers, resolvedText } from "./conflictHunks";

/**
 * Lines of a side that changed from the Base, numbered from 1 in the side:
 * `from` to `to`, or, where the side only removed lines, none, with `to`
 * the line before where they were, `from - 1`.
 */
export interface ChangedLines {
  from: number;
  to: number;
}

/** Text as CodeMirror holds it, split at `\r\n`, `\r` or `\n` as it splits a document. */
function textOf(text: string): Text {
  return Text.of(text.split(/\r\n?|\n/));
}

/** The lines of `side` that changed from `base`, in order, by `@codemirror/merge`'s line diff. */
export function changedLines(base: string, side: string): ChangedLines[] {
  const b = textOf(side);
  return Chunk.build(textOf(base), b).map((chunk) =>
    chunk.fromB === chunk.toB
      ? { from: b.lineAt(chunk.fromB).number, to: b.lineAt(chunk.fromB).number - 1 }
      : { from: b.lineAt(chunk.fromB).number, to: b.lineAt(chunk.endB).number },
  );
}

/**
 * The lines of `base` that `side` removed or changed, in order, numbered in
 * the Base: none where it only added lines.
 */
export function removedLines(base: string, side: string): ChangedLines[] {
  const a = textOf(base);
  return Chunk.build(a, textOf(side)).flatMap((chunk) =>
    chunk.fromA === chunk.toA ? [] : [{ from: a.lineAt(chunk.fromA).number, to: a.lineAt(chunk.endA).number }],
  );
}

/** Each line in any of `changes`, once, in order: as the Base's lines Ours or Theirs removed or changed. */
export function mergedLines(...changes: (readonly ChangedLines[])[]): ChangedLines[] {
  const lines = new Set<number>();
  for (const { from, to } of changes.flat()) for (let line = from; line <= to; line++) lines.add(line);
  const sorted = [...lines].toSorted((a, b) => a - b);
  const merged: ChangedLines[] = [];
  for (const line of sorted) {
    const last = merged.at(-1);
    if (last && last.to === line - 1) last.to = line;
    else merged.push({ from: line, to: line });
  }
  return merged;
}

/** “line 3”, “lines 3–5” or “lines removed after line 9”. */
function describeLines({ from, to }: ChangedLines): string {
  if (to < from) return to === 0 ? "lines removed at the start" : `lines removed after line ${to}`;
  return from === to ? `line ${from}` : `lines ${from}–${to}`;
}

/** What a side changed from the Base, in words: “Changed from the Base: line 3 and lines 7–9.” */
export function describeChanges(changes: readonly ChangedLines[]): string {
  if (changes.length === 0) return "The same as the Base.";
  const parts = changes.map(describeLines);
  const listed = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)!}`;
  return `Changed from the Base: ${listed}.`;
}

/** Where a Conflict Hunk is, in words: “lines 14–22”. */
export function describeHunkLines(hunk: ConflictHunk): string {
  return `lines ${hunk.startLine}–${hunk.endLine}`;
}

/** How a side's lines differ from the Base: `added`, as Ours' and Theirs' are, or `removed`, as the Base's. */
export type ChangeKind = "added" | "removed";

const changeLines: Record<ChangeKind, Decoration> = {
  added: Decoration.line({ class: "conflict-line-added" }),
  removed: Decoration.line({ class: "conflict-line-removed" }),
};

/** A `+` or `−` in a changed line's gutter, as a diff marks it, so a change isn't told by colour alone. */
class ChangeMark extends GutterMarker {
  constructor(private readonly kind: ChangeKind) {
    super();
  }

  override eq(other: GutterMarker): boolean {
    return other instanceof ChangeMark && other.kind === this.kind;
  }

  override toDOM(): Node {
    const mark = document.createElement("span");
    mark.className = `conflict-mark conflict-mark-${this.kind}`;
    mark.textContent = this.kind === "added" ? "+" : "−";
    mark.setAttribute("aria-hidden", "true");
    return mark;
  }
}

const changeMarks: Record<ChangeKind, GutterMarker> = { added: new ChangeMark("added"), removed: new ChangeMark("removed") };

/**
 * Shows one side of a conflicted file, `text`, in a read-only CodeMirror
 * editor in `parent`, labelled `label` and described by the elements with
 * the IDs in `describedBy` for screen readers, with the lines in `changes`
 * marked as a diff marks them: green with a `+` where `kind` is `added`, red
 * with a `−` where it's `removed`.
 */
export function sideEditor(
  parent: HTMLElement,
  text: string,
  label: string,
  describedBy: string,
  changes: readonly ChangedLines[],
  kind: ChangeKind = "added",
): EditorView {
  const marked = new Set<number>();
  for (const { from, to } of changes) for (let line = from; line <= to; line++) marked.add(line);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        // Read-only, but still editable to the browser, so the keyboard can move a
        // caret through it and select and copy lines. Tab is never bound, so it
        // always moves focus on.
        EditorState.readOnly.of(true),
        EditorView.contentAttributes.of({ "aria-label": label, "aria-describedby": describedBy }),
        keymap.of(standardKeymap),
        lineNumbers(),
        gutter({
          class: "conflict-marks",
          lineMarker: (view, line) => (marked.has(view.state.doc.lineAt(line.from).number) ? changeMarks[kind] : null),
          initialSpacer: () => changeMarks[kind],
        }),
        highlightSpecialChars(),
        // Worked out once: the text never changes.
        EditorView.decorations.compute([], (state) => {
          const lines: Range<Decoration>[] = [];
          for (const line of [...marked].toSorted((a, b) => a - b)) {
            if (line <= state.doc.lines) lines.push(changeLines[kind].range(state.doc.line(line).from));
          }
          return Decoration.set(lines);
        }),
      ],
    }),
  });
}

/** The Conflict Hunks in a Resolution, where they're drawn, and whether any Conflict Markers are left. */
interface HunkState {
  hunks: ConflictHunk[];
  markers: boolean;
  decorations: DecorationSet;
}

const lineClasses = {
  marker: Decoration.line({ class: "conflict-line-marker" }),
  ours: Decoration.line({ class: "conflict-line-ours" }),
  base: Decoration.line({ class: "conflict-line-base" }),
  theirs: Decoration.line({ class: "conflict-line-theirs" }),
};

function hunkState(state: EditorState): HunkState {
  const text = state.doc.toString();
  const hunks = conflictHunks(text);
  const lines: Range<Decoration>[] = [];
  for (const hunk of hunks) {
    let line = hunk.startLine;
    // The next `count` lines, as `kind`.
    const mark = (kind: keyof typeof lineClasses, count = 1) => {
      for (const end = line + count; line < end; line++) lines.push(lineClasses[kind].range(state.doc.line(line).from));
    };
    mark("marker");
    mark("ours", hunk.ours.length);
    if (hunk.base !== null) {
      mark("marker");
      mark("base", hunk.base.length);
    }
    mark("marker");
    mark("theirs", hunk.theirs.length);
    mark("marker");
  }
  return { hunks, markers: hasConflictMarkers(text), decorations: Decoration.set(lines) };
}

const hunkField = StateField.define<HunkState>({
  create: hunkState,
  update: (value, transaction) => (transaction.docChanged ? hunkState(transaction.state) : value),
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/** The Conflict Hunks left in a Resolution editor's text, and whether any Conflict Markers are. */
export function hunksIn(state: EditorState): { hunks: ConflictHunk[]; markers: boolean } {
  const { hunks, markers } = state.field(hunkField);
  return { hunks, markers };
}

/**
 * The Resolution of a conflicted file, `text`, in an editable CodeMirror
 * editor in `parent`, labelled and described for screen readers, with each
 * Conflict Hunk's Conflict Markers, ours, base and theirs lines marked. Every
 * change can be undone. `onUpdate` is called as its text or cursor changes.
 */
export function resolutionEditor(
  parent: HTMLElement,
  text: string,
  label: string,
  describedBy: string,
  onUpdate: (state: EditorState) => void,
): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        EditorView.contentAttributes.of({ "aria-label": label, "aria-describedby": describedBy }),
        history(),
        // Tab is never bound, so it always moves focus on.
        keymap.of([...defaultKeymap, ...historyKeymap]),
        lineNumbers(),
        highlightSpecialChars(),
        hunkField,
        EditorView.updateListener.of((update) => {
          if (update.docChanged || update.selectionSet) onUpdate(update.state);
        }),
      ],
    }),
  });
}

/**
 * Resolves `hunk` in the Resolution by `choice`, with the cursor where it
 * was, as one change undo takes back.
 */
export function chooseHunk(view: EditorView, hunk: ConflictHunk, choice: HunkChoice): void {
  view.dispatch({
    changes: { from: hunk.from, to: hunk.to, insert: resolvedText(view.state.doc.toString(), hunk, choice) },
    selection: { anchor: hunk.from },
    scrollIntoView: true,
    userEvent: "input.choose",
    annotations: isolateHistory.of("full"),
  });
}

/** Whether two sides of a Conflict Hunk have the same lines, or are both missing. */
function same(a: readonly string[] | null, b: readonly string[] | null): boolean {
  return a === null || b === null ? a === b : a.length === b.length && a.every((line, index) => line === b[index]);
}

/**
 * The Conflict Hunk left in the Resolution that has the same Ours, Base and
 * Theirs lines as `hunk`, the nearest to where it was if more than one has,
 * or `null` once it's resolved.
 */
export function sameHunk(state: EditorState, hunk: ConflictHunk): ConflictHunk | null {
  const found = hunksIn(state).hunks.filter(
    (at) => same(at.ours, hunk.ours) && same(at.base, hunk.base) && same(at.theirs, hunk.theirs),
  );
  const distance = (at: ConflictHunk) => Math.abs(at.from - hunk.from);
  return found.reduce<ConflictHunk | null>((best, at) => (best === null || distance(at) < distance(best) ? at : best), null);
}

/**
 * Puts `resolution`, a Suggestion's Resolution text, in place of `hunk` in
 * the Resolution, as one change undo takes back, ending in a newline where
 * the Conflict Hunk did. With `select`, the lines put in are selected, to
 * edit, and otherwise the cursor goes to where they start.
 */
export function putSuggestion(view: EditorView, hunk: ConflictHunk, resolution: string, select: boolean): void {
  const lines = resolution.split(/\r\n?|\n/);
  // A Resolution text's last newline ends its last line: it doesn't start another.
  if (lines.at(-1) === "") lines.pop();
  const text = lines.join("\n");
  const endsText = hunk.to === view.state.doc.length && view.state.doc.sliceString(hunk.to - 1, hunk.to) !== "\n";
  const insert = lines.length === 0 || endsText ? text : `${text}\n`;
  const end = hunk.from + text.length;
  view.dispatch({
    changes: { from: hunk.from, to: hunk.to, insert },
    selection: select ? { anchor: hunk.from, head: end } : { anchor: hunk.from },
    scrollIntoView: true,
    userEvent: "input.suggestion",
    annotations: isolateHistory.of("full"),
  });
}

/** Puts `text` in place of the whole Resolution, as one change undo takes back. */
export function replaceResolution(view: EditorView, text: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: 0 },
    scrollIntoView: true,
    userEvent: "input.replace",
    annotations: isolateHistory.of("full"),
  });
}

/** Moves the Resolution's cursor to the start of `hunk`, scrolled into view. */
export function goToHunk(view: EditorView, hunk: ConflictHunk): void {
  view.dispatch({ selection: { anchor: hunk.from }, effects: EditorView.scrollIntoView(hunk.from, { y: "start" }) });
}
