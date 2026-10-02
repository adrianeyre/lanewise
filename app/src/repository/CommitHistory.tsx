import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  memo,
  useMemo,
  useRef,
  useState,
} from "react";
import { PullRequestIcon, pullRequestName } from "../pullRequests/PullRequestsWidget";
import { flushSync } from "react-dom";
import { PencilLine } from "lucide-react";

import type {
  BranchesAndRemotes,
  CommandClient,
  CommitLabel,
  PullRequest,
  GraphRow,
  LabelKind,
  OpenedRepository,
  Stash,
} from "../commands/api";
import { Avatar } from "../avatars/Avatar";
import { pictureOf, useAvatarsShown, usePicturesLoaded } from "../avatars/avatars";
import { type Copy, useCopy } from "../ui/Copyable";
import { ContextMenu } from "../ui/Menu";
import { Splitter } from "../ui/Splitter";
import { openRemoteBranch } from "./branchMenus";
import { CommitBranchMenu, commitActions, labelActions } from "./CommitBranchMenu";
import {
  buildScene,
  columnX,
  type GraphColours,
  graphWidth,
  LANE_COLOURS,
  paint,
  type Scene,
} from "./graphDrawing";
import { titleOf } from "./stashWords";
import { describePlace } from "./graphWords";
import {
  clampHistoryWidth,
  HISTORY_COLUMNS,
  HISTORY_LIMITS,
  type HistoryColumn,
  textWidth,
  useHistoryWidths,
} from "./historyColumns";
import { absoluteTime, machineTime, relativeTime, useNow } from "./time";
import { useBranchActions } from "./useBranchActions";
import { useCommitActions } from "./useCommitActions";
import { useGraphWindows } from "./useGraphWindows";

interface Props {
  commands: CommandClient;
  repository: OpenedRepository;
  /** The open Pull Requests, by the full ID of their branch's tip, to mark beside it. */
  pullRequests?: ReadonlyMap<string, readonly PullRequest[]>;
  /** Opens a Pull Request clicked: in a Tab of its own, or the user's browser. */
  onOpenLink?: (url: string) => void;
  /** The selected commit's full ID, if one is. */
  selected: string | null;
  onSelect: (commit: string) => void;
  /** Counts the times the working tree or its refs changed, on disk or in Lanewise. */
  refreshes: number;
  /** Called once a branch is made, renamed, deleted or checked out from the Branch menu. */
  onChanged: () => void;
  /** The repository's stashes, each drawn as a dotted square beside the commit it was made on. */
  stashes?: readonly Stash[];
  /** The selected stash's `id`, if one is. */
  selectedStash?: string | null;
  /** Called with the stash whose square was clicked. */
  onSelectStash?: (stash: string) => void;
  /** Called by the Working tree row at the top, to show the working tree's changes instead of a commit's. */
  onShowWorkingTree?: () => void;
  /**
   * A commit to scroll to and select, such as a branch's tip chosen in the
   * Branches Widget, counted so choosing the same one again shows it again.
   */
  reveal?: { commit: string; count: number } | null;
  /** A branch just made elsewhere on the page, whose Label is highlighted a moment as it appears. */
  made?: { name: string; count: number } | null;
  /** Puts text on the clipboard, for the commit menu's Copy commit ID and Copy commit message. */
  copyText?: (text: string) => Promise<void>;
  /** Called once, as the first window comes and says how many rows the history has, or as it can't be read. */
  onRead?: () => void;
  /** The branches and remotes, as the page last read them, for the menus to offer deleting a branch on its remote. */
  refs?: BranchesAndRemotes | null;
  /** Called with a commit whose message was changed, and the commit it was made again as. */
  onReworded?: (from: string, to: string) => void;
}

/** Each row's height, in `rem`: one line of text. `styles.css` draws rows this tall. */
const ROW_REM = 1.75;

/** The distance between two of the graph's columns, in `rem`: room for an avatar. */
const LANE_REM = 1.5;

/** The most of the history's width the graph takes, however many columns it has (ADR 0005). */
const GRAPH_SHARE = 0.45;

/** How many rows to draw when the list can't be measured, as in a test. */
const UNMEASURED_ROWS = 20;

/** The columns' names, as their headers show them. */
const COLUMN_NAMES: Record<HistoryColumn, string> = {
  labels: "Branch / tag",
  graph: "Graph",
  author: "Author",
  date: "Date",
  id: "Commit",
};

/** The fonts the rows are drawn in, for sizing the columns to fit them. */
const MONOSPACE = 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace';

/** How many rows are drawn beyond each end of what shows, so a quick scroll isn't blank. */
const OVERSCAN = 5;

const labelKinds: Record<LabelKind, string> = {
  head: "Detached HEAD",
  currentBranch: "Current branch",
  branch: "Branch",
  remoteBranch: "Remote branch",
  tag: "Tag",
};

/** The root font size in pixels, so rows and lanes follow the user's text size. */
function remPixels(): number {
  const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(root) && root > 0 ? root : 16;
}

