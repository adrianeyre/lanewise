// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { EditorView } from "@codemirror/view";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";

import type { CommitFile, DiffHunk, FileDiff, FileStatusEntry, StageHunkError } from "../commands/api";
import { expectNoAxeViolations } from "../test/axe";
import { diffsOf, fakePlatform, type FakeCommands, historyCommit, textDiff } from "../test/fakePlatform";
import { DiffWidget } from "./DiffWidget";

// The Diff Widget's editor loads when first shown. Loading it once here keeps
// each test about what it draws, not how long Vitest takes to transform CodeMirror.
beforeAll(async () => {
  await import("./DiffEditor");
});

// Most of these are about the unified view, CodeMirror's; the split view's own tests say so.
beforeEach(() => {
  localStorage.setItem("lanewise.diff-view", "unified");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const lanewise = { root: "/work/lanewise", name: "lanewise" };
const commit = historyCommit(0).id;

function renderDiff(file: CommitFile | null, commands: FakeCommands) {
  const fake = fakePlatform({ commands });
  const view = render(
    <DiffWidget
      commands={fake.platform.commands}
      repository={lanewise}
      subject={file === null ? null : { kind: "commit", commit, file }}
    />,
  );
  return { fake, ...view };
}

function modified(path: string): CommitFile {
  return { path, change: { kind: "modified" } };
}

const lanes: DiffHunk = {
  oldStart: 1,
  oldLines: 3,
  newStart: 1,
  newLines: 3,
  lines: [" fn lanes() {", "-    let n = 1;", "+    let n = 2;", " }"],
};

/** The editor's lines, as their text, without the buttons on hunks' headers. */
function linesOf(editor: HTMLElement): string[] {
  return [...editor.querySelectorAll(".cm-line")].map((line) => {
    const text = line.cloneNode(true) as HTMLElement;
    for (const button of text.querySelectorAll(".diff-hunk-action")) button.remove();
    return text.textContent ?? "";
  });
}

test("with no file chosen, the Diff Widget says so and reads nothing", async () => {
  const { fake, container } = renderDiff(null, {});

  expect(screen.getByRole("heading", { level: 3, name: "Diff" })).toBeVisible();
  expect(screen.getByText("No file selected.")).toBeVisible();
  expect(fake.calls).toEqual([]);
  await expectNoAxeViolations(container);
});

test("the split view, the default, shows the file as it was beside the file as it is, each line numbered and marked - or +", async () => {
  localStorage.removeItem("lanewise.diff-view");
  const { container } = renderDiff(modified("graph/src/lanes.rs"), {
    commitFileDiff: diffsOf({ "graph/src/lanes.rs": textDiff("graph/src/lanes.rs", [lanes]) }),
  });

  const split = await screen.findByRole("group", { name: "Diff of graph/src/lanes.rs, side by side" });
  const table = within(split).getByRole("table");
  const rows = within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).queryAllByRole("cell").map((cell) => cell.textContent));
  expect(rows).toEqual([
    [],
    ["1", " fn lanes() {", "1", " fn lanes() {"],
    ["2", "-    let n = 1;", "2", "+    let n = 2;"],
    ["3", " }", "3", " }"],
  ]);
  expect(within(table).getByRole("rowheader", { name: "@@ -1,3 +1,3 @@" })).toBeVisible();
  expect(within(table).getByText("let n = 1;", { exact: false })).toHaveClass("split-diff-removed");
  expect(within(table).getByText("let n = 2;", { exact: false })).toHaveClass("split-diff-added");
  // A commit's hunks stay as they are.
  expect(within(split).queryByRole("button")).toBeNull();
  // The keyboard reaches it, to scroll it.
  expect(split).toHaveAttribute("tabindex", "0");
  expect(screen.getByRole("button", { name: "Split" })).toHaveAttribute("aria-pressed", "true");
  await expectNoAxeViolations(container);
});

