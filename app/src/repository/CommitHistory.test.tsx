// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";

import type { CommandClient, GraphRow, GraphWindowRequest, LayoutToken, Stash } from "../commands/api";
import { expectNoAxeViolations } from "../test/axe";
import { canvasRecorder } from "../test/canvas";
import {
  fakePlatform,
  type FakeCommands,
  type FakeSegment,
  graphRow,
  graphWindows,
  straightHistory,
} from "../test/fakePlatform";
import { CommitHistory } from "./CommitHistory";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
});

const lanewise = { root: "/work/lanewise", name: "lanewise" };

/** A row's height and a lane's width in jsdom, where the root font size is 16px. */
const ROW = 28;
const LANE = 24;
/** An avatar's radius, and the selection's ring round it, as the graph draws them at these sizes. */
const AVATAR = LANE * 0.4;
const SELECTED = AVATAR + LANE / 5;

interface HistoryProps {
  commands: CommandClient;
  picked?: string[];
  refreshes?: number;
  onChanged?: () => void;
}

/** The history with its selection kept, as the page keeps it. */
function History({ commands, picked = [], refreshes = 0, onChanged = () => {} }: HistoryProps) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <CommitHistory
      commands={commands}
      repository={lanewise}
      selected={selected}
      onSelect={(commit) => {
        picked.push(commit);
        setSelected(commit);
      }}
      refreshes={refreshes}
      onChanged={onChanged}
    />
  );
}

function renderHistory(commands: FakeCommands, picked?: string[]) {
  const fake = fakePlatform({ commands });
  const view = render(<History commands={fake.platform.commands} picked={picked} />);
  return { fake, ...view };
}

/** A `graphWindow` for a line of `count` commits on `main`. */
const straight = (count: number) => {
  const { rows, segments } = straightHistory(count);
  return graphWindows(rows, segments);
};

const grid = () => screen.findByRole("grid", { name: "Commit graph" });
/** The history's summary, which says how long it is, ahead of what the Branch menu did. */
const historySummary = () => screen.getAllByRole("status")[0];
const row = (summary: string) => screen.getByRole("row", { name: new RegExp(`^${summary}, `) });
const selectedSummary = () =>
  screen
    .getAllByRole("row")
    .filter((element) => element.getAttribute("aria-selected") === "true")
    .map((element) => element.querySelector(".history-summary")?.textContent);
const windowsRead = (fake: ReturnType<typeof fakePlatform>) =>
  fake.calls.filter((call) => call.name === "graphWindow").map((call) => call.request as GraphWindowRequest);

/**
 * A merge of `feature/x` into `main`: row 0 merges row 1, on `feature/x`, and
 * row 2, where `feature/x` branched off `main`.
 */
function merged(): { rows: GraphRow[]; segments: FakeSegment[] } {
  const now = Date.now() / 1000;
  return {
    rows: [
      graphRow(0, {
        summary: "Draw the lanes",
        time: now - 3 * 60 * 60,
        labels: [
          { kind: "currentBranch", name: "main" },
          { kind: "remoteBranch", name: "origin/main" },
          { kind: "tag", name: "v0.1.0" },
        ],
        line: "main",
        merged: ["feature/x"],
      }),
      graphRow(1, {
        summary: "Read the refs",
        author: "Grace Hopper",
        time: now - 2 * 86400,
        labels: [{ kind: "branch", name: "feature/x" }],
        node: 1,
        colour: 1,
        line: "feature/x",
      }),
      graphRow(2, { summary: "Start", time: now - 3 * 86400, line: "main", branchesOff: ["feature/x"] }),
    ],
    segments: [
      [0, 0, 2, 0, 0, 0, 0],
      [1, 0, 1, 0, 1, 1, 1],
      [2, 1, 1, 1, 1, 0, 1],
    ],
  };
}