/**
 * The Commit graph Widget's history: every commit, newest first, with its
 * lanes drawn beside it. It is read from the `graphWindow` command a window
 * at a time, around what shows, so any part of a long history is quick to
 * reach (ADR 0005). The history is an ARIA grid of one row per commit,
 * focused a row at a time: the arrow keys, Page Up and Page Down, and Home
 * and End move through it, and the focused commit is the selected one. Each
 * row says its place in the graph in words; the canvas the lanes are drawn
 * on is hidden from screen readers, and clicking it selects the commit
 * beside the click. Only the rows in view are drawn, so a long history
 * stays quick. The Branch menu makes a branch at the selected commit, and
 * checks out, merges, renames or deletes the branches whose Labels it
 * carries, and a right click on a commit, or Shift+F10 or the Menu key on its
 * row, opens the same actions beside it. Each commit is drawn with its
 * author's avatar, their initials, and each stash as a dotted square beside
 * the commit it was made on, which selects the stash when clicked. The row
 * above the history shows the working tree's changes. A click on a Label
 * or a commit's ID copies it, and a double click on a branch's Label checks
 * it out, as a local branch: a remote-tracking branch's moves the local
 * branch to it if it's elsewhere. A right click on a Label, in its row or
 * among every Label "+N" shows, opens that Label's actions, then the
 * commit's. A commit's "+N" shows every Label it has, and so does `+` on
 * its row. Each column sizes itself to fit what it shows,
 * until its edge in the header is dragged, or moved from the keyboard; a
 * double click on the edge, or Enter, sizes it to fit again. The history
 * is read again as the refs move. Give it a new `key` for each repository
 * opened.
 */
