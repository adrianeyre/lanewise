// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeAll, expect, test } from "vitest";

import type { CommandClient, CommitFile, CreateStashRequest, Stash, StashApplied, StashRequest } from "../commands/api";
import { expectNoAxeViolations } from "../test/axe";
import { fakePlatform, type FakeCommands, historyCommit } from "../test/fakePlatform";
import { StashesWidget } from "./StashesWidget";

// The Diff Widget's editor loads when first shown. Loading it once here keeps
// each test about what it draws, not how long Vitest takes to transform CodeMirror.
beforeAll(async () => {
  await import("../diff/DiffEditor");
});

afterEach(cleanup);

const lanewise = { root: "/work/lanewise", name: "lanewise" };
const base = historyCommit(0);
const now = Math.floor(Date.now() / 1000);

function stashOf(n: number, found: Partial<Stash> = {}): Stash {
  return {
    id: n.toString(16).padStart(40, "5"),
    index: 0,
    message: `Stash ${n}`,
    branch: "main",
    base: { id: base.id, shortId: base.shortId, summary: base.summary },
    time: now - (n + 1) * 60 * 60,
    untracked: false,
    ...found,
  };
}

/** What the page around the Widget was told. */
interface Told {
  counts: number[];
  chosen: { stash: string; file: CommitFile }[];
}

/** The Widget as the Repository page draws it: read again after each change it makes, with what's selected kept. */
function Page({ commands, told }: { commands: CommandClient; told: Told }) {
  const [changed, setChanged] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [chosen, setChosen] = useState<{ stash: string; file: CommitFile } | null>(null);
  return (
    <StashesWidget
      commands={commands}
      repository={lanewise}
      refreshes={changed}
      selected={selected}
      onSelect={(stash) => {
        setSelected(stash);
        if (stash !== chosen?.stash) setChosen(null);
      }}
      selectedFile={chosen !== null && chosen.stash === selected ? chosen.file.path : null}
      onSelectFile={(stash, file) => {
        told.chosen.push({ stash, file });
        setChosen({ stash, file });
      }}
      onStashes={(stashes) => told.counts.push(stashes.length)}
      onChanged={() => setChanged((count) => count + 1)}
    />
  );
}

/**
 * A repository's stashes, which `createStash`, `applyStash`, `popStash` and
 * `dropStash` change as Git would. `conflicting` names the stashes that stop
 * with conflicts in `a.txt` as they're applied or popped.
 */
function stashRepository(stashes: Stash[], { conflicting = [] }: { conflicting?: string[] } = {}) {
  let list = stashes.map((stash, index) => ({ ...stash, index }));
  const calls: { name: string; request: unknown }[] = [];
  const renumber = () => {
    list = list.map((stash, index) => ({ ...stash, index }));
  };
  const find = (request: StashRequest) => list.find(({ id }) => id === request.stash);
  const applying = (pop: boolean) => (request: StashRequest) => {
    calls.push({ name: pop ? "popStash" : "applyStash", request });
    const stash = find(request);
    if (stash === undefined) return { ok: false as const, error: { kind: "stashNotFound" as const, stash: request.stash } };
    if (conflicting.includes(stash.id)) {
      const value: StashApplied = { kind: "stopped", conflicts: ["a.txt"], messages: "CONFLICT (content)" };
      return { ok: true as const, value };
    }
    if (pop) {
      list = list.filter(({ id }) => id !== stash.id);
      renumber();
    }
    return { ok: true as const, value: { kind: "applied" as const } };
  };
  const commands: FakeCommands = {
    stashes: () => ({ ok: true, value: structuredClone(list) }),
    createStash: (request: CreateStashRequest) => {
      calls.push({ name: "createStash", request });
      if (request.message === "nothing") return { ok: false, error: { kind: "nothingToStash" } };
      const made = stashOf(list.length + 5, {
        message: request.message ?? null,
        untracked: request.includeUntracked,
        time: now,
      });
      list = [made, ...list];
      renumber();
      return { ok: true, value: list[0]! };
    },
    applyStash: applying(false),
    popStash: applying(true),
    dropStash: (request: StashRequest) => {
      calls.push({ name: "dropStash", request });
      list = list.filter(({ id }) => id !== request.stash);
      renumber();
      return { ok: true, value: null };
    },
    stashChanges: ({ stash }) => {
      const files: CommitFile[] =
        stash === stashes[0]?.id
          ? [
              { path: "a.txt", change: { kind: "modified" } },
              { path: "new.txt", change: { kind: "added" } },
            ]
          : [{ path: "b.txt", change: { kind: "deleted" } }];
      return { ok: true, value: { items: files, nextCursor: null } };
    },
  };
  return { commands, calls, list: () => list };
}

