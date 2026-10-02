import { CircleAlert, FolderGit2, FolderOpen, X } from "lucide-react";
import { OpenOnHost } from "../hosts/OpenOnHost";
import type { WebPage } from "../hosts/webPage";
import { type Ref, useCallback, useEffect, useId, useRef, useState } from "react";

import type { CommandClient, Path, RepositoryError } from "../commands/api";
import type { HostsState } from "../hosts/useHosts";
import type { LinkOpener } from "../legal/ExternalLink";
import { CloneForm } from "./CloneForm";
import type { RecentRepository } from "./recent";
import type { CloneState } from "./useClone";

interface Props extends LinkOpener {
  commands: CommandClient;
  /** The Recent Repositories, most recent first. */
  recent: readonly RecentRepository[];
  /**
   * Opens the repository at `root`, in its Tab. Resolves with why it didn't
   * open, if that was the repository's doing, `null` if it opened, or
   * `undefined` if it couldn't be tried.
   */
  onOpen(root: Path): Promise<RepositoryError | null | undefined>;
  /** Takes the repository at `root` off the Recent Repositories. */
  onRemove(root: Path): void;
  /** The clone, which the App keeps while the Welcome screen isn't shown. */
  clone: CloneState;
  /** The Hosts Clone can browse for a repository. */
  hosts: HostsState;
  /** Asks the user for a folder, with the platform's own dialog: `null` if they cancel it. */
  chooseFolder(title: string): Promise<Path | null>;
  /** The base folder Settings has, which Clone clones into until another is chosen. */
  baseFolder?: Path | null;
  /** Asks for a repository's folder and opens it, as the File menu's "Open repository…" does. */
  onOpenFolder?: () => void;
  /** Counts the File menu's "Clone repository…", each of which puts focus in Clone. */
  cloneRequest?: number;
  /** The Open repository button, for the App to put focus on as the Welcome screen comes back. */
  openButton?: Ref<HTMLButtonElement>;
}

/** What a Recent Repository that won't open is marked with. */
function mark(error: RepositoryError): string {
  switch (error.kind) {
    case "notAFolder":
      return "Missing: its folder isn't there any more.";
    case "notARepository":
      return "No longer a Git repository.";
    case "noWorkingTree":
      return "A bare repository now, with no working tree.";
    case "unreadable":
      return `Can't be read: ${error.message}`;
  }
}

/**
 * The Welcome screen (PRD §7.1), shown with no repository open, or in a Tab
 * of its own: it offers to open a repository, or clone one, and lists the Recent
 * Repositories, most recent first. Each is checked as it's listed, so one
 * whose folder has gone, or that no longer opens, is marked, and any can be
 * removed.
 */
export function WelcomeScreen({
  commands,
  recent,
  onOpen,
  onRemove,
  clone,
  hosts,
  chooseFolder,
  baseFolder = null,
  onOpenLink,
  onOpenFolder,
  cloneRequest = 0,
  openButton,
}: Props) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [problems, setProblems] = useState<ReadonlyMap<Path, RepositoryError>>(new Map());
  // Each Recent Repository's page on its Host, as checking it found.
  const [pages, setPages] = useState<ReadonlyMap<Path, WebPage>>(new Map());
  const checked = useRef(new Set<Path>());
  const shown = useRef(true);

  const found = useCallback((root: Path, problem: RepositoryError | null) => {
    if (!shown.current) return;
    setProblems((previous) => {
      const next = new Map(previous);
      if (problem === null) next.delete(root);
      else next.set(root, problem);
      return next;
    });
  }, []);

  useEffect(() => {
    shown.current = true;
    return () => {
      shown.current = false;
    };
  }, []);

  useEffect(() => {
    for (const { root } of recent) {
      if (checked.current.has(root)) continue;
      checked.current.add(root);
      commands.call("openRepository", { path: root }).then(
        (outcome) => {
          found(root, outcome.ok ? null : outcome.error);
          const web = outcome.ok ? (outcome.value.web ?? null) : null;
          if (web !== null && shown.current) setPages((previous) => new Map(previous).set(root, web));
        },
        // The core is missing or broken: opening it says so.
        () => {},
      );
    }
  }, [commands, recent, found]);

  async function open(root: Path) {
    const problem = await onOpen(root);
    if (problem !== undefined) found(root, problem);
  }

  function remove(index: number) {
    const entries = list.current?.querySelectorAll<HTMLButtonElement>(".recent-remove") ?? [];
    // Focus stays in the list: on the next entry's Remove, or the one before, or the heading.
    const next = entries[index + 1] ?? entries[index - 1] ?? heading.current;
    onRemove(recent[index]!.root);
    next?.focus();
  }

  return (
    <div className="welcome">
      <div className="welcome-intro">
        <p className="app-intro">Open a repository to see its changes.</p>
        {onOpenFolder && (
          <button ref={openButton} type="button" className="button button-primary" onClick={onOpenFolder}>
            <FolderOpen aria-hidden="true" className="button-icon" />
            Open repository
          </button>
        )}
      </div>
      <CloneForm
        focusRequest={cloneRequest}
        commands={commands}
        clone={clone}
        hosts={hosts}
        chooseFolder={chooseFolder}
        baseFolder={baseFolder}
        onOpenLink={onOpenLink}
      />
      {recent.length > 0 && (
        <section className="recent" aria-labelledby={headingId}>
          <h2 id={headingId} ref={heading} tabIndex={-1} className="recent-heading">
            Recent repositories
          </h2>
          <ul ref={list} className="recent-list">
            {recent.map((entry, index) => (
              <RecentEntry
                key={entry.root}
                entry={entry}
                problem={problems.get(entry.root) ?? null}
                page={pages.get(entry.root) ?? null}
                onOpenLink={onOpenLink}
                onOpen={() => void open(entry.root)}
                onRemove={() => remove(index)}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RecentEntry({
  entry,
  problem,
  page,
  onOpenLink,
  onOpen,
  onRemove,
}: {
  entry: RecentRepository;
  problem: RepositoryError | null;
  page: WebPage | null;
  onOpenLink?: (url: string) => void;
  onOpen(): void;
  onRemove(): void;
}) {
  const markId = useId();
  return (
    <li className="recent-entry" data-problem={problem !== null || undefined}>
      <button
        type="button"
        className="recent-open"
        aria-describedby={problem === null ? undefined : markId}
        onClick={onOpen}
      >
        <FolderGit2 aria-hidden="true" className="recent-icon" />
        <span className="recent-name">{entry.name}</span>{" "}
        <span className="recent-root">{entry.root}</span>
      </button>
      {problem !== null && (
        <p id={markId} className="recent-mark">
          <CircleAlert aria-hidden="true" className="recent-mark-icon" />
          {mark(problem)}
        </p>
      )}
      {page !== null && onOpenLink && <OpenOnHost page={page} name={entry.name} onOpenLink={onOpenLink} />}
      <button
        type="button"
        className="button recent-remove"
        aria-label={`Remove ${entry.name} from recent repositories`}
        title="Remove from recent repositories"
        onClick={onRemove}
      >
        <X aria-hidden="true" className="button-icon" />
      </button>
    </li>
  );
}
