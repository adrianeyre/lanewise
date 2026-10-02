import {
  BASE_FOLDER_KEY,
  COLUMN_WIDTHS_KEY,
  SIDEBAR_SECTIONS_KEY,
  HISTORY_COLUMNS_KEY,
  DIFF_LIMIT_KEY,
  FETCH_ON_SHOW_KEY,
  AVATARS_KEY,
  HOST_PAGES_KEY,
  DIFF_VIEW_KEY,
  PALETTE_KEY,
  ENTERPRISE_HOSTS_KEY,
  JEV_KEY,
  MODEL_PROVIDER_KEY,
  OPEN_REPOSITORIES_KEY,
  RECENT_REPOSITORIES_KEY,
  THEME_KEY,
  UPDATE_CHECK_KEY,
} from "../settings/localSettings";

export interface StoredItem {
  /** Its key in local storage. */
  name: string;
  purpose: string;
}

// TODO(#50): Web Mode's access token, if the browser ever keeps it (PRD §7.12, P1).
/**
 * Everything Lanewise may keep in local storage, and why: the Cookie Policy's
 * table. A test holds it to what the app really writes.
 */
export const STORED_ITEMS: readonly StoredItem[] = [
  {
    name: THEME_KEY,
    purpose: "Remembers your colour theme: light, dark or matching your system.",
  },
  {
    name: PALETTE_KEY,
    purpose: "Remembers the palette you chose for Lanewise's colours and backgrounds.",
  },
  {
    name: AVATARS_KEY,
    purpose: "Remembers whether you turned off authors' pictures from GitHub.",
  },
  {
    name: HOST_PAGES_KEY,
    purpose: "Remembers whether you chose to open GitHub, GitLab, Bitbucket and Azure DevOps pages in your browser, not in Tabs in Lanewise.",
  },
  {
    name: BASE_FOLDER_KEY,
    purpose:
      "Remembers the folder on this machine you keep your repositories in, if you set one in Settings, so opening and cloning start there.",
  },
  {
    name: FETCH_ON_SHOW_KEY,
    purpose: "Remembers whether Lanewise fetches as you switch to a repository's tab or come back to it, if you turned that off.",
  },
  {
    name: SIDEBAR_SECTIONS_KEY,
    purpose: "Remembers which of the repository page's Local branches, Remotes, Tags, Pull requests, Stashes and Issues you closed or opened.",
  },
  {
    name: COLUMN_WIDTHS_KEY,
    purpose: "Remembers how wide you made the repository page's left and right columns.",
  },
  {
    name: HISTORY_COLUMNS_KEY,
    purpose: "Remembers how wide you made the Commit graph's columns, for those you didn't leave to size to fit.",
  },
  {
    name: RECENT_REPOSITORIES_KEY,
    purpose: "Remembers the repositories you opened recently, by their folders on this machine, so you can open them again.",
  },
  {
    name: OPEN_REPOSITORIES_KEY,
    purpose:
      "Remembers the repositories you have open in tabs, by their folders on this machine, and which one you were looking at, so they open again the next time you start Lanewise.",
  },
  {
    name: ENTERPRISE_HOSTS_KEY,
    purpose:
      "Remembers the addresses of the GitHub Enterprise Servers you added in Settings, so Lanewise can sign you in to them. Never your password or token, which stay with Git's credential helper.",
  },
  {
    name: DIFF_LIMIT_KEY,
    purpose: "Remembers how many lines a diff may have before Lanewise asks you before showing it.",
  },
  {
    name: DIFF_VIEW_KEY,
    purpose: "Remembers whether a diff shows its two sides next to each other or in one column.",
  },
  {
    name: MODEL_PROVIDER_KEY,
    purpose:
      "Remembers whether AI is on, which Model Providers you agreed to send Conflict Hunks to, how many lines of context go with them, and your choice of Model Provider, model, version and effort, for every repository and for any you set apart. Never your API keys.",
  },
  {
    name: JEV_KEY,
    purpose: "Remembers whether Jev is on, and which of its decisions you want. Never your TypeSafe API key.",
  },
  {
    name: UPDATE_CHECK_KEY,
    purpose: "Remembers whether the Desktop App checks for an Update each time it starts, if you turned that off.",
  },
];
