import {
  ArrowRightLeft,
  Copy,
  FileMinus,
  FilePenLine,
  FilePlus,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import type { CommitFile, CommitFileChange, Cursor } from "../commands/api";
import type { PageRead } from "./paging";

const changes: Record<CommitFileChange["kind"], { label: string; icon: LucideIcon }> = {
  added: { label: "Added", icon: FilePlus },
  modified: { label: "Modified", icon: FilePenLine },
  deleted: { label: "Deleted", icon: FileMinus },
  renamed: { label: "Renamed", icon: ArrowRightLeft },
  copied: { label: "Copied", icon: Copy },
};

interface Props {
  /**
   * Reads the page of files at `cursor`, `null` for the first. A new one
   * reads them again from the first page, so keep it the same while what
   * it reads is.
   */
  read: (cursor: Cursor | null) => Promise<PageRead<CommitFile>>;
  /** The path of the file chosen, whose diff the Diff Widget shows, or `null`. */
  selectedFile: string | null;
  onSelectFile: (file: CommitFile) => void;
  /** Called with the first page's files once they're read. */
  onFirstPage?: (files: CommitFile[]) => void;
}

/**
 * The files a commit or a stash changed, each a button that shows its diff,
 * with "Show more files" while there are more.
 */
export function ChangedFiles({ read, selectedFile, onSelectFile, onFirstPage }: Props) {
  const [files, setFiles] = useState<CommitFile[]>([]);
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  const headingId = useId();
  const firstPage = useRef(onFirstPage);
  useEffect(() => {
    firstPage.current = onFirstPage;
  }, [onFirstPage]);

  const show = useCallback((result: PageRead<CommitFile>) => {
    setLoading(false);
    if (result.ok) {
      const { items } = result.page;
      setFiles((shown) => (result.fromStart ? items : [...shown, ...items]));
      setNextCursor(result.page.nextCursor);
      setProblem(null);
      if (result.fromStart) firstPage.current?.(items);
    } else {
      setProblem(result.problem);
    }
  }, []);

  useEffect(() => {
    let current = true;
    void read(null).then((result) => {
      if (current) show(result);
    });
    return () => {
      current = false;
    };
  }, [read, show]);

  useEffect(() => {
    // "Show more files" has gone with the last page: keep focus from falling to the page's start.
    if (refocus.current && !loading) {
      refocus.current = false;
      if (nextCursor === null) list.current?.focus();
    }
  }, [loading, nextCursor]);

  function showMore() {
    if (loading || nextCursor === null) return;
    refocus.current = true;
    setLoading(true);
    void read(nextCursor).then(show);
  }

  return (
    <div
      className="commit-changes"
      ref={list}
      tabIndex={-1}
      aria-labelledby={headingId}
      role="group"
    >
      <h4 id={headingId} className="file-status-section-heading">
        Changed files
      </h4>
      <p role="status" className="file-status-summary">
        {summarise(loading, files.length, nextCursor !== null, problem !== null)}
      </p>
      {problem !== null && (
        <p role="alert" className="problem">
          {problem}
        </p>
      )}
      {files.length > 0 && (
        <ul className="file-status-entries">
          {files.map((file) => (
            <ChangedFile
              key={file.path}
              file={file}
              selected={file.path === selectedFile}
              onSelect={onSelectFile}
            />
          ))}
        </ul>
      )}
      {nextCursor !== null && (
        <button type="button" className="button" aria-disabled={loading} onClick={showMore}>
          Show more files
        </button>
      )}
    </div>
  );
}

function ChangedFile({
  file,
  selected,
  onSelect,
}: {
  file: CommitFile;
  selected: boolean;
  onSelect: (file: CommitFile) => void;
}) {
  const { label, icon: Icon } = changes[file.change.kind];
  return (
    <li className={`change-${file.change.kind}`}>
      <button
        type="button"
        className="file-status-entry changed-file"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(file)}
      >
        <Icon aria-hidden="true" className="change-icon" />
        {/* Spaced, so the path and change are read as two words. */}
        <span className="file-status-path">{file.path}</span>{" "}
        <span className="change-label">
          {label}
          {(file.change.kind === "renamed" || file.change.kind === "copied") && (
            <>
              {" from "}
              <span className="file-status-path">{file.change.from}</span>
            </>
          )}
        </span>
      </button>
    </li>
  );
}

function summarise(loading: boolean, count: number, more: boolean, failed: boolean): string {
  if (loading && count === 0) return "Reading the changed files…";
  if (failed && count === 0) return "";
  if (count === 0) return "No files changed.";
  const counted = count === 1 ? "1 file" : `${count} files`;
  return more ? `Showing the first ${counted}.` : `${counted} changed.`;
}
