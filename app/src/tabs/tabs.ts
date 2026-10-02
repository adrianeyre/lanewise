import type { OpenedRepository, Path } from "../commands/api";
import type { DiffSubject } from "../diff/DiffWidget";

/**
 * The window's Tabs (PRD §7.1): one per open repository, each with its own
 * Repository page, or Conflicts page in its place, at most one for the
 * Welcome screen, and one for each Host page opened (ADR 0042), which isn't
 * kept for the next launch. Pure functions
 * over {@link Tabs}, tested without a browser; `RepositoryTabs` draws them.
 */

/** The Welcome screen in a Tab of its own, for opening another repository. */
export interface WelcomeTab {
  kind: "welcome";
  /** Names the Tab while it's open, wherever it moves. */
  key: number;
}

/** An open repository, and what its Repository page had chosen, kept while another Tab is shown. */
export interface RepositoryTab {
  kind: "repository";
  key: number;
  repository: OpenedRepository;
  /** Counts opens, so opening the repository again reads it afresh. */
  opening: number;
  /** The commit selected in the Commit graph, shown in Commit details. */
  selectedCommit: string | null;
  /**
   * The file whose diff the Diff Widget shows: one chosen in Commit details,
   * for the commit it was chosen in, one chosen in the Stashes Widget, for
   * the stash it was chosen in, or a change chosen in the Working tree.
   */
  chosenFile: DiffSubject | null;
  /** The stash selected in the Stashes Widget, by its `id`, whose files it lists. */
  selectedStash: string | null;
  /** Which page the Tab shows. */
  page: TabPage;
}

/**
 * A Host page, such as a repository or a Pull Request on GitHub, shown in a
 * Tab of Lanewise's own (ADR 0042). Its `key` numbers its Host page too.
 */
export interface HostPageTab {
  kind: "hostPage";
  key: number;
  /** Where it was opened at, and then where it has gone. */
  url: string;
  /** Its page's title, once it has one. */
  title: string | null;
  /** Whether it's loading a page. */
  loading: boolean;
}

/** The page a Tab shows: the Repository page, or the Conflicts page in its place while an In-Progress Operation is. */
export type TabPage = { name: "repository" } | { name: "conflicts" };

export type Tab = WelcomeTab | RepositoryTab | HostPageTab;

export interface Tabs {
  /** In the order they're drawn. */
  tabs: readonly Tab[];
  /** The key of the Tab shown, or `null` with none open. */
  active: number | null;
  /** The key the next Tab opened gets. */
  next: number;
}

export const NO_TABS: Tabs = { tabs: [], active: null, next: 0 };

export function activeTab({ tabs, active }: Tabs): Tab | null {
  return tabs.find((tab) => tab.key === active) ?? null;
}

/** The Tab `repository` is open in, if it is. */
export function tabOf({ tabs }: Tabs, root: Path): RepositoryTab | null {
  return (
    tabs.find((tab): tab is RepositoryTab => tab.kind === "repository" && tab.repository.root === root) ??
    null
  );
}

/**
 * `repository`, shown. One already open is switched to, and read afresh.
 * Otherwise it takes the place of the Welcome screen's Tab, if that is the
 * one shown, or opens in a new Tab at the end.
 */
export function openRepositoryTab(state: Tabs, repository: OpenedRepository): Tabs {
  const open = tabOf(state, repository.root);
  if (open !== null) {
    return {
      ...updateRepositoryTab(state, open.key, (tab) => ({ opening: tab.opening + 1 })),
      active: open.key,
    };
  }
  const tab: RepositoryTab = {
    kind: "repository",
    key: state.next,
    repository,
    opening: 1,
    selectedCommit: null,
    chosenFile: null,
    selectedStash: null,
    page: { name: "repository" },
  };
  const shown = activeTab(state);
  const tabs =
    shown?.kind === "welcome"
      ? state.tabs.map((each) => (each === shown ? tab : each))
      : [...state.tabs, tab];
  return { tabs, active: tab.key, next: state.next + 1 };
}

/** The Welcome screen's Tab, shown: the one already open, or a new one at the end. */
export function openWelcomeTab(state: Tabs): Tabs {
  const open = state.tabs.find((tab) => tab.kind === "welcome");
  if (open !== undefined) return { ...state, active: open.key };
  const tab: WelcomeTab = { kind: "welcome", key: state.next };
  return { tabs: [...state.tabs, tab], active: tab.key, next: state.next + 1 };
}

