// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, test } from "vitest";

import type { BranchesAndRemotes, CommandClient, PullRequest } from "../commands/api";
import { HISTORY_COLUMNS_KEY } from "../settings/localSettings";
import { expectNoAxeViolations } from "../test/axe";
import { fakePlatform, type FakeCommands, graphRow, graphWindows } from "../test/fakePlatform";
import { type Copy, Copying } from "../ui/Copyable";
import { CommitHistory } from "./CommitHistory";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const lanewise = { root: "/work/lanewise", name: "lanewise" };

// `main`, `origin/main` and the tag v1 at 0; `feature` and `origin/topic` at 1.
const rows = [
  graphRow(0, {
    labels: [
      { kind: "currentBranch", name: "main" },
      { kind: "remoteBranch", name: "origin/main" },
      { kind: "tag", name: "v1" },
    ],
  }),
  graphRow(1, {
    summary: "Read the refs",
    labels: [
      { kind: "branch", name: "feature" },
      { kind: "remoteBranch", name: "origin/topic" },
    ],
  }),
  graphRow(2, { summary: "Start" }),
];

// `topic` tracks `origin/topic`, a commit behind it, so a double click on `origin/topic` checks it out, moved to it.
const refs: BranchesAndRemotes = {
  local: [
    { name: "main", commit: rows[0]!.id, current: true, upstream: null },
    { name: "feature", commit: rows[1]!.id, current: false, upstream: null },
    {
      name: "topic",
      commit: rows[2]!.id,
      current: false,
      upstream: { name: "origin/topic", remote: "origin", ahead: 0, behind: 1, gone: false },
    },
  ],
  remotes: [
    {
      name: "origin",
      url: "https://example.com/lanewise.git",
      pushUrl: null,
      configured: true,
      branches: [
        { name: "origin/main", branch: "main", commit: rows[0]!.id },
        { name: "origin/topic", branch: "topic", commit: rows[1]!.id },
      ],
    },
  ],
  tags: [{ name: "v1", commit: rows[0]!.id }],
  detached: null,
};