test("Unified and Split switch the view, and the one chosen is kept for the next diff", async () => {
  localStorage.removeItem("lanewise.diff-view");
  const user = userEvent.setup();
  renderDiff(modified("a.txt"), { commitFileDiff: diffsOf({ "a.txt": textDiff("a.txt", [lanes]) }) });
  await screen.findByRole("group", { name: "Diff of a.txt, side by side" });

  await user.click(screen.getByRole("button", { name: "Unified" }));

  expect(await screen.findByRole("textbox", { name: "Diff of a.txt" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Unified" })).toHaveAttribute("aria-pressed", "true");
  expect(localStorage.getItem("lanewise.diff-view")).toBe("unified");

  await user.click(screen.getByRole("button", { name: "Split" }));

  expect(await screen.findByRole("group", { name: "Diff of a.txt, side by side" })).toBeVisible();
  expect(localStorage.getItem("lanewise.diff-view")).toBe("split");
});

test("an unstaged change's split view stages a hunk from its header", async () => {
  localStorage.removeItem("lanewise.diff-view");
  const user = userEvent.setup();
  const entry: FileStatusEntry = { path: "a.txt", change: { kind: "modified" }, staged: false };
  const fake = fakePlatform({
    commands: {
      workingTreeFileDiff: () => ({ ok: true, value: textDiff("a.txt", [lanes]) }),
      stageHunk: () => ({ ok: true, value: null }),
    },
  });
  render(
    <DiffWidget
      commands={fake.platform.commands}
      repository={lanewise}
      subject={{ kind: "workingTree", entry }}
    />,
  );
  const split = await screen.findByRole("group", { name: "Diff of a.txt, side by side" });

  await user.click(within(split).getByRole("button", { name: "Stage hunk" }));

  expect(fake.calls.at(-1)).toEqual({
    name: "stageHunk",
    request: { repository: "/work/lanewise", path: "a.txt", hunk: lanes },
  });
});

test("its close button and Escape close it", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn<() => void>();
  const fake = fakePlatform({ commands: { commitFileDiff: diffsOf({ "a.txt": textDiff("a.txt", [lanes]) }) } });
  render(
    <DiffWidget
      commands={fake.platform.commands}
      repository={lanewise}
      subject={{ kind: "commit", commit, file: modified("a.txt") }}
      onClose={onClose}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Close the diff" }));
  expect(onClose).toHaveBeenCalledTimes(1);

  screen.getByRole("button", { name: "Unified" }).focus();
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledTimes(2);
});

test("a chosen file's unified diff is a read-only editor named for the file, marked + and -, and highlighted as its language", async () => {
  const { fake, container } = renderDiff(modified("graph/src/lanes.rs"), {
    commitFileDiff: diffsOf({ "graph/src/lanes.rs": textDiff("graph/src/lanes.rs", [lanes]) }),
  });

  const editor = await screen.findByRole("textbox", { name: "Diff of graph/src/lanes.rs" });
  expect(editor).toHaveAttribute("aria-readonly", "true");
  expect(editor).toHaveAttribute("aria-multiline", "true");
  expect(linesOf(editor)).toEqual([
    "@@ -1,3 +1,3 @@",
    " fn lanes() {",
    "-    let n = 1;",
    "+    let n = 2;",
    " }",
  ]);
  const [, , removed, addedLine] = editor.querySelectorAll(".cm-line");
  expect(removed).toHaveClass("diff-line-removed");
  expect(addedLine).toHaveClass("diff-line-added");
  // Rust, by the file's name: both the removed line and the added one.
  // The language loads and parses in the background, which a busy machine can make slow.
  expect(
    await within(removed as HTMLElement).findByText("let", {}, { timeout: 5000 }),
  ).toHaveClass("tok-keyword");
  expect(within(addedLine as HTMLElement).getByText("2")).toHaveClass("tok-number");
  expect(fake.calls).toEqual([
    {
      name: "commitFileDiff",
      request: { repository: "/work/lanewise", commit, path: "graph/src/lanes.rs", from: null, limit: 5000 },
    },
  ]);
  await expectNoAxeViolations(container);
});

test("the editor is reached with Tab, and Tab leaves it again", async () => {
  const user = userEvent.setup();
  render(
    <>
      <button type="button">Before</button>
      <DiffWidget
        commands={
          fakePlatform({ commands: { commitFileDiff: diffsOf({ "a.txt": textDiff("a.txt", [lanes]) }) } })
            .platform.commands
        }
        repository={lanewise}
        subject={{ kind: "commit", commit, file: modified("a.txt") }}
      />
      <button type="button">After</button>
    </>,
  );
  const editor = await screen.findByRole("textbox", { name: "Diff of a.txt" });

  // Past the view's Split and Unified in the Widget's header, then the editor.
  screen.getByRole("button", { name: "Unified" }).focus();
  await user.tab();
  expect(editor).toHaveFocus();
  await user.keyboard("typed");
  expect(linesOf(editor)[1]).toBe(" fn lanes() {");
  await user.tab();
  expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
});

test("a file of a type with no known language is shown plain", async () => {
  const { container } = renderDiff(modified("notes.lanewise-unknown"), {
    commitFileDiff: diffsOf({ "notes.lanewise-unknown": textDiff("notes.lanewise-unknown", [lanes]) }),
  });

  const editor = await screen.findByRole("textbox", { name: "Diff of notes.lanewise-unknown" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(editor.querySelector("[class*='tok-']")).toBeNull();
  await expectNoAxeViolations(container);
});

test("a renamed file is read from where it was, and a rename or mode change with no new lines is said in words", async () => {
  const renamed: FileDiff = {
    old: { path: "graph/src/sort.rs", mode: "file" },
    new: { path: "graph/src/order.rs", mode: "executable" },
    content: { kind: "text", hunks: [] },
  };
  const { fake, container } = renderDiff(
    { path: "graph/src/order.rs", change: { kind: "renamed", from: "graph/src/sort.rs" } },
    { commitFileDiff: diffsOf({ "graph/src/order.rs": renamed }) },
  );

  expect(await screen.findByText("Renamed from graph/src/sort.rs.")).toBeVisible();
  expect(screen.getByText("Made executable.")).toBeVisible();
  expect(screen.getByText("Its content didn't change.")).toBeVisible();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(fake.calls[0]!.request).toMatchObject({ path: "graph/src/order.rs", from: "graph/src/sort.rs" });
  await expectNoAxeViolations(container);
});

test("a binary file and a submodule are described in words, not drawn", async () => {
  const binary: FileDiff = {
    old: { path: "logo.png", mode: "file" },
    new: { path: "logo.png", mode: "file" },
    content: { kind: "binary", oldSize: 1234, newSize: 3_400_000 },
  };
  const submodule: FileDiff = {
    old: { path: "vendor/gix", mode: "submodule" },
    new: { path: "vendor/gix", mode: "submodule" },
    content: { kind: "submodule", old: "a".repeat(40), new: "b".repeat(40) },
  };
  const commands = { commitFileDiff: diffsOf({ "logo.png": binary, "vendor/gix": submodule }) };
  const { container } = renderDiff(modified("logo.png"), commands);

  expect(
    await screen.findByText(
      "A binary file, so its changes aren't shown as lines. It was 1.2 KB and is now 3.4 MB.",
    ),
  ).toBeVisible();
  expect(screen.queryByRole("textbox")).toBeNull();
  await expectNoAxeViolations(container);

  cleanup();
  renderDiff(modified("vendor/gix"), commands);
  expect(await screen.findByText("A submodule, moved from commit aaaaaaa to commit bbbbbbb.")).toBeVisible();
  expect(screen.queryByRole("textbox")).toBeNull();
});

/** A diff adding `count` lines to a new file. */
function added(path: string, count: number): FileDiff {
  const lines = Array.from({ length: count }, (_, n) => `+line ${n + 1}`);
  return {
    old: null,
    new: { path, mode: "file" },
    content: { kind: "text", hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: count, lines }] },
  };
}

test("a diff over the limit asks before it is shown, and the editor takes focus when it is", async () => {
  const user = userEvent.setup();
  localStorage.setItem("lanewise.diff-limit", "3");
  const { fake, container } = renderDiff(modified("long.txt"), {
    commitFileDiff: diffsOf({ "long.txt": added("long.txt", 12_345) }),
  });

  const prompt = await screen.findByRole("group", { name: /^This diff is 12,345 lines long/ });
  expect(prompt).toHaveTextContent(
    "This diff is 12,345 lines long: 12,345 lines added and 0 lines removed. Lanewise asks before showing a diff over 3 lines",
  );
  expect(screen.queryByRole("textbox")).toBeNull();
  await expectNoAxeViolations(container);

  await user.click(within(prompt).getByRole("button", { name: "Show the diff" }));
  const editor = await screen.findByRole("textbox", { name: "Diff of long.txt" });
  expect(editor).toHaveFocus();
  expect(fake.calls.map((call) => (call.request as { limit: number }).limit)).toEqual([3, 200_000]);
  // Only the lines in view are drawn, however long the diff.
  expect(editor.querySelectorAll(".cm-line").length).toBeLessThan(1000);
  expect(localStorage.getItem("lanewise.diff-limit")).toBe("3");
});

test("the limit can be changed where it asks, and is kept", async () => {
  const user = userEvent.setup();
  const { fake } = renderDiff(modified("long.txt"), {
    commitFileDiff: diffsOf({ "long.txt": added("long.txt", 6000) }),
  });

  const limit = await screen.findByRole("spinbutton", { name: "Ask before showing a diff over" });
  expect(limit).toHaveValue(5000);
  await user.clear(limit);
  await user.type(limit, "0");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a whole number of lines from 1 to 200,000.");
  expect(limit).toHaveAttribute("aria-invalid", "true");
  expect(localStorage.getItem("lanewise.diff-limit")).toBeNull();

  await user.clear(limit);
  await user.type(limit, "10000{Enter}");
  expect(await screen.findByRole("textbox", { name: "Diff of long.txt" })).toBeVisible();
  expect(localStorage.getItem("lanewise.diff-limit")).toBe("10000");
  expect(fake.calls.map((call) => (call.request as { limit: number }).limit)).toEqual([5000, 10_000]);
});

test("a diff longer than any diff Lanewise shows says so", async () => {
  const { container } = renderDiff(modified("huge.txt"), {
    commitFileDiff: () => ({
      ok: true,
      value: {
        ...added("huge.txt", 0),
        content: { kind: "tooLarge", lines: 300_000, added: 300_000, removed: 0, showable: false },
      },
    }),
  });

  expect(
    await screen.findByText(
      "This diff is 300,000 lines long: 300,000 lines added and 0 lines removed. That is more than the 200,000 lines Lanewise can show.",
    ),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "Show the diff" })).toBeNull();
  await expectNoAxeViolations(container);
});

test("a file that has gone from the commit says so", async () => {
  renderDiff(modified("gone.txt"), { commitFileDiff: diffsOf({}) });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This commit has no file gone.txt. Choose another in Commit details.",
  );
});

