import { Ellipsis, RefreshCw } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import type {
  CommandClient,
  Cursor,
  Issue,
  IssueTracker,
  IssueTrackerAccountShown,
  OpenedRepository,
} from "../commands/api";
import { describeFailure } from "../repository/problems";
import { useBranchActions } from "../repository/useBranchActions";
import { ContextMenu, Menu, type MenuItem } from "../ui/Menu";
import { branchNameFor } from "./branchName";
import { describeIssueTrackerError, TRACKER_NAMES, TRACKERS } from "./issueWords";
import { useIssueTrackersChanged } from "./trackerEvents";
import { SectionHeading, useSectionOpen } from "../ui/Section";

/** How many Issues a page asks for. */
const PAGE_SIZE = 25;

/** How long typing rests before the search is sent. */
const SEARCH_PAUSE = 400;

interface Props {
  commands: CommandClient;
  repository: OpenedRepository;
  /** Called once a branch is made, so what shows the refs reads them again. */
  onChanged: () => void;
  /** Opens an Issue's page in the user's browser. */
  onOpenLink?: (url: string) => void;
  /** Puts an Issue's key or link on the clipboard. */
  copyText?: (text: string) => Promise<void>;
}

type Accounts = Partial<Record<IssueTracker, IssueTrackerAccountShown>>;

/** One page read, or why it couldn't be. */
type IssuesRead =
  | { ok: true; page: { items: Issue[]; nextCursor: Cursor | null } }
  | { ok: false; problem: string; notSignedIn: boolean };

/** What's listed, for the Issue Tracker, search and read named by `key`. */
type Listing = { key: string } & (
  | { items: Issue[]; nextCursor: Cursor | null; more: boolean }
  | { ok: false; problem: string; notSignedIn: boolean }
);

/** The accounts saved, by Issue Tracker. One that can't be read is taken as not saved. */
async function readAccounts(commands: CommandClient): Promise<Accounts> {
  const found = await Promise.all(
    TRACKERS.map((tracker) =>
      commands.call("issueTrackerAccount", { tracker }).then(
        (outcome) => [tracker, outcome.ok ? outcome.value : null] as const,
        () => [tracker, null] as const,
      ),
    ),
  );
  const saved: Accounts = {};
  for (const [tracker, account] of found) if (account !== null) saved[tracker] = account;
  return saved;
}

/** The page of `tracker`'s Issues at `cursor` for `query`, or what to tell the user instead. */
async function readIssues(
  commands: CommandClient,
  tracker: IssueTracker,
  query: string,
  cursor: Cursor | null,
): Promise<IssuesRead> {
  try {
    const outcome = await commands.call("issues", { tracker, query, page: { cursor, limit: PAGE_SIZE } });
    if (outcome.ok) return { ok: true, page: outcome.value };
    return {
      ok: false,
      problem: describeIssueTrackerError(outcome.error, tracker),
      notSignedIn: outcome.error.kind === "notSignedIn",
    };
  } catch (failure) {
    return { ok: false, problem: describeFailure(failure), notSignedIn: false };
  }
}

/**
 * The Issues Widget (ADR 0038): the user's open Issues in the Issue
 * Trackers saved in Settings, Jira Cloud's assigned to them and Trello's
 * cards they're on, most recently changed first, with a search and Load
 * more. Activating an Issue, its "…" button, a right click, Shift+F10 or
 * the Menu key open its actions: a branch for it, named from its key and
 * title, its page in the browser, and copying its key or link. It only
 * reads the Issue Trackers.
 */