/** Gives the history a size, as a real window does, and records what its canvas draws. */
function measureAndRecord() {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() {
        const entry = { contentRect: { width: 640, height: 10 * ROW } } as ResizeObserverEntry;
        this.callback([entry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  const context = canvasRecorder();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => context as unknown as CanvasRenderingContext2D,
  );
  return context;
}

/** Where row `index`'s dot is drawn in column `column`, while the history isn't scrolled. */
const dotAt = (column: number, index: number) => `${(column + 1) * LANE},${index * ROW + ROW / 2}`;

test("the history is a grid of commits, each with its place in the graph, Labels, subject, author, date and short ID", async () => {
  const { rows, segments } = merged();
  const { container } = renderHistory({ graphWindow: graphWindows(rows, segments) });

  const table = await grid();
  expect(historySummary()).toHaveTextContent("3 commits.");
  expect(table).toHaveAttribute("aria-rowcount", "4");
  expect(table).toHaveAttribute("aria-colcount", "6");
  expect(
    within(table)
      .getAllByRole("columnheader")
      .map((header) => header.textContent),
  ).toEqual(["Graph", "Branch / tag", "Subject", "Author", "Date", "Commit"]);

  const first = row("Draw the lanes");
  const second = row("Read the refs");
  expect(first).toHaveAttribute("aria-rowindex", "2");
  expect(second).toHaveAttribute("aria-rowindex", "3");
  expect(first).toHaveAccessibleName(
    `Draw the lanes, merge of feature/x into main, Current branch main, Remote branch origin/main, Tag v0.1.0, Ada Lovelace, 3 hours ago, commit ${rows[0]!.shortId}`,
  );
  expect(second).toHaveAccessibleName(
    `Read the refs, on feature/x, Branch feature/x, Grace Hopper, 2 days ago, commit ${rows[1]!.shortId}`,
  );
  expect(row("Start")).toHaveAccessibleName(
    `Start, on main, where feature/x branches off, Ada Lovelace, 3 days ago, commit ${rows[2]!.shortId}`,
  );
  expect(
    within(first)
      .getAllByRole("gridcell")
      .map((cell) => cell.textContent),
  ).toEqual([
    "merge of feature/x into main",
    // The current branch first, then how many more, each read out.
    "Current branch main+2Remote branch origin/main, Tag v0.1.0",
    "Draw the lanes",
    // The author's avatar, their initials without a picture, then their name.
    "ALAda Lovelace",
    "3 hours ago",
    rows[0]!.shortId,
  ]);
  expect(within(second).getByText("2 days ago")).toHaveAttribute(
    "dateTime",
    new Date(rows[1]!.time * 1000).toISOString(),
  );
  expect(within(second).getByText("Grace Hopper")).toBeVisible();
  // Nothing is selected until the user picks a commit, and only one row is in the tab order.
  expect(selectedSummary()).toEqual([]);
  expect(first).toHaveAttribute("tabindex", "0");
  expect(second).toHaveAttribute("tabindex", "-1");
  await expectNoAxeViolations(container);
});

test("an empty repository says it has no commits yet, and draws no grid", async () => {
  const { container } = renderHistory({ graphWindow: graphWindows([]) });

  expect(await screen.findByText("No commits yet.")).toBeVisible();
  expect(screen.queryByRole("grid")).toBeNull();
  await expectNoAxeViolations(container);
});

test("the keyboard moves through the history, selecting the commit it moves to", async () => {
  const user = userEvent.setup();
  const picked: string[] = [];
  const { container } = renderHistory({ graphWindow: straight(40) }, picked);
  await grid();

  await user.tab();
  expect(row("Commit 0")).toHaveFocus();
  expect(selectedSummary()).toEqual(["Commit 0"]);

  await user.keyboard("{ArrowDown}{ArrowDown}");
  expect(row("Commit 2")).toHaveFocus();
  expect(selectedSummary()).toEqual(["Commit 2"]);
  expect(row("Commit 2")).toHaveAttribute("tabindex", "0");
  expect(row("Commit 0")).toHaveAttribute("tabindex", "-1");

  await user.keyboard("{ArrowUp}");
  expect(row("Commit 1")).toHaveFocus();

  // A page is what shows, less one row: 20 rows when the list can't be measured.
  await user.keyboard("{PageDown}");
  expect(row("Commit 20")).toHaveFocus();
  await user.keyboard("{PageUp}");
  expect(row("Commit 1")).toHaveFocus();

  await user.keyboard("{End}");
  expect(row("Commit 39")).toHaveFocus();
  expect(row("Commit 39")).toHaveAttribute("aria-rowindex", "41");
  await user.keyboard("{ArrowDown}");
  expect(row("Commit 39")).toHaveFocus();

  await user.keyboard("{Home}");
  expect(row("Commit 0")).toHaveFocus();
  await user.keyboard("{ArrowUp}");
  expect(row("Commit 0")).toHaveFocus();
  expect(selectedSummary()).toEqual(["Commit 0"]);
  // Each commit moved to is selected once, and a key that goes nowhere selects nothing again.
  expect(picked).toEqual([0, 1, 2, 1, 20, 1, 39, 0].map((n) => graphRow(n).id));
  await expectNoAxeViolations(container);
});

test("clicking a commit selects it", async () => {
  const user = userEvent.setup();
  renderHistory({ graphWindow: straight(5) });
  await grid();

  await user.click(screen.getByText("Commit 3"));

  expect(row("Commit 3")).toHaveFocus();
  expect(selectedSummary()).toEqual(["Commit 3"]);
});

test("a long history is read a window at a time around what shows, and End reads only the last", async () => {
  const user = userEvent.setup();
  const picked: string[] = [];
  const { fake } = renderHistory({ graphWindow: straight(5000) }, picked);
  const table = await grid();

  expect(historySummary()).toHaveTextContent("5000 commits.");
  expect(table).toHaveAttribute("aria-rowcount", "5001");
  // The window on screen, then the one after it, read ahead under its layout.
  await waitFor(() =>
    expect(windowsRead(fake)).toEqual([
      { repository: "/work/lanewise", layout: null, start: 0 },
      { repository: "/work/lanewise", layout: "layout-1", start: 200 },
    ]),
  );

  await user.tab();
  await user.keyboard("{End}");
  // The last row takes focus as it's read, and is selected once it is.
  expect(await screen.findByRole("row", { name: /^Commit 4999, / })).toHaveFocus();
  await waitFor(() => expect(selectedSummary()).toEqual(["Commit 4999"]));
  expect(picked.at(-1)).toBe(graphRow(4999).id);
  expect(windowsRead(fake).map((request) => request.start)).toEqual([0, 200, 4600, 4800]);

  // The first windows, far from what shows, were forgotten, so going back reads them again.
  await user.keyboard("{Home}");
  expect(await screen.findByRole("row", { name: /^Commit 0, / })).toHaveFocus();
  await waitFor(() => expect(windowsRead(fake).map((request) => request.start)).toEqual([0, 200, 4600, 4800, 0, 200]));
});

test("a long history draws only the rows in view", async () => {
  const user = userEvent.setup();
  renderHistory({ graphWindow: straight(5000) });
  const table = await grid();

  const drawn = () => within(table).getAllByRole("row").length - 1;
  expect(drawn()).toBeLessThanOrEqual(30);

  await user.tab();
  await user.keyboard("{End}");
  expect(await screen.findByRole("row", { name: /^Commit 4999, / })).toHaveFocus();
  expect(drawn()).toBeLessThanOrEqual(30);
  expect(screen.queryByText("Commit 0")).toBeNull();
});

test("a history laid out again, as its refs move, is read again from its new layout", async () => {
  const user = userEvent.setup();
  const before = graphWindows(straightHistory(250).rows);
  const after = graphWindows(
    Array.from({ length: 250 }, (_, n) => graphRow(n, { summary: `Moved ${n}` })),
    [],
    "layout-2" as LayoutToken,
  );
  let reads = 0;
  const { fake } = renderHistory({ graphWindow: (request) => (reads++ === 0 ? before : after)(request) });

  expect(await screen.findByRole("row", { name: /^Moved 0, / })).toBeVisible();
  await user.tab();
  expect(row("Moved 0")).toHaveFocus();
  expect(screen.queryByRole("alert")).toBeNull();
  await waitFor(() =>
    expect(windowsRead(fake).map(({ layout, start }) => [layout, start])).toEqual([
      [null, 0],
      ["layout-1", 200],
      [null, 0],
      [null, 200],
    ]),
  );
});

test("a history the repository can't give says why", async () => {
  const { container } = renderHistory({
    graphWindow: ({ repository }) => ({
      ok: false,
      error: { kind: "notAFolder", path: repository },
    }),
  });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "“/work/lanewise” isn't a folder, or is no longer there.",
  );
  expect(screen.queryByRole("grid")).toBeNull();
  await expectNoAxeViolations(container);
});

test("the graph is drawn beside the rows, hidden from screen readers: lanes, a merge's curve, its authors' avatars and a merge's dot with HEAD's ring", async () => {
  const context = measureAndRecord();
  const { rows, segments } = merged();
  const { container } = renderHistory({ graphWindow: graphWindows(rows, segments) });
  const table = await grid();

  const canvas = container.querySelector("canvas")!;
  expect(canvas.closest("[aria-hidden='true']")).not.toBeNull();
  // As wide as its two columns need, and the rows start after it.
  expect(canvas).toHaveStyle({ width: `${3 * LANE}px`, height: `${10 * ROW}px` });
  expect(table.closest("section")!.style.getPropertyValue("--graph-width")).toBe(`${3 * LANE}px`);

  await waitFor(() => expect(context.log).toContain(`arc ${dotAt(0, 2)} r${AVATAR}`));
  const painted = context.log.slice(context.log.lastIndexOf("clear"));
  // `main` straight down, and `feature/x` curving out of the merge and back to where it branched off.
  expect(painted).toContain(`line ${dotAt(0, 2)}`);
  expect(painted).toContain(`curve ${dotAt(1, 1)}`);
  expect(painted).toContain(`curve ${dotAt(0, 2)}`);
  // The merge a small plain dot, and the other commits their authors' avatars, with their initials.
  const merge = LANE / 5;
  expect(painted).toEqual(expect.arrayContaining([`arc ${dotAt(0, 0)} r${merge}`, `arc ${dotAt(1, 1)} r${AVATAR}`]));
  expect(painted.some((entry) => entry.startsWith("text GH "))).toBe(true);
  // HEAD, through `main`, is ringed.
  expect(painted).toContain(`arc ${dotAt(0, 0)} r${merge + LANE / 10}`);
  await expectNoAxeViolations(container);
});

test("selecting a commit on the graph or in the grid keeps the two in step", async () => {
  const user = userEvent.setup();
  const context = measureAndRecord();
  const { container } = renderHistory({ graphWindow: straight(8) });
  await grid();
  const canvas = container.querySelector("canvas")!;
  const lastPainted = () => context.log.slice(context.log.lastIndexOf("clear"));

  // A click on the graph selects the commit beside it, and rings it there.
  fireEvent.click(canvas, { clientY: 3 * ROW + 10 });
  expect(row("Commit 3")).toHaveFocus();
  expect(selectedSummary()).toEqual(["Commit 3"]);
  await waitFor(() => expect(lastPainted()).toContain(`arc ${dotAt(0, 3)} r${SELECTED}`));

  // Moving in the grid moves the ring too.
  await user.keyboard("{ArrowDown}");
  expect(selectedSummary()).toEqual(["Commit 4"]);
  await waitFor(() => expect(lastPainted()).toContain(`arc ${dotAt(0, 4)} r${SELECTED}`));
  expect(lastPainted()).not.toContain(`arc ${dotAt(0, 3)} r${SELECTED}`);

  // A new Theme draws it again, in the new colours.
  const paints = context.log.filter((entry) => entry === "clear").length;
  document.documentElement.dataset.theme = "dark";
  await waitFor(() => expect(context.log.filter((entry) => entry === "clear").length).toBe(paints + 1));
});

test("a scroll draws its rows and lanes before the frame it shows in is painted, not a frame behind", async () => {
  const context = measureAndRecord();
  const { container } = renderHistory({ graphWindow: straight(150) });
  await grid();
  expect(await screen.findByRole("row", { name: /^Commit 0, / })).toBeVisible();
  const viewport = container.querySelector<HTMLElement>(".history-viewport")!;

  // Deferred work would wait for the end of `act`; what's asserted inside it is drawn in step with the scroll.
  act(() => {
    context.log.length = 0;
    viewport.scrollTop = 100 * ROW;
    viewport.dispatchEvent(new Event("scroll"));
    expect(row("Commit 100")).toBeInTheDocument();
    // Row 0 stays, as the row focus goes to; the rows around it don't.
    expect(screen.queryByRole("row", { name: /^Commit 1, / })).toBeNull();
    // Row 100's dot, at the top of the canvas, which stays put as the rows scroll under it.
    expect(context.log).toContain(`arc ${LANE},${ROW / 2} r${AVATAR}`);
  });
});

test("the Branch menu makes a branch at the selected commit, and acts on the branches whose Labels it carries", async () => {
  const user = userEvent.setup();
  const { rows, segments } = merged();
  let changes = 0;
  const fake = fakePlatform({
    commands: {
      graphWindow: graphWindows(rows, segments),
      createBranch: () => ({ ok: true, value: null }),
      checkOut: () => ({ ok: true, value: { branch: "feature/x", stash: null } }),
    },
  });
  const { container } = render(<History commands={fake.platform.commands} onChanged={() => changes++} />);
  await grid();
  // Nothing is selected, so there is nothing for it to act on yet.
  expect(screen.queryByRole("button", { name: /^Branch actions/ })).toBeNull();

  row("Read the refs").focus();
  const menu = await screen.findByRole("button", { name: `Branch actions for commit ${rows[1]!.shortId}` });
  await user.click(menu);
  // GitKraken's order: the commit's own actions, its tags, then each branch's.
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    `Check out commit ${rows[1]!.shortId}…`,
    `New branch at ${rows[1]!.shortId}…`,
    `Reset “main” to ${rows[1]!.shortId}`,
    `Revert commit ${rows[1]!.shortId}`,
    "Edit commit message…",
    `Cherry-pick commit ${rows[1]!.shortId} onto “main”`,
    `New tag at ${rows[1]!.shortId}…`,
    "Check out “feature/x”",
    "Merge “feature/x” into “main”…",
    "Rename “feature/x”…",
    "Delete “feature/x”",
  ]);
  await user.click(screen.getByRole("menuitem", { name: "Check out “feature/x”" }));
  expect(await screen.findByText("Checked out “feature/x”.")).toBeVisible();
  expect(changes).toBe(1);

  // The current branch is only renamed, and a remote-tracking branch is checked out as a local one.
  row("Draw the lanes").focus();
  await user.click(await screen.findByRole("button", { name: `Branch actions for commit ${rows[0]!.shortId}` }));
  // HEAD's commit isn't checked out, reset to or cherry-picked, since it's where HEAD is.
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    `New branch at ${rows[0]!.shortId}…`,
    `Revert commit ${rows[0]!.shortId}`,
    "Edit commit message…",
    `New tag at ${rows[0]!.shortId}…`,
    "Rename tag “v0.1.0”…",
    "Delete tag “v0.1.0”…",
    "Rename “main”…",
    "Check out “origin/main” as a local branch",
    "Merge “origin/main” into “main”…",
  ]);
  await user.click(screen.getByRole("menuitem", { name: `New branch at ${rows[0]!.shortId}…` }));
  const dialog = screen.getByRole("dialog", { name: "New branch" });
  expect(dialog).toHaveTextContent(`It starts at commit ${rows[0]!.shortId} “Draw the lanes”, and isn't checked out.`);
  await expectNoAxeViolations(container);
  await user.keyboard("lanes{Enter}");

  expect(await screen.findByText(`Created branch “lanes” at ${rows[0]!.shortId}.`)).toBeVisible();
  expect(changes).toBe(2);
  expect(fake.calls.filter(({ name }) => name === "createBranch").map(({ request }) => request)).toEqual([
    { repository: lanewise.root, name: "lanes", start: rows[0]!.id },
  ]);
  expect(screen.getByRole("button", { name: `Branch actions for commit ${rows[0]!.shortId}` })).toHaveFocus();
});