function renderWorkingTreeDiff(entry: FileStatusEntry, commands: FakeCommands, refreshes = 0) {
  const fake = fakePlatform({ commands });
  const draw = (count: number) => (
    <DiffWidget
      commands={fake.platform.commands}
      repository={lanewise}
      subject={{ kind: "workingTree", entry }}
      refreshes={count}
    />
  );
  const view = render(draw(refreshes));
  return { fake, redraw: (count: number) => view.rerender(draw(count)), ...view };
}

test("a staged change's diff is from the last commit to what's staged, and an unstaged one's from what's staged", async () => {
  const staged: FileStatusEntry = { path: "src/lanes.rs", change: { kind: "renamed", from: "src/graph.rs" }, staged: true };
  const { fake, container } = renderWorkingTreeDiff(staged, {
    workingTreeFileDiff: () => ({ ok: true, value: textDiff("src/lanes.rs", [lanes]) }),
  });

  const editor = await screen.findByRole("textbox", { name: "Diff of src/lanes.rs" });
  expect(linesOf(editor)).toContain("+    let n = 2;");
  expect(screen.getByText("Staged: from the last commit to what's staged.")).toBeVisible();
  expect(fake.calls).toEqual([
    {
      name: "workingTreeFileDiff",
      request: { repository: lanewise.root, path: "src/lanes.rs", from: "src/graph.rs", staged: true, limit: 5000 },
    },
  ]);
  await expectNoAxeViolations(container);
  cleanup();

  const unstaged = renderWorkingTreeDiff({ path: "README.md", change: { kind: "modified" }, staged: false }, {
    workingTreeFileDiff: () => ({ ok: true, value: textDiff("README.md", [lanes]) }),
  });
  await screen.findByRole("textbox", { name: "Diff of README.md" });
  expect(screen.getByText("Unstaged: from what's staged to the working tree.")).toBeVisible();
  expect(unstaged.fake.calls.map((call) => call.request)).toEqual([
    { repository: lanewise.root, path: "README.md", from: null, staged: false, limit: 5000 },
  ]);
});

