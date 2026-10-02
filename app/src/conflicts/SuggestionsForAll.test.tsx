// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { EditorView } from "@codemirror/view";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import type { Suggestion } from "../ai/modelProvider";
import { App } from "../App";
import type { ConflictedFile, InProgressOperation } from "../commands/api";
import { MODEL_PROVIDER_KEY } from "../settings/localSettings";
import { expectNoAxeViolations } from "../test/axe";
import { fakeModelProvider } from "../test/fakeModelProvider";
import { fakeKeyStore, fakePlatform, historyCommit } from "../test/fakePlatform";

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

/** The lanes Conflict Hunk, lines 2–9: Ours added a spare lane, and Theirs made it five lanes. */
const lanesHunk = [
  "<<<<<<< HEAD",
  "    let lanes = 3;",
  "    let spare = 1;",
  "||||||| base",
  "    let lanes = 3;",
  "=======",
  "    let lanes = 5;",
  ">>>>>>> feature",
];
/** The width Conflict Hunk, lines 11–18: Theirs added a height. */
const widthHunk = [
  "<<<<<<< HEAD",
  "    let width = 2;",
  "||||||| base",
  "    let width = 1;",
  "=======",
  "    let width = 2;",
  "    let height = 3;",
  ">>>>>>> feature",
];
/** The depth Conflict Hunk, lines 21–28: each side changed it its own way. */
const depthHunk = [
  "<<<<<<< HEAD",
  "    let depth = 2;",
  "||||||| base",
  "    let depth = 1;",
  "=======",
  "    let depth = 1;",
  "    let deep = true;",
  ">>>>>>> feature",
];

/** `src/layout.rs` with its three Conflict Hunks as given, in order. */
const layoutWith = (lanes: string[], width: string[], depth: string[]) =>
  ["fn layout() {", ...lanes, "    // width", ...width, "", "    // depth", ...depth, "}", ""].join("\n");

const conflicted = layoutWith(lanesHunk, widthHunk, depthHunk);

const text = (content: string) => ({ kind: "text" as const, text: content });

/** A fixture conflict with three Conflict Hunks. */
const layout: ConflictedFile = {
  base: text(layoutWith(["    let lanes = 3;"], ["    let width = 1;"], ["    let depth = 1;"])),
  ours: text(layoutWith(["    let lanes = 3;", "    let spare = 1;"], ["    let width = 2;"], ["    let depth = 2;"])),
  theirs: text(
    layoutWith(["    let lanes = 5;"], ["    let width = 2;", "    let height = 3;"], ["    let depth = 1;", "    let deep = true;"]),
  ),
  working: text(conflicted),
  reports: [],
  oursSubject: "Add a spare lane",
  theirsSubject: "Use five lanes",
};

type Named = "lanes" | "width" | "depth";

/** The Suggestion the fake Model Provider gives for each Conflict Hunk: the depth one the model isn't sure of. */
const answers: Record<Named, Suggestion> = {
  lanes: {
    explanation: "Keep both: five lanes and a spare.",
    resolution: "    let lanes = 5;\n    let spare = 1;\n",
    confidence: "high",
  },
  width: {
    explanation: "Theirs only added a height.",
    resolution: "    let width = 2;\n    let height = 3;\n",
    confidence: "medium",
  },
  depth: {
    explanation: "Each side changed the depth; this keeps Ours' depth and Theirs' flag.",
    resolution: "    let depth = 2;\n    let deep = true;\n",
    confidence: "low",
  },
};

/** Which Conflict Hunk a request to the fake Model Provider is about, by its Ours. */
function about(init: RequestInit | undefined): Named {
  const { prompt } = JSON.parse(init!.body as string) as { prompt: string };
  if (prompt.includes("<ours>\n    let lanes")) return "lanes";
  if (prompt.includes("<ours>\n    let width")) return "width";
  if (prompt.includes("<ours>\n    let depth")) return "depth";
  throw new Error(`A request about no Conflict Hunk here: ${prompt}`);
}

/** A request for a Suggestion the test answers when it says. */
interface Held {
  about: Named;
  signal: AbortSignal;
  /** Answers it as the fake Model Provider would, or with `status`. */
  answer(status?: number): void;
}