test("the Branch menu merges a branch whose Label the selected commit carries, once its preview is confirmed", async () => {
  const user = userEvent.setup();
  const { rows, segments } = merged();
  let changes = 0;
  const preview = { into: "main", head: rows[0]!.id, tip: rows[1]!.id, commits: 1 };
  const fake = fakePlatform({
    commands: {
      graphWindow: graphWindows(rows, segments),
      previewMerge: () => ({ ok: true, value: { ...preview, kind: "mergeCommit", insteadOfFastForward: false } }),
      merge: () => ({ ok: true, value: { kind: "mergeCommit", commit: "abcdef0123456789", commits: 1 } }),
    },
  });
  const { container } = render(<History commands={fake.platform.commands} onChanged={() => changes++} />);
  await grid();

  row("Read the refs").focus();
  await user.click(await screen.findByRole("button", { name: `Branch actions for commit ${rows[1]!.shortId}` }));
  await user.click(screen.getByRole("menuitem", { name: "Merge “feature/x” into “main”…" }));
  const dialog = await screen.findByRole("dialog", { name: "Merge “feature/x” into “main”?" });
  expect(dialog).toHaveTextContent("A merge commit. A new commit on “main” joins it with “feature/x”, bringing in 1 commit.");
  await expectNoAxeViolations(container);
  await user.click(within(dialog).getByRole("button", { name: "Merge" }));

  expect(
    await screen.findByText("Merged “feature/x” into “main” in merge commit abcdef0, bringing in 1 commit."),
  ).toBeVisible();
  expect(changes).toBe(1);
  expect(fake.calls.filter(({ name }) => name === "merge").map(({ request }) => request)).toEqual([
    { repository: lanewise.root, branch: { kind: "local", name: "feature/x" }, head: preview.head, tip: preview.tip },
  ]);
});