function History({
  commands,
  copy,
  given = refs,
  pulls,
  onOpenLink,
}: {
  commands: CommandClient;
  copy: Copy | null;
  given?: BranchesAndRemotes;
  pulls?: ReadonlyMap<string, readonly PullRequest[]>;
  onOpenLink?: (url: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <Copying.Provider value={copy}>
      <CommitHistory
        commands={commands}
        repository={lanewise}
        selected={selected}
        onSelect={setSelected}
        refreshes={0}
        onChanged={() => {}}
        refs={given}
        pullRequests={pulls}
        onOpenLink={onOpenLink}
      />
    </Copying.Provider>
  );
}

function renderHistory(commands: FakeCommands = {}, given = refs) {
  const copied: [string, string][] = [];
  const fake = fakePlatform({
    commands: {
      graphWindow: graphWindows(rows),
      checkOut: () => ({ ok: true, value: { branch: "feature", stash: null } }),
      ...commands,
    },
  });
  const view = render(<History commands={fake.platform.commands} copy={(text, what) => copied.push([text, what])} given={given} />);
  return { fake, copied, ...view };
}

const requests = (fake: ReturnType<typeof fakePlatform>, name: string) =>
  fake.calls.filter((call) => call.name === name).map((call) => call.request);

const row = (summary: string) => screen.getByRole("row", { name: new RegExp(`^${summary}, `) });

/** A Label on the row whose summary is `summary`, by the name it shows. */
const label = (summary: string, name: string) =>
  [...row(summary).querySelectorAll<HTMLElement>(".commit-label")].find((each) => each.textContent?.endsWith(name))!;

test("a double click on a branch's Label checks it out, a remote-tracking branch's as the local branch tracking it, moved to it", async () => {
  const user = userEvent.setup();
  const { fake } = renderHistory();
  await screen.findByRole("grid", { name: "Commit graph" });

  await user.dblClick(label("Read the refs", "feature"));
  await waitFor(() => expect(requests(fake, "checkOut")).toHaveLength(1));
  await user.click(row("Read the refs").querySelector<HTMLElement>(".label-more")!);
  const all = document.querySelector<HTMLElement>(".history-labels-all")!;
  await user.dblClick(within(all).getByText("origin/topic"));

  await waitFor(() =>
    expect(requests(fake, "checkOut")).toEqual([
      { repository: lanewise.root, branch: { kind: "local", name: "feature" }, stashFirst: false },
      { repository: lanewise.root, branch: { kind: "localAt", name: "topic", at: "origin/topic" }, stashFirst: false },
    ]),
  );
});

test("a double click on a remote-tracking branch whose local branch has commits it doesn't asks before moving it", async () => {
  const user = userEvent.setup();
  const diverged: BranchesAndRemotes = {
    ...refs,
    local: refs.local.map((branch) =>
      branch.name === "topic" && branch.upstream !== null
        ? { ...branch, upstream: { ...branch.upstream, ahead: 2 } }
        : branch,
    ),
  };
  const { fake } = renderHistory({}, diverged);
  await screen.findByRole("grid", { name: "Commit graph" });
  await user.click(row("Read the refs").querySelector<HTMLElement>(".label-more")!);
  await user.dblClick(within(document.querySelector<HTMLElement>(".history-labels-all")!).getByText("origin/topic"));

  const dialog = await screen.findByRole("dialog", { name: "Move “topic” to “origin/topic”?" });
  expect(dialog).toHaveTextContent("“topic” has 2 commits “origin/topic” doesn't.");
  expect(requests(fake, "checkOut")).toEqual([]);
  await expectNoAxeViolations(dialog);
  await user.click(within(dialog).getByRole("button", { name: "Move and check out" }));
  await waitFor(() =>
    expect(requests(fake, "checkOut")).toEqual([
      { repository: lanewise.root, branch: { kind: "localAt", name: "topic", at: "origin/topic" }, stashFirst: false },
    ]),
  );
});

test("a right click on a Label, in its row or among every Label +N shows, opens that Label's actions, then the commit's", async () => {
  const user = userEvent.setup();
  renderHistory();
  await screen.findByRole("grid", { name: "Commit graph" });

  fireEvent.contextMenu(label("Read the refs", "feature"), { clientX: 10, clientY: 10 });
  const menu = await screen.findByRole("menu", { name: "Actions for feature" });
  const names = within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent);
  expect(names.slice(0, 3)).toEqual(["Check out “feature”", "Merge “feature” into “main”…", "Rename “feature”…"]);
  expect(names).toContain("New branch at " + rows[1]!.shortId + "…");
  // Only this Label's: not the other Labels on the commit.
  expect(names.some((name) => name?.includes("origin/topic"))).toBe(false);
  await user.keyboard("{Escape}");

  await user.click(row("Read the refs").querySelector<HTMLElement>(".label-more")!);
  const all = document.querySelector<HTMLElement>(".history-labels-all")!;
  fireEvent.contextMenu(within(all).getByText("origin/topic"), { clientX: 10, clientY: 10 });
  const remote = await screen.findByRole("menu", { name: "Actions for origin/topic" });
  expect(within(remote).getAllByRole("menuitem")[0]).toHaveTextContent("Check out “topic” at “origin/topic”");
  await expectNoAxeViolations(remote);
});

test("a commit's +N shows every Label it has, as + on its row does, and a click copies a Label or the commit's ID", async () => {
  const user = userEvent.setup();
  const { copied, container } = renderHistory();
  await screen.findByRole("grid", { name: "Commit graph" });

  const more = row("Commit 0").querySelector<HTMLElement>(".label-more")!;
  expect(more).toHaveTextContent("+2");
  expect(document.querySelector(".history-labels-all")).toBeNull();
  await user.click(more);
  const all = document.querySelector<HTMLElement>(".history-labels-all")!;
  expect([...all.querySelectorAll(".commit-label")].map((each) => each.textContent)).toEqual([
    "Current branch main",
    "Remote branch origin/main",
    "Tag v1",
  ]);
  expect(more).toHaveTextContent("−2");
  await user.click(within(all).getByText("v1"));
  expect(copied).toEqual([["v1", "tag name"]]);
  await expectNoAxeViolations(container);

  // A click anywhere else hides them, and + on the focused row shows them again.
  await user.click(screen.getByRole("heading", { name: "Commit graph" }));
  expect(document.querySelector(".history-labels-all")).toBeNull();
  row("Commit 0").focus();
  await user.keyboard("+");
  expect(document.querySelector(".history-labels-all")).not.toBeNull();
  await user.keyboard("{Escape}");
  expect(document.querySelector(".history-labels-all")).toBeNull();

  await user.click(label("Read the refs", "feature"));
  await user.click(row("Read the refs").querySelector<HTMLElement>(".history-id")!);
  expect(copied.slice(1)).toEqual([
    ["feature", "branch name"],
    [rows[1]!.id, "commit ID"],
  ]);
});

