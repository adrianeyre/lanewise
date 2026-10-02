import { X } from "lucide-react";
import { PullRequestsWidget } from "../pullRequests/PullRequestsWidget";
import { usePullRequests } from "../pullRequests/usePullRequests";
import { OpenOnHost } from "../hosts/OpenOnHost";
import {
  type CSSProperties,
  type FocusEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import type { AiAccess } from "../ai/requests";

import type {
  BranchesAndRemotes,
  CommandClient,
  CommandName,
  CommitFile,
  FileStatusEntry,
  OpenedRepository,
  Stash,
} from "../commands/api";
import { holdReads, shareReads } from "../commands/shared";
import { useInProgressOperation } from "../conflicts/useInProgressOperation";
import type { LinkOpener } from "../legal/ExternalLink";
import { type DiffSubject, DiffWidget } from "../diff/DiffWidget";
import { checkCommitWithJev } from "../ai/jevDecisions";
import { stagedDiff } from "../ai/stagedDiff";
import { AvatarsShown, isGitHubRemote } from "../avatars/avatars";
import { BranchesWidget } from "./BranchesWidget";
import { type Copy, Copying } from "../ui/Copyable";
import { ColumnResizer } from "./ColumnResizer";
import { useColumnWidths } from "./columnWidths";
import { CommitDetails } from "./CommitDetails";
import { CommitHistory } from "./CommitHistory";
import type { TabPage } from "../tabs/tabs";
import { IssuesWidget } from "../issues/IssuesWidget";
import { SelectedStash, StashesWidget } from "./StashesWidget";
import { Toolbar } from "./Toolbar";
import { useWorkingTreeChanges } from "./useWorkingTreeChanges";
import { WorkingTree } from "./WorkingTree";

// The Conflicts page, with CodeMirror's merge view and the AI Suggestion
// Widget, only loads when an In-Progress Operation is first shown.
/** What the side Widgets read as a Tab opens, held until the Commit graph has its first window. */
const SIDE_READS: readonly CommandName[] = [
  "branches",
  "stashes",
  "fileStatus",
  "workingTreeChanges",
  "pullRequests",
  "issueTrackerAccount",
  "issues",
];

const ConflictsPage = lazy(async () => ({ default: (await import("../conflicts/ConflictsPage")).ConflictsPage }));

interface Props extends LinkOpener {
  commands: CommandClient;
  repository: OpenedRepository;
  /** The GitHub Enterprise Server Hosts added in Settings, for reading Pull Requests there. */
  enterpriseHosts?: readonly string[];
  /** What the Conflicts page's AI Suggestion Widget asks for a Suggestion through. */
  ai: AiAccess;
  /** Counts opens, so opening the same repository again reads it afresh. */
  opening: number;
  /** Whether Settings lets authors' pictures come from GitHub. */
  avatars?: boolean;
  /** Whether Settings says to fetch as the page is shown, as when its Tab is chosen. */
  fetchOnShow?: boolean;
  /** Called with the page shown, as it changes. */
  onPage: (page: TabPage) => void;
  /** The commit selected in the Commit graph, shown in Commit details, or `null` for the working tree's changes. */
  selectedCommit: string | null;
  onSelectCommit: (commit: string | null) => void;
  /** The file whose diff the Diff Widget shows, chosen in Commit details, the Stashes Widget or the Working tree. */
  chosenFile: DiffSubject | null;
  onSelectFile: (file: CommitFile) => void;
  /** Called with the change chosen in the Working tree, or `null` once the chosen one has gone. */
  onSelectChange: (entry: FileStatusEntry | null) => void;
  /** Called as the Diff Widget is closed, for the Commit graph to come back in its place. */
  onCloseFile: () => void;
  /** The stash selected in the Stashes Widget, by its `id`. */
  selectedStash: string | null;
  /** Called with the stash selected, or `null` once the one selected has gone. */
  onSelectStash: (stash: string | null) => void;
  onSelectStashFile: (stash: string, file: CommitFile) => void;
  /** Puts text on the clipboard, for the Commit graph's Copy commit ID and Copy commit message. */
  copyText?: (text: string) => Promise<void>;
}

// TODO: there is one Repository page per tab (PRD §7.1, M1).
/**
 * An open repository's page, laid out as GitKraken's is (ADR 0032): its
 * name and Toolbar along the top, then the Branches and Stashes Widgets down
 * the left, the Commit graph in the middle, and the Working tree, or Commit
 * details with a commit selected, down the right. A file chosen in any of
 * them shows its diff in the middle, in the Commit graph's place, until the
 * Diff Widget is closed. While an In-Progress Operation is, made in Lanewise
 * or not, the Conflicts page is shown instead. It watches the working tree
 * and its refs while it's drawn, and the Widgets refresh as they change. As
 * the page changes, focus goes to the top of the one shown.
 */
export function RepositoryPage({
  commands,
  repository,
  ai,
  opening,
  onPage,
  selectedCommit,
  onSelectCommit,
  chosenFile,
  onSelectFile,
  onSelectChange,
  onCloseFile,
  selectedStash,
  onSelectStash,
  onSelectStashFile,
  onOpenLink,
  enterpriseHosts,
  avatars = false,
  fetchOnShow = false,
  copyText,
}: Props) {
  // The Widgets beside the Commit graph read what they show once it has its
  // first window, or couldn't read one, so the graph is drawn first, and the
  // CPU is the history's while it's laid out (ADR 0043).
  const [historyLatch, setHistoryLatch] = useState(() => ({ opening, ...Promise.withResolvers<void>() }));
  // Opened again, its Widgets wait for its Commit graph again.
  if (historyLatch.opening !== opening) setHistoryLatch({ opening, ...Promise.withResolvers<void>() });
  const sideCommands = useMemo(
    () => holdReads(commands, SIDE_READS, historyLatch.promise),
    [commands, historyLatch],
  );
  const watched = useWorkingTreeChanges(sideCommands, repository.root);
  // The Toolbar and the Branches Widget read the branches together, sent once.
  const branchReads = useMemo(() => shareReads(sideCommands, ["branches"]), [sideCommands]);
  // What's done in Lanewise refreshes at once, not waiting for the watcher.
  const [changed, setChanged] = useState(0);
  const [commits, setCommits] = useState(0);
  // The opening whose Commit graph has its first window: the Toolbar's fetch waits for it (ADR 0043).
  const [readIn, setReadIn] = useState<number | null>(null);
  const historyRead = readIn === opening;
  const onHistoryRead = useCallback(() => {
    setReadIn(opening);
    historyLatch.resolve();
  }, [opening, historyLatch]);
  const refreshes = watched.changes + changed;
  const heading = useRef<HTMLHeadingElement>(null);
  // The columns' widths, which their edges resize, kept for every repository.
  const columns = useColumnWidths();
  const layout = useRef<HTMLDivElement>(null);
  const layoutWidth = () => layout.current?.clientWidth || window.innerWidth;
  const sidebarId = useId();
  const detailId = useId();
  // Opening the repository again reads it afresh too.
  const { operation, problem, show } = useInProgressOperation(commands, repository.root, refreshes + opening);
  const [said, setSaid] = useState<string | null>(null);
  // A commit ID or name clicked anywhere on the page is copied, and said so here.
  const copy = useMemo<Copy | null>(
    () =>
      copyText
        ? (text, what) =>
            void copyText(text).then(
              () => setSaid(`Copied the ${what} “${text}”.`),
              () => setSaid(`The ${what} wasn't copied.`),
            )
        : null,
    [copyText],
  );
  // The conflicted file chosen on the Conflicts page, kept here while the page is.
  const [chosenConflict, setChosenConflict] = useState<string | null>(null);
  // Chosen for one In-Progress Operation, it isn't for the next.
  if (operation === null && chosenConflict !== null) setChosenConflict(null);
  const page: TabPage["name"] = operation ? "conflicts" : "repository";
  // The page drawn, and the one before it: `null` until the In-Progress
  // Operation is first read. Kept as the page changes, while it's drawn.
  const [drawn, setDrawn] = useState<{ page: TabPage["name"] | null; before: TabPage["name"] | null }>({
    page: null,
    before: null,
  });
  if (operation !== undefined && drawn.page !== page) setDrawn({ page, before: drawn.page });
  const shownPage = useMemo<TabPage>(() => ({ name: page }), [page]);
  // The stashes, as the Stashes Widget last read them, for the Commit graph to draw.
  const [stashList, setStashList] = useState<readonly Stash[]>([]);
  // The branches and remotes, read with the Toolbar's and the Branches
  // Widget's, for the Commit graph's menus to know which branches are on a
  // remote too, and whether a remote is on GitHub, for its authors' pictures.
  const [refs, setRefs] = useState<BranchesAndRemotes | null>(null);
  useEffect(() => {
    let live = true;
    branchReads.call("branches", { repository: repository.root }).then(
      (outcome) => {
        if (!live || !outcome.ok) return;
        // Read again after a change and found the same, the menus are kept as they are.
        const read = outcome.value;
        setRefs((shown) => (refreshes > 0 && JSON.stringify(shown) === JSON.stringify(read) ? shown : read));
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [branchReads, repository.root, refreshes]);
  const onGitHub = useMemo(() => refs?.remotes.some((remote) => isGitHubRemote(remote.url)) ?? false, [refs]);
  // A branch's or tag's commit chosen in the Branches Widget, for the Commit graph to show.
  const [reveal, setReveal] = useState<{ commit: string; count: number } | null>(null);
  // A branch just made in the Branches Widget, for the Commit graph to highlight.
  const [made, setMade] = useState<{ name: string; count: number } | null>(null);
  // Whether the right shows the stash chosen in the Commit graph, in the Working tree's or Commit details' place.
  const [showingStash, setShowingStash] = useState(false);
  const stashHeading = useId();
  const shownStash = showingStash ? (stashList.find((stash) => stash.id === selectedStash) ?? null) : null;
  // What last had focus beside the middle, such as the file chosen, for focus to go back to as a diff closes.
  const beforeDiff = useRef<HTMLElement | null>(null);
  const remember = (event: FocusEvent) => {
    if (event.target instanceof HTMLElement) beforeDiff.current = event.target;
  };
  const diffShown = chosenFile !== null;
  // Closed from the Diff Widget, focus goes back where it was as the diff
  // opened, once the Commit graph is back, or else to the top of the page.
  const closing = useRef(false);
  useEffect(() => {
    if (diffShown || !closing.current) return;
    closing.current = false;
    const back = beforeDiff.current;
    beforeDiff.current = null;
    (back?.isConnected ? back : heading.current)?.focus();
  }, [diffShown]);
  const callbacks = useRef({ onPage });
  useEffect(() => {
    callbacks.current = { onPage };
  }, [onPage]);

  useEffect(() => {
    callbacks.current.onPage(shownPage);
  }, [shownPage]);

  // Back from the Conflicts page, focus goes to the top of this one. The
  // Conflicts page's own Widget takes focus as it's drawn.
  useEffect(() => {
    if (drawn.before === "conflicts" && drawn.page === "repository") heading.current?.focus();
  }, [drawn]);

  // The open Pull Requests, for their Widget and for the Commit graph to mark.
  const pulls = usePullRequests(sideCommands, repository, enterpriseHosts);
  /** Shows `commit` in the Commit graph, bringing it back if a diff was in its place. */
  function showCommit(commit: string) {
    if (diffShown) onCloseFile();
    setShowingStash(false);
    setReveal((last) => ({ commit, count: (last?.count ?? 0) + 1 }));
  }

  const top = (
    <div className="repository-heading">
      <h2 ref={heading} id="repository-name" className="repository-name" tabIndex={-1}>
        {repository.name}
        {page === "conflicts" && <span className="repository-page-name">: Conflicts</span>}
      </h2>
      <p className="repository-root" title={repository.root}>
        {repository.root}
      </p>
      {repository.web && onOpenLink && (
        <OpenOnHost page={repository.web} name={repository.name} onOpenLink={onOpenLink} />
      )}
      <p role="status" className="visually-hidden">
        {said}
      </p>
      {problem !== null && (
        <p role="alert" className="problem problem-output">
          {problem}
        </p>
      )}
    </div>
  );

  if (operation) {
    return (
      <section className="repository" aria-labelledby="repository-name">
        <div className="repository-bar">{top}</div>
        <Suspense
          fallback={
            <p role="status" className="file-status-summary">
              Opening the Conflicts page…
            </p>
          }
        >
          <ConflictsPage
            key={opening}
            commands={commands}
            repository={repository}
            operation={operation}
            ai={ai}
            focusOnShow={drawn.before === "repository"}
            chosen={chosenConflict}
            onChoose={setChosenConflict}
            onDone={show}
            onChanged={() => setChanged((n) => n + 1)}
            onSay={setSaid}
          />
        </Suspense>
      </section>
    );
  }
  return (
    <AvatarsShown.Provider value={avatars && onGitHub}>
    <Copying.Provider value={copy}>
    <section className="repository" aria-labelledby="repository-name">
      <Toolbar
        key={`toolbar:${opening}`}
        commands={branchReads}
        repository={repository}
        refreshes={refreshes}
        onChanged={() => setChanged((n) => n + 1)}
        onOpenLink={onOpenLink}
        fetchOnShow={fetchOnShow}
        historyRead={historyRead}
        heading={top}
        selectedCommit={selectedCommit}
        stashes={stashList}
      />
      <div
        ref={layout}
        className="repository-layout"
        style={{ "--sidebar-width": `${columns.widths.sidebar}px`, "--detail-width": `${columns.widths.detail}px` } as CSSProperties}
      >
        <aside
          id={sidebarId}
          className="repository-sidebar"
          aria-label="Branches, remotes, Pull Requests, stashes and Issues"
          onFocus={remember}
        >
          <BranchesWidget
            onOpenLink={onOpenLink}
            key={`branches:${opening}`}
            commands={branchReads}
            repository={repository}
            refreshes={refreshes}
            selectedCommit={selectedCommit}
            onChanged={() => setChanged((n) => n + 1)}
            onSelectCommit={showCommit}
            onBranchMade={(name) => setMade((last) => ({ name, count: (last?.count ?? 0) + 1 }))}
            copyText={copyText}
          />
          {onOpenLink && (
            <PullRequestsWidget pullRequests={pulls} onOpenLink={onOpenLink} onShowCommit={showCommit} />
          )}
          <StashesWidget
            key={`stashes:${opening}`}
            commands={sideCommands}
            repository={repository}
            refreshes={refreshes}
            selected={selectedStash}
            onSelect={onSelectStash}
            selectedFile={chosenFile?.kind === "stash" ? chosenFile.file.path : null}
            onSelectFile={onSelectStashFile}
            onStashes={setStashList}
            onChanged={() => setChanged((n) => n + 1)}
          />
          <IssuesWidget
            key={`issues:${opening}`}
            commands={sideCommands}
            repository={repository}
            onChanged={() => setChanged((n) => n + 1)}
            onOpenLink={onOpenLink}
            copyText={copyText}
          />
        </aside>
        <ColumnResizer
          column="sidebar"
          label="Resize the branches column"
          controls={sidebarId}
          widths={columns.widths}
          total={layoutWidth}
          onResize={(width) => columns.resize("sidebar", width)}
          onReset={() => columns.reset("sidebar")}
        />
        <div className="repository-centre">
          {/* Kept while a diff is shown in its place, scrolled where it was. */}
          <div className="repository-graph" hidden={diffShown}>
            <CommitHistory
              // Read again from the top after each commit made here.
              key={`${opening}:${commits}`}
              commands={commands}
              repository={repository}
              selected={selectedCommit}
              onSelect={(commit) => {
                setShowingStash(false);
                onSelectCommit(commit);
              }}
              refreshes={refreshes}
              onChanged={() => setChanged((n) => n + 1)}
              stashes={stashList}
              selectedStash={selectedStash}
              onSelectStash={(stash) => {
                setShowingStash(true);
                onSelectStash(stash);
              }}
              onShowWorkingTree={() => {
                setShowingStash(false);
                onSelectCommit(null);
              }}
              reveal={reveal}
              onReworded={(from, to) => {
                if (from === selectedCommit) onSelectCommit(to);
              }}
              copyText={copyText}
              onRead={onHistoryRead}
              made={made}
              refs={refs}
              pullRequests={pulls.byCommit}
              onOpenLink={onOpenLink}
            />
          </div>
          {diffShown && (
            <DiffWidget
              key={opening}
              commands={commands}
              repository={repository}
              subject={chosenFile}
              refreshes={refreshes}
              onChanged={() => setChanged((n) => n + 1)}
              onClose={() => {
                closing.current = true;
                onCloseFile();
              }}
            />
          )}
        </div>
        <ColumnResizer
          column="detail"
          label="Resize the details column"
          controls={detailId}
          widths={columns.widths}
          total={layoutWidth}
          onResize={(width) => columns.resize("detail", width)}
          onReset={() => columns.reset("detail")}
        />
        <div id={detailId} className="repository-detail" onFocus={remember}>
          {shownStash !== null && (
            <section className="surface stash-details" aria-labelledby={stashHeading}>
              <div className="surface-header">
                <h3 id={stashHeading} className="surface-heading">
                  Stash
                </h3>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Close the stash, showing what was there before"
                  title="Close"
                  onClick={() => setShowingStash(false)}
                >
                  <X aria-hidden="true" className="button-icon" />
                </button>
              </div>
              <SelectedStash
                key={shownStash.id}
                commands={sideCommands}
                root={repository.root}
                stash={shownStash}
                selectedFile={chosenFile?.kind === "stash" ? chosenFile.file.path : null}
                onSelectFile={(file) => onSelectStashFile(shownStash.id, file)}
              />
            </section>
          )}
          <div className="repository-detail-pane" hidden={shownStash !== null || selectedCommit !== null}>
            <WorkingTree
              key={opening}
              commands={sideCommands}
              repository={repository}
              refreshes={refreshes}
              unwatched={watched.problem}
              selected={chosenFile?.kind === "workingTree" ? chosenFile.entry : null}
              onSelect={onSelectChange}
              onChanged={() => setChanged((n) => n + 1)}
              onCommitted={() => {
                setChanged((n) => n + 1);
                setCommits((n) => n + 1);
              }}
              checkWithJev={
                ai.jev?.enabled && ai.jev.commits
                  ? async (message) =>
                      checkCommitWithJev(ai.platform, await stagedDiff(commands, repository.root), message)
                  : null
              }
            />
          </div>
          <div className="repository-detail-pane" hidden={shownStash !== null || selectedCommit === null}>
            <CommitDetails
              key={opening}
              commands={sideCommands}
              repository={repository}
              commit={selectedCommit}
              selectedFile={chosenFile?.kind === "commit" ? chosenFile.file.path : null}
              onSelectFile={onSelectFile}
              onShowWorkingTree={() => onSelectCommit(null)}
              onChanged={() => setChanged((n) => n + 1)}
              onReworded={(_, to) => onSelectCommit(to)}
            />
          </div>
        </div>
      </div>
    </section>
    </Copying.Provider>
    </AvatarsShown.Provider>
  );
}