test("a right click on a commit opens its actions there, as Shift+F10 and the Menu key do on its row, and Escape hands focus back", async () => {
  const user = userEvent.setup();
  const { rows, segments } = merged();
  const fake = fakePlatform({
    commands: {
      graphWindow: graphWindows(rows, segments),
      previewMerge: () => ({
        ok: true,
        value: {
          into: "main",
          head: rows[0]!.id,
          tip: rows[1]!.id,
          commits: 1,
          kind: "mergeCommit",
          insteadOfFastForward: false,
        },
      }),
    },
  });
  const { container } = render(<History commands={fake.platform.commands} />);
  await grid();

  fireEvent.contextMenu(row("Read the refs"), { clientX: 40, clientY: 60 });

  const menu = await screen.findByRole("menu", { name: `Actions for commit ${rows[1]!.shortId}` });
  expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    `Check out commit ${rows[1]!.shortId}…`,
    `New branch at ${rows[1]!.shortId}…`,
    `Reset “main” to ${rows[1]!.shortId}`,
    `Revert commit ${rows[1]!.shortId}`,
    "Edit commit message…",
    `Cherry-pick commit ${rows[1]!.shortId} onto “main”`,
    `New tag at ${rows[1]!.shortId}…`,
    "Check out “feature/x”",
    "Merge “feature/x” into “main”…",
    "Rename “feature/x”…",
    "Delete “feature/x”",
  ]);
  // It selected the commit, and focus is on its first action.
  expect(selectedSummary()).toEqual(["Read the refs"]);
  expect(within(menu).getAllByRole("menuitem")[0]).toHaveFocus();
  await expectNoAxeViolations(container);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(row("Read the refs")).toHaveFocus();

  // From the keyboard: Shift+F10, then the merge, through its preview.
  await user.keyboard("{Shift>}{F10}{/Shift}");
  await user.click(await screen.findByRole("menuitem", { name: "Merge “feature/x” into “main”…" }));
  expect(await screen.findByRole("dialog", { name: "Merge “feature/x” into “main”?" })).toBeVisible();
  await user.keyboard("{Escape}");

  // And the Menu key.
  row("Read the refs").focus();
  await user.keyboard("{ContextMenu}");
  expect(await screen.findByRole("menu", { name: `Actions for commit ${rows[1]!.shortId}` })).toBeVisible();
});