function renderStashes(commands: FakeCommands) {
  const fake = fakePlatform({ commands });
  const told: Told = { counts: [], chosen: [] };
  const view = render(<Page commands={fake.platform.commands} told={told} />);
  return { fake, told, ...view };
}

const widget = () => screen.getByRole("region", { name: "Stashes" });
const announced = () => within(widget()).getAllByRole("status")[0];
const titles = () => [...widget().querySelectorAll(".stash-message")].map((title) => title.textContent);

/** Opens the menu of the stash called `title`, from the keyboard, and chooses `item`. */
async function choose(user: ReturnType<typeof userEvent.setup>, title: string, item: string) {
  screen.getByRole("button", { name: `Actions for ${title}` }).focus();
  await user.keyboard("{Enter}");
  const menu = screen.getByRole("menu", { name: `Actions for ${title}` });
  const wanted = within(menu).getByRole("menuitem", { name: item });
  while (document.activeElement !== wanted) await user.keyboard("{ArrowDown}");
  await user.keyboard("{Enter}");
}

test("the Widget lists the stashes, newest first, with each one's message, branch and date, and reports how many", async () => {
  const user = userEvent.setup();
  const repository = stashRepository([
    stashOf(1),
    stashOf(2, { message: null, branch: null, untracked: true }),
  ]);
  const { container, told } = renderStashes(repository.commands);

  expect(await screen.findByRole("heading", { level: 3, name: "Stashes" })).toBeVisible();
  await screen.findByRole("button", { name: /^Stash 1/ });
  expect(titles()).toEqual(["Stash 1", `WIP on ${base.shortId}: ${base.summary}`]);
  const [first, second] = within(widget()).getAllByRole("listitem");
  expect(first).toHaveTextContent("Stash 1 On main, 2 hours ago");
  expect(second).toHaveTextContent("On a detached HEAD, 3 hours ago, with untracked files");
  const time = first!.querySelector("time");
  expect(time).toHaveAttribute("dateTime", new Date((now - 2 * 60 * 60) * 1000).toISOString());
  expect(told.counts.at(-1)).toBe(2);

  await user.click(screen.getByRole("button", { name: "Actions for Stash 1" }));
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Apply", "Pop", "Drop…"]);
  await user.keyboard("{Escape}");
  await expectNoAxeViolations(container);
});

test("with no stashes the Widget says so, and reports none, for the Commit graph to draw none", async () => {
  const { container, told } = renderStashes(stashRepository([]).commands);

  expect(await within(widget()).findByText("No stashes.")).toBeVisible();
  expect(told.counts).toEqual([0]);
  await expectNoAxeViolations(container);
});

