// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, test } from "vitest";

import type { CommandClient, FileStatusEntry, Outcome, StagedFiles } from "../commands/api";
import { expectNoAxeViolations } from "../test/axe";
import { changingWorkingTree, fakePlatform, type FakeCommands } from "../test/fakePlatform";
import { useWorkingTreeChanges } from "./useWorkingTreeChanges";
import { WorkingTree } from "./WorkingTree";

afterEach(cleanup);

const lanewise = { root: "/work/lanewise", name: "lanewise" };

/** The Working tree Widget as the Repository page draws it: refreshed on a change on disk or a stage. */
function Page({ commands, chosen }: { commands: CommandClient; chosen: (FileStatusEntry | null)[] }) {
  const watched = useWorkingTreeChanges(commands, lanewise.root);
  const [changed, setChanged] = useState(0);
  const [selected, setSelected] = useState<FileStatusEntry | null>(null);
  return (
    <WorkingTree
      commands={commands}
      repository={lanewise}
      refreshes={watched.changes + changed}
      unwatched={watched.problem}
      selected={selected}
      onSelect={(entry) => {
        chosen.push(entry);
        setSelected(entry);
      }}
      onChanged={() => setChanged((count) => count + 1)}
      onCommitted={() => setChanged((count) => count + 1)}
    />
  );
}

function renderWorkingTree(commands: FakeCommands) {
  const fake = fakePlatform({ commands });
  const chosen: (FileStatusEntry | null)[] = [];
  const view = render(<Page commands={fake.platform.commands} chosen={chosen} />);
  return { fake, chosen, ...view };
}

/**
 * A working tree whose `stageFiles` and `unstageFiles` change what
 * `fileStatus` reads next, as Git's would.
 */
function workingTree(entries: FileStatusEntry[]): FakeCommands & { entries: FileStatusEntry[] } {
  const tree = { entries: [...entries] };
  const moves = (files: StagedFiles, staged: boolean) => {
    tree.entries = tree.entries.map((entry) =>
      entry.change.kind !== "conflicted" &&
      entry.staged !== staged &&
      (files.kind === "all" || files.paths.includes(entry.path))
        ? { ...entry, staged, change: moved(entry.change, staged) }
        : entry,
    );
    return { ok: true as const, value: null };
  };
  return Object.assign(tree, {
    fileStatus: () => ({ ok: true as const, value: { items: tree.entries, nextCursor: null } }),
    stageFiles: ({ files }: { files: StagedFiles }) => moves(files, true),
    unstageFiles: ({ files }: { files: StagedFiles }) => moves(files, false),
  });
}

/** A new file is untracked until it's staged, and again once it's unstaged. */
function moved(change: FileStatusEntry["change"], staged: boolean): FileStatusEntry["change"] {
  if (staged && change.kind === "untracked") return { kind: "added" };
  if (!staged && change.kind === "added") return { kind: "untracked" };
  return change;
}

const changed: FileStatusEntry[] = [
  { path: "src/merge.rs", change: { kind: "conflicted" }, staged: false },
  { path: "src/lanes.rs", change: { kind: "renamed", from: "src/graph.rs" }, staged: true },
  { path: "README.md", change: { kind: "modified" }, staged: false },
  { path: "notes.md", change: { kind: "untracked" }, staged: false },
];

function section(title: string): HTMLElement {
  return screen.getByRole("region", { name: title });
}

/** Each change listed in `title`, as it reads apart from its Stage or Unstage button. */
function entriesIn(title: string): string[] {
  return within(section(title))
    .getAllByRole("listitem")
    .map((item) => item.querySelector(".file-status-entry")?.textContent ?? "");
}

function stagingCalls(fake: { calls: { name: string; request: unknown }[] }) {
  return fake.calls.filter((call) => call.name === "stageFiles" || call.name === "unstageFiles");
}

test("the Working tree Widget lists the changes by section, each to stage or unstage, with the Commit Message box", async () => {
  const { container } = renderWorkingTree(workingTree(changed));

  expect(screen.getByRole("heading", { level: 3, name: "Working tree" })).toBeVisible();
  expect(await screen.findByText("4 changes.")).toBeVisible();
  expect(entriesIn("Conflicted")).toEqual(["src/merge.rs Conflicted"]);
  expect(entriesIn("Staged")).toEqual(["src/lanes.rs Renamed from src/graph.rs"]);
  expect(entriesIn("Unstaged")).toEqual(["README.md Modified", "notes.md Untracked"]);
  // A conflict is resolved on the Conflicts page, not staged from here.
  expect(within(section("Conflicted")).queryByRole("button")).toBeNull();
  expect(within(section("Staged")).getByRole("button", { name: "Unstage all" })).toBeVisible();
  expect(within(section("Unstaged")).getByRole("button", { name: "Stage all" })).toBeVisible();
  expect(screen.getByRole("form", { name: "Commit" })).toBeVisible();
  await expectNoAxeViolations(container);
});