test("a working tree change reads its diff again as the working tree changes, keeping the editor when it's the same", async () => {
  let hunk = lanes;
  const { fake, redraw } = renderWorkingTreeDiff({ path: "README.md", change: { kind: "modified" }, staged: false }, {
    workingTreeFileDiff: () => ({ ok: true, value: textDiff("README.md", [hunk]) }),
  });
  const editor = await screen.findByRole("textbox", { name: "Diff of README.md" });

  await act(async () => redraw(1));
  expect(fake.calls).toHaveLength(2);
  // The same diff: the same editor, not a new one that loses the place.
  expect(screen.getByRole("textbox", { name: "Diff of README.md" })).toBe(editor);

  hunk = { ...lanes, lines: [...lanes.lines.slice(0, 3), "+    let n = 3;", " }"] };
  await act(async () => redraw(2));
  expect(fake.calls).toHaveLength(3);
  expect(linesOf(await screen.findByRole("textbox", { name: "Diff of README.md" }))).toContain("+    let n = 3;");
});

test("a working tree change found gone when read again keeps its diff, for the Working tree Widget to follow it", async () => {
  let gone = false;
  const { redraw } = renderWorkingTreeDiff({ path: "README.md", change: { kind: "modified" }, staged: false }, {
    workingTreeFileDiff: () =>
      gone
        ? { ok: false, error: { kind: "changeNotFound", path: "README.md" } }
        : { ok: true, value: textDiff("README.md", [lanes]) },
  });
  const editor = await screen.findByRole("textbox", { name: "Diff of README.md" });

  gone = true;
  await act(async () => redraw(1));

  expect(screen.getByRole("textbox", { name: "Diff of README.md" })).toBe(editor);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a working tree change that has gone says to choose another", async () => {
  const { container } = renderWorkingTreeDiff({ path: "gone.txt", change: { kind: "modified" }, staged: true }, {
    workingTreeFileDiff: () => ({ ok: false, error: { kind: "changeNotFound", path: "gone.txt" } }),
  });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "gone.txt no longer has this change. Choose another in the Working tree.",
  );
  await expectNoAxeViolations(container);
});