function aiOn() {
  localStorage.setItem(
    MODEL_PROVIDER_KEY,
    JSON.stringify({ enabled: true, disclosed: ["fake"], global: { provider: "fake", model: "fake-opus" } }),
  );
}

function mergeOf(conflicts: string[]): InProgressOperation {
  return { kind: "merge", into: "main", merging: [feature], conflicts, resolved: [] };
}

/**
 * Lanewise, partway through a merge with `src/layout.rs` chosen and AI on,
 * asking the fake Model Provider. With `hold`, each request for a Suggestion
 * waits in `held` until the test answers it; otherwise each is answered at
 * once, with the `status` given for its Conflict Hunk in `statuses` or else
 * its Suggestion in `answers`.
 */
async function opened({ hold = false, statuses = {} }: { hold?: boolean; statuses?: Partial<Record<Named, number>> } = {}) {
  aiOn();
  const user = userEvent.setup();
  const model = fakeModelProvider();
  const store = fakeKeyStore({ fake: "sk-fake" });
  const held: Held[] = [];
  const respond = (url: string, init: RequestInit | undefined, named: Named, status?: number) => {
    // Logged as the fake Model Provider logs every request.
    model.answer(url, init);
    return status === undefined ? Response.json(answers[named]) : new Response("{}", { status });
  };
  const fake = fakePlatform({
    folders: [lanewise.root],
    commands: {
      ...store.commands,
      openRepository: () => ({ ok: true, value: lanewise }),
      operationInProgress: () => ({ ok: true, value: mergeOf(["src/layout.rs"]) }),
      conflictedFile: () => ({ ok: true, value: layout }),
    },
    fetch: (url, init) => {
      if (!url.endsWith("/suggest")) return model.answer(url, init);
      const named = about(init);
      if (!hold) return respond(url, init, named, statuses[named]);
      return new Promise<Response>((resolve) => {
        held.push({ about: named, signal: init!.signal!, answer: (status) => resolve(respond(url, init, named, status)) });
      });
    },
  });
  const { container } = render(<App platform={fake.platform} modelProviders={[model.provider]} />);
  await user.click(await screen.findByRole("button", { name: "Open repository" }));
  const files = await screen.findByRole("region", { name: "Conflicted files" });
  await user.click(within(files).getByRole("button", { name: "src/layout.rs Conflicted" }));
  const editor = await screen.findByRole("textbox", { name: "Resolution of src/layout.rs" });
  const widget = screen.getByRole("region", { name: "AI Suggestion" });
  await within(widget).findByText("For Conflict Hunk 1 of 3, lines 2–9, where the Resolution is.");
  return { user, fake, model, container, editor, widget, held };
}

function textOf(editor: HTMLElement): string {
  return EditorView.findFromDOM(editor)!.state.doc.toString();
}

function asked(model: ReturnType<typeof fakeModelProvider>): Named[] {
  return model.requests.filter((request) => request.url.endsWith("/suggest")).map((request) => about({ body: JSON.stringify(request.body) }));
}

function shownIn(widget: HTMLElement): HTMLElement[] {
  return within(widget).queryAllByRole("region", { name: /^AI-generated Suggestion for/ });
}

function headings(widget: HTMLElement): string[] {
  return shownIn(widget).map((shown) => within(shown).getAllByRole("heading")[0]!.textContent);
}

const ALL = "Suggest for all Conflict Hunks in this file";

