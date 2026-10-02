// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { EditorView } from "@codemirror/view";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "../App";
import type { ConflictedFile, InProgressOperation } from "../commands/api";
import { expectNoAxeViolations } from "../test/axe";
import { fakePlatform, type FakeCommands, historyCommit } from "../test/fakePlatform";

// jsdom lays nothing out, so a Range has no rectangles: CodeMirror measures
// them to scroll a Conflict Hunk into view, and finds none.
Range.prototype.getClientRects ??= function getClientRects() {
  return Object.assign([], { item: () => null }) as unknown as DOMRectList;
};
Range.prototype.getBoundingClientRect ??= function getBoundingClientRect() {
  return new DOMRect();
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const lanewise = { root: "/work/lanewise", name: "lanewise" };
const feature = historyCommit(2, { labels: [{ kind: "branch", name: "feature" }] });

function mergeOf(conflicts: string[], resolved: string[] = []): InProgressOperation {
  return { kind: "merge", into: "main", merging: [feature], conflicts, resolved };
}

const text = (lines: string[]) => ({ kind: "text" as const, text: lines.join("\n") });

/**
 * A fixture conflict: `src/lanes.rs` changed on both sides in two places,
 * the first with its Base shown, as `merge.conflictStyle=diff3` leaves it,
 * the second without.
 */
const lanes: ConflictedFile = {
  base: text(["fn lanes() -> u32 {", "    let lanes = 3;", "    lanes", "}", "", "fn spare() -> u32 {", "    1", "}", ""]),
  ours: text(["fn lanes() -> u32 {", "    let lanes = 4;", "    lanes", "}", "", "fn spare() -> u32 {", "    2", "}", ""]),
  theirs: text(["fn lanes() -> u32 {", "    let lanes = 5;", "    lanes", "}", "", "fn spare() -> u32 {", "    3", "}", ""]),
  working: text([
    "fn lanes() -> u32 {",
    "<<<<<<< HEAD",
    "    let lanes = 4;",
    "||||||| base",
    "    let lanes = 3;",
    "=======",
    "    let lanes = 5;",
    ">>>>>>> feature",
    "    lanes",
    "}",
    "",
    "fn spare() -> u32 {",
    "<<<<<<< HEAD",
    "    2",
    "=======",
    "    3",
    ">>>>>>> feature",
    "}",
    "",
  ]),
  reports: [],
  oursSubject: "Use four lanes",
  theirsSubject: "Use five lanes",
};

const conflicted = (lanes.working as { text: string }).text;

/** `src/lanes.rs` with its first Conflict Hunk resolved as `first`, and the second left. */
const withFirst = (first: string[]) =>
  [
    "fn lanes() -> u32 {",
    ...first,
    "    lanes",
    "}",
    "",
    "fn spare() -> u32 {",
    "<<<<<<< HEAD",
    "    2",
    "=======",
    "    3",
    ">>>>>>> feature",
    "}",
    "",
  ].join("\n");

const merge: ConflictedFile = {
  base: text(["a", ""]),
  ours: text(["b", ""]),
  theirs: text(["c", ""]),
  working: text(["<<<<<<< HEAD", "b", "=======", "c", ">>>>>>> feature", ""]),
  reports: [],
  oursSubject: "Change a to b",
  theirsSubject: "Change a to c",
};

/** A version with `\r\n` between its lines, as a file written on Windows has. */
const crlf = (version: ConflictedFile["base"]) =>
  version?.kind === "text" ? { kind: "text" as const, text: version.text.replaceAll("\n", "\r\n") } : version;

/** Lanewise, opened on `lanewise` partway through a merge of `feature` into `main`, with these conflicted files. */
async function opened(files: Record<string, ConflictedFile>, commands: FakeCommands = {}) {
  let shown = mergeOf(Object.keys(files).toSorted());
  const user = userEvent.setup();
  const fake = fakePlatform({
    folders: [lanewise.root],
    commands: {
      openRepository: () => ({ ok: true, value: lanewise }),
      operationInProgress: () => ({ ok: true, value: shown }),
      conflictedFile: ({ path }) =>
        files[path] === undefined ? { ok: false, error: { kind: "notConflicted", path } } : { ok: true, value: files[path] },
      resolveConflict: ({ path }) => {
        shown = mergeOf(
          shown.conflicts.filter((file) => file !== path),
          [...shown.resolved, path].toSorted(),
        );
        return { ok: true, value: null };
      },
      resolveWholeFile: ({ path }) => {
        shown = mergeOf(
          shown.conflicts.filter((file) => file !== path),
          [...shown.resolved, path].toSorted(),
        );
        return { ok: true, value: null };
      },
      ...commands,
    },
  });
  const { container } = render(<App platform={fake.platform} />);
  await user.click(await screen.findByRole("button", { name: "Open repository" }));
  const list = await screen.findByRole("region", { name: "Conflicted files" });
  return { user, fake, container, files: list };
}

/** Chooses `path` in Conflicted files, and gives its Resolution's editor once it's drawn. */
async function choose(user: ReturnType<typeof userEvent.setup>, files: HTMLElement, path: string) {
  await user.click(within(files).getByRole("button", { name: `${path} Conflicted` }));
  return screen.findByRole("textbox", { name: `Resolution of ${path}` });
}

function viewOf(editor: HTMLElement): EditorView {
  return EditorView.findFromDOM(editor)!;
}

function textOf(editor: HTMLElement): string {
  return viewOf(editor).state.doc.toString();
}

function cursorLine(editor: HTMLElement): number {
  const { state } = viewOf(editor);
  return state.doc.lineAt(state.selection.main.head).number;
}

function calledWith(fake: ReturnType<typeof fakePlatform>, name: string) {
  return fake.calls.filter((call) => call.name === name).map((call) => call.request);
}

// The first test here pays for loading CodeMirror's merge view, then runs axe over four editors: about 3s under load, so with the rest of the suite beside it,
// it's given longer than Vitest's 5s default.
test("choosing a conflicted file shows its Base, Ours and Theirs, each saying which side it is, and its Resolution", { timeout: 20_000 }, async () => {
  const { user, container, files } = await opened({ "src/lanes.rs": lanes, "src/merge.rs": merge });
  // Until a file is chosen, neither is drawn.
  expect(screen.queryByRole("region", { name: "Base / Ours / Theirs" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Resolution" })).toBeNull();
  expect(within(files).getByText(/Choose a file to resolve it here/)).toBeVisible();

  const editor = await choose(user, files, "src/lanes.rs");
  expect(within(files).getByRole("button", { name: "src/lanes.rs Conflicted" })).toHaveAttribute("aria-current", "true");
  expect(within(files).getByRole("status")).toHaveTextContent("Showing “src/lanes.rs” in Base / Ours / Theirs, the Resolution and the AI Suggestion.");

  const threeWay = screen.getByRole("region", { name: "Base / Ours / Theirs" });
  const base = within(threeWay).getByRole("textbox", { name: "Base of src/lanes.rs" });
  const ours = within(threeWay).getByRole("textbox", { name: "Ours of src/lanes.rs" });
  const theirs = within(threeWay).getByRole("textbox", { name: "Theirs of src/lanes.rs" });
  expect(textOf(base)).toBe((lanes.base as { text: string }).text);
  expect(textOf(ours)).toBe((lanes.ours as { text: string }).text);
  expect(textOf(theirs)).toBe((lanes.theirs as { text: string }).text);
  // Each side is read-only, and says what it is in the merge, and what it changed.
  expect(ours).toHaveAttribute("aria-readonly", "true");
  expect(base).toHaveAccessibleDescription(
    "Before either side changed it, where the two branches last met. What Ours and Theirs each changed. " +
      "Removed or changed by them: line 2 and line 7.",
  );
  expect(ours).toHaveAccessibleDescription("“main”, the branch being merged into. Changed from the Base: line 2 and line 7.");
  expect(theirs).toHaveAccessibleDescription("“feature”, being merged. Changed from the Base: line 2 and line 7.");
  expect(within(threeWay).getByRole("group", { name: "Ours" })).toBeVisible();
  // Coloured as a diff is, not by colour alone: each changed line has a `+` or `−` too, and the words above say which.
  expect(ours.querySelectorAll(".conflict-line-added")).toHaveLength(2);
  expect(theirs.querySelectorAll(".conflict-line-added")).toHaveLength(2);
  expect([...ours.closest(".cm-editor")!.querySelectorAll(".cm-gutterElement:not([style*=visibility]) .conflict-mark")].map((mark) => mark.textContent)).toEqual(["+", "+"]);
  // The Base's lines Ours or Theirs changed are red, each with a `−`.
  expect(base.querySelectorAll(".conflict-line-removed")).toHaveLength(2);
  expect([...base.closest(".cm-editor")!.querySelectorAll(".cm-gutterElement:not([style*=visibility]) .conflict-mark")].map((mark) => mark.textContent)).toEqual(["−", "−"]);

  const resolution = screen.getByRole("region", { name: "Resolution" });
  expect(editor).not.toHaveAttribute("aria-readonly", "true");
  expect(textOf(editor)).toBe(conflicted);
  expect(within(resolution).getByText("2 Conflict Hunks left. At Conflict Hunk 1 of 2, lines 2–8.")).toBeVisible();
  expect(editor).toHaveAccessibleDescription(/F7 goes to the next Conflict Hunk.*2 Conflict Hunks left\. At Conflict Hunk 1 of 2, lines 2–8\.$/);
  expect(within(resolution).getByRole("group", { name: "Resolve Conflict Hunk 1, lines 2–8" })).toBeVisible();
  // Each side's lines, and the Conflict Markers round them, are marked.
  expect(editor.querySelectorAll(".conflict-line-marker")).toHaveLength(7);
  expect(editor.querySelectorAll(".conflict-line-ours")).toHaveLength(2);
  expect(editor.querySelectorAll(".conflict-line-base")).toHaveLength(1);
  expect(editor.querySelectorAll(".conflict-line-theirs")).toHaveLength(2);

  await expectNoAxeViolations(container);
});

test.each([
  ["Accept Ours", ["    let lanes = 4;"], "Accepted Ours at line 2. 1 Conflict Hunk left."],
  ["Accept Theirs", ["    let lanes = 5;"], "Accepted Theirs at line 2. 1 Conflict Hunk left."],
  [
    "Accept both, Ours first",
    ["    let lanes = 4;", "    let lanes = 5;"],
    "Accepted both, Ours first, at line 2. 1 Conflict Hunk left.",
  ],
  [
    "Accept both, Theirs first",
    ["    let lanes = 5;", "    let lanes = 4;"],
    "Accepted both, Theirs first, at line 2. 1 Conflict Hunk left.",
  ],
])("%s resolves the Conflict Hunk at the cursor with it, and says so", async (name, first, said) => {
  const { user, container, files } = await opened({ "src/lanes.rs": lanes });
  const editor = await choose(user, files, "src/lanes.rs");
  const resolution = screen.getByRole("region", { name: "Resolution" });

  await user.click(within(resolution).getByRole("button", { name }));

  expect(textOf(editor)).toBe(withFirst(first));
  expect(within(resolution).getByRole("status")).toHaveTextContent(said);
  // The second is the first now, where the lines chosen leave it.
  const start = first.length + 6;
  expect(within(resolution).getByText(`1 Conflict Hunk left. At Conflict Hunk 1 of 1, lines ${start}–${start + 4}.`)).toBeVisible();
  await expectNoAxeViolations(container);
});

test("the next and previous Conflict Hunk are a key away, going round at the ends, and each says where it is", async () => {
  const { user, files } = await opened({ "src/lanes.rs": lanes });
  const editor = await choose(user, files, "src/lanes.rs");
  const resolution = screen.getByRole("region", { name: "Resolution" });
  const status = within(resolution).getByRole("status");

  act(() => editor.focus());
  await user.keyboard("{F7}");
  expect(cursorLine(editor)).toBe(2);
  expect(status).toHaveTextContent(
    "Conflict Hunk 1 of 2, lines 2–8: Ours has 1 line, the Base 1 line, Theirs 1 line.",
  );
  await user.keyboard("{F7}");
  expect(cursorLine(editor)).toBe(13);
  expect(status).toHaveTextContent("Conflict Hunk 2 of 2, lines 13–17: Ours has 1 line, Theirs 1 line.");
  expect(within(resolution).getByText(/At Conflict Hunk 2 of 2, lines 13–17\./)).toBeVisible();
  await user.keyboard("{F7}");
  expect(cursorLine(editor)).toBe(2);
  await user.keyboard("{Shift>}{F7}{/Shift}");
  expect(cursorLine(editor)).toBe(13);

  // The buttons do the same, and name their keys; the choices act on the Conflict Hunk gone to.
  const previous = within(resolution).getByRole("button", { name: "Previous conflict" });
  expect(previous).toHaveAttribute("aria-keyshortcuts", "Shift+F7");
  expect(within(resolution).getByRole("button", { name: "Next conflict" })).toHaveAttribute("aria-keyshortcuts", "F7");
  await user.click(previous);
  expect(cursorLine(editor)).toBe(2);
  await user.click(within(resolution).getByRole("button", { name: "Next conflict" }));
  expect(cursorLine(editor)).toBe(13);
  await user.click(within(resolution).getByRole("button", { name: "Accept Theirs" }));
  expect(textOf(editor)).toBe(conflicted.replace("<<<<<<< HEAD\n    2\n=======\n    3\n>>>>>>> feature\n", "    3\n"));
  expect(within(resolution).getByText("1 Conflict Hunk left. At Conflict Hunk 1 of 1, lines 2–8.")).toBeVisible();
});

test("a Resolution edited by hand is written as it is, and marking it resolved waits until no Conflict Markers are left, unless told not to", async () => {
  const { user, fake, container, files } = await opened({ "src/lanes.rs": lanes, "src/merge.rs": merge });
  const editor = await choose(user, files, "src/lanes.rs");
  const resolution = screen.getByRole("region", { name: "Resolution" });
  const markResolved = within(resolution).getByRole("button", { name: "Mark resolved" });

  // Editing a Conflict Hunk by hand: its Conflict Markers typed away.
  const view = viewOf(editor);
  const first = view.state.doc.line(2).from;
  act(() =>
    view.dispatch({ changes: { from: first, to: view.state.doc.line(9).from, insert: "    let lanes = 9;\n" } }),
  );
  expect(within(resolution).getByText(/^1 Conflict Hunk left\./)).toBeVisible();

  // With Conflict Markers left, Mark resolved says why it waits, and writes nothing.
  expect(markResolved).toHaveAttribute("aria-disabled", "true");
  expect(markResolved).toHaveAccessibleDescription(/^Conflict Markers are left in\./);
  await user.click(markResolved);
  expect(within(resolution).getByRole("alert")).toHaveTextContent(
    "“src/lanes.rs” still has Conflict Markers. Resolve each Conflict Hunk, or check “Mark resolved with Conflict Markers left in”.",
  );
  expect(calledWith(fake, "resolveConflict")).toEqual([]);
  await expectNoAxeViolations(container);

  // Told to, it writes them as they are.
  await user.click(within(resolution).getByRole("checkbox", { name: "Mark resolved with Conflict Markers left in" }));
  expect(markResolved).not.toHaveAttribute("aria-disabled");
  await user.click(markResolved);
  const written = withFirst(["    let lanes = 9;"]);
  await waitFor(() =>
    expect(calledWith(fake, "resolveConflict")).toEqual([{ repository: lanewise.root, path: "src/lanes.rs", content: written }]),
  );
  // Marked resolved, it leaves the Three-way view and the Resolution empty,
  // and focus goes to the file that took its place.
  await waitFor(() => expect(screen.queryByRole("region", { name: "Resolution" })).toBeNull());
  expect(screen.queryByRole("region", { name: "Base / Ours / Theirs" })).toBeNull();
  expect(screen.getByText("Wrote the Resolution of “src/lanes.rs” and marked it resolved.")).toBeInTheDocument();
  await waitFor(() => expect(within(files).getByRole("button", { name: "src/merge.rs Conflicted" })).toHaveFocus());
  expect(within(files).getByText(/^1 of 2 files resolved\./)).toBeVisible();
});

test("once every Conflict Hunk is resolved, Mark resolved writes the Resolution with the file's own line endings and stages it", async () => {
  const windows: ConflictedFile = {
    base: crlf(lanes.base),
    ours: crlf(lanes.ours),
    theirs: crlf(lanes.theirs),
    working: crlf(lanes.working),
    reports: [],
    oursSubject: null,
    theirsSubject: null,
  };
  const { user, fake, files } = await opened({ "src/lanes.rs": windows });
  const editor = await choose(user, files, "src/lanes.rs");
  const resolution = screen.getByRole("region", { name: "Resolution" });
  // CodeMirror holds it with `\n` between lines.
  expect(textOf(editor)).toBe(conflicted);

  await user.click(within(resolution).getByRole("button", { name: "Accept Ours" }));
  await user.click(within(resolution).getByRole("button", { name: "Accept both, Theirs first" }));
  expect(within(resolution).getByText("No Conflict Hunks left.")).toBeVisible();
  expect(within(resolution).queryByRole("checkbox")).toBeNull();
  await user.click(within(resolution).getByRole("button", { name: "Mark resolved" }));

  await waitFor(() => expect(calledWith(fake, "resolveConflict")).toHaveLength(1));
  expect(calledWith(fake, "resolveConflict")[0]).toEqual({
    repository: lanewise.root,
    path: "src/lanes.rs",
    content: [
      "fn lanes() -> u32 {",
      "    let lanes = 4;",
      "    lanes",
      "}",
      "",
      "fn spare() -> u32 {",
      "    3",
      "    2",
      "}",
      "",
    ].join("\r\n"),
  });
  await waitFor(() => expect(within(files).getByText(/^1 of 1 file resolved\./)).toBeVisible());
});

test("every change to the Resolution can be undone, back to the file as Git left it, and Start over goes straight there", async () => {
  const { user, files } = await opened({ "src/lanes.rs": lanes });
  const editor = await choose(user, files, "src/lanes.rs");
  const resolution = screen.getByRole("region", { name: "Resolution" });
  const undo = within(resolution).getByRole("button", { name: "Undo" });
  const status = within(resolution).getByRole("status");
  expect(undo).toHaveAttribute("aria-disabled", "true");

  await user.click(within(resolution).getByRole("button", { name: "Accept Ours" }));
  await user.click(within(resolution).getByRole("button", { name: "Accept Theirs" }));
  expect(textOf(editor)).toBe(withFirst(["    let lanes = 4;"]).replace("<<<<<<< HEAD\n    2\n=======\n    3\n>>>>>>> feature\n", "    3\n"));

  // Each choice is undone apart.
  await user.click(undo);
  expect(textOf(editor)).toBe(withFirst(["    let lanes = 4;"]));
  expect(status).toHaveTextContent("Undone. 1 Conflict Hunk left.");
  await user.click(undo);
  expect(textOf(editor)).toBe(conflicted);
  expect(undo).toHaveAttribute("aria-disabled", "true");
  await user.click(within(resolution).getByRole("button", { name: "Redo" }));
  expect(textOf(editor)).toBe(withFirst(["    let lanes = 4;"]));

  // In the editor, the usual keys undo too.
  act(() => editor.focus());
  await user.keyboard("{Control>}z{/Control}");
  expect(textOf(editor)).toBe(conflicted);

  // Start over puts back the file as Git left it, which Undo takes back in turn.
  await user.click(within(resolution).getByRole("button", { name: "Accept Theirs" }));
  await user.click(within(resolution).getByRole("button", { name: "Start over" }));
  expect(textOf(editor)).toBe(conflicted);
  expect(status).toHaveTextContent("Started over from the file as Git left it: 2 Conflict Hunks. Undo takes this back.");
  await user.click(undo);
  expect(textOf(editor)).toBe(withFirst(["    let lanes = 5;"]));
});

test("a Resolution is kept, file by file, while another file is chosen", async () => {
  const { user, fake, files } = await opened({ "src/lanes.rs": lanes, "src/merge.rs": merge });
  let editor = await choose(user, files, "src/lanes.rs");
  await user.click(within(screen.getByRole("region", { name: "Resolution" })).getByRole("button", { name: "Accept Ours" }));

  const other = await choose(user, files, "src/merge.rs");
  expect(textOf(other)).toBe((merge.working as { text: string }).text);
  expect(screen.getByRole("textbox", { name: "Ours of src/merge.rs" })).toBeVisible();

  editor = await choose(user, files, "src/lanes.rs");
  expect(textOf(editor)).toBe(withFirst(["    let lanes = 4;"]));
  // Each is read once each time it's chosen.
  expect(calledWith(fake, "conflictedFile")).toHaveLength(3);
});

/** A binary file both sides changed, as Git leaves it. */
const image: ConflictedFile = {
  base: { kind: "notText" },
  ours: { kind: "notText" },
  theirs: { kind: "notText" },
  working: { kind: "notText" },
  reports: [],
  oursSubject: null,
  theirsSubject: null,
};

/** A file Ours deleted and Theirs changed, as Git leaves it and reports it. */
const deleted: ConflictedFile = {
  base: text(["a", ""]),
  ours: null,
  theirs: text(["b", ""]),
  working: text(["b", ""]),
  reports: [
    {
      kind: "modify/delete",
      message: "CONFLICT (modify/delete): lanes.txt deleted in Ours and modified in Theirs.  Version Theirs of lanes.txt left in tree.",
      paths: ["lanes.txt"],
    },
  ],
  oursSubject: null,
  theirsSubject: null,
};

const renameReports = [
  {
    kind: "rename/rename",
    message: "CONFLICT (rename/rename): both.txt renamed to main.txt in Ours and to feature.txt in Theirs.",
    paths: ["both.txt", "main.txt", "feature.txt"],
  },
];

/** A rename conflict's files: the one Theirs renamed away, and where each side renamed it to. */
const renamed: Record<string, ConflictedFile> = {
  "moved.txt": {
    base: text(["old", ""]),
    ours: null,
    theirs: text(["old", ""]),
    working: text(["old", ""]),
    reports: [
      {
        kind: "rename/delete",
        message: "CONFLICT (rename/delete): old.txt renamed to moved.txt in Theirs, but deleted in Ours.",
        paths: ["moved.txt"],
      },
    ],
    oursSubject: null,
    theirsSubject: null,
  },
  "both.txt": { base: text(["both", ""]), ours: null, theirs: null, working: null, reports: renameReports, oursSubject: null, theirsSubject: null },
  "main.txt": { base: null, ours: text(["both", ""]), theirs: null, working: text(["both", ""]), reports: renameReports, oursSubject: null, theirsSubject: null },
};

/** The whole-file choices the Resolution offers, by name. */
function choicesIn(resolution: HTMLElement): string[] {
  return within(resolution)
    .getAllByRole("radio")
    .map((radio) => radio.closest("label")!.textContent!);
}

test("a binary file has no Three-way view, and is resolved by keeping Ours or Theirs, with no AI", async () => {
  const { user, fake, container, files } = await opened({ "image.png": image, "src/merge.rs": merge });

  await user.click(within(files).getByRole("button", { name: "image.png Conflicted" }));
  const resolution = await screen.findByRole("region", { name: "Resolution" });
  expect(
    await within(resolution).findByText(
      "Ours and Theirs each changed this file, and neither is text Lanewise can show: it's binary, not UTF-8, a symbolic link or a submodule.",
    ),
  ).toBeVisible();
  const threeWay = screen.getByRole("region", { name: "Base / Ours / Theirs" });
  expect(within(threeWay).getByText(/^There's no Three-way view of “image\.png”/)).toBeVisible();
  expect(screen.queryAllByRole("textbox")).toEqual([]);
  // Each side is said in the operation's own terms.
  expect(within(resolution).getByText("Ours: “main”, the branch being merged into.")).toBeVisible();
  expect(within(resolution).getByText("Theirs: “feature”, being merged.")).toBeVisible();

  const choices = within(resolution).getByRole("group", { name: "What “image.png” becomes" });
  expect(choicesIn(resolution)).toEqual(["Keep Ours", "Keep Theirs"]);
  expect(choices).toHaveAccessibleDescription(/^Ours and Theirs each changed this file/);
  // No AI is offered for it (PRD §7.7).
  expect(screen.queryByRole("button", { name: /^Suggest/ })).toBeNull();
  expect(
    within(screen.getByRole("region", { name: "AI Suggestion" })).getByText(
      "There's no AI Suggestion for “image.png”: it's resolved as a whole, in the Resolution.",
    ),
  ).toBeVisible();
  await expectNoAxeViolations(container);

  // Nothing is chosen yet, so Mark resolved says so, and resolves nothing.
  const markResolved = within(resolution).getByRole("button", { name: "Mark resolved" });
  expect(markResolved).toHaveAttribute("aria-disabled", "true");
  await user.click(markResolved);
  expect(within(resolution).getByRole("alert")).toHaveTextContent("Choose what “image.png” becomes first.");
  expect(calledWith(fake, "resolveWholeFile")).toEqual([]);

  await user.click(within(choices).getByRole("radio", { name: "Keep Theirs" }));
  expect(within(resolution).queryByRole("alert")).toBeNull();
  expect(markResolved).not.toHaveAttribute("aria-disabled");
  await user.click(markResolved);
  await waitFor(() =>
    expect(calledWith(fake, "resolveWholeFile")).toEqual([{ repository: lanewise.root, path: "image.png", choice: "theirs" }]),
  );
  await waitFor(() => expect(screen.queryByRole("region", { name: "Resolution" })).toBeNull());
  expect(screen.getByText("Kept “image.png” as Theirs has it, and marked it resolved.")).toBeInTheDocument();
  expect(calledWith(fake, "resolveConflict")).toEqual([]);
  await waitFor(() => expect(within(files).getByRole("button", { name: "src/merge.rs Conflicted" })).toHaveFocus());
});

test.each([
  ["Keep the file, as Theirs has it", "theirs", "Kept “lanes.txt” as Theirs has it, and marked it resolved."],
  ["Delete the file", "delete", "Deleted “lanes.txt”, and marked it resolved."],
] as const)("a file one side deleted is described in words, with what Git reports, and %s resolves it", async (name, choice, said) => {
  const { user, fake, container, files } = await opened({ "lanes.txt": deleted });

  await user.click(within(files).getByRole("button", { name: "lanes.txt Conflicted" }));
  const resolution = await screen.findByRole("region", { name: "Resolution" });
  expect(await within(resolution).findByText("Ours deleted this file, and Theirs changed it.")).toBeVisible();
  const reported = within(resolution).getByRole("list", { name: "What Git reports" });
  expect(within(reported).getByRole("listitem")).toHaveTextContent(
    "CONFLICT (modify/delete): lanes.txt deleted in Ours and modified in Theirs.",
  );
  expect(choicesIn(resolution)).toEqual(["Keep the file, as Theirs has it", "Delete the file"]);
  expect(within(screen.getByRole("region", { name: "Base / Ours / Theirs" })).queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Suggest/ })).toBeNull();
  await expectNoAxeViolations(container);

  await user.click(within(resolution).getByRole("radio", { name }));
  await user.click(within(resolution).getByRole("button", { name: "Mark resolved" }));
  await waitFor(() =>
    expect(calledWith(fake, "resolveWholeFile")).toEqual([{ repository: lanewise.root, path: "lanes.txt", choice }]),
  );
  expect(await screen.findByText(said)).toBeInTheDocument();
});

test("a rename conflict shows what Git reports, with the same whole-file choices", async () => {
  const { user, fake, container, files } = await opened(renamed);

  await user.click(within(files).getByRole("button", { name: "moved.txt Conflicted" }));
  const resolution = await screen.findByRole("region", { name: "Resolution" });
  expect(await within(resolution).findByText("Ours deleted this file, and Theirs renamed it here.")).toBeVisible();
  expect(within(within(resolution).getByRole("list", { name: "What Git reports" })).getByRole("listitem")).toHaveTextContent(
    "CONFLICT (rename/delete): old.txt renamed to moved.txt in Theirs, but deleted in Ours.",
  );
  expect(choicesIn(resolution)).toEqual(["Keep the file, as Theirs has it", "Delete the file"]);
  await expectNoAxeViolations(container);

  // Where Ours renamed the file to, Theirs has nothing.
  await user.click(within(files).getByRole("button", { name: "main.txt Conflicted" }));
  expect(await within(resolution).findByText("Only Ours has this file, having renamed a file to it. Theirs doesn't.")).toBeVisible();
  expect(within(within(resolution).getByRole("list", { name: "What Git reports" })).getByRole("listitem")).toHaveTextContent(
    "CONFLICT (rename/rename): both.txt renamed to main.txt in Ours and to feature.txt in Theirs.",
  );
  expect(choicesIn(resolution)).toEqual(["Keep the file, as Ours has it", "Delete the file"]);

  // The file both sides renamed away can only go.
  await user.click(within(files).getByRole("button", { name: "both.txt Conflicted" }));
  expect(
    await within(resolution).findByText("Neither Ours nor Theirs has this file any more: each deleted it or renamed it."),
  ).toBeVisible();
  expect(choicesIn(resolution)).toEqual(["Delete the file"]);
  expect(screen.queryByRole("button", { name: /^Suggest/ })).toBeNull();
  await expectNoAxeViolations(container);

  await user.click(within(resolution).getByRole("radio", { name: "Delete the file" }));
  await user.click(within(resolution).getByRole("button", { name: "Mark resolved" }));
  await waitFor(() =>
    expect(calledWith(fake, "resolveWholeFile")).toEqual([{ repository: lanewise.root, path: "both.txt", choice: "delete" }]),
  );
});

test("keeping a side that has no version of the file says so, and leaves it conflicted", async () => {
  const { user, files } = await opened(
    { "lanes.txt": deleted },
    { resolveWholeFile: ({ path }) => ({ ok: false, error: { kind: "noVersion", path, side: "theirs" } }) },
  );

  await user.click(within(files).getByRole("button", { name: "lanes.txt Conflicted" }));
  const resolution = await screen.findByRole("region", { name: "Resolution" });
  await user.click(await within(resolution).findByRole("radio", { name: "Keep the file, as Theirs has it" }));
  await user.click(within(resolution).getByRole("button", { name: "Mark resolved" }));

  expect(await within(resolution).findByRole("alert")).toHaveTextContent(
    "The file wasn't resolved: Theirs has no version of “lanes.txt” to keep.",
  );
  expect(within(files).getByRole("button", { name: "lanes.txt Conflicted" })).toBeVisible();
});

test("a text file's Resolution can take all of one side, as one change undo takes back, and shows what Git reports", async () => {
  const { user, container, files } = await opened({
    "src/lanes.rs": {
      ...lanes,
      reports: [
        {
          kind: "rename/rename",
          message: "CONFLICT (rename/rename): src/lane.rs renamed to src/lanes.rs in Ours and to src/lanes.rs in Theirs.",
          paths: ["src/lanes.rs"],
        },
      ],
    },
  });
  const editor = await choose(user, files, "src/lanes.rs");
  const resolution = screen.getByRole("region", { name: "Resolution" });
  expect(within(within(resolution).getByRole("list", { name: "What Git reports" })).getByRole("listitem")).toHaveTextContent(
    /^CONFLICT \(rename\/rename\)/,
  );

  const whole = within(resolution).getByRole("group", { name: "Take a whole side" });
  await user.click(within(whole).getByRole("button", { name: "Take all of Theirs" }));
  expect(textOf(editor)).toBe((lanes.theirs as { text: string }).text);
  expect(within(resolution).getByRole("status")).toHaveTextContent("Took all of Theirs, as the whole file. Undo takes this back.");
  expect(within(resolution).getByText("No Conflict Hunks left.")).toBeVisible();
  await expectNoAxeViolations(container);

  await user.click(within(resolution).getByRole("button", { name: "Undo" }));
  expect(textOf(editor)).toBe(conflicted);
});

test("a conflicted file that can't be read says so", async () => {
  const { user, files } = await opened(
    { "src/lanes.rs": lanes },
    { conflictedFile: ({ path }) => ({ ok: false, error: { kind: "file", path, message: "Permission denied" } }) },
  );

  await user.click(within(files).getByRole("button", { name: "src/lanes.rs Conflicted" }));

  const resolution = await screen.findByRole("region", { name: "Resolution" });
  expect(await within(resolution).findByRole("alert")).toHaveTextContent(/^The conflicted file couldn't be shown/);
  expect(within(resolution).getByRole("alert")).toHaveTextContent(/Permission denied/);
});
