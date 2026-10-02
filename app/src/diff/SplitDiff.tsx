import { useEffect, useMemo, useRef } from "react";

import type { DiffHunk } from "../commands/api";
import { type SplitSide, splitHunk } from "./split";

interface Props {
  hunks: DiffHunk[];
  path: string;
  /** Whether it takes focus as it's shown. */
  focus: boolean;
  /** For a working tree change, whether it's staged; `null` for a commit's or a stash's file. */
  staged: boolean | null;
  onHunk: (hunk: DiffHunk, focused: boolean) => void;
}

const SIGNS: Record<SplitSide["kind"], string> = { context: " ", removed: "-", added: "+" };

/**
 * The split view of a diff (ADR 0033): the file as it was on the left and
 * as it is on the right, each hunk's lines side by side, removed lines red
 * and added ones green, and each still marked `-` or `+` in its text, so
 * nothing is told by colour alone. Both sides scroll as one. Each hunk's
 * header says where it is, and for a working tree change has a button that
 * stages or unstages it. The whole is a table, which the keyboard reaches
 * and scrolls.
 */
export function SplitDiff({ hunks, path, focus, staged, onHunk }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const split = useMemo(() => hunks.map((hunk) => ({ hunk, rows: splitHunk(hunk) })), [hunks]);

  useEffect(() => {
    if (focus) scroller.current?.focus();
  }, [focus]);

  return (
    <div ref={scroller} className="split-diff" tabIndex={0} role="group" aria-label={`Diff of ${path}, side by side`}>
      <table className="split-diff-table">
        <caption className="visually-hidden">
          {path} as it was, on the left, and as it is, on the right.
        </caption>
        <colgroup>
          <col className="split-diff-number" />
          <col />
          <col className="split-diff-number" />
          <col />
        </colgroup>
        <thead className="visually-hidden">
          <tr>
            <th scope="col">Line before</th>
            <th scope="col">Before</th>
            <th scope="col">Line after</th>
            <th scope="col">After</th>
          </tr>
        </thead>
        {split.map(({ hunk, rows }, index) => (
          <tbody key={`${index}:${hunk.oldStart}:${hunk.newStart}`}>
            <tr className="split-diff-hunk">
              <th scope="rowgroup" colSpan={4}>
                <span className="split-diff-hunk-header">
                  <code>
                    @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                  </code>
                  {staged !== null && (
                    <button
                      type="button"
                      className="button button-small"
                      onClick={(event) => onHunk(hunk, event.currentTarget.contains(document.activeElement))}
                    >
                      {staged ? "Unstage hunk" : "Stage hunk"}
                    </button>
                  )}
                </span>
              </th>
            </tr>
            {rows.map((row, at) => (
              <tr key={at}>
                <Side side={row.old} />
                <Side side={row.new} />
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/** One side of a row: its line number and its text, or two empty cells where that side has no line. */
function Side({ side }: { side: SplitSide | null }) {
  if (side === null) {
    return (
      <>
        <td className="split-diff-gap" />
        <td className="split-diff-gap" />
      </>
    );
  }
  return (
    <>
      <td className={`split-diff-line-number split-diff-${side.kind}`}>{side.number}</td>
      <td className={`split-diff-text split-diff-${side.kind}`}>
        <span className="split-diff-sign">{SIGNS[side.kind]}</span>
        {side.text}
        {side.noNewline && <span className="split-diff-no-newline"> (no newline at end of file)</span>}
      </td>
    </>
  );
}
