// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import type { CommitFile, Outcome } from "../commands/api";
import { expectNoAxeViolations } from "../test/axe";
import {
  detailsOf,
  fakePlatform,
  type FakeCommands,
  historyCommit,
  pagedChanges,
} from "../test/fakePlatform";
import { Copying } from "../ui/Copyable";
import { CommitDetails } from "./CommitDetails";

afterEach(cleanup);

const lanewise = { root: "/work/lanewise", name: "lanewise" };

function renderDetails(commit: string | null, commands: FakeCommands, selectedFile: string | null = null) {
  const fake = fakePlatform({ commands });
  const chosen: CommitFile[] = [];
  const view = render(
    <CommitDetails
      commands={fake.platform.commands}
      repository={lanewise}
      commit={commit}
      selectedFile={selectedFile}
      onSelectFile={(file) => chosen.push(file)}
    />,
  );
  return { fake, chosen, ...view };
}

const files: CommitFile[] = [
  { path: "graph/src/lanes.rs", change: { kind: "added" } },
  { path: "README.md", change: { kind: "modified" } },
  { path: "old.txt", change: { kind: "deleted" } },
  { path: "graph/src/order.rs", change: { kind: "renamed", from: "graph/src/sort.rs" } },
  { path: "docs/copy.md", change: { kind: "copied", from: "docs/original.md" } },
];

/** The value of the `term` row in the commit's facts. */
function fact(term: string): HTMLElement {
  const dt = screen.getByText(term, { selector: "dt" });
  return dt.nextElementSibling as HTMLElement;
}

test("with no commit selected, Commit details says so and reads nothing", () => {
  const { fake, container } = renderDetails(null, {});

  expect(screen.getByRole("heading", { level: 3, name: "Commit details" })).toBeVisible();
  expect(screen.getByText("No commit selected.")).toBeVisible();
  expect(fake.calls).toEqual([]);
  return expectNoAxeViolations(container);
});

