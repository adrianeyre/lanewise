/**
 * The few preferences the UI keeps in local storage, such as the Theme.
 * Local storage can be missing or refused (a private window,
 * blocked site data), so every read and write here survives that, and the
 * UI works without it. Carried over from soundcheck.
 */
export type LocalStore = Pick<Storage, "getItem" | "setItem">;

export function localStore(): LocalStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readLocal(key: string, store = localStore()): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string, store = localStore()): void {
  try {
    store?.setItem(key, value);
  } catch {
    // Nowhere to keep it: it lasts for this run only.
  }
}

// Keys the UI keeps in local storage. The Cookie Policy lists every one (`legal/stored.ts`).

/** The Theme: `system`, `light` or `dark` (`settings/theme.ts`), which `index.html` reads before first paint. */
export const THEME_KEY = "lanewise.theme";

/** The palette: `default`, `ocean`, `forest`, `plum`, `ember`, `midnight` or `rose` (`settings/palette.ts`), which `index.html` reads before first paint. */
export const PALETTE_KEY = "lanewise.palette";

/** Whether authors' pictures come from GitHub for a repository there: `off` once turned off (`settings/avatarSetting.ts`). */
export const AVATARS_KEY = "lanewise.avatars";

/** Whether a Host's pages open in Tabs of Lanewise's own: `off` for the browser (ADR 0042). */
export const HOST_PAGES_KEY = "lanewise.hostPages";

/** Whether Jev is on, and which decisions it makes, as JSON (`ai/jevSettings.ts`). Never its API key. */
export const JEV_KEY = "lanewise.jev";

/** The base folder the folder dialogs open in, such as `C:\\projects`, set in Settings (`settings/repositorySettings.ts`). */
export const BASE_FOLDER_KEY = "lanewise.base-folder";

/** Whether a fetch starts as a repository's Tab is shown: `off` once turned off in Settings (`settings/repositorySettings.ts`). */
export const FETCH_ON_SHOW_KEY = "lanewise.fetch-on-show";

/** How wide the Repository page's left and right columns are, dragged or set from the keyboard, as JSON (`repository/columnWidths.ts`). */
export const COLUMN_WIDTHS_KEY = "lanewise.column-widths";

/** How wide the Commit graph's columns were made, by hand, as JSON: those not in it size to fit (`repository/historyColumns.ts`). */
export const HISTORY_COLUMNS_KEY = "lanewise.history-columns";

/** The Recent Repositories, most recent first (`welcome/recent.ts`). */
/** Which of the Repository page's left column's sections are open, as `{ name: open }`: its accordion. */
export const SIDEBAR_SECTIONS_KEY = "lanewise.sidebar-sections";

export const RECENT_REPOSITORIES_KEY = "lanewise.recent-repositories";

/** The repositories open in Tabs, and the one shown, to open again on the next launch (`tabs/tabs.ts`). */
export const OPEN_REPOSITORIES_KEY = "lanewise.open-repositories";

/** The GitHub Enterprise Server Hosts added in Settings, by name, as JSON (`hosts/enterpriseHosts.ts`). */
export const ENTERPRISE_HOSTS_KEY = "lanewise.github-enterprise-hosts";

/**
 * Whether AI is on, the Model Providers whose first-use disclosure was
 * accepted, the lines of context sent, and the Model Provider, model, version
 * and effort chosen, globally and per repository, as JSON (`ai/aiSettings.ts`).
 * Never an API key, which stays in the OS credential store.
 */
export const MODEL_PROVIDER_KEY = "lanewise.model-provider";

/**
 * How many lines a diff may have before the Diff Widget asks before showing
 * it. TODO: Settings changes it too (PRD §7.9, M1).
 */
export const DIFF_LIMIT_KEY = "lanewise.diff-limit";

/** How the Diff view shows a diff: `split`, its two sides next to each other, or `unified` (`diff/view.ts`). */
export const DIFF_VIEW_KEY = "lanewise.diff-view";

/**
 * Whether the Desktop App checks for an Update each time it starts (`updates/useUpdates.ts`):
 * `false` when turned off in Settings, and on otherwise.
 */
export const UPDATE_CHECK_KEY = "lanewise.updates.check-at-start";
