// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { EditorView } from "@codemirror/view";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { sentForASuggestion } from "../ai/aiWords";
import type { Suggestion, SuggestionRequest } from "../ai/modelProvider";
import { SUGGESTION_INSTRUCTIONS, SUGGESTION_SCHEMA, suggestionPrompt } from "../ai/suggestionRequest";
import { resetTokenTotals } from "../ai/usage";
import { App } from "../App";
import type { ConflictedFile, InProgressOperation } from "../commands/api";
import { MODEL_PROVIDER_KEY } from "../settings/localSettings";
import { expectNoAxeViolations } from "../test/axe";
import { FAKE_API, fakeModelProvider } from "../test/fakeModelProvider";
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

const above = Array.from({ length: 25 }, (_, index) => `// above ${index + 1}`);
const below = Array.from({ length: 25 }, (_, index) => `// below ${index + 1}`);
const text = (lines: string[]) => ({ kind: "text" as const, text: lines.join("\n") });

/** The second Conflict Hunk, left as Git left it. */
const second = ["<<<<<<< HEAD", "    2", "=======", "    3", ">>>>>>> feature"];

/** `src/lanes.rs` with its first Conflict Hunk as `first`: 25 lines above it, and 25 below it before the second. */
const lanesWith = (first: string[]) => [...above, ...first, ...below, ...second, ""].join("\n");

/**
 * A fixture conflict: `src/lanes.rs`, where Ours added a spare lane and
 * Theirs made it five lanes, with the Base shown, and a second Conflict
 * Hunk further down.
 */
const lanes: ConflictedFile = {
  base: text([...above, "    let lanes = 3;", ...below, "    1", ""]),
  ours: text([...above, "    let lanes = 3;", "    let spare = 1;", ...below, "    2", ""]),
  theirs: text([...above, "    let lanes = 5;", ...below, "    3", ""]),
  working: text(
    lanesWith([
      "<<<<<<< HEAD",
      "    let lanes = 3;",
      "    let spare = 1;",
      "||||||| base",
      "    let lanes = 3;",
      "=======",
      "    let lanes = 5;",
      ">>>>>>> feature",
    ]).split("\n"),
  ),
  reports: [],
  oursSubject: "Add a spare lane",
  theirsSubject: "Use five lanes",
};

const conflicted = (lanes.working as { text: string }).text;

/** Exactly what's sent for the first Conflict Hunk: 20 lines each side of it. */
const sent: SuggestionRequest = {
  path: "src/lanes.rs",
  base: ["    let lanes = 3;"],
  ours: ["    let lanes = 3;", "    let spare = 1;"],
  theirs: ["    let lanes = 5;"],
  before: above.slice(5),
  after: below.slice(0, 20),
  oursSubject: "Add a spare lane",
  theirsSubject: "Use five lanes",
};

/** A Suggestion that keeps what each side meant, as the fake Model Provider gives it unless a test says otherwise. */
const keepsBoth: Suggestion = {
  explanation: "Ours added a spare lane and Theirs made it five lanes, so keep both.",
  resolution: "    let lanes = 5;\n    let spare = 1;\n",
  confidence: "high",
};

/** AI as the user left it: on, with the fake Model Provider's disclosure accepted and Fake Opus chosen. */
function aiOn(extra: Record<string, unknown> = {}) {
  localStorage.setItem(
    MODEL_PROVIDER_KEY,
    JSON.stringify({
      enabled: true,
      disclosed: ["fake"],
      global: { provider: "fake", model: "fake-opus" },
      ...extra,
    }),
  );
}

function mergeOf(conflicts: string[], resolved: string[] = []): InProgressOperation {
  return { kind: "merge", into: "main", merging: [feature], conflicts, resolved };
}

/**
 * Lanewise, opened partway through a merge with `src/lanes.rs` conflicted,
 * and the file chosen, asking the fake Model Provider, which answers with
 * `suggestion`, through `fetch` if it's given, for the API key kept.
 */