// Several Suggestions, one after another, each drawn and checked with axe: about 3s under load, so with the rest of the suite beside it,
// it's given longer than Vitest's 5s default.
test("one action asks for a Suggestion for every Conflict Hunk in the file, one at a time, showing progress, and applies none", { timeout: 20_000 }, async () => {
  const { user, fake, container, editor, widget, held } = await opened({ hold: true });

  await user.click(within(widget).getByRole("button", { name: ALL }));
  await waitFor(() => expect(held).toHaveLength(1));
  expect(held[0]!.about).toBe("lanes");
  const progress = within(widget).getByRole("progressbar", {
    name: "Asking for Suggestion 1 of 3, for Conflict Hunk 1 of 3, lines 2–9…",
  });
  expect(progress).toHaveAttribute("aria-valuenow", "0");
  expect(progress).toHaveAttribute("aria-valuemax", "3");
  expect(progress).toHaveAttribute("aria-valuetext", "0 of 3 asked");
  expect(within(widget).getByRole("status")).toHaveTextContent(
    "Asking for a Suggestion for each of 3 Conflict Hunks, one at a time…",
  );
  // While it runs, neither asking action is taken again.
  expect(within(widget).getByRole("button", { name: ALL })).toHaveAttribute("aria-disabled", "true");
  expect(within(widget).getByRole("button", { name: "Suggest a resolution" })).toHaveAttribute("aria-disabled", "true");
  await user.click(within(widget).getByRole("button", { name: ALL }));
  expect(held).toHaveLength(1);
  await expectNoAxeViolations(container);

  // The next is asked only once the one before is answered, and each is shown as it comes.
  held[0]!.answer();
  await waitFor(() => expect(held).toHaveLength(2));
  expect(held[1]!.about).toBe("width");
  expect(headings(widget)).toEqual(["AI-generated Suggestion for Conflict Hunk 1 of 3, lines 2–9"]);
  expect(
    within(widget).getByRole("progressbar", { name: "Asking for Suggestion 2 of 3, for Conflict Hunk 2 of 3, lines 11–18…" }),
  ).toHaveAttribute("aria-valuenow", "1");
  held[1]!.answer();
  await waitFor(() => expect(held).toHaveLength(3));
  expect(held[2]!.about).toBe("depth");
  held[2]!.answer();

  await waitFor(() => expect(within(widget).queryByRole("progressbar")).toBeNull());
  expect(within(widget).queryByRole("button", { name: "Cancel" })).toBeNull();
  expect(headings(widget)).toEqual([
    "AI-generated Suggestion for Conflict Hunk 1 of 3, lines 2–9",
    "AI-generated Suggestion for Conflict Hunk 2 of 3, lines 11–18",
    "AI-generated Suggestion for Conflict Hunk 3 of 3, lines 21–28",
  ]);
  expect(textOf(editor)).toBe(conflicted);
  expect(fake.calls.filter((call) => call.name === "resolveConflict")).toEqual([]);
});

test("every Suggestion made is shown to review on its own, with its Confidence, and nothing accepts them all", async () => {
  const { user, fake, container, editor, widget } = await opened();

  await user.click(within(widget).getByRole("button", { name: ALL }));
  await waitFor(() => expect(shownIn(widget)).toHaveLength(3));
  const [lanes, width, depth] = shownIn(widget);
  expect(within(lanes!).getByText("Confidence: High")).toBeVisible();
  expect(within(width!).getByText("Confidence: Medium")).toBeVisible();
  expect(within(depth!).getByText("Confidence: Low")).toBeVisible();
  expect(within(depth!).getByText("Low Confidence.")).toBeVisible();
  expect(within(widget).getByText(/^3 Suggestions to review\. Accept, edit or reject each on its own/)).toBeVisible();
  expect(within(widget).getByRole("status")).toHaveTextContent(
    "Asked about 3 Conflict Hunks: 3 Suggestions ready to review, each on its own; 1 with low Confidence: check it closely. Nothing was put in the Resolution.",
  );

  // Each has its own Accept, Edit and Reject, and nothing accepts them all.
  for (const shown of shownIn(widget)) {
    const use = within(shown).getByRole("group", { name: /^Use the Suggestion for/ });
    expect(within(use).getAllByRole("button").map((button) => button.textContent)).toEqual(["Accept", "Edit", "Reject"]);
  }
  expect(screen.queryByRole("button", { name: /accept all|apply all|accept every/i })).toBeNull();
  // Nothing is put in the Resolution, or written, until the user says, one at a time.
  expect(textOf(editor)).toBe(conflicted);
  expect(fake.calls.filter((call) => call.name === "resolveConflict")).toEqual([]);
  await expectNoAxeViolations(container);
});