export function IssuesWidget({ commands, repository, onChanged, onOpenLink, copyText }: Props) {
  const headingId = useId();
  // A section of the left column's accordion.
  const [issuesOpen, toggleIssues] = useSectionOpen("issues");
  const issuesId = useId();
  const searchId = useId();
  const trackerId = useId();
  const [accounts, setAccounts] = useState<Accounts | null>(null);
  const [chosen, setChosen] = useState<IssueTracker | null>(null);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [reads, setReads] = useState(0);
  const [listing, setListing] = useState<Listing | null>(null);
  // What a copy said, and what the branch actions had said before it, so whichever came last is said.
  const [copied, setCopied] = useState<{ said: string; after: string | null } | null>(null);
  const [menu, setMenu] = useState<{ issue: Issue; at: { x: number; y: number } } | null>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  // The Issue Load more added first, to hand focus to once it's drawn.
  const focusNext = useRef<string | null>(null);
  // Counts the reads of the accounts, so only the latest is kept.
  const accountReads = useRef(0);
  const actions = useBranchActions({ commands, repository, onChanged });

  async function reloadAccounts() {
    const reading = ++accountReads.current;
    const found = await readAccounts(commands);
    if (reading === accountReads.current) setAccounts(found);
  }
  useIssueTrackersChanged(() => void reloadAccounts());

  useEffect(() => {
    let live = true;
    void readAccounts(commands).then((found) => {
      if (live) setAccounts(found);
    });
    return () => {
      live = false;
    };
  }, [commands]);

  const saved = TRACKERS.filter((tracker) => accounts?.[tracker] !== undefined);
  const tracker = chosen !== null && saved.includes(chosen) ? chosen : (saved[0] ?? null);

  // The search is sent once typing rests.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearched(query.trim()), SEARCH_PAUSE);
    return () => window.clearTimeout(timer);
  }, [query]);

  // What's listed is for one Issue Tracker, search and read: anything else is still being read.
  const wanted = tracker === null ? null : JSON.stringify([tracker, searched, reads]);
  const listed = listing !== null && listing.key === wanted ? listing : null;

  useEffect(() => {
    if (tracker === null) return;
    const key = JSON.stringify([tracker, searched, reads]);
    let live = true;
    void readIssues(commands, tracker, searched, null).then((read) => {
      if (live) setListing(read.ok ? { key, ...read.page, more: false } : { key, ...read });
    });
    return () => {
      live = false;
    };
  }, [commands, tracker, searched, reads]);

  async function loadMore() {
    if (tracker === null || listed === null || !("items" in listed) || listed.nextCursor === null || listed.more) return;
    const { key, nextCursor } = listed;
    setListing({ ...listed, more: true });
    const read = await readIssues(commands, tracker, searched, nextCursor);
    if (read.ok) focusNext.current = read.page.items[0]?.id ?? null;
    setListing((shown) => {
      if (shown === null || shown.key !== key || !("items" in shown)) return shown;
      return read.ok
        ? { key, items: [...shown.items, ...read.page.items], nextCursor: read.page.nextCursor, more: false }
        : { key, ...read };
    });
  }

  function refresh() {
    setCopied(null);
    void reloadAccounts();
    setReads((n) => n + 1);
  }

  async function copy(text: string, what: string) {
    if (!copyText) return;
    let said: string;
    try {
      await copyText(text);
      said = `Copied ${what}.`;
    } catch (failure) {
      said = describeFailure(failure);
    }
    setCopied({ said, after: actions.said });
  }
  const said = copied !== null && copied.after === actions.said ? copied.said : actions.said;

  function itemsFor(issue: Issue): MenuItem[] {
    const name = issue.key ?? issue.title;
    const items: MenuItem[] = [
      {
        kind: "action",
        id: "branch",
        label: "Create branch for this Issue…",
        onSelect: () => actions.create({ kind: "choose", selected: null, name: branchNameFor(issue) }),
      },
      {
        kind: "action",
        id: "open",
        label: "Open in browser",
        onSelect: () => {
          if (onOpenLink) onOpenLink(issue.url);
          else window.open(issue.url, "_blank", "noopener,noreferrer");
        },
      },
    ];
    if (copyText && issue.key !== null) {
      const key = issue.key;
      items.push({ kind: "action", id: "copy-key", label: "Copy key", onSelect: () => void copy(key, key) });
    }
    if (copyText) {
      items.push({
        kind: "action",
        id: "copy-link",
        label: "Copy link",
        onSelect: () => void copy(issue.url, `the link to ${name}`),
      });
    }
    return items;
  }

  function openMenuBeside(issue: Issue) {
    const box = rows.current.get(issue.id)?.getBoundingClientRect();
    setMenu({ issue, at: { x: (box?.left ?? 0) + 16, y: box?.bottom ?? 0 } });
  }

  function onRowKey(event: KeyboardEvent, issue: Issue) {
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      openMenuBeside(issue);
    }
  }

  function onRowMenu(event: MouseEvent, issue: Issue) {
    event.preventDefault();
    setMenu({ issue, at: { x: event.clientX, y: event.clientY } });
  }

  return (
    <section className="surface issues" aria-labelledby={headingId} aria-busy={actions.busy || undefined}>
      <div className="surface-header">
        <SectionHeading level={3} open={issuesOpen} onToggle={toggleIssues} controls={issuesId} labelId={headingId}>
          Issues
        </SectionHeading>
        {saved.length > 0 && (
          <button type="button" className="icon-button" aria-label="Refresh Issues" title="Refresh Issues" onClick={refresh}>
            <RefreshCw aria-hidden="true" className="button-icon" />
          </button>
        )}
      </div>
      <p role="status" className="file-status-summary">
        {said}
      </p>
      {actions.problem !== null && (
        <p role="alert" className="problem problem-output">
          {actions.problem}
        </p>
      )}
      {issuesOpen && (
        <div id={issuesId}>
        {accounts === null && <p className="surface-note">Looking for your Issue Trackers…</p>}
        {accounts !== null && tracker === null && (
          <p className="surface-note">Add Jira Cloud or Trello under Issue Trackers in Settings to see your Issues here.</p>
        )}
        {tracker !== null && (
          <>
            {saved.length > 1 && (
              <div className="branch-field issues-tracker">
                <label htmlFor={trackerId}>Issue Tracker</label>
                <select
                  id={trackerId}
                  value={tracker}
                  onChange={(event) => setChosen(event.target.value as IssueTracker)}
                >
                  {saved.map((each) => (
                    <option key={each} value={each}>
                      {TRACKER_NAMES[each]}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {saved.length === 1 && (
              <p className="surface-note">
                From {tracker === "jira" ? (accounts?.jira?.site ?? TRACKER_NAMES.jira) : TRACKER_NAMES.trello}
              </p>
            )}
            <form
              role="search"
              className="branch-field issues-search"
              aria-label="Issues"
              onSubmit={(event) => {
                event.preventDefault();
                setSearched(query.trim());
              }}
            >
              <label htmlFor={searchId}>Search Issues</label>
              <input
                id={searchId}
                type="search"
                value={query}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setQuery(event.target.value)}
              />
            </form>
            {listed === null && <p className="surface-note">Reading your Issues…</p>}
            {listed !== null && "problem" in listed && (
              <div className="issues-problem">
                <p role="alert" className="problem">
                  {listed.problem}
                </p>
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => (listed.notSignedIn ? refresh() : setReads((n) => n + 1))}
                >
                  Try again
                </button>
              </div>
            )}
            {listed !== null && "items" in listed && listed.items.length === 0 && (
              <p className="surface-note">
                {searched === "" ? "No open Issues for you." : `No open Issues match “${searched}”.`}
              </p>
            )}
            {listed !== null && "items" in listed && listed.items.length > 0 && (
              <ul className="issues-list" aria-label={`Issues in ${TRACKER_NAMES[tracker]}`}>
                {listed.items.map((issue) => (
                  <li key={issue.id} className="issue-row" onContextMenu={(event) => onRowMenu(event, issue)}>
                    <button
                      ref={(button) => {
                        if (button === null) return void rows.current.delete(issue.id);
                        rows.current.set(issue.id, button);
                        // Load more hands focus to the first Issue it added, as it's drawn.
                        if (focusNext.current === issue.id) {
                          focusNext.current = null;
                          button.focus();
                        }
                      }}
                      type="button"
                      className="issue-select"
                      aria-haspopup="menu"
                      aria-expanded={menu?.issue.id === issue.id}
                      onClick={() => openMenuBeside(issue)}
                      onKeyDown={(event) => onRowKey(event, issue)}
                    >
                      <span className="issue-words">
                        {issue.key !== null && <span className="issue-key">{issue.key}</span>}{" "}
                        <span className="issue-title">{issue.title === "" ? "(No title)" : issue.title}</span>
                      </span>{" "}
                      {issue.status !== null && <span className="issue-status">{issue.status}</span>}
                    </button>
                    <Menu
                      label={<Ellipsis aria-hidden="true" className="button-icon" />}
                      ariaLabel={`Actions for ${issue.key ?? issue.title}`}
                      chevron={false}
                      buttonClassName="icon-button"
                      items={itemsFor(issue)}
                    />
                  </li>
                ))}
              </ul>
            )}
            {listed !== null && "items" in listed && listed.nextCursor !== null && (
              <div>
                <button
                  type="button"
                  className="button button-small"
                  aria-disabled={listed.more || undefined}
                  onClick={() => void loadMore()}
                >
                  {listed.more ? "Loading more…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
        </div>
      )}
      {menu !== null && (
        <ContextMenu
          ariaLabel={`Actions for ${menu.issue.key ?? menu.issue.title}`}
          items={itemsFor(menu.issue)}
          at={menu.at}
          onClose={(returnFocus) => {
            const id = menu.issue.id;
            setMenu(null);
            if (returnFocus) rows.current.get(id)?.focus();
          }}
        />
      )}
      {actions.dialogs}
    </section>
  );
}
