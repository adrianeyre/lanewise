import { expect, test } from "vitest";

import { tabName } from "./RepositoryTabs";
import {
  activateTab,
  activeTab,
  closeTab,
  moveTab,
  NO_TABS,
  openHostPageTab,
  openRepositoryTab,
  openWelcomeTab,
  parseSavedTabs,
  restoredTabs,
  savedTabs,
  serialiseSavedTabs,
  type Tabs,
  updateHostPageTab,
  updateRepositoryTab,
} from "./tabs";

const lanewise = { root: "/work/lanewise", name: "lanewise" };
const soundcheck = { root: "/work/soundcheck", name: "soundcheck" };
const git = { root: "/src/git", name: "git" };

/** What each Tab shows, in order, with the shown one starred. */
function drawn(state: Tabs): string[] {
  return state.tabs.map((tab) => {
    const name = tabName(tab);
    return tab.key === state.active ? `*${name}` : name;
  });
}

function opened(...repositories: { root: string; name: string }[]): Tabs {
  return repositories.reduce(openRepositoryTab, NO_TABS);
}

test("each repository opens in a new Tab at the end, which is shown", () => {
  expect(drawn(opened(lanewise))).toEqual(["*lanewise"]);
  expect(drawn(opened(lanewise, soundcheck, git))).toEqual(["lanewise", "soundcheck", "*git"]);
});

test("opening a repository that is already open switches to its Tab, and reads it afresh", () => {
  const state = opened(lanewise, soundcheck);
  const selected = updateRepositoryTab(state, state.tabs[0]!.key, () => ({ selectedCommit: "abc" }));

  const again = openRepositoryTab(selected, { ...lanewise });

  expect(drawn(again)).toEqual(["*lanewise", "soundcheck"]);
  const tab = activeTab(again);
  expect(tab?.kind === "repository" && tab.opening).toBe(2);
  // What it had chosen is kept.
  expect(tab?.kind === "repository" && tab.selectedCommit).toBe("abc");
});

test("the Welcome screen has at most one Tab, which a repository opened from it replaces", () => {
  const state = openWelcomeTab(opened(lanewise, soundcheck));
  expect(drawn(state)).toEqual(["lanewise", "soundcheck", "*Welcome"]);
  expect(drawn(openWelcomeTab(activateTab(state, state.tabs[0]!.key)))).toEqual([
    "lanewise",
    "soundcheck",
    "*Welcome",
  ]);

  const moved = moveTab(state, state.tabs[2]!.key, 0);
  expect(drawn(openRepositoryTab(moved, git))).toEqual(["*git", "lanewise", "soundcheck"]);
  // Not while another Tab is shown.
  expect(drawn(openRepositoryTab(activateTab(state, state.tabs[1]!.key), git))).toEqual([
    "lanewise",
    "soundcheck",
    "Welcome",
    "*git",
  ]);
});

test("closing the Tab shown shows the one after it, or before it if it was last", () => {
  const state = activateTab(opened(lanewise, soundcheck, git), 1);

  const middle = closeTab(state, 1);
  expect(drawn(middle)).toEqual(["lanewise", "*git"]);
  const last = closeTab(middle, 2);
  expect(drawn(last)).toEqual(["*lanewise"]);
  const none = closeTab(last, 0);
  expect(none.tabs).toEqual([]);
  expect(none.active).toBeNull();
});

test("closing a Tab that isn't shown leaves the shown one alone", () => {
  const state = opened(lanewise, soundcheck, git);

  expect(drawn(closeTab(state, 0))).toEqual(["soundcheck", "*git"]);
  expect(closeTab(state, 99)).toBe(state);
});

test("a Tab moves to any place among the Tabs, and no further", () => {
  const state = opened(lanewise, soundcheck, git);

  expect(drawn(moveTab(state, 2, 0))).toEqual(["*git", "lanewise", "soundcheck"]);
  expect(drawn(moveTab(state, 0, 1))).toEqual(["soundcheck", "lanewise", "*git"]);
  expect(drawn(moveTab(state, 0, 10))).toEqual(["soundcheck", "*git", "lanewise"]);
  expect(moveTab(state, 0, -1)).toBe(state);
});

test("the repositories' Tabs are saved in order, with the one shown, but not the Welcome screen's", () => {
  const state = openWelcomeTab(opened(lanewise, soundcheck));

  expect(savedTabs(state)).toEqual({ repositories: ["/work/lanewise", "/work/soundcheck"], active: null });
  expect(savedTabs(activateTab(state, 1))).toEqual({
    repositories: ["/work/lanewise", "/work/soundcheck"],
    active: "/work/soundcheck",
  });
});

test("saved Tabs read back as they were, and anything broken reads as none", () => {
  const saved = { repositories: ["/work/lanewise", "/work/soundcheck"], active: "/work/soundcheck" };

  expect(parseSavedTabs(serialiseSavedTabs(saved))).toEqual(saved);
  const none = { repositories: [], active: null };
  expect(parseSavedTabs(null)).toEqual(none);
  expect(parseSavedTabs("{")).toEqual(none);
  expect(parseSavedTabs("[]")).toEqual(none);
  expect(parseSavedTabs('{"repositories":"/work"}')).toEqual(none);
  expect(
    parseSavedTabs('{"repositories":["/a", 3, "", "/a", "/b"],"active":"/elsewhere"}'),
  ).toEqual({ repositories: ["/a", "/b"], active: null });
});

test("restored Tabs show the one that was shown, or the first if it didn't reopen", () => {
  expect(drawn(restoredTabs([lanewise, soundcheck, git], "/work/soundcheck"))).toEqual([
    "lanewise",
    "*soundcheck",
    "git",
  ]);
  expect(drawn(restoredTabs([lanewise, git], "/work/soundcheck"))).toEqual(["*lanewise", "git"]);
  expect(drawn(restoredTabs([lanewise, { ...lanewise }], null))).toEqual(["*lanewise"]);
  expect(restoredTabs([], "/work/lanewise")).toEqual(NO_TABS);
});

test("a Host page opens in a new Tab after the one shown, takes its title, and isn't kept for the next launch", () => {
  const two = openRepositoryTab(openRepositoryTab(NO_TABS, lanewise), soundcheck);
  const first = activateTab(two, two.tabs[0]!.key);
  const withPage = openHostPageTab(first, "https://github.com/adrianeyre/lanewise");
  expect(drawn(withPage)).toEqual(["lanewise", "*github.com", "soundcheck"]);
  const page = withPage.tabs[1]!;
  const titled = updateHostPageTab(withPage, page.key, { title: "adrianeyre/lanewise", loading: false });
  expect(drawn(titled)).toEqual(["lanewise", "*adrianeyre/lanewise", "soundcheck"]);
  // Only a Host page's Tab takes a Host page's change.
  expect(updateHostPageTab(titled, titled.tabs[0]!.key, { title: "nope" })).toBe(titled);
  expect(savedTabs(titled)).toEqual({ repositories: ["/work/lanewise", "/work/soundcheck"], active: null });
});
