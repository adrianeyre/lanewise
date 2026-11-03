import { FolderGit2, Menu, Settings } from "lucide-react";

/**
 * The parts Lanewise's scenes are made of, drawn as the app draws them, from
 * its Theme's tokens (`scenes.css`).
 */

/** Lanewise's own title bar, as the app draws it on every platform, and a Tab for the repository open, if there is one. */
export function Chrome({ tab }: { tab?: string }) {
  return (
    <>
      <div className="lw-titlebar">
        <Menu aria-hidden="true" className="lw-icon" />
        <span className="lw-brand">
          <img className="lw-logo" src="favicon.svg" width="16" height="16" alt="" />
          Lanewise
        </span>
        <Settings aria-hidden="true" className="lw-icon" />
      </div>
      {tab !== undefined && (
        <div className="lw-tabs">
          <span className="lw-tab">
            <FolderGit2 aria-hidden="true" className="lw-icon" />
            {tab}
          </span>
        </div>
      )}
    </>
  );
}

/** One line of code: plain, or a Conflict Marker, Ours, Theirs, or added or removed, as a diff colours it. */
export interface CodeLine {
  text: string;
  kind?: "marker" | "ours" | "theirs" | "added" | "removed";
  /** Whether it's there: a line that goes closes up, and one that comes opens, so the lines round it move. */
  shown?: boolean;
}

/** Lines of code, each numbered among the lines shown. */
export function Code({ lines, className }: { lines: readonly CodeLine[]; className?: string }) {
  // Each line's number among the lines before it that are shown.
  const numbers = lines.map((_, index) => lines.slice(0, index + 1).filter((each) => each.shown ?? true).length);
  return (
    <div className={className === undefined ? "lw-code" : `lw-code ${className}`}>
      {lines.map((line, index) => {
        const shown = line.shown ?? true;
        const number = numbers[index];
        return (
          <div key={index} className="lw-line" data-kind={line.kind} data-shown={shown}>
            <div className="lw-line-inner">
              <span className="lw-line-number">{shown ? number : ""}</span>
              <span className="lw-line-sign">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : ""}</span>
              <span className="lw-line-text">{line.text}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Text that crossfades as it changes, keyed by `id`, so it never jumps. */
export function Swap({ id, text }: { id: string; text: string }) {
  return (
    <span key={id} className="lw-swap">
      {text}
    </span>
  );
}
