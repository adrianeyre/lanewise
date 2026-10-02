import { useEffect, useId, useMemo, useRef } from "react";

import type { ConflictedFile, ConflictVersion, InProgressOperation } from "../commands/api";
import {
  type ChangedLines,
  changedLines,
  describeChanges,
  mergedLines,
  removedLines,
  sideEditor,
} from "./conflictEditors";
import { describeSides } from "./sideWords";
import type { ConflictRead } from "./useConflictedFile";
import { resolvedWhole } from "./wholeFile";

interface Props {
  operation: InProgressOperation;
  /** The conflicted file chosen in Conflicted files, or `null` with none, when the Widget is empty. */
  path: string | null;
  /** Its versions, or `null` while they're read. */
  read: ConflictRead | null;
}

/**
 * The Conflicts page's Three-way view (PRD §7.7): the conflicted file chosen
 * in Conflicted files as its Base, Ours and Theirs, side by side, each in a
 * read-only CodeMirror editor, coloured as a diff is: Ours' and Theirs'
 * lines added or changed from the Base green with a `+`, and the Base's
 * lines they removed or changed red with a `−`, and said in words. Beside each, and to screen readers, it says
 * which side it is in the In-Progress Operation. A file resolved as a whole,
 * being binary or deleted on one side, has no Three-way view: it says so,
 * and the Resolution has the choice.
 */
export function ThreeWayWidget({ operation, path, read }: Props) {
  const headingId = useId();
  return (
    <section className="surface three-way" aria-labelledby={headingId}>
      <h3 id={headingId} className="surface-heading">
        Base / Ours / Theirs
      </h3>
      {path === null ? (
        <p className="surface-note">No file selected.</p>
      ) : read === null ? (
        <p role="status" className="file-status-summary">
          Reading “{path}”…
        </p>
      ) : !read.ok ? (
        // The Resolution, beside it, says so aloud.
        <p className="problem">{read.problem}</p>
      ) : resolvedWhole(read.file) ? (
        <>
          <p className="diff-path">{path}</p>
          <p className="surface-note">
            There's no Three-way view of “{path}”: it isn't text on both sides, so it's resolved as a whole file, in the
            Resolution.
          </p>
        </>
      ) : (
        <ThreeWay operation={operation} path={path} file={read.file} />
      )}
    </section>
  );
}

function ThreeWay({ operation, path, file }: { operation: InProgressOperation; path: string; file: ConflictedFile }) {
  const words = describeSides(operation);
  const base = file.base?.kind === "text" ? file.base.text : null;
  const others = useMemo(() => [file.ours, file.theirs], [file]);
  return (
    <>
      <p className="diff-path">{path}</p>
      <div className="three-way-sides">
        <Side
          name="Base"
          meaning={words.base}
          path={path}
          version={file.base}
          base={null}
          others={others}
        />
        <Side name="Ours" meaning={words.ours} path={path} version={file.ours} base={base} />
        <Side name="Theirs" meaning={words.theirs} path={path} version={file.theirs} base={base} />
      </div>
    </>
  );
}

/**
 * What a side's version is, when there's no text of it to show, or else
 * what it changed from the Base, its `changes`, `null` with no Base. Only
 * the Base can be missing, or not text: a file whose Ours or Theirs is has
 * no Three-way view.
 */
function describeVersion(name: string, version: ConflictVersion | null, changes: ChangedLines[] | null): string {
  if (version === null) return "None: the file was added on both sides.";
  if (version.kind === "notText") {
    return "Not text Lanewise can show: it's binary, not UTF-8, a symbolic link or a submodule.";
  }
  if (name === "Base") {
    if (changes === null || changes.length === 0) return "What Ours and Theirs each changed.";
    return `What Ours and Theirs each changed. ${describeChanges(changes).replace("Changed from the Base", "Removed or changed by them")}`;
  }
  return changes === null ? "Nothing to compare with: there's no Base." : describeChanges(changes);
}

/** No other versions: the same array each time, so a side's marks aren't worked out again on each render. */
const NO_OTHERS: (ConflictVersion | null)[] = [];

function Side({
  name,
  meaning,
  path,
  version,
  base,
  others = NO_OTHERS,
}: {
  name: "Base" | "Ours" | "Theirs";
  meaning: string;
  path: string;
  version: ConflictVersion | null;
  /** The Base's text, to mark what this side changed from it; `null` for the Base itself, or with none. */
  base: string | null;
  /** For the Base, Ours and Theirs, to mark the lines they removed or changed from it. */
  others?: (ConflictVersion | null)[];
}) {
  const headingId = useId();
  const meaningId = useId();
  const summaryId = useId();
  const parent = useRef<HTMLDivElement>(null);
  const text = version?.kind === "text" ? version.text : null;
  const changes = useMemo(() => {
    if (text === null) return null;
    // The Base's lines that Ours or Theirs removed or changed, red; each side's lines it added or changed, green.
    if (name === "Base") {
      return mergedLines(
        ...others.flatMap((other) => (other?.kind === "text" ? [removedLines(text, other.text)] : [])),
      );
    }
    return base === null ? null : changedLines(base, text);
  }, [name, text, base, others]);

  useEffect(() => {
    if (text === null) return;
    const kind = name === "Base" ? "removed" : "added";
    const view = sideEditor(parent.current!, text, `${name} of ${path}`, `${meaningId} ${summaryId}`, changes ?? [], kind);
    return () => view.destroy();
  }, [name, path, text, changes, meaningId, summaryId]);

  return (
    <div className="three-way-side" role="group" aria-labelledby={headingId}>
      <h4 id={headingId} className="surface-subheading">
        {name}
      </h4>
      <p id={meaningId} className="surface-note">
        {meaning}
      </p>
      <p id={summaryId} className="surface-note">
        {describeVersion(name, version, changes)}
      </p>
      {text !== null && <div ref={parent} className="diff-editor conflict-editor" />}
    </div>
  );
}