export function CommitHistory({
  commands,
  repository,
  selected,
  onSelect,
  refreshes,
  onChanged,
  stashes = [],
  selectedStash = null,
  onSelectStash = () => {},
  onShowWorkingTree,
  reveal = null,
  made = null,
  copyText,
  refs = null,
  onReworded,
  pullRequests = NO_PULL_REQUESTS_BY_COMMIT,
  onOpenLink,
  onRead,
}: Props) {
  // The row that takes focus when the grid is tabbed to.
  const [active, setActive] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const viewport = useRef<HTMLDivElement | null>(null);
  const rows = useRef(new Map<number, HTMLDivElement>());
  const focusTo = useRef<number | null>(null);
  // A row focused before its window was read, to select once it is.
  const selectOnRead = useRef<number | null>(null);
  const headingId = useId();
  const now = useNow();
  const rem = remPixels();
  const row = rem * ROW_REM;
  const lane = rem * LANE_REM;

  const visible = viewportSize.height > 0 ? Math.ceil(viewportSize.height / row) : UNMEASURED_ROWS;
  const top = Math.floor(scrollTop / row);
  const first = Math.max(0, top - OVERSCAN);
  const wantedLast = top + visible + OVERSCAN;
  const graph = useGraphWindows(commands, repository.root, first, wantedLast, active, refreshes);
  const isRead = graph.total !== null || graph.problem !== null;
  const saidRead = useRef(false);
  useEffect(() => {
    if (!isRead || saidRead.current) return;
    saidRead.current = true;
    onRead?.();
  }, [isRead, onRead]);
  // The branch made last, here or elsewhere on the page, whose Label is highlighted a moment.
  const [fresh, setFresh] = useState<string | null>(null);
  const actions = useBranchActions({
    commands,
    repository,
    onChanged,
    onDone: (done) => {
      if (done.kind === "created") setFresh(done.name);
    },
  });
  const more = useCommitActions({ commands, repository, onChanged, copyText, onReworded });
  // The commit whose every Label shows, its "+N" clicked.
  const [expanded, setExpanded] = useState<string | null>(null);
  const expandedBox = useRef<HTMLDivElement | null>(null);
  const columns = useHistoryWidths();
  // How wide each column needs to be to fit what's been drawn in it, only ever growing, so it doesn't jump on a scroll.
  const [fitted, setFitted] = useState<Record<HistoryColumn, number>>({ labels: 0, graph: 0, author: 0, date: 0, id: 0 });
  const font = useMemo(() => getComputedStyle(document.body).fontFamily || "sans-serif", []);
  const [madeSeen, setMadeSeen] = useState(made);
  if (made !== madeSeen) {
    setMadeSeen(made);
    if (made !== null) setFresh(made.name);
  }
  useEffect(() => {
    if (fresh === null) return;
    const done = setTimeout(() => setFresh(null), 2500);
    return () => clearTimeout(done);
  }, [fresh]);
  const count = graph.total ?? 0;
  const last = Math.min(count, wantedLast);
  const current = Math.min(active, Math.max(0, count - 1));
  const rowAt = graph.row;
  // The selected commit as last read, so the Branch menu, and focus on it,
  // stay while its window is read again after the refs move.
  const [lastSelected, setLastSelected] = useState<GraphRow | undefined>(undefined);
  const selectedNow = rowAt(current)?.id === selected ? rowAt(current) : undefined;
  if (selectedNow !== undefined && selectedNow !== lastSelected) setLastSelected(selectedNow);
  const selectedRow = selectedNow ?? (lastSelected?.id === selected ? lastSelected : undefined);
  // The menu a right click, Shift+F10 or the Menu key opened on a row, and where.
  // A right click on a Label opens that Label's menu.
  const [contextMenu, setContextMenu] = useState<{
    index: number;
    at: { x: number; y: number };
    label?: CommitLabel;
  } | null>(null);
  const contextRow = contextMenu === null ? undefined : rowAt(contextMenu.index);
  // The branch checked out, as the rows read so far have its Label, for the menus to name.
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);

  // The viewport, and its size, for how many rows it shows and how wide the graph may be.
  const viewportRef = useCallback((element: HTMLDivElement | null) => {
    viewport.current = element;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      viewport.current = null;
    };
  }, []);

  // A row moved to by the keyboard takes focus once it's drawn.
  useLayoutEffect(() => {
    if (focusTo.current === null) return;
    rows.current.get(focusTo.current)?.focus({ preventScroll: true });
    focusTo.current = null;
  });

  // A row focused before it was read is selected once it is.
  useEffect(() => {
    if (selectOnRead.current !== current) return;
    const commit = rowAt(current);
    if (!commit) return;
    selectOnRead.current = null;
    if (commit.id !== selected) onSelect(commit.id);
  }, [rowAt, current, selected, onSelect]);

  /** Scrolls row `target` into view, the one the grid's focus goes to. */
  function scrollTo(target: number) {
    const element = viewport.current;
    if (element) {
      const height = element.clientHeight || visible * row;
      const at = target * row;
      if (at < element.scrollTop) element.scrollTop = at;
      else if (at + row > element.scrollTop + height) element.scrollTop = at + row - height;
      setScrollTop(element.scrollTop);
    }
    setActive(target);
  }

  /** Moves focus, and so the selection, to row `to`, scrolling it into view. */
  function moveTo(to: number) {
    const target = Math.max(0, Math.min(count - 1, to));
    scrollTo(target);
    focusTo.current = target;
  }

  // A commit to show, found by its row: scrolled to and selected, leaving focus where it is.
  const latestReveal = useRef({ scrollTo, onSelect });
  useLayoutEffect(() => {
    latestReveal.current = { scrollTo, onSelect };
  });
  useEffect(() => {
    if (reveal === null) return;
    let live = true;
    void commands.call("graphRowOf", { repository: repository.root, commit: reveal.commit }).then(
      (outcome) => {
        if (!live || !outcome.ok || outcome.value.row === null) return;
        latestReveal.current.scrollTo(outcome.value.row);
        latestReveal.current.onSelect(reveal.commit);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [commands, repository.root, reveal]);

  /** Opens the menu of `index`'s actions, or of its `label`'s, at `at`, selecting it, once its window is read. */
  function openMenu(index: number, at: { x: number; y: number }, label?: CommitLabel) {
    if (!rowAt(index)) return;
    moveTo(index);
    setContextMenu({ index, at, label });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "+" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const commit = rowAt(current);
      if (commit && commit.labels.length > 1) {
        event.preventDefault();
        setExpanded(expanded === commit.id ? null : commit.id);
      }
      return;
    }
    if (event.key === "Escape" && expanded !== null) {
      event.preventDefault();
      setExpanded(null);
      return;
    }
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      const box = rows.current.get(current)?.getBoundingClientRect();
      openMenu(current, { x: (box?.left ?? 0) + lane * 2, y: box?.bottom ?? 0 });
      return;
    }
    const page = Math.max(1, visible - 1);
    const moves: Record<string, () => number> = {
      ArrowDown: () => current + 1,
      ArrowUp: () => current - 1,
      PageDown: () => current + page,
      PageUp: () => current - page,
      Home: () => 0,
      End: () => count - 1,
    };
    const move = moves[event.key];
    if (!move || event.altKey || event.shiftKey || event.metaKey) return;
    event.preventDefault();
    moveTo(move());
  }

  function focused(index: number) {
    setActive(index);
    const commit = rowAt(index);
    selectOnRead.current = commit ? null : index;
    if (commit && commit.id !== selected) onSelect(commit.id);
  }

  // The rows' callbacks stay the same from one render to the next, so a row
  // whose commit hasn't changed isn't drawn again as another window comes.
  const latestFocused = useRef(focused);
  useLayoutEffect(() => {
    latestFocused.current = focused;
  });
  const onRowFocus = useCallback((index: number) => latestFocused.current(index), []);
  const latestMenu = useRef(openMenu);
  useLayoutEffect(() => {
    latestMenu.current = openMenu;
  });
  const onRowMenu = useCallback(
    (index: number, at: { x: number; y: number }, label?: CommitLabel) => latestMenu.current(index, at, label),
    [],
  );
  /** A double click on a branch's Label checks it out: a remote-tracking branch's as a local branch. */
  function openLabel(label: CommitLabel) {
    if (label.kind === "branch") actions.checkOut({ kind: "local", name: label.name });
    // The local branch it's checked out as is moved to it, if it's elsewhere.
    if (label.kind === "remoteBranch") openRemoteBranch(actions, refs, label.name);
  }
  const latestOpenLabel = useRef(openLabel);
  useLayoutEffect(() => {
    latestOpenLabel.current = openLabel;
  });
  const onOpenLabel = useCallback((label: CommitLabel) => latestOpenLabel.current(label), []);
  const onExpand = useCallback((commit: string) => setExpanded((open) => (open === commit ? null : commit)), []);
  const latestOpenLink = useRef(onOpenLink);
  useLayoutEffect(() => {
    latestOpenLink.current = onOpenLink;
  });
  const onOpenPullRequest = useCallback((pull: PullRequest) => latestOpenLink.current?.(pull.url), []);

  // Every Label shown closes as a click lands anywhere else.
  useEffect(() => {
    if (expanded === null) return;
    const close = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".history-labels-all, .label-more")) return;
      setExpanded(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [expanded]);

  const rowElement = useCallback((index: number, element: HTMLDivElement | null) => {
    if (element) rows.current.set(index, element);
    else rows.current.delete(index);
  }, []);

  // The graph beside the rows on screen.
  const onScreen = Math.min(count, top + visible + 1);
  // The stashes made on each commit, by its ID, and each commit's stashes, for the rows to name.
  const stashesOn = useMemo(() => {
    const on = new Map<string, string[]>();
    for (const stash of stashes) on.set(stash.base.id, [...(on.get(stash.base.id) ?? []), stash.id]);
    return on;
  }, [stashes]);
  const stashNames = useMemo(() => {
    const names = new Map<string, string[]>();
    for (const stash of stashes) names.set(stash.base.id, [...(names.get(stash.base.id) ?? []), titleOf(stash)]);
    return names;
  }, [stashes]);
  // Authors' pictures, where they're shown, drawn in place of their initials as each loads.
  const avatarsShown = useAvatarsShown();
  const picturesLoaded = usePicturesLoaded();
  const pictures = useMemo(
    () => (avatarsShown ? { of: pictureOf, loaded: picturesLoaded } : null),
    [avatarsShown, picturesLoaded],
  );
  const scene = useMemo(
    () =>
      buildScene({
        row: rowAt,
        segments: graph.segments,
        first: top,
        last: onScreen,
        rowHeight: row,
        lane,
        scrollTop,
        selected,
        stashes: stashesOn,
        selectedStash,
      }),
    [rowAt, graph.segments, top, onScreen, row, lane, scrollTop, selected, stashesOn, selectedStash],
  );
  const drawn = new Set<number>();
  for (let index = first; index < last; index++) drawn.add(index);
  if (count > 0) drawn.add(current);

  // What each column needs to fit the rows drawn, as GitKraken's columns size themselves.
  const small = rem * 0.75;
  const needs: Record<HistoryColumn, number> = { labels: 0, graph: 0, author: 0, date: 0, id: 0 };
  for (const index of drawn) {
    const commit = rowAt(index);
    if (!commit) continue;
    const [shown, ...rest] = orderLabels(commit.labels);
    const pulls = pullRequests.get(commit.id) ?? [];
    if (shown !== undefined || pulls.length > 0) {
      const chip = (text: string) => textWidth(text, `700 ${small}px ${font}`, small) + rem * 0.75 + 2;
      const labels =
        (shown === undefined ? 0 : chip(shown.name)) +
        pulls.reduce((width, pull) => width + rem * 0.25 + chip(pullRequestName(pull)) + small, 0) +
        (rest.length > 0 ? rem * 0.25 + chip(`+${rest.length}`) : 0) +
        rem * 0.75;
      needs.labels = Math.max(needs.labels, labels);
    }
    needs.author = Math.max(needs.author, rem * 1.625 + textWidth(commit.author, `${rem}px ${font}`, rem));
    needs.date = Math.max(needs.date, textWidth(relativeTime(commit.time, now), `${rem}px ${font}`, rem));
    needs.id = Math.max(needs.id, textWidth(commit.shortId, `${rem}px ${MONOSPACE}`, rem));
  }
  const grown = HISTORY_COLUMNS.filter((column) => Math.ceil(needs[column]) > fitted[column]);
  if (grown.length > 0) {
    setFitted((was) => {
      const next = { ...was };
      for (const column of grown) next[column] = Math.max(was[column], Math.ceil(needs[column]));
      return next;
    });
  }
  /** A column's width: as made by hand, or else what fits. */
  const widthOf = (column: HistoryColumn, fits: number) =>
    clampHistoryWidth(column, columns.widths[column] ?? fits, rem);
  const labelsWidth = widthOf("labels", fitted.labels);
  const widest = viewportSize.width > 0 ? Math.max(lane * 2, viewportSize.width * GRAPH_SHARE - labelsWidth) : Infinity;
  const width = widthOf("graph", Math.min(graphWidth(Math.max(1, scene.columns), lane), widest));
  const widths: Record<HistoryColumn, number> = {
    labels: labelsWidth,
    graph: width,
    author: widthOf("author", fitted.author),
    date: widthOf("date", fitted.date),
    id: widthOf("id", fitted.id),
  };
  /** The edge in `column`'s header that resizes it. */
  const edge = (column: HistoryColumn) => (
    <Splitter
      className={`history-resizer history-resizer-${column === "labels" || column === "graph" ? "end" : "start"}`}
      label={`Resize the ${COLUMN_NAMES[column]} column`}
      width={widths[column]}
      min={Math.round(HISTORY_LIMITS[column].min * rem)}
      max={Math.round(HISTORY_LIMITS[column].max * rem)}
      // The Labels' and the graph's edges are at their right; the others' at their left.
      rightward={column === "labels" || column === "graph" ? 1 : -1}
      onResize={(to) => columns.resize(column, to)}
      onReset={() => columns.fit(column)}
      resetLabel="Size to fit"
    />
  );
  const expandedIndex = expanded === null ? undefined : [...drawn].find((index) => rowAt(index)?.id === expanded);
  const expandedRow = expandedIndex === undefined ? undefined : rowAt(expandedIndex);
  const height = viewportSize.height > 0 ? viewportSize.height : visible * row;

  /** The row beside a pointer on the graph, and the stash whose square it's on, if it is. */
  function graphPoint(event: MouseEvent<HTMLCanvasElement>): { index: number; stash: string | null } {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.floor((event.clientY - box.top + scrollTop) / row);
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const square = scene.stashes.find((mark) => Math.abs(mark.x - x) <= lane / 2 && Math.abs(mark.y - y) <= lane / 2);
    return { index, stash: square?.id ?? null };
  }

  /** Selects the commit beside a click on the graph, or the stash whose square it's on. */
  function onGraphClick(event: MouseEvent<HTMLCanvasElement>) {
    const { index, stash } = graphPoint(event);
    if (stash !== null) onSelectStash(stash);
    else if (index >= 0 && index < count) moveTo(index);
  }

  function onGraphMenu(event: MouseEvent<HTMLCanvasElement>) {
    const { index } = graphPoint(event);
    if (index < 0 || index >= count) return;
    event.preventDefault();
    openMenu(index, { x: event.clientX, y: event.clientY });
  }

  // The current branch, from whichever row drawn has its Label, kept once it scrolls away.
  const head = [...drawn]
    .map((index) => rowAt(index)?.labels.find((each) => each.kind === "currentBranch" || each.kind === "head"))
    .find((label) => label !== undefined);
  const headBranch = head === undefined ? currentBranch : head.kind === "currentBranch" ? head.name : null;
  if (headBranch !== currentBranch) setCurrentBranch(headBranch);

  const style = {
    "--history-row": `${ROW_REM}rem`,
    "--graph-width": `${width}px`,
    "--labels-width": `${widths.labels}px`,
    "--author-width": `${widths.author}px`,
    "--date-width": `${widths.date}px`,
    "--id-width": `${widths.id}px`,
  } as CSSProperties;

  return (
    <section
      className="surface commit-history"
      aria-labelledby={headingId}
      aria-busy={actions.busy || more.busy || undefined}
      style={style}
    >
      <div className="surface-header">
        <h3 id={headingId} className="surface-heading">
          Commit graph
        </h3>
        <p role="status" className="surface-count">
          {summarise(graph.total, graph.problem !== null)}
        </p>
        {selectedRow !== undefined && (
          <CommitBranchMenu
            commit={selectedRow}
            actions={actions}
            currentBranch={currentBranch}
            more={more}
            refs={refs}
          />
        )}
      </div>
      <p role="status" className="visually-hidden">
        {actions.said}
      </p>
      <p role="status" className="visually-hidden">
        {more.said}
      </p>
      {onShowWorkingTree && (
        <button
          type="button"
          className="history-wip"
          aria-pressed={selected === null}
          onClick={onShowWorkingTree}
          style={{ paddingInlineStart: columnX(0, lane) - lane / 2 }}
        >
          <PencilLine aria-hidden="true" className="history-wip-icon" />
          <span>Working tree changes</span>
        </button>
      )}
      {graph.problem !== null && (
        <p role="alert" className="problem">
          {graph.problem}
        </p>
      )}
      {actions.problem !== null && (
        <p role="alert" className="problem problem-output">
          {actions.problem}
        </p>
      )}
      {more.problem !== null && (
        <p role="alert" className="problem problem-output">
          {more.problem}
        </p>
      )}
      {count > 0 && (
        <div
          role="grid"
          className="history-grid"
          aria-labelledby={headingId}
          aria-rowcount={count + 1}
          aria-colcount={6}
          onKeyDown={onKeyDown}
        >
          <div
            role="rowgroup"
            ref={viewportRef}
            className="history-viewport"
            // Drawn before the frame the scroll shows in is painted: React
            // would otherwise draw a scroll's rows and lanes a frame behind it,
            // which a fast scroll shows as blank rows, with the lanes out of
            // step with them.
            onScroll={(event) => {
              const { scrollTop: at } = event.currentTarget;
              flushSync(() => setScrollTop(at));
            }}
          >
            <div className="history-graph" aria-hidden="true">
              <GraphCanvas
                scene={scene}
                width={width}
                height={height}
                lane={lane}
                // Nothing is drawn until the viewport's size is known.
                measured={viewportSize.width > 0}
                pictures={pictures}
                onClick={onGraphClick}
                onContextMenu={onGraphMenu}
              />
            </div>
            <div className="history-rows" style={{ height: count * row }}>
              {[...drawn]
                .toSorted((a, b) => a - b)
                .map((index) => (
                  // Keyed by row, so a row read while it has focus keeps it.
                  <HistoryRow
                    key={index}
                    commit={rowAt(index)}
                    index={index}
                    top={index * row}
                    now={now}
                    selected={rowAt(index)?.id === selected}
                    tabbable={index === current}
                    onFocus={onRowFocus}
                    onMenu={onRowMenu}
                    element={rowElement}
                    stashes={stashNamesOf(stashNames, rowAt(index))}
                    fresh={fresh}
                    expanded={expanded !== null && rowAt(index)?.id === expanded}
                    onExpand={onExpand}
                    onOpenLabel={onOpenLabel}
                    pullRequests={pullRequestsOf(pullRequests, rowAt(index))}
                    onOpenPullRequest={onOpenPullRequest}
                  />
                ))}
              {expandedRow !== undefined && expandedIndex !== undefined && (
                // Read out with its row already, every Label is only shown here.
                <div
                  ref={expandedBox}
                  className="history-labels-all"
                  aria-hidden="true"
                  style={{ top: (expandedIndex + 1) * row }}
                >
                  {orderLabels(expandedRow.labels).map((label) => (
                    <Label
                      key={`${label.kind}:${label.name}`}
                      label={label}
                      fresh={label.name === fresh}
                      onOpen={onOpenLabel}
                      onMenu={(chosen, at) => {
                        setExpanded(null);
                        openMenu(expandedIndex, at, chosen);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
          {/* After the rows, so Tab reaches the rows first; drawn above them. */}
          <div role="rowgroup" className="history-header">
            <div role="row" aria-rowindex={1} className="history-header-row">
              <span role="columnheader" className="history-heading history-heading-graph">
                <span className="history-heading-name">{COLUMN_NAMES.graph}</span>
                {edge("graph")}
              </span>
              <span role="columnheader" className="history-heading history-heading-labels">
                <span className="history-heading-name">{COLUMN_NAMES.labels}</span>
                {edge("labels")}
              </span>
              <span role="columnheader" className="history-heading history-subject">
                <span className="history-heading-name">Subject</span>
              </span>
              {(["author", "date", "id"] as const).map((column) => (
                <span key={column} role="columnheader" className={`history-heading history-${column}`}>
                  {edge(column)}
                  <span className="history-heading-name">{COLUMN_NAMES[column]}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
      {contextMenu !== null && contextRow !== undefined && (
        <ContextMenu
          ariaLabel={
            contextMenu.label === undefined
              ? `Actions for commit ${contextRow.shortId}`
              : `Actions for ${contextMenu.label.name}`
          }
          items={
            contextMenu.label === undefined
              ? commitActions(contextRow, actions, currentBranch, more, refs)
              : labelActions(contextRow, contextMenu.label, actions, currentBranch, more, refs)
          }
          at={contextMenu.at}
          onClose={(returnFocus) => {
            const index = contextMenu.index;
            setContextMenu(null);
            if (returnFocus) rows.current.get(index)?.focus();
          }}
        />
      )}
      {actions.dialogs}
      {more.dialogs}
    </section>
  );
}

const NO_STASHES: readonly string[] = [];
const NO_PULL_REQUESTS: readonly PullRequest[] = [];
const NO_PULL_REQUESTS_BY_COMMIT: ReadonlyMap<string, readonly PullRequest[]> = new Map();

/** The open Pull Requests whose branch's tip is `commit`, the same list each time for a row with none. */
function pullRequestsOf(
  pulls: ReadonlyMap<string, readonly PullRequest[]>,
  commit: GraphRow | undefined,
): readonly PullRequest[] {
  return (commit && pulls.get(commit.id)) ?? NO_PULL_REQUESTS;
}

/** The names of the stashes made on `commit`, the same list each time for a row with none. */
function stashNamesOf(names: ReadonlyMap<string, string[]>, commit: GraphRow | undefined): readonly string[] {
  return (commit && names.get(commit.id)) ?? NO_STASHES;
}

interface CanvasProps {
  scene: Scene;
  width: number;
  height: number;
  lane: number;
  measured: boolean;
  /** Authors' pictures, by email, where they're shown; `loaded` changes as more load. */
  pictures: { of: (email: string) => CanvasImageSource | null; loaded: number } | null;
  onClick: (event: MouseEvent<HTMLCanvasElement>) => void;
  onContextMenu: (event: MouseEvent<HTMLCanvasElement>) => void;
}

/**
 * The canvas the graph is drawn on: as big as what shows, not the whole
 * history, and sharp on a high-density screen. It is drawn again when the
 * Theme changes, in the new Theme's colours.
 */
function GraphCanvas({ scene, width, height, lane, measured, pictures, onClick, onContextMenu }: CanvasProps) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const context = useRef<CanvasRenderingContext2D | null>(null);
  const [colours, setColours] = useState<GraphColours | null>(null);

  // The canvas, and its Theme's colours, read again whenever `data-theme` on the root changes.
  const canvasRef = useCallback((element: HTMLCanvasElement | null) => {
    canvas.current = element;
    if (!element) return;
    const readColours = () => setColours(coloursOf(element));
    readColours();
    const observer = new MutationObserver(readColours);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      observer.disconnect();
      canvas.current = null;
    };
  }, []);

  // Painted before the frame is, so the lanes move with the rows they're beside.
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element || !measured || !colours) return;
    context.current ??= element.getContext("2d");
    const painter = context.current;
    if (!painter) return;
    const density = window.devicePixelRatio || 1;
    // Sizing a canvas clears it and makes it anew, even at the same size, so only when it changes.
    const pixels = { width: Math.round(width * density), height: Math.round(height * density) };
    if (element.width !== pixels.width) element.width = pixels.width;
    if (element.height !== pixels.height) element.height = pixels.height;
    painter.setTransform(density, 0, 0, density, 0, 0);
    paint(painter, scene, colours, { width, height, lane, picture: pictures?.of });
  }, [scene, width, height, lane, measured, colours, pictures]);

  return (
    <canvas
      ref={canvasRef}
      className="history-canvas"
      style={{ width, height }}
      onClick={onClick}
      onContextMenu={onContextMenu}
    />
  );
}

/** The Theme's colours, as the canvas's own styles have them. */
function coloursOf(element: HTMLElement): GraphColours {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    lanes: Array.from({ length: LANE_COLOURS }, (_, n) => token(`--lane-${n}`)),
    surface: token("--surface"),
    text: token("--text"),
    focus: token("--focus"),
  };
}

interface RowProps {
  /** The row's commit, or `undefined` until its window is read. */
  commit: GraphRow | undefined;
  index: number;
  top: number;
  now: number;
  selected: boolean;
  tabbable: boolean;
  onFocus: (index: number) => void;
  /** Called with where a right click on the row was, to open its menu there, or its Label's, if it was on one. */
  onMenu: (index: number, at: { x: number; y: number }, label?: CommitLabel) => void;
  element: (index: number, element: HTMLDivElement | null) => void;
  /** The names of the stashes made on its commit. */
  stashes: readonly string[];
  /** A branch just made, whose Label is highlighted. */
  fresh: string | null;
  /** Whether every one of its Labels is shown, below it. */
  expanded: boolean;
  /** Called with its commit's ID as its "+N" is clicked, to show or hide every Label. */
  onExpand: (commit: string) => void;
  /** Called with a Label double-clicked, to check its branch out. */
  onOpenLabel: (label: CommitLabel) => void;
  /** The open Pull Requests whose branch's tip it is. */
  pullRequests: readonly PullRequest[];
  /** Called with one of them clicked, to open it in the browser. */
  onOpenPullRequest: (pull: PullRequest) => void;
}

const HistoryRow = memo(function HistoryRow({
  commit,
  index,
  top,
  now,
  selected,
  tabbable,
  onFocus,
  onMenu,
  element,
  stashes,
  fresh,
  expanded,
  onExpand,
  onOpenLabel,
  pullRequests,
  onOpenPullRequest,
}: RowProps) {
  const copy = useCopy();
  const row = {
    ref: (drawn: HTMLDivElement | null) => element(index, drawn),
    role: "row",
    className: "history-row",
    "aria-rowindex": index + 2,
    "aria-selected": selected,
    tabIndex: tabbable ? 0 : -1,
    style: { top },
    onFocus: () => onFocus(index),
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault();
      onMenu(index, { x: event.clientX, y: event.clientY });
    },
  };
  if (!commit) {
    return (
      <div {...row} aria-label="Reading…">
        <span role="gridcell" aria-colspan={6} className="history-reading">
          Reading…
        </span>
      </div>
    );
  }
  const when = relativeTime(commit.time, now);
  const place = describePlace(commit, index);
  // What a screen reader says as focus reaches the row: the cells, apart, subject first.
  const name = [
    commit.summary,
    ...(place ? [place] : []),
    ...commit.labels.map((label) => `${labelKinds[label.kind]} ${label.name}`),
    ...stashes.map((stash) => `stash “${stash}” made on it`),
    ...pullRequests.map((pull) => `Pull Request ${pullRequestName(pull)} “${pull.title}”`),
    commit.author,
    when,
    `commit ${commit.shortId}`,
  ].join(", ");
  return (
    <div {...row} aria-label={name}>
      <span role="gridcell" className="visually-hidden">
        {place}
      </span>
      <Labels
        labels={commit.labels}
        fresh={fresh}
        expanded={expanded}
        onExpand={() => onExpand(commit.id)}
        onOpen={onOpenLabel}
        onMenu={(label, at) => onMenu(index, at, label)}
        pullRequests={pullRequests}
        onOpenPullRequest={onOpenPullRequest}
      />
      <span role="gridcell" className="history-subject">
        <span className="history-summary">{commit.summary}</span>
      </span>
      <span role="gridcell" className="history-author">
        <Avatar name={commit.author} email={commit.email} />
        <span className="history-author-name">{commit.author}</span>
      </span>
      <span role="gridcell" className="history-date">
        <time dateTime={machineTime(commit.time)} title={absoluteTime(commit.time)}>
          {when}
        </time>
      </span>
      <span
        role="gridcell"
        className="history-id"
        title={copy === null ? commit.id : `${commit.id}: click to copy`}
        onClick={copy === null ? undefined : () => copy(commit.id, "commit ID")}
      >
        <code>{commit.shortId}</code>
      </span>
    </div>
  );
});

/** Which Label a row shows first: the checked-out branch, `HEAD`, a branch, a remote branch, then a tag. */
const LABEL_ORDER: LabelKind[] = ["currentBranch", "head", "branch", "remoteBranch", "tag"];

/** `labels` in the order {@link LABEL_ORDER} has them. */
function orderLabels(labels: readonly CommitLabel[]): CommitLabel[] {
  return labels.toSorted((a, b) => LABEL_ORDER.indexOf(a.kind) - LABEL_ORDER.indexOf(b.kind));
}

/**
 * A commit's Labels, in their column: the first, as {@link LABEL_ORDER} has
 * them, or a branch just made, and "+N" for the rest, as GitKraken shows
 * them, which shows them all as it's clicked. Every one is read out, and
 * named in the column's tooltip.
 */
function Labels({
  labels,
  fresh,
  expanded,
  onExpand,
  onOpen,
  onMenu,
  pullRequests,
  onOpenPullRequest,
}: {
  labels: readonly CommitLabel[];
  fresh: string | null;
  expanded: boolean;
  onExpand: () => void;
  onOpen: (label: CommitLabel) => void;
  onMenu: (label: CommitLabel, at: { x: number; y: number }) => void;
  pullRequests: readonly PullRequest[];
  onOpenPullRequest: (pull: PullRequest) => void;
}) {
  const ordered = orderLabels(labels);
  const first = ordered.find((label) => label.name === fresh) ?? ordered[0];
  const rest = ordered.filter((label) => label !== first);
  return (
    <span role="gridcell" className="history-labels" title={ordered.map((label) => label.name).join(", ") || undefined}>
      {first !== undefined && <Label label={first} fresh={first.name === fresh} onOpen={onOpen} onMenu={onMenu} />}
      {pullRequests.map((pull) => (
        // Read out with its row already; the Pull requests Widget opens it from the keyboard.
        <span
          key={pull.number}
          className="commit-label label-pull-request"
          aria-hidden="true"
          title={`Pull Request ${pullRequestName(pull)}: ${pull.title}. Click to open it`}
          onClick={(event) => {
            event.stopPropagation();
            onOpenPullRequest(pull);
          }}
        >
          <PullRequestIcon />
          {pullRequestName(pull)}
        </span>
      ))}
      {rest.length > 0 && (
        <>
          <span
            className="commit-label label-more"
            aria-hidden="true"
            data-expanded={expanded || undefined}
            title={`${expanded ? "Hide" : "Show"} all ${ordered.length} branches and tags (+)`}
            onClick={(event) => {
              event.stopPropagation();
              onExpand();
            }}
          >
            {expanded ? "−" : "+"}
            {rest.length}
          </span>
          <span className="visually-hidden">
            {rest.map((label) => `${labelKinds[label.kind]} ${label.name}`).join(", ")}
          </span>
        </>
      )}
    </span>
  );
}


/**
 * A Label as a chip, with what it names for screen readers: highlighted a
 * moment when `fresh`. A click copies its name, a double click on a
 * branch's checks it out, and a right click opens its own menu: its row's
 * Shift+F10 menu has the same actions, for the keyboard.
 */
function Label({
  label,
  fresh = false,
  onOpen,
  onMenu,
}: {
  label: CommitLabel;
  fresh?: boolean;
  onOpen: (label: CommitLabel) => void;
  onMenu: (label: CommitLabel, at: { x: number; y: number }) => void;
}) {
  // A detached HEAD's Label names no branch or tag to copy.
  const copying = useCopy();
  const copy: Copy | null = label.kind === "head" ? null : copying;
  const opens = label.kind === "branch" || label.kind === "remoteBranch";
  const hints = [...(copy === null ? [] : ["click to copy"]), ...(opens ? ["double-click to check out"] : [])];
  return (
    <span
      className={`commit-label label-${label.kind}${fresh ? " label-fresh" : ""}`}
      title={hints.length === 0 ? undefined : `${label.name}: ${hints.join("; ")}`}
      onClick={copy === null ? undefined : () => copy(label.name, label.kind === "tag" ? "tag name" : "branch name")}
      onDoubleClick={opens ? () => onOpen(label) : undefined}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onMenu(label, { x: event.clientX, y: event.clientY });
      }}
    >
      <span className="visually-hidden">{labelKinds[label.kind]} </span>
      {label.name}
    </span>
  );
}

function summarise(total: number | null, failed: boolean): string {
  if (failed && !total) return "";
  if (total === null) return "Reading the history…";
  if (total === 0) return "No commits yet.";
  return total === 1 ? "1 commit." : `${total} commits.`;
}
