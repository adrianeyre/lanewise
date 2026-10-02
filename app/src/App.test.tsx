// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, expect, test } from "vitest";

import { App } from "./App";
import type { Cursor, FileStatusEntry, InProgressOperation, LayoutToken, OpenedRepository, Outcome, Stash } from "./commands/api";
import { CommandRejectedError } from "./commands/reply";
import { STORED_ITEMS } from "./legal/stored";
import { unavailablePlatform } from "./platform/unavailable";
import { RECENT_REPOSITORIES_KEY } from "./settings/localSettings";
import { chooseFromMenu, openFromFileMenu } from "./test/appMenu";
import { expectNoAxeViolations } from "./test/axe";
import {
  detailsOf,
  listedBranches,
  diffsOf,
  fakePlatform,
  graphRow,
  graphWindows,
  historyCommit,
  pagedChanges,
  pagedStatus,
  textDiff,
} from "./test/fakePlatform";

// The Diff Widget's editor and the Conflicts page load when first shown. Loading them once here keeps
// each test about what it draws, not how long Vitest takes to transform CodeMirror.
beforeAll(async () => {
  await Promise.all([import("./diff/DiffEditor"), import("./conflicts/ConflictsPage")]);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const lanewise = { root: "/work/lanewise", name: "lanewise" };

const opens = (repository: OpenedRepository = lanewise) => (): Outcome<"openRepository"> => ({
  ok: true,
  value: repository,
});

const changed: FileStatusEntry[] = [
  { path: "src/merge.rs", change: { kind: "conflicted" }, staged: false },
  { path: "src/new.rs", change: { kind: "added" }, staged: true },
  { path: "src/lanes.rs", change: { kind: "renamed", from: "src/graph.rs" }, staged: true },
  { path: "README.md", change: { kind: "modified" }, staged: false },
  { path: "old.txt", change: { kind: "deleted" }, staged: false },
  { path: "notes.md", change: { kind: "untracked" }, staged: false },
];

function modified(path: string): FileStatusEntry {
  return { path, change: { kind: "modified" }, staged: false };
}

/** Each Tab's name, in order. */
function tabNames(): (string | null)[] {
  return screen.getAllByRole("tab").map((tab) => tab.querySelector(".tab-name")!.textContent);
}

/** Keeps `recent` as the Recent Repositories, as a launch before would have. */
function keepRecent(recent: { root: string; name: string }[]) {
  localStorage.setItem(RECENT_REPOSITORIES_KEY, JSON.stringify(recent));
}

/**
 * The Working tree Widget's status line, apart from the other Widgets', once
 * it has read the status, which waits for the Commit graph's first window.
 */
async function changesStatus(): Promise<HTMLElement> {
  const changes = await screen.findByRole("group", { name: "Changes" });
  const status = await within(changes).findByRole("status");
  await waitFor(() => expect(status.textContent).not.toMatch(/^$|^Reading/));
  return status;
}

/** Each change listed in `section`, as it reads apart from its Stage or Unstage button. */
function entriesIn(section: string): string[] {
  const region = screen.getByRole("region", { name: section });
  return within(region)
    .getAllByRole("listitem")
    .map((item) => item.querySelector(".file-status-entry")?.textContent ?? "");
}

test("the app names itself in its main landmark", () => {
  render(<App platform={fakePlatform({}).platform} />);

  const main = screen.getByRole("main");
  expect(main).toContainElement(screen.getByRole("heading", { level: 1, name: "Lanewise" }));
});

test("before a repository is open, the app offers to open one", async () => {
  const { container } = render(<App platform={fakePlatform({}).platform} />);

  expect(await screen.findByRole("button", { name: "Open repository" })).toBeVisible();
  expect(screen.getByText("Open a repository to see its changes.")).toBeVisible();
  await expectNoAxeViolations(container);
});

test("opening a repository from the keyboard lists its changes, by section", async () => {
  const user = userEvent.setup();
  const fake = fakePlatform({
    folders: ["/work/lanewise/src"],
    commands: { openRepository: opens(), fileStatus: pagedStatus(changed) },
  });
  const { container } = render(<App platform={fake.platform} />);

  await screen.findByRole("button", { name: "Open repository" });
  // Past the title bar's menu and Settings, and the Welcome screen's Tab, New tab and Tab actions, to its Open repository.
  await user.tab();
  expect(screen.getByRole("button", { name: "Menu" })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("button", { name: "Settings" })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("tab", { name: "Welcome" })).toHaveFocus();
  await user.tab();
  await user.tab();
  await user.tab();
  expect(screen.getByRole("button", { name: "Open repository" })).toHaveFocus();
  await user.keyboard("{Enter}");

  expect(await screen.findByRole("heading", { level: 2, name: "lanewise" })).toBeVisible();
  expect(within(screen.getByRole("tabpanel", { name: "lanewise" })).getByText("/work/lanewise")).toBeVisible();
  expect(await changesStatus()).toHaveTextContent("6 changes.");
  expect(fake.dialogs).toEqual(["Open repository"]);
  await waitFor(() => expect(fake.calls.map(({ name }) => name)).toContain("startFetch"));
  expect(fake.calls).toEqual([
    { name: "checkGitSetup", request: {} },
    { name: "openRepository", request: { path: "/work/lanewise/src" } },
    // The Commit graph's first window first, and whether an In-Progress Operation is, for the
    // Conflicts page to be shown in this one's place.
    { name: "graphWindow", request: { repository: "/work/lanewise", layout: null, start: 0 } },
    { name: "operationInProgress", request: { repository: "/work/lanewise" } },
    // Once the Commit graph has its first window, the Widgets beside it read theirs (ADR 0043).
    // For the Toolbar and the Branches Widget both, the current branch and its Upstream, read once.
    { name: "branches", request: { repository: "/work/lanewise" } },
    // Read while the Stashes Widget is empty too, for it to be drawn once there are some.
    { name: "stashes", request: { repository: "/work/lanewise" } },
    // Which Issue Trackers are signed in to, for the Issues Widget.
    { name: "issueTrackerAccount", request: { tracker: "jira" } },
    { name: "issueTrackerAccount", request: { tracker: "trello" } },
    { name: "fileStatus", request: { repository: "/work/lanewise", page: { cursor: null } } },
    // The working tree is watched from the first, and again after each answer.
    { name: "workingTreeChanges", request: { repository: "/work/lanewise", seen: null } },
    // The open Pull Requests, for their Widget and the Commit graph, with only a credential kept.
    { name: "pullRequests", request: { repository: "/work/lanewise", enterpriseHosts: [], interactive: false } },
    // For the Toolbar, a fetch, pull or push running still, and with none, a fetch starts as the
    // Tab is shown: this repository has no remotes.
    { name: "remoteOperation", request: { repository: "/work/lanewise" } },
    { name: "startFetch", request: { repository: "/work/lanewise" } },
    { name: "workingTreeChanges", request: { repository: "/work/lanewise", seen: 1 } },
  ]);

  expect(entriesIn("Conflicted")).toEqual(["src/merge.rs Conflicted"]);
  expect(entriesIn("Staged")).toEqual([
    "src/new.rs Added",
    "src/lanes.rs Renamed from src/graph.rs",
  ]);
  expect(entriesIn("Unstaged")).toEqual([
    "README.md Modified",
    "old.txt Deleted",
    "notes.md Untracked",
  ]);
  // Each change but a conflict stages or unstages on its own, and each section at once.
  const changes = screen.getByRole("group", { name: "Changes" });
  expect(
    within(changes)
      .getAllByRole("button", { name: /^(Stage|Unstage)/ })
      .map((button) => button.getAttribute("aria-label") ?? button.textContent),
  ).toEqual([
    "Unstage all",
    "Unstage src/new.rs",
    "Unstage src/lanes.rs",
    "Stage all",
    "Stage README.md",
    "Stage old.txt",
    "Stage notes.md",
  ]);
  await expectNoAxeViolations(container);
});

test("an open repository's page is laid out as GitKraken's is: branches and stashes at the left, the Commit graph in the middle, the Working tree at the right", async () => {
  const fake = fakePlatform({
    folders: ["/work/lanewise"],
    commands: { openRepository: opens(), fileStatus: pagedStatus(changed) },
  });
  const { container } = render(<App platform={fake.platform} />);
  await userEvent.click(await screen.findByRole("button", { name: "Open repository" }));
  expect(await changesStatus()).toHaveTextContent("6 changes.");

  const sidebar = screen.getByRole("complementary", { name: "Branches, remotes, Pull Requests, stashes and Issues" });
  expect(within(sidebar).getByRole("heading", { level: 3, name: "Branches & remotes" })).toBeVisible();
  // Stashes stays, even with none.
  expect(within(sidebar).getByRole("heading", { level: 3, name: "Stashes" })).toBeVisible();
  expect(within(sidebar).getByText("No stashes.")).toBeVisible();
  expect(screen.getByRole("heading", { level: 3, name: "Commit graph" })).toBeVisible();
  expect(screen.getByRole("heading", { level: 3, name: "Working tree" })).toBeVisible();
  // Commit details takes the Working tree's place once a commit is selected, and Diff the Commit graph's once a file is chosen.
  expect(screen.queryByRole("heading", { level: 3, name: "Commit details" })).toBeNull();
  expect(screen.queryByRole("heading", { level: 3, name: "Diff" })).toBeNull();
  // Nothing is dragged or pinned: there is no Grid.
  expect(screen.queryByRole("button", { name: /^(Move|Pin|Hide) / })).toBeNull();
  await expectNoAxeViolations(container);
});

test("the title bar has the app's menu at the left, whose File menu opens, clones and closes, and the name in the middle", async () => {
  const user = userEvent.setup();
  keepRecent([{ root: "/work/lanewise", name: "lanewise" }]);
  const fake = fakePlatform({
    folders: ["/work/lanewise"],
    commands: { openRepository: opens(), fileStatus: pagedStatus([]) },
  });
  const { container } = render(<App platform={fake.platform} />);
  const header = screen.getByRole("banner");
  expect(within(header).getByRole("heading", { level: 1, name: "Lanewise" })).toBeVisible();
  await screen.findByRole("button", { name: "Open repository" });

  const menu = within(header).getByRole("button", { name: "Menu" });
  menu.focus();
  await user.keyboard("{Enter}");
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "File",
    "Help",
    "Privacy Policy",
    "Terms and Conditions",
    "Cookie Policy",
    "Accessibility",
    "Credits",
    "Version: 1.0.0",
  ]);
  // The version is only said: choosing it does nothing.
  expect(screen.getByRole("menuitem", { name: "Version: 1.0.0" })).toHaveAttribute("aria-disabled", "true");
  // Credits, Cookie Policy and Accessibility open the footer's own dialogs.
  await user.click(screen.getByRole("menuitem", { name: "Credits" }));
  expect(await screen.findByRole("dialog", { name: "Credits" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Close credits" }));
  menu.focus();
  await user.keyboard("{Enter}");
  // The right arrow opens File, to the right, on its first item.
  await user.keyboard("{ArrowRight}");
  const file = screen.getByRole("menu", { name: "File" });
  // Each with its shortcut, as the OS's own menus show them.
  expect(within(file).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "Open repository…Ctrl+O",
    "Clone repository…Ctrl+Shift+O",
    "Open recent",
    "New tabCtrl+T",
    "Settings…Ctrl+,",
  ]);
  expect(within(file).getByRole("menuitem", { name: "Open repository…" })).toHaveAttribute(
    "aria-keyshortcuts",
    "Control+O",
  );
  expect(within(file).getByRole("menuitem", { name: "Open repository…" })).toHaveFocus();
  await expectNoAxeViolations(container);
  // The left arrow closes it, back to File.
  await user.keyboard("{ArrowLeft}");
  expect(screen.queryByRole("menu", { name: "File" })).toBeNull();
  expect(screen.getByRole("menuitem", { name: "File" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(menu).toHaveFocus();

  await openFromFileMenu(user);
  expect(await screen.findByRole("heading", { level: 2, name: "lanewise" })).toBeVisible();
  expect(fake.dialogs).toEqual(["Open repository"]);

  // With a repository open, File closes its Tab.
  await chooseFromMenu(user, ["File", "Close “lanewise”"]);
  expect(await screen.findByRole("button", { name: "Open repository" })).toHaveFocus();

  // Clone repository… puts focus in the Welcome screen's Clone.
  await chooseFromMenu(user, ["File", "Clone repository…"]);
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Repository URL" })).toHaveFocus());

  // Settings… opens Settings.
  await chooseFromMenu(user, ["File", "Settings…"]);
  expect(await screen.findByRole("dialog", { name: "Settings" })).toBeVisible();
});

// Two repositories opened in Tabs and axe over the whole App: about 3s on its
// own, so with the rest of the suite beside it, it's given longer than
// Vitest's 5s default.
test("selecting a commit in the Commit graph shows it in Commit details, kept for its Tab", { timeout: 20_000 }, async () => {
  const user = userEvent.setup();
  const commits = [0, 1, 2].map((n) => graphRow(n));
  const third = historyCommit(2);
  const other = { root: "/work/other", name: "other" };
  const fake = fakePlatform({
    folders: ["/work/lanewise", "/work/other"],
    commands: {
      openRepository: ({ path }) => ({ ok: true, value: path === other.root ? other : lanewise }),
      fileStatus: pagedStatus([]),
      graphWindow: graphWindows(commits),
      commitDetails: detailsOf(3),
      commitChanges: pagedChanges([{ path: "README.md", change: { kind: "modified" } }]),
    },
  });
  const { container } = render(<App platform={fake.platform} />);
  const open = await screen.findByRole("button", { name: "Open repository" });
  await user.click(open);

  const history = await screen.findByRole("grid", { name: "Commit graph" });
  expect(screen.queryByRole("heading", { level: 3, name: "Commit details" })).toBeNull();

  // By keyboard: into the history, and down to the second commit.
  within(history).getByRole("row", { name: /^Commit 0, / }).focus();
  await user.keyboard("{ArrowDown}");
  const details = await screen.findByRole("region", { name: "Commit details" });
  expect(await within(details).findByText("Commit 1")).toBeVisible();
  expect(within(details).getByText(third.shortId)).toBeVisible();
  expect(await within(details).findByText("1 file changed.")).toBeVisible();
  await expectNoAxeViolations(container);

  // By mouse.
  await user.click(within(history).getByText("Commit 2"));
  expect(await within(details).findByText("None: this is a first commit.")).toBeVisible();
  // The Working tree is out of the way, until its row above the history is chosen again.
  expect(screen.queryByRole("heading", { level: 3, name: "Working tree" })).toBeNull();

  // Another repository, in its own Tab, has no commit selected.
  await openFromFileMenu(user);
  expect(await screen.findByRole("heading", { level: 2, name: "other" })).toBeVisible();
  await screen.findByRole("grid", { name: "Commit graph" });
  expect(screen.queryByRole("heading", { level: 3, name: "Commit details" })).toBeNull();

  // Back in the first Tab, its commit is still selected.
  await user.click(screen.getByRole("tab", { name: "lanewise" }));
  const again = await screen.findByRole("region", { name: "Commit details" });
  expect(await within(again).findByText("None: this is a first commit.")).toBeVisible();

  // Its close button shows the working tree again.
  await user.click(within(again).getByRole("button", { name: "Close commit details, showing the working tree" }));
  expect(await screen.findByRole("heading", { level: 3, name: "Working tree" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Working tree changes" })).toHaveAttribute("aria-pressed", "true");
});

test("choosing a changed file in Commit details shows its diff, side by side, in the Commit graph's place until it's closed", async () => {
  const user = userEvent.setup();
  const fake = fakePlatform({
    folders: ["/work/lanewise"],
    commands: {
      openRepository: opens(),
      fileStatus: pagedStatus([]),
      graphWindow: graphWindows([0, 1].map((n) => graphRow(n))),
      commitDetails: detailsOf(2),
      commitChanges: pagedChanges([{ path: "README.md", change: { kind: "modified" } }]),
      commitFileDiff: diffsOf({
        "README.md": textDiff("README.md", [
          { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-# Lanewise", "+# Lanewise, a Git client"] },
        ]),
      }),
    },
  });
  const { container } = render(<App platform={fake.platform} />);
  await user.click(await screen.findByRole("button", { name: "Open repository" }));
  await user.click(await screen.findByText("Commit 0"));

  const details = await screen.findByRole("region", { name: "Commit details" });
  await user.click(await within(details).findByRole("button", { name: "README.md Modified" }));
  const diff = await screen.findByRole("region", { name: "Diff" });
  const split = await within(diff).findByRole("group", { name: "Diff of README.md, side by side" });
  expect(split).toHaveTextContent("-# Lanewise");
  expect(split).toHaveTextContent("+# Lanewise, a Git client");
  // In the Commit graph's place.
  expect(screen.queryByRole("grid", { name: "Commit graph" })).toBeNull();
  expect(within(details).getByRole("button", { name: "README.md Modified" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  expect(fake.calls.at(-1)).toEqual({
    name: "commitFileDiff",
    request: {
      repository: "/work/lanewise",
      commit: historyCommit(0).id,
      path: "README.md",
      from: null,
      limit: 5000,
    },
  });
  await expectNoAxeViolations(container);

  // Closed, the Commit graph is back, and focus goes back to the file it was opened from.
  await user.click(within(diff).getByRole("button", { name: "Close the diff" }));
  expect(await screen.findByRole("grid", { name: "Commit graph" })).toBeVisible();
  expect(screen.queryByRole("heading", { level: 3, name: "Diff" })).toBeNull();
  expect(within(details).getByRole("button", { name: "README.md Modified" })).toHaveFocus();

  // Another commit has no file chosen yet.
  await user.click(screen.getByText("Commit 1"));
  expect(await within(details).findByRole("button", { name: "README.md Modified" })).not.toHaveAttribute(
    "aria-current",
  );
  expect(screen.queryByRole("heading", { level: 3, name: "Diff" })).toBeNull();
});

test("a stash made from the Working tree is listed in the Stashes Widget, where its files show their diffs, and a pop that conflicts opens the Conflicts page, which continues it", async () => {
  const user = userEvent.setup();
  let stashes: Stash[] = [];
  let applying: InProgressOperation | null = null;
  const made: Stash = {
    id: "5".repeat(40),
    index: 0,
    message: "Before the merge",
    branch: "main",
    base: { id: historyCommit(0).id, shortId: historyCommit(0).shortId, summary: "Commit 0" },
    time: Math.floor(Date.now() / 1000),
    untracked: false,
  };
  const fake = fakePlatform({
    folders: ["/work/lanewise"],
    commands: {
      openRepository: opens(),
      fileStatus: pagedStatus([{ path: "README.md", change: { kind: "modified" }, staged: false }]),
      stashes: () => ({ ok: true, value: stashes }),
      createStash: () => {
        stashes = [made];
        return { ok: true, value: made };
      },
      stashChanges: () => ({ ok: true, value: { items: [{ path: "README.md", change: { kind: "modified" } }], nextCursor: null } }),
      stashFileDiff: ({ path }) => ({
        ok: true,
        value: textDiff(path, [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-# Lanewise", "+# Stashed"] }]),
      }),
      popStash: () => {
        applying = { kind: "stashApply", stash: made, pop: true, conflicts: ["README.md"], resolved: [] };
        return { ok: true, value: { kind: "stopped", conflicts: ["README.md"], messages: "CONFLICT (content)" } };
      },
      operationInProgress: () => ({ ok: true, value: applying }),
      markResolved: ({ paths }) => {
        applying = { kind: "stashApply", stash: made, pop: true, conflicts: [], resolved: paths };
        return { ok: true, value: null };
      },
      continueOperation: () => {
        applying = null;
        stashes = [];
        return { ok: true, value: null };
      },
    },
  });
  const { container } = render(<App platform={fake.platform} />);
  await user.click(await screen.findByRole("button", { name: "Open repository" }));
  await user.click(await screen.findByRole("button", { name: "Stash changes…" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "Stash changes" })).getByRole("button", { name: "Stash changes" }),
  );

  const widget = await screen.findByRole("region", { name: "Stashes" });

  // Selecting the stash lists its files, and choosing one shows its diff.
  await user.click(await within(widget).findByRole("button", { name: /^Before the merge/ }));
  await user.click(await within(widget).findByRole("button", { name: "README.md Modified" }));
  const diff = await screen.findByRole("region", { name: "Diff" });
  expect(await within(diff).findByRole("group", { name: "Diff of README.md, side by side" })).toHaveTextContent("+# Stashed");
  expect(fake.calls.at(-1)).toEqual({
    name: "stashFileDiff",
    request: { repository: "/work/lanewise", stash: made.id, path: "README.md", from: null, limit: 5000 },
  });
  await expectNoAxeViolations(container);

  // A pop that conflicts leaves a stash apply in progress: the Conflicts page takes the Repository page's place,
  // its In-Progress Operation Widget along the top and taking focus.
  within(widget).getByRole("button", { name: "Actions for Before the merge" }).focus();
  await user.keyboard("{Enter}");
  await user.click(screen.getByRole("menuitem", { name: "Pop" }));
  const operation = await screen.findByRole("region", { name: "Stash pop in progress" });
  await waitFor(() => expect(within(operation).getByRole("heading", { name: "Stash pop in progress" })).toHaveFocus());
  expect(within(operation).getByText("Popping stash “Before the merge”: 1 file still conflicted.")).toBeVisible();
  expect(screen.queryByRole("region", { name: "Stashes" })).toBeNull();
  const files = screen.getByRole("region", { name: "Conflicted files" });
  expect(within(files).getByRole("listitem")).toHaveTextContent("README.md Conflicted");
  expect(within(operation).getByRole("button", { name: "Continue" })).toHaveAttribute("aria-disabled", "true");
  // The Three-way view, the Resolution and the AI Suggestion wait for a file to be chosen.
  expect(screen.getByText("Choose a conflicted file to resolve it.")).toBeVisible();
  expect(screen.queryByRole("region", { name: "Resolution" })).toBeNull();
  await expectNoAxeViolations(container);

  // Marked resolved and continued, the pop finishes: the stash is dropped, and the Repository page is back,
  // with no stashes and no diff, handing focus to the page.
  await user.click(within(files).getByRole("button", { name: "Mark README.md resolved" }));
  await waitFor(() => expect(within(operation).getByRole("button", { name: "Continue" })).not.toHaveAttribute("aria-disabled"));
  await user.click(within(operation).getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "lanewise" })).toHaveFocus());
  expect(screen.queryByRole("region", { name: "Stash pop in progress" })).toBeNull();
  // Said where it's still heard once the Conflicts page has gone.
  expect(screen.getByText("Continued, and the stash pop finished.")).toHaveAttribute("role", "status");
  expect(await within(screen.getByRole("region", { name: "Stashes" })).findByText("No stashes.")).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("heading", { level: 3, name: "Diff" })).toBeNull());
  expect(fake.calls.filter(({ name }) => name === "continueOperation")).toEqual([
    { name: "continueOperation", request: { repository: "/work/lanewise" } },
  ]);
});

test("only sections with changes are shown", async () => {
  const fake = fakePlatform({
    folders: ["/work/lanewise"],
    commands: {
      openRepository: opens(),
      fileStatus: pagedStatus([{ path: "a.txt", change: { kind: "untracked" }, staged: false }]),
    },
  });
  render(<App platform={fake.platform} />);

  await userEvent.click(await screen.findByRole("button", { name: "Open repository" }));

  expect(await changesStatus()).toHaveTextContent("1 change.");
  expect(screen.getByRole("region", { name: "Unstaged" })).toBeVisible();
  expect(screen.queryByRole("region", { name: "Staged" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Conflicted" })).toBeNull();
});

test("a clean working tree says it has no changes", async () => {
  const fake = fakePlatform({
    folders: ["/work/lanewise"],
    commands: { openRepository: opens(), fileStatus: pagedStatus([]) },
  });
  const { container } = render(<App platform={fake.platform} />);

  await userEvent.click(await screen.findByRole("button", { name: "Open repository" }));

  expect(await changesStatus()).toHaveTextContent(
    "No changes: the working tree matches the last commit.",
  );
  expect(within(screen.getByRole("group", { name: "Changes" })).queryByRole("listitem")).toBeNull();
  await expectNoAxeViolations(container);
});

test("a folder that isn't a repository says so clearly, and lists nothing", async () => {
  const fake = fakePlatform({
    folders: ["/home/me/Downloads"],
    commands: {
      openRepository: ({ path }) => ({ ok: false, error: { kind: "notARepository", path } }),
    },
  });
  const { container } = render(<App platform={fake.platform} />);

  await userEvent.click(await screen.findByRole("button", { name: "Open repository" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "“/home/me/Downloads” isn't in a Git repository. Choose a repository's folder, or a folder inside one.",
  );
  // No repository's heading: only the Welcome screen's own.
  expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
    "Clone a repository",
  ]);
  // Only the Welcome screen's own Tab.
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Welcome"]);
  expect(fake.calls.map((call) => call.name)).toEqual(["checkGitSetup", "openRepository"]);
  await expectNoAxeViolations(container);
});

test("a failed open keeps the repository open, and a good one clears the message", async () => {
  const user = userEvent.setup();
  const fake = fakePlatform({
    folders: ["/work/lanewise", "/tmp", "/work/lanewise"],
    commands: {
      openRepository: ({ path }) =>
        path === "/tmp"
          ? { ok: false, error: { kind: "notARepository", path } }
          : { ok: true, value: lanewise },
      fileStatus: pagedStatus(changed),
    },
  });
  render(<App platform={fake.platform} />);

  await user.click(await screen.findByRole("button", { name: "Open repository" }));
  await screen.findByText("6 changes.");
  await openFromFileMenu(user);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "“/tmp” isn't in a Git repository.",
  );
  expect(screen.getByRole("heading", { level: 2, name: "lanewise" })).toBeVisible();
  expect(screen.getByText("6 changes.")).toBeVisible();

  await openFromFileMenu(user);

  await screen.findByText("6 changes.");
  expect(screen.queryByRole("alert")).toBeNull();
  // Opening it again reads its status afresh.
  expect(fake.calls.filter((call) => call.name === "fileStatus")).toHaveLength(2);
});

test("cancelling the folder dialog changes nothing", async () => {
  const fake = fakePlatform({ folders: [null], commands: { openRepository: opens() } });
  render(<App platform={fake.platform} />);

  await userEvent.click(await screen.findByRole("button", { name: "Open repository" }));

  expect(fake.dialogs).toEqual(["Open repository"]);
  expect(fake.calls.map((call) => call.name)).toEqual(["checkGitSetup"]);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("Open a repository to see its changes.")).toBeVisible();
});

test("a hunk staged in the Diff Widget moves the change to Staged, and its diff follows with the focus", async () => {
  const user = userEvent.setup();
  const hunk = { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-# Lanewise", "+# Lanewise, a Git client"] };
  let staged = false;
  const fake = fakePlatform({
    folders: ["/work/lanewise"],
    commands: {
      openRepository: opens(),
      fileStatus: (request) => pagedStatus([{ ...modified("README.md"), staged }])(request),
      workingTreeFileDiff: (request) =>
        request.staged === staged
          ? { ok: true, value: textDiff("README.md", [hunk]) }
          : { ok: false, error: { kind: "changeNotFound", path: "README.md" } },
      stageHunk: () => {
        staged = true;
        return { ok: true, value: null };
      },
    },
  });
  // The unified view, where S stages the hunk at the cursor.
  localStorage.setItem("lanewise.diff-view", "unified");
  const { container } = render(<App platform={fake.platform} />);
  await user.click(await screen.findByRole("button", { name: "Open repository" }));
  await user.click(await screen.findByRole("button", { name: "README.md Modified" }));
  const diff = await screen.findByRole("region", { name: "Diff" });
  const editor = await within(diff).findByRole("textbox", { name: "Diff of README.md" });
  editor.focus();

  await user.keyboard("s");

  await waitFor(() => expect(entriesIn("Staged")).toEqual(["README.md Modified"]));
  expect(screen.queryByRole("region", { name: "Unstaged" })).toBeNull();
  expect(await within(diff).findByText("Staged: from the last commit to what's staged.")).toBeVisible();
  const stagedEditor = await within(diff).findByRole("textbox", { name: "Diff of README.md" });
  await waitFor(() => expect(stagedEditor).toHaveFocus());
  expect(fake.calls.find((call) => call.name === "stageHunk")).toEqual({
    name: "stageHunk",
    request: { repository: "/work/lanewise", path: "README.md", hunk },
  });
  await expectNoAxeViolations(container);
});

test("a long status comes a page at a time, and focus stays in the list at the end", async () => {
  const user = userEvent.setup();
  const many: FileStatusEntry[] = ["a", "b", "c", "d", "e"].map((name) => ({
    path: `${name}.txt`,
    change: { kind: "untracked" },
    staged: false,
  }));
  const fake = fakePlatform({
    folders: ["/work/lanewise"],
    commands: { openRepository: opens(), fileStatus: pagedStatus(many, 2) },
  });
  const { container } = render(<App platform={fake.platform} />);

  await user.click(await screen.findByRole("button", { name: "Open repository" }));

  expect(await changesStatus()).toHaveTextContent("Showing the first 2 changes.");
  expect(entriesIn("Unstaged")).toEqual(["a.txt Untracked", "b.txt Untracked"]);
  await expectNoAxeViolations(container);

  await user.click(screen.getByRole("button", { name: "Show more changes" }));
  expect(await screen.findByText("Showing the first 4 changes.")).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Show more changes" }));
  expect(await screen.findByText("5 changes.")).toBeVisible();

  expect(entriesIn("Unstaged")).toHaveLength(5);
  expect(screen.queryByRole("button", { name: "Show more changes" })).toBeNull();
  expect(screen.getByRole("group", { name: "Changes" })).toHaveFocus();
  expect(
    fake.calls.filter((call) => call.name === "fileStatus").map((call) => call.request),
  ).toEqual([
    { repository: "/work/lanewise", page: { cursor: null } },
    { repository: "/work/lanewise", page: { cursor: "2" } },
    { repository: "/work/lanewise", page: { cursor: "4" } },
  ]);
});

test("a cursor the core no longer knows starts the list again from the first page", async () => {
  const user = userEvent.setup();
  let pages = 0;
  const fake = fakePlatform({
    folders: ["/work/lanewise"],
    commands: {
      openRepository: opens(),
      fileStatus: ({ page }) => {
        if (page?.cursor) return { ok: false, error: { kind: "invalidCursor" } };
        pages++;
        return pages === 1
          ? { ok: true, value: { items: [modified("a.txt")], nextCursor: "stale" as Cursor } }
          : {
              ok: true,
              value: { items: [modified("a.txt"), modified("b.txt")], nextCursor: null },
            };
      },
    },
  });
  render(<App platform={fake.platform} />);

  await user.click(await screen.findByRole("button", { name: "Open repository" }));
  await user.click(await screen.findByRole("button", { name: "Show more changes" }));

  expect(await screen.findByText("2 changes.")).toBeVisible();
  expect(entriesIn("Unstaged")).toEqual(["a.txt Modified", "b.txt Modified"]);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a status for a repository no longer shown is dropped", async () => {
  const user = userEvent.setup();
  const other = { root: "/work/other", name: "other" };
  const lanewiseStatus: { answer?: (outcome: Outcome<"fileStatus">) => void } = {};
  const fake = fakePlatform({
    folders: ["/work/lanewise", "/work/other"],
    commands: {
      openRepository: ({ path }) => ({ ok: true, value: path === other.root ? other : lanewise }),
      fileStatus: ({ repository }) =>
        repository === lanewise.root
          ? new Promise((resolve) => {
              lanewiseStatus.answer = resolve;
            })
          : pagedStatus([])({ repository }),
    },
  });
  render(<App platform={fake.platform} />);

  await user.click(await screen.findByRole("button", { name: "Open repository" }));
  const changes = await screen.findByRole("group", { name: "Changes" });
  expect(within(changes).getByRole("status")).toHaveTextContent("Reading the working tree…");
  // Asked for once the Commit graph has its first window, and not yet answered.
  await waitFor(() => expect(lanewiseStatus.answer).toBeDefined());
  await openFromFileMenu(user);
  expect(
    await screen.findByText("No changes: the working tree matches the last commit."),
  ).toBeVisible();

  lanewiseStatus.answer?.(await pagedStatus(changed)({ repository: lanewise.root }));
  await new Promise((resolve) => setTimeout(resolve));

  expect(screen.getByRole("heading", { level: 2, name: "other" })).toBeVisible();
  expect(within(screen.getByRole("group", { name: "Changes" })).queryByRole("listitem")).toBeNull();
});

test("a status the repository can no longer give says why", async () => {
  const fake = fakePlatform({
    folders: ["/work/lanewise"],
    commands: {
      openRepository: opens(),
      fileStatus: ({ repository }) => ({
        ok: false,
        error: { kind: "notAFolder", path: repository },
      }),
    },
  });
  const { container } = render(<App platform={fake.platform} />);

  await userEvent.click(await screen.findByRole("button", { name: "Open repository" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "“/work/lanewise” isn't a folder, or is no longer there.",
  );
  await expectNoAxeViolations(container);
});

test("a command the core rejects says something went wrong", async () => {
  const fake = fakePlatform({
    folders: ["/work/lanewise"],
    commands: {
      openRepository: () => {
        throw new CommandRejectedError({ kind: "internal", message: "openRepository stopped." });
      },
    },
  });
  render(<App platform={fake.platform} />);

  await userEvent.click(await screen.findByRole("button", { name: "Open repository" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Something went wrong in Lanewise. openRepository stopped.",
  );
});

test("outside the Desktop App, the app says it's the UI on its own, not that something went wrong, and still offers to open a repository", async () => {
  const { container } = render(<App platform={unavailablePlatform} />);

  const open = await screen.findByRole("button", { name: "Open repository" });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "This is Lanewise's UI on its own, in a browser, so nothing that needs Git works here. Run the Desktop App with `pnpm desktop:dev` to use it.",
  );
  expect(screen.getByRole("alert")).not.toHaveTextContent("Something went wrong");
  await expectNoAxeViolations(container);

  await userEvent.click(open);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This is Lanewise's UI on its own, in a browser, so nothing that needs Git works here.",
  );
});

test("the footer is under the page, outside the main landmark, and its links open in the user's browser", async () => {
  const user = userEvent.setup();
  const fake = fakePlatform({});
  render(<App platform={fake.platform} />);
  await screen.findByRole("button", { name: "Open repository" });

  const footer = screen.getByRole("contentinfo");
  expect(screen.getByRole("main")).not.toContainElement(footer);
  expect(within(footer).getByRole("button", { name: "Cookie Policy" })).toBeVisible();
  await user.click(within(footer).getByRole("link", { name: /^Site design/ }));

  expect(fake.links).toEqual(["https://github.com/adrianeyre/lanewise"]);
});

test("there is no cookie banner: nothing about cookies shows until the Cookie Policy is asked for", async () => {
  const { container } = render(<App platform={fakePlatform({}).platform} />);
  await screen.findByRole("button", { name: "Open repository" });

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(container.querySelectorAll("dialog[open]")).toHaveLength(0);
  // The footer's button is the only mention of cookies on the page.
  const button = within(screen.getByRole("contentinfo")).getByRole("button", { name: "Cookie Policy" });
  expect(screen.getAllByText(/cookie/i)).toEqual([button]);
});

test("everything the app keeps in local storage is listed in the Cookie Policy", async () => {
  const user = userEvent.setup();
  const fake = fakePlatform({
    folders: ["/work/lanewise"],
    commands: { openRepository: opens(), fileStatus: pagedStatus(changed) },
  });
  render(<App platform={fake.platform} />);
  await user.click(await screen.findByRole("button", { name: "Open repository" }));
  await changesStatus();
  await user.click(await screen.findByRole("button", { name: "README.md Modified" }));
  await user.click(await screen.findByRole("button", { name: "Unified" }));
  expect(localStorage.length).toBeGreaterThan(0);

  const listed = new Set(STORED_ITEMS.map((item) => item.name));
  const kept = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!);
  expect(kept.filter((key) => !listed.has(key))).toEqual([]);
});

test("the menus' shortcuts work from anywhere in the window, but not from inside a dialog", async () => {
  const user = userEvent.setup();
  const fake = fakePlatform({ folders: ["/work/lanewise"], commands: { openRepository: opens(), fileStatus: pagedStatus([]) } });
  render(<App platform={fake.platform} />);
  await screen.findByRole("button", { name: "Open repository" });

  await user.keyboard("{Control>}o{/Control}");
  expect(await screen.findByRole("heading", { level: 2, name: "lanewise" })).toBeVisible();
  expect(fake.dialogs).toEqual(["Open repository"]);

  await user.keyboard("{Control>}t{/Control}");
  expect(tabNames()).toEqual(["lanewise", "Welcome"]);
  await user.keyboard("{Control>}{Tab}{/Control}");
  expect(screen.getByRole("tab", { name: "lanewise" })).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{Control>}w{/Control}");
  expect(tabNames()).toEqual(["Welcome"]);

  await user.keyboard("{Control>},{/Control}");
  const settings = await screen.findByRole("dialog", { name: "Settings" });
  // Inside the dialog, the shortcuts are left alone.
  await user.keyboard("{Control>}/{/Control}");
  expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
  await user.keyboard("{Escape}");
  expect(settings).not.toBeVisible();

  await user.keyboard("{Control>}/{/Control}");
  const shortcuts = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
  expect(within(shortcuts).getByRole("row", { name: /Ctrl\+Shift\+O Clone a repository/ })).toBeVisible();
});

test("Help checks main's package.json for the latest version, and links to it when the one running is older", async () => {
  const user = userEvent.setup();
  const fake = fakePlatform({
    fetch: (url) =>
      url === "https://raw.githubusercontent.com/adrianeyre/lanewise/main/package.json"
        ? new Response(JSON.stringify({ version: "99.0.0" }))
        : new Response("", { status: 404 }),
  });
  const { container } = render(<App platform={fake.platform} />);
  await screen.findByRole("button", { name: "Open repository" });

  await chooseFromMenu(user, ["Help", "Check for the latest version…"]);

  const dialog = await screen.findByRole("dialog", { name: "Check for the latest version" });
  expect(await within(dialog).findByText(/is out of date\./)).toBeVisible();
  expect(within(dialog).getByText(/The latest version is 99\.0\.0\./)).toBeVisible();
  await user.click(within(dialog).getByRole("link", { name: /Get Lanewise 99\.0\.0 from GitHub/ }));
  expect(fake.links).toEqual(["https://github.com/adrianeyre/lanewise/releases/latest"]);
  expect(fake.fetches.map(({ url }) => url)).toEqual(["https://raw.githubusercontent.com/adrianeyre/lanewise/main/package.json"]);
  await expectNoAxeViolations(container);
});

test("a palette chosen in Settings is shown at once and kept", async () => {
  const user = userEvent.setup();
  render(<App platform={fakePlatform({}).platform} />);
  await user.click(await screen.findByRole("button", { name: "Settings" }));
  const palette = within(await screen.findByRole("dialog", { name: "Settings" })).getByRole("group", { name: "Palette" });
  expect(within(palette).getAllByRole("radio")).toHaveLength(7);
  expect(within(palette).getByRole("radio", { name: "Lanewise" })).toBeChecked();

  await user.click(within(palette).getByRole("radio", { name: "Forest" }));

  expect(document.documentElement.dataset.palette).toBe("forest");
  expect(localStorage.getItem("lanewise.palette")).toBe("forest");
  await user.click(within(palette).getByRole("radio", { name: "Lanewise" }));
  expect(document.documentElement.dataset.palette).toBeUndefined();
});

test("a branch clicked in the Branches Widget selects its latest commit in the Commit graph, and a stash's square shows its files at the right", async () => {
  const user = userEvent.setup();
  const rows = [0, 1, 2].map((n) => graphRow(n));
  const stash: Stash = {
    id: "5".repeat(40),
    index: 0,
    message: "Half done",
    branch: "main",
    base: { id: rows[0]!.id, shortId: rows[0]!.shortId, summary: rows[0]!.summary },
    time: 1_790_000_000,
    untracked: false,
  };
  const fake = fakePlatform({
    folders: ["/work/lanewise"],
    commands: {
      openRepository: opens(),
      fileStatus: pagedStatus([]),
      graphWindow: graphWindows(rows),
      graphRowOf: ({ commit }) => ({ ok: true, value: { layout: "layout-1" as LayoutToken, row: rows.findIndex((each) => each.id === commit) } }),
      branches: listedBranches({
        local: [
          { name: "main", commit: rows[0]!.id, current: true, upstream: null },
          { name: "feature", commit: rows[2]!.id, current: false, upstream: null },
        ],
      }),
      commitDetails: detailsOf(3),
      commitChanges: pagedChanges([]),
      stashes: () => ({ ok: true, value: [stash] }),
      stashChanges: () => ({ ok: true, value: { items: [{ path: "a.txt", change: { kind: "modified" } }], nextCursor: null } }),
    },
  });
  const { container } = render(<App platform={fake.platform} />);
  await user.click(await screen.findByRole("button", { name: "Open repository" }));

  await user.click(await screen.findByRole("button", { name: "feature" }));

  const details = await screen.findByRole("region", { name: "Commit details" });
  expect(await within(details).findByText("Commit 2")).toBeVisible();
  expect(screen.getByRole("button", { name: "feature" })).toHaveAttribute("aria-pressed", "true");
  expect(fake.calls).toContainEqual({ name: "graphRowOf", request: { repository: "/work/lanewise", commit: rows[2]!.id } });

  // The stash, chosen in the Stashes Widget, shows its files; from the graph's square it does at the right.
  await user.click(within(screen.getByRole("region", { name: "Stashes" })).getByRole("button", { name: /^Half done/ }));
  expect(await within(screen.getByRole("region", { name: "Stashes" })).findByRole("button", { name: "a.txt Modified" })).toBeVisible();
  await expectNoAxeViolations(container);
});

test("a repository on a Host has Open repository, with its Host's logo, in Recent Repositories and beside its name, opening its page in the browser", async () => {
  const user = userEvent.setup();
  keepRecent([{ root: "/work/lanewise", name: "lanewise" }]);
  const web = { url: "https://github.com/adrianeyre/lanewise", host: "github.com", integration: "github" } as const;
  const fake = fakePlatform({
    commands: { openRepository: opens({ ...lanewise, web }), fileStatus: pagedStatus([]) },
  });
  const { container } = render(<App platform={fake.platform} />);
  const recent = await screen.findByRole("button", { name: "Open repository lanewise on GitHub" });
  expect(recent).toHaveTextContent("Open repository");
  expect(recent.querySelector("svg")).not.toBeNull();
  await user.click(recent);
  expect(fake.links).toEqual([web.url]);
  // It opens the page only: not the repository, here, as the rest of its row does.
  expect(screen.queryByRole("heading", { level: 2, name: "lanewise" })).toBeNull();
  await expectNoAxeViolations(container);

  await user.click(screen.getByRole("button", { name: /^lanewise/ }));
  const heading = await screen.findByRole("heading", { level: 2, name: "lanewise" });
  await user.click(
    within(heading.parentElement!).getByRole("button", { name: "Open repository lanewise on GitHub" }),
  );
  expect(fake.links).toEqual([web.url, web.url]);
});