async function opened({
  suggestion = keepsBoth,
  keys = { fake: "sk-fake" } as Record<string, string>,
  fetch,
}: {
  suggestion?: Suggestion;
  keys?: Record<string, string>;
  fetch?: (url: string, init: RequestInit | undefined, answer: () => Response) => Response | Promise<Response>;
} = {}) {
  let shown = mergeOf(["src/lanes.rs", "src/merge.rs"]);
  const user = userEvent.setup();
  const model = fakeModelProvider({ suggestion });
  const store = fakeKeyStore(keys);
  const fake = fakePlatform({
    folders: [lanewise.root],
    commands: {
      ...store.commands,
      openRepository: () => ({ ok: true, value: lanewise }),
      operationInProgress: () => ({ ok: true, value: shown }),
      conflictedFile: ({ path }) =>
        path === "src/lanes.rs"
          ? { ok: true, value: lanes }
          : {
              ok: true,
              value: {
                ...lanes,
                working: text(["<<<<<<< HEAD", "b", "=======", "c", ">>>>>>> feature", ""]),
                oursSubject: null,
                theirsSubject: null,
              },
            },
      resolveConflict: ({ path }) => {
        shown = mergeOf(
          shown.conflicts.filter((file) => file !== path),
          [path],
        );
        return { ok: true, value: null };
      },
    },
    fetch: (url, init) => (fetch ? fetch(url, init, () => model.answer(url, init)) : model.answer(url, init)),
  });
  const { container } = render(<App platform={fake.platform} modelProviders={[model.provider]} />);
  await user.click(await screen.findByRole("button", { name: "Open repository" }));
  const files = await screen.findByRole("region", { name: "Conflicted files" });
  await user.click(within(files).getByRole("button", { name: "src/lanes.rs Conflicted" }));
  const editor = await screen.findByRole("textbox", { name: "Resolution of src/lanes.rs" });
  const widget = screen.getByRole("region", { name: "AI Suggestion" });
  return { user, fake, model, container, files, editor, widget };
}

function textOf(editor: HTMLElement): string {
  return EditorView.findFromDOM(editor)!.state.doc.toString();
}

function suggestionsAsked(model: ReturnType<typeof fakeModelProvider>) {
  return model.requests.filter((request) => request.url.endsWith("/suggest"));
}

function written(fake: ReturnType<typeof fakePlatform>) {
  return fake.calls.filter((call) => call.name === "resolveConflict").map((call) => call.request);
}

/** Asks for a Suggestion, and gives it once it's shown. */
async function suggest(user: ReturnType<typeof userEvent.setup>, widget: HTMLElement) {
  await user.click(within(widget).getByRole("button", { name: "Suggest a resolution" }));
  return within(widget).findByRole("region", { name: /^AI-generated Suggestion for/ });
}

// The first test here pays for loading the Conflicts page and its editors, then runs axe: about 3s under load, so with the rest of the suite beside it,
// it's given longer than Vitest's 5s default.
test("while AI is off, the AI Suggestion Widget says how to turn it on, and nothing is sent", { timeout: 20_000 }, async () => {
  const { fake, container, widget } = await opened();

  expect(within(widget).getByText("AI is off, so nothing is sent to any Model Provider.")).toBeVisible();
  expect(within(widget).getByText(/open Settings in the title bar, turn on “Suggest Resolutions with AI”/)).toBeVisible();
  expect(within(widget).queryByRole("button", { name: "Suggest a resolution" })).toBeNull();
  expect(fake.fetches).toEqual([]);
  await expectNoAxeViolations(container);
});