test("a stash is made from the keyboard, with a message and the untracked files or without, and announced", async () => {
  const user = userEvent.setup();
  const repository = stashRepository([stashOf(1)]);
  const { container, told } = renderStashes(repository.commands);
  const button = await screen.findByRole("button", { name: "New stash…" });

  button.focus();
  await user.keyboard("{Enter}");
  const dialog = screen.getByRole("dialog", { name: "Stash changes" });
  const message = within(dialog).getByRole("textbox", { name: "Message (optional)" });
  expect(message).toHaveFocus();
  expect(message).toHaveAccessibleDescription("Left blank, Git names it after the commit it's made on.");
  expect(within(dialog).getByRole("checkbox", { name: "Include untracked files" })).not.toBeChecked();
  await expectNoAxeViolations(container);

  // Nothing to stash is said in the dialog, which stays open.
  await user.keyboard("nothing{Enter}");
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Nothing was stashed: there are no uncommitted changes to stash.",
  );

  await user.clear(message);
  await user.keyboard("Half-done parser");
  await user.tab();
  await user.keyboard(" ");
  expect(within(dialog).getByRole("checkbox", { name: "Include untracked files" })).toBeChecked();
  await user.click(within(dialog).getByRole("button", { name: "Stash changes" }));

  expect(await within(widget()).findByText("Stashed your changes as “Half-done parser”.")).toBeVisible();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(button).toHaveFocus();
  expect(await within(widget()).findByText(/with untracked files/)).toBeVisible();
  expect(titles()).toEqual(["Half-done parser", "Stash 1"]);
  expect(told.counts.at(-1)).toBe(2);

  // Without a message, and without the untracked files.
  await user.click(button);
  await user.click(within(screen.getByRole("dialog", { name: "Stash changes" })).getByRole("button", { name: "Stash changes" }));
  expect(await within(widget()).findByText(`Stashed your changes as “WIP on ${base.shortId}: ${base.summary}”.`)).toBeVisible();
  expect(repository.calls.map(({ request }) => request)).toEqual([
    { repository: lanewise.root, message: "nothing", includeUntracked: false },
    { repository: lanewise.root, message: "Half-done parser", includeUntracked: true },
    { repository: lanewise.root, message: null, includeUntracked: false },
  ]);
});

test("applying a stash keeps it, and popping one drops it, each from its menu, and announced", async () => {
  const user = userEvent.setup();
  const [newer, older] = [stashOf(1), stashOf(2)];
  const repository = stashRepository([newer!, older!]);
  renderStashes(repository.commands);
  await screen.findByRole("button", { name: "Actions for Stash 1" });

  await choose(user, "Stash 1", "Apply");
  expect(await within(widget()).findByText("Applied “Stash 1”: its changes are back in the working tree, and it's still stashed.")).toBeVisible();
  expect(titles()).toEqual(["Stash 1", "Stash 2"]);

  await choose(user, "Stash 1", "Pop");
  expect(
    await within(widget()).findByText("Popped “Stash 1”: its changes are back in the working tree, and it's no longer stashed."),
  ).toBeVisible();
  expect(titles()).toEqual(["Stash 2"]);
  // Its row went with it: focus moves to the one that took its place.
  expect(screen.getByRole("button", { name: /^Stash 2/ })).toHaveFocus();
  expect(repository.calls).toEqual([
    { name: "applyStash", request: { repository: lanewise.root, stash: newer!.id } },
    { name: "popStash", request: { repository: lanewise.root, stash: newer!.id } },
  ]);
});

test("a stash is only dropped once the user confirms it", async () => {
  const user = userEvent.setup();
  const repository = stashRepository([stashOf(1), stashOf(2)]);
  const { container } = renderStashes(repository.commands);
  await screen.findByRole("button", { name: "Actions for Stash 2" });

  await choose(user, "Stash 2", "Drop…");
  const dialog = await screen.findByRole("dialog", { name: "Drop “Stash 2”?" });
  expect(dialog).toHaveTextContent("Dropping this stash deletes the changes in it, which Lanewise can't bring back.");
  expect(within(dialog).getByRole("button", { name: "Keep the stash" })).toHaveFocus();
  await expectNoAxeViolations(container);

  // Kept, nothing changes, and focus goes back to the stash's menu.
  await user.keyboard("{Enter}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Actions for Stash 2" })).toHaveFocus();
  expect(repository.calls).toEqual([]);

  await choose(user, "Stash 2", "Drop…");
  await user.click(
    within(await screen.findByRole("dialog", { name: "Drop “Stash 2”?" })).getByRole("button", { name: "Drop stash" }),
  );
  expect(await within(widget()).findByText("Dropped “Stash 2”.")).toBeVisible();
  expect(titles()).toEqual(["Stash 1"]);
  expect(screen.getByRole("button", { name: /^Stash 1/ })).toHaveFocus();
  expect(repository.calls.map(({ name }) => name)).toEqual(["dropStash"]);
});