/** Three hunks of README.md, far enough apart to stay three. */
const first: DiffHunk = { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [" # Lanewise", "-old", "+new"] };
const second: DiffHunk = { oldStart: 20, oldLines: 2, newStart: 20, newLines: 3, lines: [" twenty", "+twenty-one"] };
const third: DiffHunk = { oldStart: 40, oldLines: 1, newStart: 41, newLines: 1, lines: ["-forty", "+Forty"] };

/**
 * A working tree change whose diff has `hunks`, and whose `stageHunk` and
 * `unstageHunk` move the hunk sent to the file's other diff, or fail with
 * `failing`. Each change it's told of is drawn again with one more refresh,
 * as the Repository page does.
 */
function renderHunks(entry: FileStatusEntry, hunks: DiffHunk[], failing?: StageHunkError) {
  let diff = hunks;
  let other: DiffHunk[] = [];
  let refreshes = 0;
  const change: (request: { hunk: DiffHunk }) => { ok: true; value: null } | { ok: false; error: StageHunkError } = ({ hunk }) => {
    if (failing !== undefined) return { ok: false, error: failing };
    diff = diff.filter((shown) => JSON.stringify(shown) !== JSON.stringify(hunk));
    other = [...other, hunk];
    return { ok: true, value: null };
  };
  const fake = fakePlatform({
    commands: {
      workingTreeFileDiff: ({ staged }) => ({
        ok: true,
        value: textDiff(entry.path, staged === entry.staged ? diff : other),
      }),
      stageHunk: change,
      unstageHunk: change,
    },
  });
  const draw = (shown: FileStatusEntry) => (
    <DiffWidget
      commands={fake.platform.commands}
      repository={lanewise}
      subject={{ kind: "workingTree", entry: shown }}
      refreshes={refreshes}
      onChanged={() => {
        refreshes += 1;
        view.rerender(draw(shown));
      }}
    />
  );
  const view = render(draw(entry));
  return { fake, show: (shown: FileStatusEntry) => view.rerender(draw(shown)), ...view };
}

