import { standardKeymap } from "@codemirror/commands";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  gutter,
  GutterMarker,
  highlightSpecialChars,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { Parser } from "@lezer/common";

import type { DiffDocument, DiffLineKind } from "./document";
import { diffHighlighting } from "./highlight";

/**
 * What an editor on a working tree diff does to its hunks: stages one of an
 * unstaged diff, or unstages one of a staged diff.
 */
export interface HunkActions {
  /** What the button on each hunk's header says, and does. */
  name: "Stage hunk" | "Unstage hunk";
  /** The key that does it to the hunk the cursor is in, while the editor has focus. */
  key: string;
  /** The ID of the text that says so, to describe the editor with. */
  hint: string;
  /** Does it to the diff's `hunk`th hunk, from 0. */
  run(hunk: number): void;
}

/** An editor showing a diff, which shows the next in its place. */
export interface ShownDiffEditor {
  view: EditorView;
  /**
   * Shows `diff` in place of the diff shown, changing only the lines that
   * differ, so the editor keeps its focus and its scroll position, and the
   * cursor stays where it was, or where the lines it was in were.
   */
  show(diff: DiffDocument): void;
}

/**
 * Shows `diff` in a read-only CodeMirror editor in `parent`, labelled `label`
 * for screen readers, and highlights it as the language of the file at `path`
 * once that has loaded. A file of a type CodeMirror doesn't know stays plain.
 * With `actions`, each hunk's header has a button that stages or unstages it,
 * and the key does it to the hunk at the cursor.
 */
export function diffEditor(
  parent: HTMLElement,
  diff: DiffDocument,
  label: string,
  path: string,
  actions?: HunkActions,
): ShownDiffEditor {
  const highlighting = new Compartment();
  const lines = new Compartment();
  let shown = diff;
  let parser: Parser | null = null;
  const highlight = () => (parser === null ? [] : diffHighlighting(shown, parser));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: diff.text,
      extensions: [
        // Only `\n` ends a line, so a carriage return stays in its line, shown by
        // `highlightSpecialChars`, as the core sends it.
        EditorState.lineSeparator.of("\n"),
        // Read-only, but still editable to the browser, so the keyboard can move a
        // caret through it and select and copy lines, all of them however few
        // are drawn. Tab is never bound, so it always moves focus on.
        EditorState.readOnly.of(true),
        EditorView.contentAttributes.of({
          "aria-label": label,
          ...(actions && { "aria-describedby": actions.hint, "aria-keyshortcuts": actions.key.toUpperCase() }),
        }),
        keymap.of(standardKeymap),
        highlightSpecialChars(),
        lines.of(lineExtensions(diff, actions)),
        highlighting.of([]),
      ],
    }),
  });
  const description = LanguageDescription.matchFilename(languages, path);
  description
    ?.load()
    .then((support) => {
      parser = support.language.parser;
      if (view.dom.isConnected) view.dispatch({ effects: highlighting.reconfigure(highlight()) });
    })
    // A language that fails to load leaves the diff plain, which still reads.
    .catch(() => {});
  return {
    view,
    show(next) {
      if (next === shown) return;
      shown = next;
      view.dispatch({
        changes: changeBetween(view.state.doc.toString(), next.text),
        effects: [lines.reconfigure(lineExtensions(next, actions)), highlighting.reconfigure(highlight())],
      });
    },
  };
}

/** What the editor draws of `diff`'s lines, and does to its hunks. */
function lineExtensions(diff: DiffDocument, actions: HunkActions | undefined): Extension {
  return [lineNumbers(diff), lineKinds(diff), actions === undefined ? [] : hunkActions(diff, actions)];
}

/**
 * The one change from `before` to `after`: whatever lies between the text
 * they start with and the text they end with. The lines round it are kept,
 * so CodeMirror keeps the lines in view where they were.
 */
export function changeBetween(before: string, after: string): { from: number; to: number; insert: string } {
  const most = Math.min(before.length, after.length);
  let start = 0;
  while (start < most && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let end = 0;
  while (
    end < most - start &&
    before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)
  ) {
    end++;
  }
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) };
}

/** The index of the hunk `line` of `diff` is in, from 0. */
function hunkAt(diff: DiffDocument, line: number): number {
  let hunk = 0;
  while (hunk + 1 < diff.hunks.length && diff.hunks[hunk + 1]! <= line) hunk++;
  return hunk;
}

