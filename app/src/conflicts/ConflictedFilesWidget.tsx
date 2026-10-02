import { FileCheck, FileExclamationPoint, Undo2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { CommandClient, InProgressOperation, OpenedRepository } from "../commands/api";
import { describeFailure } from "../repository/problems";
import { describeOperationError, files } from "./operationWords";

interface Props {
  commands: CommandClient;
  repository: OpenedRepository;
  operation: InProgressOperation;
  /** The conflicted file shown in the Three-way view and the Resolution, or `null`. */
  chosen: string | null;
  /** The file last resolved in the Resolution, for focus to move on from once it's read as resolved. */
  resolvedElsewhere: { path: string } | null;
  /** Called with the conflicted file chosen, to show in the Three-way view and the Resolution. */
  onChoose: (path: string) => void;
  /** Called once files are marked, for the page to read the In-Progress Operation again. */
  onChanged: () => void;
}

/**
 * Which list's row had focus when its file was marked, and which of its
 * buttons, to move to the other list, and the lists as they were then,
 * before they're read again.
 */
type Refocus = {
  list: "conflicts" | "resolved";
  index: number;
  button: "choose" | "mark";
  conflicts: string[];
  resolved: string[];
};

/**
 * The Conflicts page's Conflicted files Widget (PRD §7.7): the files the
 * In-Progress Operation left conflicted, each chosen to show it in the
 * Three-way view and resolve it in the Resolution, with the AI Suggestion,
 * and each with Mark resolved, which takes it as it is in the working tree;
 * and the files
 * marked resolved, each with Mark unresolved, which makes it conflicted
 * again. What each did is announced. Focus stays in the list the file left.
 */
export function ConflictedFilesWidget({
  commands,
  repository,
  operation,
  chosen,
  resolvedElsewhere,
  onChoose,
  onChanged,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const container = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const refocus = useRef<Refocus | null>(null);
  const headingId = useId();
  const conflictsId = useId();
  const resolvedId = useId();
  const { conflicts, resolved } = operation;
  const total = conflicts.length + resolved.length;

  // A file marked took its row, and focus, to the other list once the lists
  // are read again: focus goes to the row that took its place, or the one
  // before it, or else the heading.
  useEffect(() => {
    const moved = refocus.current;
    if (moved === null || (moved.conflicts === conflicts && moved.resolved === resolved)) return;
    refocus.current = null;
    const buttons = container.current?.querySelectorAll<HTMLButtonElement>(
      `[data-list="${moved.list}"] [data-focus="${moved.button}"]`,
    );
    const next = buttons?.[Math.min(moved.index, buttons.length - 1)];
    (next ?? heading.current)?.focus();
  }, [conflicts, resolved]);

  // A file resolved in the Resolution leaves its row too: focus goes to the
  // file that takes its place, to choose next.
  // Only as it's resolved, with the lists as they were then.
  const handled = useRef(resolvedElsewhere);
  useEffect(() => {
    if (resolvedElsewhere === handled.current) return;
    handled.current = resolvedElsewhere;
    const index = resolvedElsewhere === null ? -1 : conflicts.indexOf(resolvedElsewhere.path);
    if (index !== -1) refocus.current = { list: "conflicts", index, button: "choose", conflicts, resolved };
  }, [resolvedElsewhere, conflicts, resolved]);

  function choose(path: string) {
    setProblem(null);
    setSaid(`Showing “${path}” in Base / Ours / Theirs, the Resolution and the AI Suggestion.`);
    onChoose(path);
  }

  async function mark(paths: string[], resolve: boolean, from: Pick<Refocus, "list" | "index">) {
    if (busy) return;
    setBusy(true);
    setSaid(null);
    setProblem(null);
    try {
      const outcome = await commands.call(resolve ? "markResolved" : "markUnresolved", {
        repository: repository.root,
        paths,
      });
      if (outcome.ok) {
        const which = paths.length === 1 ? `“${paths[0]}”` : files(paths.length);
        setSaid(resolve ? `Marked ${which} resolved.` : `Marked ${which} unresolved: conflicted again.`);
        refocus.current = { ...from, button: "mark", conflicts, resolved };
      } else setProblem(describeOperationError(outcome.error, resolve ? "mark" : "unmark"));
      onChanged();
    } catch (failure) {
      setProblem(describeFailure(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section ref={container} className="surface conflicted-files" aria-labelledby={headingId} aria-busy={busy || undefined}>
      <div className="surface-header">
        <h3 ref={heading} id={headingId} className="surface-heading" tabIndex={-1}>
          Conflicted files
        </h3>
        {conflicts.length > 1 && (
          <button
            type="button"
            className="button button-small"
            aria-disabled={busy || undefined}
            onClick={() => void mark(conflicts, true, { list: "conflicts", index: 0 })}
          >
            <FileCheck aria-hidden="true" className="button-icon" />
            Mark all resolved
          </button>
        )}
      </div>
      <p className="surface-note">
        {resolved.length} of {files(total)} resolved. Choose a file to resolve it here, or resolve it in your editor and
        mark it resolved: Lanewise takes it as it is in the working tree.
      </p>
      <p role="status" className="visually-hidden">
        {said}
      </p>
      {problem !== null && (
        <p role="alert" className="problem problem-output">
          {problem}
        </p>
      )}
      {conflicts.length > 0 && (
        <section className="file-status-section" aria-labelledby={conflictsId}>
          <h4 id={conflictsId} className="file-status-section-heading">
            Conflicted
          </h4>
          <ul className="file-status-entries" data-list="conflicts">
            {conflicts.map((path, index) => (
              <li key={path} className="file-status-row change-conflicted">
                <button
                  type="button"
                  className="file-status-entry changed-file"
                  data-focus="choose"
                  aria-current={path === chosen ? "true" : undefined}
                  onClick={() => choose(path)}
                >
                  <FileExclamationPoint aria-hidden="true" className="change-icon" />
                  <span className="file-status-path">{path}</span>{" "}
                  <span className="change-label">Conflicted</span>
                </button>
                <button
                  type="button"
                  className="button button-small"
                  data-focus="mark"
                  aria-disabled={busy || undefined}
                  aria-label={`Mark ${path} resolved`}
                  onClick={() => void mark([path], true, { list: "conflicts", index })}
                >
                  <FileCheck aria-hidden="true" className="button-icon" />
                  Mark resolved
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {resolved.length > 0 && (
        <section className="file-status-section" aria-labelledby={resolvedId}>
          <h4 id={resolvedId} className="file-status-section-heading">
            Resolved
          </h4>
          <ul className="file-status-entries" data-list="resolved">
            {resolved.map((path, index) => (
              <li key={path} className="file-status-row change-added">
                <span className="file-status-entry">
                  <FileCheck aria-hidden="true" className="change-icon" />
                  <span className="file-status-path">{path}</span>{" "}
                  <span className="change-label">Resolved</span>
                </span>
                <button
                  type="button"
                  className="button button-small"
                  data-focus="mark"
                  aria-disabled={busy || undefined}
                  aria-label={`Mark ${path} unresolved`}
                  onClick={() => void mark([path], false, { list: "resolved", index })}
                >
                  <Undo2 aria-hidden="true" className="button-icon" />
                  Mark unresolved
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