const readme: FileStatusEntry = { path: "README.md", change: { kind: "modified" }, staged: false };

function hunkButtons(editor: HTMLElement): HTMLElement[] {
  return [...editor.querySelectorAll<HTMLElement>(".diff-hunk-action")];
}

/** Puts the editor's cursor at the start of its `line`th line, from 1. */
function putCursor(editor: HTMLElement, line: number) {
  const view = EditorView.findFromDOM(editor)!;
  act(() => view.dispatch({ selection: { anchor: view.state.doc.line(line).from } }));
}

function cursorLine(editor: HTMLElement): number {
  const { state } = EditorView.findFromDOM(editor)!;
  return state.doc.lineAt(state.selection.main.head).number;
}

test("each hunk of an unstaged change has Stage hunk, which stages just it, and the diff changes in place", async () => {
  const { fake, container } = renderHunks(readme, [first, second, third]);
  const editor = await screen.findByRole("textbox", { name: "Diff of README.md" });
  expect(screen.getByText("Press S in the diff to stage the hunk at the cursor, or choose Stage hunk on its header.")).toBeVisible();
  expect(editor).toHaveAttribute("aria-keyshortcuts", "S");
  expect(editor).toHaveAccessibleDescription(
    "Press S in the diff to stage the hunk at the cursor, or choose Stage hunk on its header.",
  );
  const buttons = hunkButtons(editor);
  expect(buttons.map((button) => button.textContent)).toEqual(["Stage hunk", "Stage hunk", "Stage hunk"]);
  // The pointer's way: the keyboard's is the key, which the editor's description names.
  expect(buttons[0]).toHaveAttribute("tabindex", "-1");
  expect(buttons[0]).toHaveAttribute("aria-hidden", "true");
  await expectNoAxeViolations(container);

  await userEvent.setup().click(buttons[1]!);

  expect(fake.calls.filter((call) => call.name === "stageHunk")).toEqual([
    { name: "stageHunk", request: { repository: lanewise.root, path: "README.md", hunk: second } },
  ]);
  await waitFor(() => expect(linesOf(editor)).not.toContain("+twenty-one"));
  // The same editor, changed in place, so it keeps its scroll position.
  expect(screen.getByRole("textbox", { name: "Diff of README.md" })).toBe(editor);
  expect(linesOf(editor)).toEqual(["@@ -1,2 +1,2 @@", " # Lanewise", "-old", "+new", "@@ -40 +41 @@", "-forty", "+Forty"]);
  expect(hunkButtons(editor)).toHaveLength(2);
  expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Staged the hunk at line 20 of README.md.");
  await expectNoAxeViolations(container);
});