test("Suggest a resolution sends exactly what the disclosure lists, and shows the Suggestion, labelled AI-generated, without applying it", async () => {
  aiOn();
  const { user, fake, model, container, editor, widget } = await opened();

  expect(await within(widget).findByText("For Conflict Hunk 1 of 2, lines 26–33, where the Resolution is.")).toBeVisible();
  // What's sent is listed as the disclosure lists it.
  const listed = within(widget).getByRole("group");
  expect(within(listed).getByText("What's sent to Fake Model Provider")).toBeVisible();
  expect(within(listed).getAllByRole("listitem", { hidden: true }).map((item) => item.textContent)).toEqual(
    sentForASuggestion(20),
  );
  expect(within(widget).getByRole("button", { name: "Suggest a resolution" })).toHaveAccessibleDescription(
    sentForASuggestion(20).join(" "),
  );
  // Nothing is sent before the user asks.
  expect(suggestionsAsked(model)).toEqual([]);

  const shown = await suggest(user, widget);
  const [asked] = suggestionsAsked(model);
  expect(suggestionsAsked(model)).toHaveLength(1);
  // The Conflict Hunk's three versions, 20 lines each side, the path and both commit subjects: nothing else.
  expect(asked).toEqual({
    url: `${FAKE_API}/fake/suggest`,
    method: "POST",
    authorization: "Bearer sk-fake",
    body: {
      model: "fake-opus",
      version: "fake-opus-5",
      effort: null,
      budget: null,
      instructions: SUGGESTION_INSTRUCTIONS,
      prompt: suggestionPrompt(sent),
      schema: SUGGESTION_SCHEMA,
    },
  });
  expect((asked!.body as { prompt: string }).prompt).not.toContain("// above 5\n");
  expect((asked!.body as { prompt: string }).prompt).not.toContain("// below 21");
  // Only the model catalog, the model list and the Suggestion are fetched.
  expect(fake.fetches.map(({ url }) => url.replace(/^https:\/\/raw\.githubusercontent\.com\/.*$/, "catalog"))).toEqual([
    "catalog",
    `${FAKE_API}/fake/models`,
    `${FAKE_API}/fake/suggest`,
  ]);

  // It's said to be AI-generated, with its Resolution text, explanation and Confidence.
  expect(within(shown).getByRole("heading", { name: "AI-generated Suggestion for Conflict Hunk 1 of 2, lines 26–33" })).toBeVisible();
  expect(within(shown).getByText("Made by Fake Model Provider. Check it before you use it: AI can be wrong.")).toBeVisible();
  expect(within(shown).getByRole("region", {
      name: "Resolution text AI-generated Suggestion for Conflict Hunk 1 of 2, lines 26–33",
    })).toHaveTextContent(
    "let lanes = 5; let spare = 1;",
  );
  expect(within(shown).getByText(keepsBoth.explanation)).toBeVisible();
  expect(within(shown).getByText("Confidence: High")).toBeVisible();
  expect(within(shown).queryByText(/Low Confidence/)).toBeNull();
  expect(within(widget).getByRole("status")).toHaveTextContent(
    "AI-generated Suggestion ready for Conflict Hunk 1 of 2, lines 26–33. Confidence high.",
  );

  // Nothing is put in the Resolution, or written, until the user says.
  expect(textOf(editor)).toBe(conflicted);
  expect(written(fake)).toEqual([]);
  await expectNoAxeViolations(container);
});

test("the lines of context sent are as many as Settings says", async () => {
  aiOn({ contextLines: 2 });
  const { user, model, widget } = await opened();

  await suggest(user, widget);
  const [asked] = suggestionsAsked(model);
  expect((asked!.body as { prompt: string }).prompt).toBe(
    suggestionPrompt({ ...sent, before: above.slice(23), after: below.slice(0, 2) }),
  );
  expect(within(widget).getByRole("button", { name: "Suggest a resolution" })).toHaveAccessibleDescription(
    sentForASuggestion(2).join(" "),
  );
});

test("it asks about the Conflict Hunk the Resolution is at", async () => {
  aiOn();
  const { user, model, editor, widget } = await opened();

  act(() => editor.focus());
  await user.keyboard("{F7}{F7}");
  expect(await within(widget).findByText("For Conflict Hunk 2 of 2, lines 59–63, where the Resolution is.")).toBeVisible();
  await suggest(user, widget);
  const [asked] = suggestionsAsked(model);
  expect((asked!.body as { prompt: string }).prompt).toContain("<ours>\n    2\n</ours>");
  expect((asked!.body as { prompt: string }).prompt).toContain('<base missing="true" />');
});

test.each([
  {
    name: "still has Conflict Markers",
    resolution: "<<<<<<< HEAD\n    let lanes = 5;\n    let spare = 1;\n>>>>>>> feature\n",
    reported: "high" as const,
    said: "The model said high, but the Resolution text failed Lanewise's checks:",
    failed: ["It still has Conflict Markers."],
  },
  {
    name: "is empty",
    resolution: "",
    reported: "high" as const,
    said: "The model said high, but the Resolution text failed Lanewise's checks:",
    failed: ["It's empty.", "It leaves out 1 line only Ours has:let spare = 1;", "It leaves out 1 line only Theirs has:let lanes = 5;"],
  },
  {
    name: "drops a line only one side has",
    resolution: "    let lanes = 5;\n",
    reported: "medium" as const,
    said: "The model said medium, but the Resolution text failed Lanewise's checks:",
    failed: ["It leaves out 1 line only Ours has:let spare = 1;"],
  },
  {
    name: "is one the model itself said low for",
    resolution: keepsBoth.resolution,
    reported: "low" as const,
    said: "The model said it isn't sure of this Suggestion.",
    failed: [],
  },
])("a Suggestion that $name has low Confidence, flagged with why", async ({ resolution, reported, said, failed }) => {
  aiOn();
  const { user, fake, container, editor, widget } = await opened({
    suggestion: { ...keepsBoth, resolution, confidence: reported },
  });

  const shown = await suggest(user, widget);
  expect(within(shown).getByText("Confidence: Low")).toBeVisible();
  const flagged = within(shown).getByText("Low Confidence.").closest(".suggestion-low") as HTMLElement;
  expect(flagged).toHaveTextContent(said);
  const checks = flagged.querySelector("ul");
  expect(checks === null ? [] : [...checks.children].map((item) => item.textContent)).toEqual(failed);
  expect(within(widget).getByRole("status")).toHaveTextContent(/Confidence low: check it closely\.$/);
  // Still only shown: even a low one is the user's to accept.
  expect(textOf(editor)).toBe(conflicted);
  expect(written(fake)).toEqual([]);
  await expectNoAxeViolations(container);
});