/**
 * A button at the end of each hunk's header, for the pointer. It never takes
 * focus from the editor, and screen readers skip it: from the keyboard, the
 * key does the same to the hunk at the cursor, as the hint says.
 */
class HunkButton extends WidgetType {
  constructor(
    private readonly hunk: number,
    private readonly actions: HunkActions,
  ) {
    super();
  }

  override eq(other: WidgetType): boolean {
    return other instanceof HunkButton && other.hunk === this.hunk && other.actions === this.actions;
  }

  override toDOM(): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-small diff-hunk-action";
    button.textContent = this.actions.name;
    button.tabIndex = -1;
    button.setAttribute("aria-hidden", "true");
    // Pressed, it leaves the editor's focus and cursor as they were.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => this.actions.run(this.hunk));
    return button;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

function hunkActions(diff: DiffDocument, actions: HunkActions): Extension {
  const run = (view: EditorView) => {
    actions.run(hunkAt(diff, view.state.doc.lineAt(view.state.selection.main.head).number));
    return true;
  };
  return [
    EditorView.decorations.compute(["doc"], (state) =>
      Decoration.set(
        diff.hunks.map((line, hunk) =>
          Decoration.widget({ widget: new HunkButton(hunk, actions), side: 1 }).range(state.doc.line(line).to),
        ),
      ),
    ),
    // Caps Lock on or not.
    keymap.of([actions.key.toLowerCase(), actions.key.toUpperCase()].map((key) => ({ key, run }))),
  ];
}

const kindClasses: Record<DiffLineKind, Decoration> = {
  hunk: Decoration.line({ class: "diff-line-hunk" }),
  context: Decoration.line({ class: "diff-line-context" }),
  added: Decoration.line({ class: "diff-line-added" }),
  removed: Decoration.line({ class: "diff-line-removed" }),
  noNewline: Decoration.line({ class: "diff-line-no-newline" }),
};

const changeMark = Decoration.mark({ class: "diff-mark" });

/** Classes each line in view by its kind, and its `+` or `-`, which `styles.css` colours. */
function lineKinds(diff: DiffDocument): Extension {
  const decorate = (view: EditorView): DecorationSet => {
    const lines: Range<Decoration>[] = [];
    for (const { from, to } of view.visibleRanges) {
      for (let at = from; at <= to; ) {
        const line = view.state.doc.lineAt(at);
        const kind = diff.kinds[line.number - 1]!;
        lines.push(kindClasses[kind].range(line.from));
        if (kind === "added" || kind === "removed") lines.push(changeMark.range(line.from, line.from + 1));
        at = line.to + 1;
      }
    }
    return Decoration.set(lines, true);
  };
  return ViewPlugin.define(
    (view) => ({
      decorations: decorate(view),
      update(update: ViewUpdate) {
        if (update.viewportChanged) this.decorations = decorate(update.view);
      },
    }),
    { decorations: (plugin) => plugin.decorations },
  );
}

class LineNumber extends GutterMarker {
  constructor(private readonly number: number) {
    super();
  }

  override eq(other: GutterMarker): boolean {
    return other instanceof LineNumber && other.number === this.number;
  }

  override toDOM(): Node {
    return document.createTextNode(String(this.number));
  }
}

/**
 * The old and the new file's line numbers. CodeMirror hides its gutters from
 * screen readers; each hunk's header says where it starts in words they read.
 */
function lineNumbers(diff: DiffDocument): Extension {
  return (["old", "new"] as const).map((side) => {
    const numbers = side === "old" ? diff.oldNumbers : diff.newNumbers;
    return gutter({
      class: `diff-gutter diff-gutter-${side}`,
      lineMarker(view, line) {
        const number = numbers[view.state.doc.lineAt(line.from).number - 1];
        return number === null || number === undefined ? null : new LineNumber(number);
      },
      initialSpacer: () => widest(numbers),
    });
  });
}

/** The widest of a gutter's numbers, to size it before any lines are drawn. */
function widest(numbers: (number | null)[]): LineNumber {
  return new LineNumber(numbers.reduce<number>((most, n) => Math.max(most, n ?? 0), 0));
}