test("a file stages and unstages from the keyboard, and the list reads again to show it", async () => {
  const user = userEvent.setup();
  const tree = workingTree(changed);
  const { fake, container } = renderWorkingTree(tree);
  await screen.findByText("4 changes.");

  screen.getByRole("button", { name: "Stage README.md" }).focus();
  await user.keyboard("{Enter}");

  expect(await within(section("Staged")).findByText("README.md")).toBeVisible();
  expect(entriesIn("Staged")).toEqual(["src/lanes.rs Renamed from src/graph.rs", "README.md Modified"]);
  expect(entriesIn("Unstaged")).toEqual(["notes.md Untracked"]);

  screen.getByRole("button", { name: "Unstage src/lanes.rs" }).focus();
  await user.keyboard(" ");

  expect(await within(section("Unstaged")).findByText("src/lanes.rs")).toBeVisible();
  // A rename unstages both of its paths, so it stays one change.
  expect(stagingCalls(fake)).toEqual([
    { name: "stageFiles", request: { repository: lanewise.root, files: { kind: "paths", paths: ["README.md"] } } },
    {
      name: "unstageFiles",
      request: { repository: lanewise.root, files: { kind: "paths", paths: ["src/lanes.rs", "src/graph.rs"] } },
    },
  ]);
  await expectNoAxeViolations(container);
});

test("Stage all and Unstage all move a whole section", async () => {
  const user = userEvent.setup();
  const { fake } = renderWorkingTree(workingTree(changed));
  await screen.findByText("4 changes.");

  await user.click(within(section("Unstaged")).getByRole("button", { name: "Stage all" }));
  await screen.findByRole("button", { name: "notes.md Added" });
  expect(screen.queryByRole("region", { name: "Unstaged" })).toBeNull();
  expect(entriesIn("Staged")).toEqual([
    "src/lanes.rs Renamed from src/graph.rs",
    "README.md Modified",
    "notes.md Added",
  ]);

  await user.click(within(section("Staged")).getByRole("button", { name: "Unstage all" }));
  await screen.findByRole("button", { name: "notes.md Untracked" });
  expect(screen.queryByRole("region", { name: "Staged" })).toBeNull();
  expect(stagingCalls(fake)).toEqual([
    { name: "stageFiles", request: { repository: lanewise.root, files: { kind: "all" } } },
    { name: "unstageFiles", request: { repository: lanewise.root, files: { kind: "all" } } },
  ]);
});

test("choosing a change shows it as chosen, and it stays chosen as it's staged", async () => {
  const user = userEvent.setup();
  const { chosen } = renderWorkingTree(workingTree(changed));
  await screen.findByText("4 changes.");

  await user.click(screen.getByRole("button", { name: "README.md Modified" }));

  expect(chosen).toEqual([{ path: "README.md", change: { kind: "modified" }, staged: false }]);
  expect(screen.getByRole("button", { name: "README.md Modified" })).toHaveAttribute("aria-current", "true");

  await user.click(screen.getByRole("button", { name: "Stage README.md" }));

  // Staged, it's the file's staged change that's chosen, so its diff stays in view.
  await within(section("Staged")).findByText("README.md");
  expect(chosen.at(-1)).toEqual({ path: "README.md", change: { kind: "modified" }, staged: true });
  expect(within(section("Staged")).getByRole("button", { name: "README.md Modified" })).toHaveAttribute(
    "aria-current",
    "true",
  );
});

test("a chosen change that has gone from the working tree is no longer chosen", async () => {
  const user = userEvent.setup();
  const tree = workingTree(changed);
  const disk = changingWorkingTree();
  const { chosen } = renderWorkingTree({ ...tree, workingTreeChanges: disk.command });
  await screen.findByText("4 changes.");
  await user.click(screen.getByRole("button", { name: "notes.md Untracked" }));

  tree.entries = tree.entries.filter((entry) => entry.path !== "notes.md");
  act(() => disk.change());

  await screen.findByText("3 changes.");
  expect(chosen.at(-1)).toBeNull();
});