test("Accept puts the Suggestion in the Resolution as one change undo takes back, and nothing is written until Mark resolved", async () => {
  aiOn();
  const { user, fake, container, editor, widget } = await opened();

  const shown = await suggest(user, widget);
  await user.click(within(shown).getByRole("button", { name: "Accept" }));
  expect(textOf(editor)).toBe(lanesWith(["    let lanes = 5;", "    let spare = 1;"]));
  expect(within(widget).queryByRole("region", { name: /^AI-generated Suggestion/ })).toBeNull();
  expect(within(widget).getByRole("status")).toHaveTextContent(
    "Accepted the Suggestion into the Resolution at line 26. Undo takes it back.",
  );
  expect(within(widget).getByRole("button", { name: "Suggest a resolution" })).toHaveFocus();
  // The Resolution moves on to the Conflict Hunk that's left.
  expect(within(widget).getByText("For Conflict Hunk 1 of 1, lines 53–57, where the Resolution is.")).toBeVisible();
  expect(written(fake)).toEqual([]);
  await expectNoAxeViolations(container);

  const resolution = screen.getByRole("region", { name: "Resolution" });
  await user.click(within(resolution).getByRole("button", { name: "Undo" }));
  expect(textOf(editor)).toBe(conflicted);
  await user.click(within(resolution).getByRole("button", { name: "Redo" }));

  // Only Mark resolved writes it, once the other Conflict Hunk is resolved too.
  await user.click(within(resolution).getByRole("button", { name: "Accept Ours" }));
  await user.click(within(resolution).getByRole("button", { name: "Mark resolved" }));
  await waitFor(() =>
    expect(written(fake)).toEqual([
      {
        repository: lanewise.root,
        path: "src/lanes.rs",
        content: [...above, "    let lanes = 5;", "    let spare = 1;", ...below, "    2", ""].join("\n"),
      },
    ]),
  );
});

test("Edit puts the Suggestion in the Resolution selected, with the editor focused, to change it", async () => {
  aiOn();
  const { user, fake, editor, widget } = await opened();

  const shown = await suggest(user, widget);
  await user.click(within(shown).getByRole("button", { name: "Edit" }));
  const view = EditorView.findFromDOM(editor)!;
  expect(view.hasFocus).toBe(true);
  const { from, to } = view.state.selection.main;
  expect(view.state.sliceDoc(from, to)).toBe("    let lanes = 5;\n    let spare = 1;");
  expect(within(widget).getByRole("status")).toHaveTextContent(
    "Put the Suggestion in the Resolution at line 26, selected, to edit. Undo takes it back.",
  );
  expect(textOf(editor)).toBe(lanesWith(["    let lanes = 5;", "    let spare = 1;"]));
  expect(written(fake)).toEqual([]);
});

test("Reject dismisses the Suggestion, and the Resolution is as it was", async () => {
  aiOn();
  const { user, fake, container, editor, widget } = await opened();

  const shown = await suggest(user, widget);
  await user.click(within(shown).getByRole("button", { name: "Reject" }));
  expect(within(widget).queryByRole("region", { name: /^AI-generated Suggestion/ })).toBeNull();
  expect(within(widget).getByRole("status")).toHaveTextContent("Rejected the Suggestion. The Resolution is as it was.");
  expect(within(widget).getByRole("button", { name: "Suggest a resolution" })).toHaveFocus();
  expect(textOf(editor)).toBe(conflicted);
  expect(written(fake)).toEqual([]);
  await expectNoAxeViolations(container);
});

test("Accept for a Conflict Hunk resolved in the meantime puts nothing in, and says why", async () => {
  aiOn();
  const { user, editor, widget } = await opened();

  const shown = await suggest(user, widget);
  const resolution = screen.getByRole("region", { name: "Resolution" });
  await user.click(within(resolution).getByRole("button", { name: "Accept Theirs" }));
  const resolved = textOf(editor);
  await user.click(within(shown).getByRole("button", { name: "Accept" }));
  expect(textOf(editor)).toBe(resolved);
  expect(within(widget).getByRole("alert")).toHaveTextContent(
    "Conflict Hunk 1 of 2, lines 26–33 isn't in the Resolution any more, so the Suggestion wasn't put in.",
  );
});