test("S stages the hunk at the cursor, and the editor keeps the focus with the cursor on the hunk after", async () => {
  const user = userEvent.setup();
  const { fake } = renderHunks(readme, [first, second, third]);
  const editor = await screen.findByRole("textbox", { name: "Diff of README.md" });
  editor.focus();
  // On the second hunk's added line.
  putCursor(editor, 6);

  await user.keyboard("s");

  expect(fake.calls.filter((call) => call.name === "stageHunk").map((call) => call.request)).toEqual([
    { repository: lanewise.root, path: "README.md", hunk: second },
  ]);
  await waitFor(() => expect(linesOf(editor)).not.toContain("+twenty-one"));
  expect(editor).toHaveFocus();
  expect(linesOf(editor)[cursorLine(editor) - 1]).toBe("@@ -40 +41 @@");

  // Caps Lock on, the same.
  await user.keyboard("S");
  await waitFor(() => expect(linesOf(editor)).not.toContain("+Forty"));
  expect(editor).toHaveFocus();
  expect(linesOf(editor)).toEqual(["@@ -1,2 +1,2 @@", " # Lanewise", "-old", "+new"]);
  // Other keys do nothing, and the text stays as it is.
  await user.keyboard("u");
  expect(fake.calls.filter((call) => call.name !== "workingTreeFileDiff")).toHaveLength(2);
  expect(linesOf(editor)).toHaveLength(4);
});

test("a second hunk is only sent once the diff has been read again after the first", async () => {
  const user = userEvent.setup();
  let read: (() => void) | undefined;
  let reads = 0;
  const fake = fakePlatform({
    commands: {
      workingTreeFileDiff: () => {
        reads += 1;
        const diff = { ok: true as const, value: textDiff("README.md", reads === 1 ? [first, second] : [second]) };
        return reads === 1 ? diff : new Promise((resolve) => (read = () => resolve(diff)));
      },
      stageHunk: () => ({ ok: true, value: null }),
    },
  });
  let refreshes = 0;
  const draw = () => (
    <DiffWidget
      commands={fake.platform.commands}
      repository={lanewise}
      subject={{ kind: "workingTree", entry: readme }}
      refreshes={refreshes}
      onChanged={() => {
        refreshes += 1;
        view.rerender(draw());
      }}
    />
  );
  const view = render(draw());
  const editor = await screen.findByRole("textbox", { name: "Diff of README.md" });
  editor.focus();

  await user.keyboard("s");
  await waitFor(() => expect(reads).toBe(2));
  // Pressed again before the diff comes back: nothing is sent from the old one.
  await user.keyboard("s");
  expect(fake.calls.filter((call) => call.name === "stageHunk")).toHaveLength(1);

  await act(async () => read?.());
  await waitFor(() => expect(linesOf(editor)[0]).toBe("@@ -20,2 +20,3 @@"));
  await user.keyboard("s");
  expect(fake.calls.filter((call) => call.name === "stageHunk").map((call) => (call.request as { hunk: DiffHunk }).hunk)).toEqual([
    first,
    second,
  ]);
});

test("each hunk of a staged change has Unstage hunk, and U unstages the hunk at the cursor, from where a renamed file was", async () => {
  const user = userEvent.setup();
  const staged: FileStatusEntry = { path: "docs/lanes.md", change: { kind: "renamed", from: "docs/graph.md" }, staged: true };
  const { fake, container } = renderHunks(staged, [first, third]);
  const editor = await screen.findByRole("textbox", { name: "Diff of docs/lanes.md" });
  expect(hunkButtons(editor).map((button) => button.textContent)).toEqual(["Unstage hunk", "Unstage hunk"]);
  expect(editor).toHaveAttribute("aria-keyshortcuts", "U");
  expect(screen.getByText("Press U in the diff to unstage the hunk at the cursor, or choose Unstage hunk on its header.")).toBeVisible();
  editor.focus();

  await user.keyboard("s");
  expect(fake.calls.map((call) => call.name)).toEqual(["workingTreeFileDiff"]);
  await user.keyboard("u");

  expect(fake.calls[1]).toEqual({
    name: "unstageHunk",
    request: { repository: lanewise.root, path: "docs/lanes.md", from: "docs/graph.md", hunk: first },
  });
  await waitFor(() => expect(linesOf(editor)).toEqual(["@@ -40 +41 @@", "-forty", "+Forty"]));
  expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Unstaged the hunk at line 1 of docs/lanes.md.");
  await expectNoAxeViolations(container);
});