test("a change on disk reads the status again, keeping what's shown until the new one comes", async () => {
  const disk = changingWorkingTree();
  const reads: ((outcome: Outcome<"fileStatus">) => void)[] = [];
  const { fake } = renderWorkingTree({
    workingTreeChanges: disk.command,
    fileStatus: () => new Promise((resolve) => reads.push(resolve)),
  });
  await act(async () =>
    reads[0]?.({ ok: true, value: { items: [changed[2] as FileStatusEntry], nextCursor: null } }),
  );
  expect(await screen.findByText("1 change.")).toBeVisible();

  await act(async () => disk.change());

  expect(reads).toHaveLength(2);
  // No flicker: while it's read, the list and its count stay as they were.
  expect(screen.getByText("1 change.")).toBeVisible();
  expect(entriesIn("Unstaged")).toEqual(["README.md Modified"]);

  await act(async () =>
    reads[1]?.({ ok: true, value: { items: changed.slice(2), nextCursor: null } }),
  );
  expect(await screen.findByText("2 changes.")).toBeVisible();
  expect(entriesIn("Unstaged")).toEqual(["README.md Modified", "notes.md Untracked"]);
  // It reads as many as it shows, at least a page, from the start.
  expect(fake.calls.filter((call) => call.name === "fileStatus").map((call) => call.request)).toEqual([
    { repository: lanewise.root, page: { cursor: null } },
    { repository: lanewise.root, page: { cursor: null, limit: 200 } },
  ]);
});

test("a stage Git refuses says what Git said, and changes nothing", async () => {
  const user = userEvent.setup();
  const tree = workingTree(changed);
  const { container } = renderWorkingTree({
    ...tree,
    stageFiles: () => ({
      ok: false,
      error: {
        kind: "gitFailed",
        command: "git add",
        code: 128,
        message: "fatal: Unable to create '/work/lanewise/.git/index.lock': File exists.",
      },
    }),
  });
  await screen.findByText("4 changes.");

  await user.click(screen.getByRole("button", { name: "Stage README.md" }));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Git stopped with exit code 128");
  expect(alert).toHaveTextContent("index.lock': File exists.");
  expect(entriesIn("Unstaged")).toEqual(["README.md Modified", "notes.md Untracked"]);
  await expectNoAxeViolations(container);
});

test("a working tree that can't be watched says it only refreshes after what's done in Lanewise", async () => {
  renderWorkingTree({
    ...workingTree(changed),
    workingTreeChanges: () => ({
      ok: false,
      error: { kind: "watchFailed", message: "The system's limit on watched folders was reached." },
    }),
  });

  expect(
    await screen.findByText(
      "Lanewise can't watch this working tree for changes, so it only refreshes after what you do here. The system's limit on watched folders was reached.",
    ),
  ).toBeVisible();
  expect(await screen.findByText("4 changes.")).toBeVisible();
});

test("Stash changes stashes the uncommitted changes from the Working tree, with a message and the untracked files", async () => {
  const user = userEvent.setup();
  const tree = workingTree(changed);
  const requests: unknown[] = [];
  const { container } = renderWorkingTree({
    ...tree,
    createStash: (request) => {
      requests.push(request);
      tree.entries = [];
      return {
        ok: true,
        value: {
          id: "5".repeat(40),
          index: 0,
          message: request.message ?? null,
          branch: "main",
          base: { id: "6".repeat(40), shortId: "6666666", summary: "Lay out the lanes" },
          time: 1_790_000_000,
          untracked: request.includeUntracked,
        },
      };
    },
  });
  await screen.findByText("4 changes.");

  const button = screen.getByRole("button", { name: "Stash changes…" });
  button.focus();
  await user.keyboard("{Enter}");
  const dialog = screen.getByRole("dialog", { name: "Stash changes" });
  await user.keyboard("Before the merge");
  await user.click(within(dialog).getByRole("checkbox", { name: "Include untracked files" }));
  await expectNoAxeViolations(container);
  await user.click(within(dialog).getByRole("button", { name: "Stash changes" }));

  expect(await screen.findByText("Stashed your changes as “Before the merge”.")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(button).toHaveFocus();
  expect(await screen.findByText("No changes: the working tree matches the last commit.")).toBeVisible();
  expect(requests).toEqual([{ repository: lanewise.root, message: "Before the merge", includeUntracked: true }]);
});