test("Cancel stops a request that's running, and nothing it answers is shown", async () => {
  aiOn();
  const signals: AbortSignal[] = [];
  const slow: { answer?: () => void } = {};
  const { user, container, editor, widget } = await opened({
    fetch: (url, init, answered) => {
      if (!url.endsWith("/suggest")) return answered();
      signals.push(init!.signal!);
      // Answers only when the test says, as a slow Model Provider would, unless it's stopped first.
      return new Promise((resolve) => {
        slow.answer = () => resolve(answered());
      });
    },
  });

  await user.click(within(widget).getByRole("button", { name: "Suggest a resolution" }));
  await waitFor(() => expect(signals).toHaveLength(1));
  expect(within(widget).getByRole("button", { name: "Suggest a resolution" })).toHaveAttribute("aria-disabled", "true");
  expect(
    within(widget).getByText("Asking for a Suggestion for Conflict Hunk 1 of 2, lines 26–33…", { selector: ".surface-note" }),
  ).toBeVisible();
  await expectNoAxeViolations(container);

  await user.click(within(widget).getByRole("button", { name: "Cancel" }));
  expect(signals[0]!.aborted).toBe(true);
  expect(within(widget).queryByRole("button", { name: "Cancel" })).toBeNull();
  expect(within(widget).getByRole("status")).toHaveTextContent(
    "Cancelled the request for a Suggestion. Nothing was put in the Resolution.",
  );
  expect(within(widget).getByRole("button", { name: "Suggest a resolution" })).toHaveFocus();

  // It answers after all, and is ignored.
  slow.answer!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(within(widget).queryByRole("region", { name: /^AI-generated Suggestion/ })).toBeNull();
  expect(within(widget).queryByRole("alert")).toBeNull();
  expect(textOf(editor)).toBe(conflicted);
});

test("choosing another file stops a request still running for the one before", async () => {
  aiOn();
  const signals: AbortSignal[] = [];
  const { user, files, widget } = await opened({
    fetch: (url, init, answered) => {
      if (!url.endsWith("/suggest")) return answered();
      signals.push(init!.signal!);
      return new Promise(() => {});
    },
  });

  await user.click(within(widget).getByRole("button", { name: "Suggest a resolution" }));
  await waitFor(() => expect(signals).toHaveLength(1));
  await user.click(within(files).getByRole("button", { name: "src/merge.rs Conflicted" }));
  await screen.findByRole("textbox", { name: "Resolution of src/merge.rs" });
  expect(signals[0]!.aborted).toBe(true);
  expect(within(widget).queryByRole("button", { name: "Cancel" })).toBeNull();
});

test.each([
  {
    name: "refuses the API key",
    keys: { fake: "sk-wrong" },
    said: "The Model Provider refused the API key. Check it on the Model Provider's API-key page and save it again.",
  },
  { name: "has no API key kept", keys: {} as Record<string, string>, said: "Save your API key for Fake Model Provider in Settings." },
])("a request that fails because the Model Provider $name says so clearly", async ({ keys, said }) => {
  aiOn();
  const { user, container, editor, widget } = await opened({ keys });

  await user.click(within(widget).getByRole("button", { name: "Suggest a resolution" }));
  expect(await within(widget).findByRole("alert")).toHaveTextContent(said);
  expect(within(widget).queryByRole("region", { name: /^AI-generated Suggestion/ })).toBeNull();
  expect(textOf(editor)).toBe(conflicted);
  await expectNoAxeViolations(container);
});

test("a Suggestion says the tokens it took, the widget the context it sends and the run's totals, and Refresh context works it out again", async () => {
  resetTokenTotals();
  aiOn();
  const { user, widget } = await opened({ suggestion: { ...keepsBoth, usage: { inputTokens: 1234, outputTokens: 56 } } });

  expect(await within(widget).findByText(/^Context: \d+ lines before and \d+ after, of up to 20 each side, about [\d,]+ tokens to send\.$/)).toBeVisible();
  expect(within(widget).getByText("No tokens taken yet in this run.")).toBeVisible();

  const shown = await suggest(user, widget);

  expect(within(shown).getByText("Took 1,234 tokens in and 56 tokens out, as Fake Model Provider counts them.")).toBeVisible();
  expect(within(widget).getByText("This run: 1,234 tokens in and 56 tokens out, over 1 Suggestion.")).toBeVisible();
  await user.click(within(widget).getByRole("button", { name: "Refresh context" }));
  expect(within(widget).getByText(/^Context: /)).toBeVisible();
});