test("a stash is drawn as a dotted square beside the commit it was made on, named on its row, and clicking it selects the stash", async () => {
  const context = measureAndRecord();
  const { rows, segments } = straightHistory(4);
  const stash: Stash = {
    id: "5".repeat(40),
    index: 0,
    message: "Half done",
    branch: "main",
    base: { id: rows[2]!.id, shortId: rows[2]!.shortId, summary: rows[2]!.summary },
    time: 1_790_000_000,
    untracked: false,
  };
  const chosen: string[] = [];
  const fake = fakePlatform({ commands: { graphWindow: graphWindows(rows, segments) } });
  const { container } = render(
    <CommitHistory
      commands={fake.platform.commands}
      repository={lanewise}
      selected={null}
      onSelect={() => {}}
      refreshes={0}
      onChanged={() => {}}
      stashes={[stash]}
      onSelectStash={(id) => chosen.push(id)}
    />,
  );
  await grid();

  expect(row("Commit 2")).toHaveAccessibleName(/stash “Half done” made on it/);
  // Its square, in the column after the lane's, level with the commit.
  await waitFor(() => expect(context.log.some((entry) => entry.startsWith("rect "))).toBe(true));
  const [x, y] = context.log
    .find((entry) => entry.startsWith("rect "))!
    .slice("rect ".length)
    .split(" ")[0]!
    .split(",")
    .map(Number);
  const side = LANE * 0.7;
  expect(x).toBeCloseTo(2 * LANE - side / 2);
  expect(y).toBeCloseTo(2 * ROW + ROW / 2 - side / 2);

  const canvas = container.querySelector("canvas")!;
  fireEvent.click(canvas, { clientX: 2 * LANE, clientY: 2 * ROW + ROW / 2 });
  expect(chosen).toEqual([stash.id]);
});