test("each column's edge in the header resizes it from the keyboard, kept for next time, and Enter sizes it to fit again", async () => {
  const user = userEvent.setup();
  const { container } = renderHistory();
  const grid = await screen.findByRole("grid", { name: "Commit graph" });
  const section = grid.closest("section")!;
  const width = (column: string) => Number.parseFloat(section.style.getPropertyValue(`--${column}-width`));

  expect(within(grid).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
    "Graph",
    "Branch / tag",
    "Subject",
    "Author",
    "Date",
    "Commit",
  ]);
  const edges = within(grid).getAllByRole("separator");
  expect(edges.map((edge) => edge.getAttribute("aria-label"))).toEqual([
    "Resize the Graph column",
    "Resize the Branch / tag column",
    "Resize the Author column",
    "Resize the Date column",
    "Resize the Commit column",
  ]);
  await expectNoAxeViolations(container);

  // The rows come first as Tab moves on, then the edges.
  await user.tab();
  expect(row("Commit 0")).toHaveFocus();

  const author = screen.getByRole("separator", { name: "Resize the Author column" });
  const fitted = width("author");
  author.focus();
  // The Author column's edge is at its left: moving it left widens it.
  await user.keyboard("{ArrowLeft}");
  expect(width("author")).toBe(fitted + 16);
  expect(row("Commit 0")).not.toHaveFocus();
  expect(JSON.parse(localStorage.getItem(HISTORY_COLUMNS_KEY) ?? "{}")).toEqual({ author: fitted + 16 });

  const labels = screen.getByRole("separator", { name: "Resize the Branch / tag column" });
  const labelsFitted = width("labels");
  fireEvent.keyDown(labels, { key: "ArrowRight", shiftKey: true });
  expect(width("labels")).toBe(labelsFitted + 64);

  await user.keyboard("{Enter}");
  expect(width("author")).toBe(fitted);
  expect(JSON.parse(localStorage.getItem(HISTORY_COLUMNS_KEY) ?? "{}")).toEqual({ labels: labelsFitted + 64 });
});

test("an open Pull Request is marked beside its branch's tip, read out with its row, and a click opens it in the browser", async () => {
  const user = userEvent.setup();
  const pull: PullRequest = {
    number: 42,
    title: "Read the refs",
    url: "https://github.com/adrianeyre/lanewise/pull/42",
    author: "octocat",
    draft: false,
    head: { branch: "feature", commit: rows[1]!.id, repository: "adrianeyre/lanewise" },
    base: "main",
    updatedAt: null,
  };
  const opened: string[] = [];
  const fake = fakePlatform({ commands: { graphWindow: graphWindows(rows) } });
  const { container } = render(
    <History
      commands={fake.platform.commands}
      copy={null}
      pulls={new Map([[rows[1]!.id, [pull]]])}
      onOpenLink={(url) => opened.push(url)}
    />,
  );
  await screen.findByRole("grid", { name: "Commit graph" });
  expect(row("Read the refs")).toHaveAccessibleName(expect.stringContaining("Pull Request #42 “Read the refs”"));
  const mark = row("Read the refs").querySelector<HTMLElement>(".label-pull-request")!;
  expect(mark).toHaveTextContent("#42");
  await user.click(mark);
  expect(opened).toEqual([pull.url]);
  await expectNoAxeViolations(container);
});