test("dropping the last stash hands focus to New stash, and the Widget says there are none", async () => {
  const user = userEvent.setup();
  const { told } = renderStashes(stashRepository([stashOf(1)]).commands);
  await screen.findByRole("button", { name: "Actions for Stash 1" });

  await choose(user, "Stash 1", "Drop…");
  await user.click(
    within(await screen.findByRole("dialog", { name: "Drop “Stash 1”?" })).getByRole("button", { name: "Drop stash" }),
  );

  expect(await within(widget()).findByText("No stashes.")).toBeVisible();
  expect(screen.getByRole("button", { name: "New stash…" })).toHaveFocus();
  expect(told.counts.at(-1)).toBe(0);
});

test("selecting a stash lists the files it changed, each of which shows its diff", async () => {
  const user = userEvent.setup();
  const [first, second] = [stashOf(1), stashOf(2)];
  const { container, told } = renderStashes(stashRepository([first!, second!]).commands);

  const select = await screen.findByRole("button", { name: /^Stash 1/ });
  select.focus();
  await user.keyboard("{Enter}");

  expect(select).toHaveAttribute("aria-current", "true");
  const shown = await within(widget()).findByRole("region", { name: "Stash 1" });
  expect(shown).toHaveTextContent(`stash@{0}, made on commit ${base.shortId} ${base.summary}`);
  const files = await within(shown).findByRole("group", { name: "Changed files" });
  expect(within(files).getAllByRole("button").map((button) => button.textContent)).toEqual([
    "a.txt Modified",
    "new.txt Added",
  ]);
  // None is chosen until one is clicked, so the Commit graph stays in view.
  expect(told.chosen).toEqual([]);
  await expectNoAxeViolations(container);

  await user.click(within(files).getByRole("button", { name: "new.txt Added" }));
  expect(told.chosen.at(-1)).toEqual({ stash: first!.id, file: { path: "new.txt", change: { kind: "added" } } });

  // Another stash, its own files.
  await user.click(screen.getByRole("button", { name: /^Stash 2/ }));
  const other = await within(widget()).findByRole("region", { name: "Stash 2" });
  await user.click(await within(other).findByRole("button", { name: "b.txt Deleted" }));
  expect(within(other).getByRole("button", { name: "b.txt Deleted" })).toHaveAttribute("aria-current", "true");
  expect(told.chosen.at(-1)).toEqual({ stash: second!.id, file: { path: "b.txt", change: { kind: "deleted" } } });
});

test("a pop that stops with conflicts keeps the stash and says so, and one that fails says why", async () => {
  const user = userEvent.setup();
  const conflicting = stashOf(1);
  const repository = stashRepository([conflicting, stashOf(2)], { conflicting: [conflicting.id] });
  const { fake } = renderStashes({
    ...repository.commands,
    applyStash: () => ({ ok: false, error: { kind: "wouldOverwrite", paths: ["b.txt"] } }),
  });
  await screen.findByRole("button", { name: "Actions for Stash 1" });

  await choose(user, "Stash 1", "Pop");
  expect(announced()).toHaveTextContent(
    "Git stopped popping “Stash 1” with conflicts in 1 file. Resolve them on the Conflicts page.",
  );
  expect(titles()).toEqual(["Stash 1", "Stash 2"]);

  await choose(user, "Stash 2", "Apply");
  expect(await within(widget()).findByRole("alert")).toHaveTextContent(
    "The stash wasn't applied: it would overwrite your uncommitted changes to b.txt, so Git didn't. Nothing has changed.",
  );
  // Each change is read again after: the stashes, once for each action that changed something.
  expect(fake.calls.filter(({ name }) => name === "stashes").length).toBe(2);
});