test("a selected commit shows its whole message, author, committer, parents and changed files", async () => {
  const commit = historyCommit(0);
  const { fake, container } = renderDetails(commit.id, {
    commitDetails: detailsOf(3, (details) => ({
      message: "Draw the lanes\n\nEach commit gets a lane,\nkept until its parent.",
      committer: {
        name: "Grace Hopper",
        email: "grace@example.com",
        time: details.author.time + 60,
      },
      parents: [
        { id: historyCommit(1).id, shortId: historyCommit(1).shortId },
        { id: historyCommit(2).id, shortId: historyCommit(2).shortId },
      ],
    })),
    commitChanges: pagedChanges(files),
  });

  expect(await screen.findByText("Draw the lanes")).toBeVisible();
  expect(screen.getByText(/Each commit gets a lane,/)).toHaveTextContent(
    "Each commit gets a lane, kept until its parent.",
  );
  expect(fact("Commit")).toHaveTextContent(commit.id);
  expect(fact("Author")).toHaveTextContent("Ada Lovelace <ada@example.com>");
  expect(fact("Committer")).toHaveTextContent("Grace Hopper <grace@example.com>");
  expect(within(fact("Author")).getByText(/\d{4}/, { selector: "time" })).toHaveAttribute(
    "dateTime",
    new Date(commit.time * 1000).toISOString(),
  );
  expect(
    within(fact("Parents"))
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual([historyCommit(1).shortId, historyCommit(2).shortId]);

  const changes = screen.getByRole("group", { name: "Changed files" });
  expect(await within(changes).findByText("5 files changed.", { selector: "[role=status]" })).toBeVisible();
  expect(
    within(changes)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual([
    "graph/src/lanes.rs Added",
    "README.md Modified",
    "old.txt Deleted",
    "graph/src/order.rs Renamed from graph/src/sort.rs",
    "docs/copy.md Copied from docs/original.md",
  ]);
  expect(fake.calls).toEqual([
    { name: "commitDetails", request: { repository: "/work/lanewise", commit: commit.id } },
    {
      name: "commitChanges",
      request: { repository: "/work/lanewise", commit: commit.id, page: { cursor: null } },
    },
  ]);
  await expectNoAxeViolations(container);
});

test("a first commit says it has no parents", async () => {
  renderDetails(historyCommit(0).id, {
    commitDetails: detailsOf(1),
    commitChanges: pagedChanges([{ path: "README.md", change: { kind: "added" } }]),
  });

  expect(await screen.findByText("None: this is a first commit.")).toBeVisible();
  expect(screen.getByText("Parents", { selector: "dt" })).toBeVisible();
  expect(await screen.findByText("1 file changed.")).toBeVisible();
});

test("a commit with one parent names it", async () => {
  renderDetails(historyCommit(0).id, {
    commitDetails: detailsOf(2),
    commitChanges: pagedChanges([]),
  });

  expect(await screen.findByText("Parent", { selector: "dt" })).toBeVisible();
  expect(fact("Parent")).toHaveTextContent(historyCommit(1).shortId);
  expect(await screen.findByText("No files changed.")).toBeVisible();
});

test("a changed file is a button that chooses it for the Diff Widget, and the chosen one is marked", async () => {
  const user = userEvent.setup();
  const { chosen, container } = renderDetails(
    historyCommit(0).id,
    { commitDetails: detailsOf(2), commitChanges: pagedChanges(files) },
    "README.md",
  );

  const changes = await screen.findByRole("group", { name: "Changed files" });
  expect(await within(changes).findByRole("button", { name: "README.md Modified" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  const renamed = within(changes).getByRole("button", {
    name: "graph/src/order.rs Renamed from graph/src/sort.rs",
  });
  expect(renamed).not.toHaveAttribute("aria-current");

  renamed.focus();
  await user.keyboard("{Enter}");
  await user.click(within(changes).getByRole("button", { name: "old.txt Deleted" }));
  expect(chosen).toEqual([files[3], files[2]]);
  await expectNoAxeViolations(container);
});

test("a long list of changed files comes a page at a time, and focus stays in it at the end", async () => {
  const user = userEvent.setup();
  const many: CommitFile[] = ["a", "b", "c", "d", "e"].map((name) => ({
    path: `${name}.txt`,
    change: { kind: "modified" },
  }));
  const { container } = renderDetails(historyCommit(0).id, {
    commitDetails: detailsOf(2),
    commitChanges: pagedChanges(many, 2),
  });

  expect(await screen.findByText("Showing the first 2 files.")).toBeVisible();
  await expectNoAxeViolations(container);
  await user.click(screen.getByRole("button", { name: "Show more files" }));
  expect(await screen.findByText("Showing the first 4 files.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Show more files" }));
  expect(await screen.findByText("5 files changed.")).toBeVisible();

  expect(screen.queryByRole("button", { name: "Show more files" })).toBeNull();
  expect(screen.getByRole("group", { name: "Changed files" })).toHaveFocus();
});

test("a commit that has gone from the repository says so", async () => {
  const { container } = renderDetails("f".repeat(40), {
    commitDetails: detailsOf(1),
    commitChanges: ({ commit }) => ({ ok: false, error: { kind: "commitNotFound", commit } }),
  });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This commit is no longer in the repository. Choose another in the Commit graph.",
  );
  await expectNoAxeViolations(container);
});

test("selecting another commit drops what an earlier one's read gives late", async () => {
  const late: { answer?: (outcome: Outcome<"commitDetails">) => void } = {};
  const known = detailsOf(3);
  const commands: FakeCommands = {
    commitDetails: (request) =>
      request.commit === historyCommit(0).id
        ? new Promise((resolve) => {
            late.answer = resolve;
          })
        : known(request),
    commitChanges: pagedChanges([]),
  };
  const fake = fakePlatform({ commands });
  const details = (n: number) => (
    <CommitDetails
      commands={fake.platform.commands}
      repository={lanewise}
      commit={historyCommit(n).id}
      selectedFile={null}
      onSelectFile={() => {}}
    />
  );
  const { rerender } = render(details(0));
  expect(await screen.findByText("Reading the commit…")).toBeVisible();

  rerender(details(1));
  expect(await screen.findByText("Commit 1")).toBeVisible();
  late.answer?.(await known({ repository: lanewise.root, commit: historyCommit(0).id }));
  await new Promise((resolve) => setTimeout(resolve));

  expect(screen.queryByText("Commit 0")).toBeNull();
  expect(screen.getByText("Commit 1")).toBeVisible();
});

test("the commit's message is edited from its button, and a click on its ID or a parent's copies it", async () => {
  const user = userEvent.setup();
  const copied: [string, string][] = [];
  const reworded: [string, string][] = [];
  const commit = historyCommit(0).id;
  const fake = fakePlatform({
    commands: {
      commitDetails: detailsOf(3, () => ({ message: "Draw the lanes" })),
      commitChanges: pagedChanges([]),
      rewordCommit: () => ({ ok: true, value: { commit: "abcdef0123", branches: ["main"], detached: false } }),
    },
  });
  const { container } = render(
    <Copying.Provider value={(text, what) => copied.push([text, what])}>
      <CommitDetails
        commands={fake.platform.commands}
        repository={lanewise}
        commit={commit}
        selectedFile={null}
        onSelectFile={() => {}}
        onReworded={(from, to) => reworded.push([from, to])}
      />
    </Copying.Provider>,
  );

  await user.click(await screen.findByRole("button", { name: `${commit}, copy the commit ID` }));
  await user.click(screen.getByRole("button", { name: `${historyCommit(1).id}, copy the commit ID` }));
  expect(copied).toEqual([
    [commit, "commit ID"],
    [historyCommit(1).id, "commit ID"],
  ]);
  await expectNoAxeViolations(container);

  await user.click(screen.getByRole("button", { name: "Edit message…" }));
  const dialog = await screen.findByRole("dialog", { name: `Edit the message of commit ${commit.slice(0, 7)}` });
  expect(within(dialog).getByRole("textbox", { name: "Subject" })).toHaveValue("Draw the lanes");
  await user.type(within(dialog).getByRole("textbox", { name: "Body (optional)" }), "Every lane.");
  await user.click(within(dialog).getByRole("button", { name: "Change message" }));

  await screen.findByText(`Changed the message of ${commit.slice(0, 7)}: it's commit abcdef0 now, on “main”.`);
  expect(fake.calls.filter((call) => call.name === "rewordCommit").map((call) => call.request)).toEqual([
    { repository: lanewise.root, commit, message: "Draw the lanes\n\nEvery lane." },
  ]);
  expect(reworded).toEqual([[commit, "abcdef0123"]]);
});