/** A Host page at `url`, shown, in a new Tab after the one shown. */
export function openHostPageTab(state: Tabs, url: string): Tabs {
  const tab: HostPageTab = { kind: "hostPage", key: state.next, url, title: null, loading: true };
  const at = state.tabs.findIndex((each) => each.key === state.active);
  const tabs = [...state.tabs];
  tabs.splice(at === -1 ? tabs.length : at + 1, 0, tab);
  return { tabs, active: tab.key, next: state.next + 1 };
}

/** The Host page Tab keyed `key`, changed by `change`. */
export function updateHostPageTab(
  state: Tabs,
  key: number,
  change: Partial<Omit<HostPageTab, "kind" | "key">>,
): Tabs {
  if (!state.tabs.some((tab) => tab.key === key && tab.kind === "hostPage")) return state;
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.key === key && tab.kind === "hostPage" ? { ...tab, ...change } : tab)),
  };
}

export function activateTab(state: Tabs, key: number): Tabs {
  return state.tabs.some((tab) => tab.key === key) ? { ...state, active: key } : state;
}

/**
 * The Tabs without the one keyed `key`. Closing the Tab shown shows the one
 * after it, or the one before it if it was the last.
 */
export function closeTab(state: Tabs, key: number): Tabs {
  const index = state.tabs.findIndex((tab) => tab.key === key);
  if (index === -1) return state;
  const tabs = state.tabs.filter((tab) => tab.key !== key);
  if (state.active !== key) return { ...state, tabs };
  const shown = tabs[Math.min(index, tabs.length - 1)];
  return { ...state, tabs, active: shown?.key ?? null };
}

/** The Tab keyed `key` moved to `index`, kept within the Tabs. The Tab shown stays shown. */
export function moveTab(state: Tabs, key: number, index: number): Tabs {
  const from = state.tabs.findIndex((tab) => tab.key === key);
  if (from === -1) return state;
  const to = Math.max(0, Math.min(index, state.tabs.length - 1));
  if (to === from) return state;
  const tabs = [...state.tabs];
  const [tab] = tabs.splice(from, 1);
  tabs.splice(to, 0, tab!);
  return { ...state, tabs };
}

/** The repository Tab keyed `key`, changed by `change`. */
export function updateRepositoryTab(
  state: Tabs,
  key: number,
  change: (tab: RepositoryTab) => Partial<Omit<RepositoryTab, "kind" | "key">>,
): Tabs {
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.key === key && tab.kind === "repository" ? { ...tab, ...change(tab) } : tab,
    ),
  };
}

/**
 * The Tabs as they're kept in local storage under `OPEN_REPOSITORIES_KEY`, to
 * open again on the next launch: each repository's root, in order, and the
 * one shown. The Welcome screen's Tab isn't kept.
 */
export interface SavedTabs {
  repositories: Path[];
  /** The root of the repository shown, or `null` if the Welcome screen was. */
  active: Path | null;
}

export function savedTabs(state: Tabs): SavedTabs {
  const repositories = state.tabs.flatMap((tab) =>
    tab.kind === "repository" ? [tab.repository.root] : [],
  );
  const shown = activeTab(state);
  return { repositories, active: shown?.kind === "repository" ? shown.repository.root : null };
}

export function serialiseSavedTabs(saved: SavedTabs): string {
  return JSON.stringify(saved);
}

/** The Tabs kept as `text`: what can be read of them, since it may be broken or from another version. */
export function parseSavedTabs(text: string | null): SavedTabs {
  const none: SavedTabs = { repositories: [], active: null };
  if (text === null) return none;
  let stored: unknown;
  try {
    stored = JSON.parse(text);
  } catch {
    return none;
  }
  if (typeof stored !== "object" || stored === null) return none;
  const { repositories, active } = stored as Record<string, unknown>;
  if (!Array.isArray(repositories)) return none;
  const roots = [
    ...new Set(
      (repositories as unknown[]).filter(
        (root): root is string => typeof root === "string" && root !== "",
      ),
    ),
  ];
  return {
    repositories: roots,
    active: typeof active === "string" && roots.includes(active) ? active : null,
  };
}

/**
 * Tabs for the repositories reopened on launch, in order, showing the one at
 * `active`, or the first if that one didn't reopen. Two folders that turn
 * out to be the same repository share a Tab.
 */
export function restoredTabs(repositories: readonly OpenedRepository[], active: Path | null): Tabs {
  const state = repositories.reduce(
    (tabs, repository) =>
      tabOf(tabs, repository.root) === null ? openRepositoryTab(tabs, repository) : tabs,
    NO_TABS,
  );
  const shown = (active === null ? null : tabOf(state, active)) ?? state.tabs[0] ?? null;
  return { ...state, active: shown?.key ?? null };
}