test("each Suggestion is accepted, edited or rejected on its own, leaving the others to review", async () => {
  const { user, fake, container, editor, widget, model } = await opened();

  await user.click(within(widget).getByRole("button", { name: ALL }));
  await waitFor(() => expect(shownIn(widget)).toHaveLength(3));
  expect(asked(model)).toEqual(["lanes", "width", "depth"]);

  // Accept the first: only it goes in, and the others say where their Conflict Hunks are now.
  await user.click(within(shownIn(widget)[0]!).getByRole("button", { name: "Accept" }));
  expect(textOf(editor)).toBe(layoutWith(["    let lanes = 5;", "    let spare = 1;"], widthHunk, depthHunk));
  expect(headings(widget)).toEqual([
    "AI-generated Suggestion for Conflict Hunk 1 of 2, lines 5–12",
    "AI-generated Suggestion for Conflict Hunk 2 of 2, lines 15–22",
  ]);
  // Focus moves on to the next to review.
  expect(within(shownIn(widget)[0]!).getAllByRole("heading")[0]).toHaveFocus();
  expect(within(widget).getByRole("status")).toHaveTextContent(
    "Accepted the Suggestion into the Resolution at line 2. Undo takes it back.",
  );

  // Reject the width one: the Resolution is as it was, and its Conflict Hunk still conflicted.
  const beforeReject = textOf(editor);
  await user.click(within(shownIn(widget)[0]!).getByRole("button", { name: "Reject" }));
  expect(textOf(editor)).toBe(beforeReject);
  expect(headings(widget)).toEqual(["AI-generated Suggestion for Conflict Hunk 2 of 2, lines 15–22"]);
  expect(within(shownIn(widget)[0]!).getAllByRole("heading")[0]).toHaveFocus();

  // Edit the low-Confidence one: it goes in selected, to change, and the editor takes focus.
  await user.click(within(shownIn(widget)[0]!).getByRole("button", { name: "Edit" }));
  const view = EditorView.findFromDOM(editor)!;
  expect(view.hasFocus).toBe(true);
  const { from, to } = view.state.selection.main;
  expect(view.state.sliceDoc(from, to)).toBe("    let depth = 2;\n    let deep = true;");
  expect(textOf(editor)).toBe(
    layoutWith(["    let lanes = 5;", "    let spare = 1;"], widthHunk, ["    let depth = 2;", "    let deep = true;"]),
  );
  expect(shownIn(widget)).toEqual([]);
  expect(within(widget).getByText("For Conflict Hunk 1 of 1, lines 5–12, where the Resolution is.")).toBeVisible();
  expect(fake.calls.filter((call) => call.name === "resolveConflict")).toEqual([]);
  await expectNoAxeViolations(container);

  // Undo takes back each on its own.
  const resolution = screen.getByRole("region", { name: "Resolution" });
  await user.click(within(resolution).getByRole("button", { name: "Undo" }));
  expect(textOf(editor)).toBe(layoutWith(["    let lanes = 5;", "    let spare = 1;"], widthHunk, depthHunk));
});

test("a failure partway through that's the Conflict Hunk's own is said, and the rest are still asked about", async () => {
  // The width Conflict Hunk's answer can't be read.
  const { user, container, editor, widget, model } = await opened({ statuses: { width: 500 } });

  await user.click(within(widget).getByRole("button", { name: ALL }));
  expect(await within(widget).findByRole("alert")).toHaveTextContent(
    "No Suggestion for Conflict Hunk 2 of 3, lines 11–18. The Model Provider's answer couldn't be read. It answered 500.",
  );
  await waitFor(() => expect(within(widget).queryByRole("progressbar")).toBeNull());
  expect(asked(model)).toEqual(["lanes", "width", "depth"]);
  expect(headings(widget)).toEqual([
    "AI-generated Suggestion for Conflict Hunk 1 of 3, lines 2–9",
    "AI-generated Suggestion for Conflict Hunk 3 of 3, lines 21–28",
  ]);
  expect(within(widget).getByRole("status")).toHaveTextContent(
    "Asked about 3 Conflict Hunks: 2 Suggestions ready to review, each on its own; 1 with low Confidence: check it closely; 1 failed. Nothing was put in the Resolution.",
  );
  expect(textOf(editor)).toBe(conflicted);
  await expectNoAxeViolations(container);
});