test("the last hunk staged, the file's staged change it went to takes the focus on", async () => {
  const user = userEvent.setup();
  const { show } = renderHunks(readme, [first]);
  const editor = await screen.findByRole("textbox", { name: "Diff of README.md" });
  editor.focus();

  await user.keyboard("s");
  await screen.findByText("Staged the hunk at line 1 of README.md.");
  // As the Working tree Widget follows the change to its staged entry.
  show({ ...readme, staged: true });

  const staged = await screen.findByRole("textbox", { name: "Diff of README.md" });
  expect(staged).not.toBe(editor);
  await waitFor(() => expect(staged).toHaveFocus());
});

test("a hunk the file no longer has says so, stages nothing and reads the diff again", async () => {
  const user = userEvent.setup();
  const { fake, container } = renderHunks(readme, [first], { kind: "hunkNotFound", path: "README.md" });
  const editor = await screen.findByRole("textbox", { name: "Diff of README.md" });

  await user.click(hunkButtons(editor)[0]!);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "README.md has changed since this diff was read, so the hunk wasn't staged. The diff shows it as it is now.",
  );
  await waitFor(() =>
    expect(fake.calls.map((call) => call.name)).toEqual(["workingTreeFileDiff", "stageHunk", "workingTreeFileDiff"]),
  );
  expect(screen.getByRole("status", { name: "" })).toHaveTextContent("");
  await expectNoAxeViolations(container);
});

test("a hunk Git fails to stage says what Git said", async () => {
  const user = userEvent.setup();
  renderHunks(readme, [first], { kind: "gitFailed", command: "git apply", code: 1, message: "error: patch failed" });
  const editor = await screen.findByRole("textbox", { name: "Diff of README.md" });

  await user.click(hunkButtons(editor)[0]!);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The hunk wasn't staged. Git stopped with exit code 1: error: patch failed",
  );
});

test("a commit's diff has no hunk actions", async () => {
  const user = userEvent.setup();
  const { fake } = renderDiff(modified("a.txt"), { commitFileDiff: diffsOf({ "a.txt": textDiff("a.txt", [lanes]) }) });
  const editor = await screen.findByRole("textbox", { name: "Diff of a.txt" });
  editor.focus();

  await user.keyboard("s");

  expect(hunkButtons(editor)).toEqual([]);
  expect(editor).not.toHaveAttribute("aria-keyshortcuts");
  expect(screen.queryByText(/Press S/)).toBeNull();
  expect(fake.calls.map((call) => call.name)).toEqual(["commitFileDiff"]);
});

test("a stash's file shows its diff from the commit the stash was made on, and one the stash doesn't have says so", async () => {
  const stash = "5".repeat(40);
  const draw = (file: CommitFile, commands: FakeCommands) => {
    const fake = fakePlatform({ commands });
    const view = render(
      <DiffWidget commands={fake.platform.commands} repository={lanewise} subject={{ kind: "stash", stash, file }} />,
    );
    return { fake, ...view };
  };
  const { fake, container } = draw(modified("graph/src/lanes.rs"), {
    stashFileDiff: ({ path }) => ({ ok: true, value: textDiff(path, [lanes]) }),
  });

  const editor = await screen.findByRole("textbox", { name: "Diff of graph/src/lanes.rs" });
  expect(linesOf(editor)).toContain("+    let n = 2;");
  // A stash's diff is as it was stashed: there are no hunks to stage from it.
  expect(screen.queryByRole("button", { name: /Stage hunk/ })).toBeNull();
  expect(fake.calls).toEqual([
    {
      name: "stashFileDiff",
      request: { repository: "/work/lanewise", stash, path: "graph/src/lanes.rs", from: null, limit: 5000 },
    },
  ]);
  await expectNoAxeViolations(container);
  cleanup();

  draw(modified("gone.txt"), {
    stashFileDiff: ({ path }) => ({ ok: false, error: { kind: "fileNotFound", stash, path } }),
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This stash has no file gone.txt. Choose another in the Stashes Widget.",
  );
});
