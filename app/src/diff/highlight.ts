import { type Extension, type Range, StateEffect } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { Parser, Tree } from "@lezer/common";
import { classHighlighter, highlightTree } from "@lezer/highlight";

import type { DiffDocument, DiffSideName, DiffSideText } from "./document";

/** How long a slice of parsing may run before giving the UI back, in milliseconds. */
const SLICE = 20;

/** Both sides are parsed, so the lines in view can be highlighted. */
const parsed = StateEffect.define<null>();

/**
 * Highlights `diff`'s lines as `parser`'s language. Each side of the diff is
 * parsed as a text of its own, a slice at a time so a long diff never holds
 * the UI up, and only the lines in view are highlighted, with `tok-` classes
 * that `styles.css` colours for both themes.
 */
export function diffHighlighting(diff: DiffDocument, parser: Parser): Extension {
  return ViewPlugin.define((view) => new Highlighting(view, diff, parser), {
    decorations: (plugin) => plugin.decorations,
  });
}

class Highlighting {
  decorations: DecorationSet = Decoration.none;
  private trees: Partial<Record<DiffSideName, Tree>> = {};
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly view: EditorView,
    private readonly diff: DiffDocument,
    parser: Parser,
  ) {
    const parses = (["old", "new"] as const)
      .filter((side) => diff[side].lines.length > 0)
      .map((side) => ({ side, parse: parser.startParse(diff[side].text) }));
    const work = () => {
      const until = Date.now() + SLICE;
      while (parses.length > 0) {
        const tree = parses[0]!.parse.advance();
        if (tree !== null) this.trees[parses.shift()!.side] = tree;
        else if (Date.now() >= until) {
          this.timer = setTimeout(work, 0);
          return;
        }
      }
      this.timer = undefined;
      this.view.dispatch({ effects: parsed.of(null) });
    };
    this.timer = setTimeout(work, 0);
  }

  update(update: ViewUpdate) {
    if (update.viewportChanged || update.transactions.some((tr) => tr.effects.some((e) => e.is(parsed)))) {
      this.decorations = this.highlight(update.view);
    }
  }

  destroy() {
    clearTimeout(this.timer);
  }

  private highlight(view: EditorView): DecorationSet {
    const marks: Range<Decoration>[] = [];
    for (const { from, to } of view.visibleRanges) {
      const first = view.state.doc.lineAt(from).number;
      const last = view.state.doc.lineAt(to).number;
      for (const side of ["old", "new"] as const) {
        const tree = this.trees[side];
        if (tree === undefined) continue;
        const lines = this.linesFrom(side, first, last);
        if (lines === null) continue;
        this.highlightSide(view, side, tree, lines, marks);
      }
    }
    return Decoration.set(marks, true);
  }

  /** The first and last of `side`'s lines on the document's lines `first` to `last`. */
  private linesFrom(side: DiffSideName, first: number, last: number): [number, number] | null {
    const { lines } = this.diff[side];
    const start = firstAtLeast(lines, first);
    const end = firstAtLeast(lines, last + 1) - 1;
    return start <= end ? [start, end] : null;
  }

  private highlightSide(
    view: EditorView,
    side: DiffSideName,
    tree: Tree,
    [start, end]: [number, number],
    marks: Range<Decoration>[],
  ) {
    const text: DiffSideText = this.diff[side];
    const lineEnd = (line: number) => text.starts[line]! + lineLength(text, line);
    let line = start;
    highlightTree(
      tree,
      classHighlighter,
      (from, to, classes) => {
        // A token, such as a block comment, may run over several lines.
        while (line <= end && lineEnd(line) <= from) line++;
        for (let at = line; at <= end && text.starts[at]! < to; at++) {
          const shown = this.diff.sides[text.lines[at]! - 1];
          if (shown?.side !== side) continue;
          const offset = view.state.doc.line(text.lines[at]!).from + 1 - text.starts[at]!;
          const markFrom = Math.max(from, text.starts[at]!);
          const markTo = Math.min(to, lineEnd(at));
          if (markFrom < markTo) marks.push(mark(classes).range(markFrom + offset, markTo + offset));
        }
      },
      text.starts[start]!,
      lineEnd(end),
    );
  }
}

function lineLength(text: DiffSideText, line: number): number {
  const next = text.starts[line + 1];
  return (next === undefined ? text.text.length + 1 : next) - 1 - text.starts[line]!;
}

/** The index of the first of the ascending `values` that is at least `value`. */
function firstAtLeast(values: number[], value: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle]! < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

const marks = new Map<string, Decoration>();

function mark(classes: string): Decoration {
  let found = marks.get(classes);
  if (found === undefined) {
    found = Decoration.mark({ class: classes });
    marks.set(classes, found);
  }
  return found;
}