test("the Working tree row above the history shows the working tree's changes, pressed while no commit is selected", async () => {
  const user = userEvent.setup();
  let shown = 0;
  const fake = fakePlatform({ commands: { graphWindow: straight(3) } });
  const { container } = render(
    <CommitHistory
      commands={fake.platform.commands}
      repository={lanewise}
      selected={null}
      onSelect={() => {}}
      refreshes={0}
      onChanged={() => {}}
      onShowWorkingTree={() => shown++}
    />,
  );
  await grid();

  const wip = screen.getByRole("button", { name: "Working tree changes" });
  expect(wip).toHaveAttribute("aria-pressed", "true");
  await user.click(wip);
  expect(shown).toBe(1);
  await expectNoAxeViolations(container);
});

test("as the refs may have moved, a window is read again, and the history too if they did", async () => {
  const before = graphWindows(straightHistory(3).rows);
  const after = graphWindows(
    Array.from({ length: 4 }, (_, n) => graphRow(n, { summary: `Moved ${n}` })),
    [],
    "layout-2" as LayoutToken,
  );
  let moved = false;
  const fake = fakePlatform({ commands: { graphWindow: (request) => (moved ? after : before)(request) } });
  const { rerender } = render(<History commands={fake.platform.commands} refreshes={0} />);
  expect(await screen.findByRole("row", { name: /^Commit 0, / })).toBeVisible();

  // Nothing moved: the window is read again under its layout, and kept.
  rerender(<History commands={fake.platform.commands} refreshes={1} />);
  await waitFor(() => expect(windowsRead(fake)).toHaveLength(2));
  expect(row("Commit 0")).toBeVisible();

  moved = true;
  rerender(<History commands={fake.platform.commands} refreshes={2} />);
  expect(await screen.findByRole("row", { name: /^Moved 0, / })).toBeVisible();
  expect(historySummary()).toHaveTextContent("4 commits.");
  expect(windowsRead(fake).map(({ layout, start }) => [layout, start])).toEqual([
    [null, 0],
    ["layout-1", 0],
    ["layout-1", 0],
    [null, 0],
  ]);
});