test("a failure partway through that would fail the rest stops there, and asking again asks only about those without a Suggestion", async () => {
  // The Model Provider starts limiting requests at the width Conflict Hunk.
  const statuses: Partial<Record<Named, number>> = { width: 429 };
  const { user, container, editor, widget, model } = await opened({ statuses });

  await user.click(within(widget).getByRole("button", { name: ALL }));
  expect(await within(widget).findByRole("alert")).toHaveTextContent(
    "No Suggestion for Conflict Hunk 2 of 3, lines 11–18. The Model Provider says there have been too many requests, or the account is out of credit. Try again later. The Conflict Hunk after it wasn't asked about.",
  );
  await waitFor(() => expect(within(widget).queryByRole("progressbar")).toBeNull());
  expect(asked(model)).toEqual(["lanes", "width"]);
  expect(headings(widget)).toEqual(["AI-generated Suggestion for Conflict Hunk 1 of 3, lines 2–9"]);
  expect(within(widget).getByRole("status")).toHaveTextContent(
    "Asked about 3 Conflict Hunks: 1 Suggestion ready to review, each on its own; 1 failed; 1 not asked. Nothing was put in the Resolution.",
  );
  expect(textOf(editor)).toBe(conflicted);
  await expectNoAxeViolations(container);

  // Later, asking again asks only about the two with no Suggestion, and keeps the one shown.
  delete statuses.width;
  await user.click(within(widget).getByRole("button", { name: ALL }));
  await waitFor(() => expect(shownIn(widget)).toHaveLength(3));
  expect(asked(model)).toEqual(["lanes", "width", "width", "depth"]);
  expect(within(widget).queryByRole("alert")).toBeNull();
  expect(within(widget).getByRole("status")).toHaveTextContent(
    "Asked about 2 Conflict Hunks: 2 Suggestions ready to review, each on its own; 1 with low Confidence: check it closely. Nothing was put in the Resolution.",
  );

  // With every Conflict Hunk suggested for, nothing more is sent.
  await user.click(within(widget).getByRole("button", { name: ALL }));
  expect(asked(model)).toHaveLength(4);
  expect(within(widget).getByRole("status")).toHaveTextContent(
    "Every Conflict Hunk left has a Suggestion shown to review. Reject one to ask for it again.",
  );
});

test("Cancel partway through stops the request running and those after it, and keeps the Suggestions made before", async () => {
  const { user, container, editor, widget, model, held } = await opened({ hold: true });

  await user.click(within(widget).getByRole("button", { name: ALL }));
  await waitFor(() => expect(held).toHaveLength(1));
  held[0]!.answer();
  await waitFor(() => expect(held).toHaveLength(2));

  await user.click(within(widget).getByRole("button", { name: "Cancel" }));
  expect(held[1]!.signal.aborted).toBe(true);
  expect(within(widget).queryByRole("progressbar")).toBeNull();
  expect(within(widget).queryByRole("button", { name: "Cancel" })).toBeNull();
  expect(within(widget).getByRole("status")).toHaveTextContent(
    "Stopped asking for Suggestions at Conflict Hunk 2 of 3, lines 11–18. Those made before it are shown to review. Nothing was put in the Resolution.",
  );
  expect(within(widget).getByRole("button", { name: "Suggest a resolution" })).toHaveFocus();

  // It answers after all, and is ignored, and nothing more is asked.
  held[1]!.answer();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(held).toHaveLength(2);
  expect(asked(model)).toEqual(["lanes", "width"]);
  expect(headings(widget)).toEqual(["AI-generated Suggestion for Conflict Hunk 1 of 3, lines 2–9"]);
  expect(within(widget).queryByRole("alert")).toBeNull();
  expect(textOf(editor)).toBe(conflicted);
  await expectNoAxeViolations(container);
});

test("Suggest a resolution for a Conflict Hunk that has a Suggestion shown replaces it, leaving the others", async () => {
  const { user, widget, model } = await opened();

  await user.click(within(widget).getByRole("button", { name: ALL }));
  await waitFor(() => expect(shownIn(widget)).toHaveLength(3));
  const [lanes] = shownIn(widget);

  await user.click(within(widget).getByRole("button", { name: "Suggest a resolution" }));
  await waitFor(() => expect(asked(model)).toEqual(["lanes", "width", "depth", "lanes"]));
  await waitFor(() => expect(shownIn(widget)[0]).not.toBe(lanes));
  expect(headings(widget)).toEqual([
    "AI-generated Suggestion for Conflict Hunk 1 of 3, lines 2–9",
    "AI-generated Suggestion for Conflict Hunk 2 of 3, lines 11–18",
    "AI-generated Suggestion for Conflict Hunk 3 of 3, lines 21–28",
  ]);
});
