import { useEffect, useId, useMemo, useRef } from "react";

import type { DiffHunk } from "../commands/api";
import { diffDocument } from "./document";
import { diffEditor, type HunkActions, type ShownDiffEditor } from "./editor";

/**
 * The diff's lines in CodeMirror, labelled with the file for screen readers.
 * A working tree change's hunks each have a button on their header that
 * stages or unstages it, and a key that does it to the hunk at the cursor. A
 * diff read again is shown in the same editor, which keeps its place.
 */
export function DiffEditor({
  hunks,
  path,
  focus,
  staged,
  onHunk,
}: {
  hunks: DiffHunk[];
  path: string;
  focus: boolean;
  staged: boolean | null;
  onHunk: (hunk: DiffHunk, focused: boolean) => void;
}) {
  const hintId = useId();
  const parent = useRef<HTMLDivElement>(null);
  const editor = useRef<ShownDiffEditor | null>(null);
  const shown = useMemo(() => diffDocument(hunks), [hunks]);
  // What the editor is made with, and what its hunks' actions act on: the latest.
  const latest = useRef({ shown, hunks, onHunk });

  useEffect(() => {
    latest.current = { shown, hunks, onHunk };
    editor.current?.show(shown);
  }, [shown, hunks, onHunk]);

  useEffect(() => {
    const actions: HunkActions | undefined =
      staged === null
        ? undefined
        : {
            name: staged ? "Unstage hunk" : "Stage hunk",
            key: staged ? "u" : "s",
            hint: hintId,
            run: (index) => {
              const hunk = latest.current.hunks[index];
              if (hunk !== undefined) latest.current.onHunk(hunk, made.view.hasFocus);
            },
          };
    const made = diffEditor(parent.current!, latest.current.shown, `Diff of ${path}`, path, actions);
    editor.current = made;
    if (focus) made.view.contentDOM.focus();
    return () => {
      editor.current = null;
      made.view.destroy();
    };
  }, [path, focus, staged, hintId]);

  return (
    <>
      {staged !== null && (
        <p id={hintId} className="surface-note">
          {staged
            ? "Press U in the diff to unstage the hunk at the cursor, or choose Unstage hunk on its header."
            : "Press S in the diff to stage the hunk at the cursor, or choose Stage hunk on its header."}
        </p>
      )}
      <div ref={parent} className="diff-editor" />
    </>
  );
}
