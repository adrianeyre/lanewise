// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { EditorView } from "@codemirror/view";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { JEV_API, JEV_ID } from "../ai/jev";
import type { Suggestion } from "../ai/modelProvider";
import { App } from "../App";
import type { CommandName, ConflictedFile, InProgressOperation } from "../commands/api";
import { JEV_KEY, MODEL_PROVIDER_KEY } from "../settings/localSettings";
import { expectNoAxeViolations } from "../test/axe";
import { fakeModelProvider } from "../test/fakeModelProvider";
import { fakeKeyStore, fakePlatform, historyCommit } from "../test/fakePlatform";
import { isVersionCheck, upToDate } from "../test/versionCheck";

/*
 * Pen-test round 1, M2 (#26, `docs/pen-test/M2.md`): nothing a Model
 * Provider or Jev answers reaches the Resolution without the user's Accept,
 * Edit or Use, or the working tree without Mark resolved. Asking for every
 * Conflict Hunk's Suggestion, with Jev checking each and picking a side,
 * sends no command that writes; a Suggestion shown and never accepted isn't
 * in what Mark resolved writes, nor is one still being asked for; one file's
 * Suggestions never reach another's Resolution, even with the same Conflict
 * Hunk; and Jev's answers that aren't a side, or that never come, put
 * nothing in.
 */

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

const repository = { root: "/work/lanewise", name: "lanewise" };
const feature = historyCommit(2, { labels: [{ kind: "branch", name: "feature" }] });
const text = (lines: string[]) => ({ kind: "text" as const, text: lines.join("\n") });

const hunk = (ours: string, theirs: string) => ["<<<<<<< HEAD", ours, "||||||| base", "let n = 1;", "=======", theirs, ">>>>>>> feature"];

/** A file with one Conflict Hunk on lines 2–8, or, with `twice`, a second on lines 10–16. */
function conflictedFile(twice = false): ConflictedFile {
  const second = twice ? ["// then", ...hunk("let m = 2;", "let size = 1;")] : [];
  const sides = (ours: boolean) => [
    "fn main() {",
    ours ? "let n = 2;" : "let count = 1;",
    ...(twice ? ["// then", ours ? "let m = 2;" : "let size = 1;"] : []),
    "}",
    "",
  ];
  return {
    base: text(["fn main() {", "let n = 1;", ...(twice ? ["// then", "let n = 1;"] : []), "}", ""]),
    ours: text(sides(true)),
    theirs: text(sides(false)),
    working: text(["fn main() {", ...hunk("let n = 2;", "let count = 1;"), ...second, "}", ""]),
    reports: [],
    oursSubject: "Start at two",
    theirsSubject: "Rename n to count",
  };
}

/** A Suggestion that passes every check at high Confidence, for the first Conflict Hunk. */
const suggestion: Suggestion = { explanation: "Keep both.", resolution: "let n = 2;\nlet count = 1;", confidence: "high" };

/** The commands asking for a Suggestion, or Jev, may send: those that read a key or a Gateway, and none that writes. */
const READS: readonly CommandName[] = ["modelProviderKey", "gatewayOf", "gatewayRequest"];

/**
 * Lanewise, partway through a merge of `files`, by path, with the first
 * chosen, AI on with the fake Model Provider answering `suggestion`, and
 * Jev, if `jev` is given, on for Suggestions and sides and answering it, or
 * not reached where it's `null`. With `hold`, each request for a Suggestion
 * waits in `held` until the test answers it. Mark resolved takes a file out
 * of the merge's conflicts.
 */
async function opened({
  files = { "src/main.rs": conflictedFile() },
  jev,
  hold = false,
}: { files?: Record<string, ConflictedFile>; jev?: Record<string, unknown> | null; hold?: boolean } = {}) {
  localStorage.setItem(
    MODEL_PROVIDER_KEY,
    JSON.stringify({ enabled: true, disclosed: ["fake"], global: { provider: "fake", model: "fake-opus" } }),
  );
  if (jev !== undefined) {
    localStorage.setItem(JEV_KEY, JSON.stringify({ enabled: true, suggestions: true, triage: true, commits: false }));
  }
  const user = userEvent.setup();
  const model = fakeModelProvider({ suggestion });
  const store = fakeKeyStore({ fake: "sk-fake", [JEV_ID]: "ts-key" });
  const held: { signal: AbortSignal; answer: () => void }[] = [];
  let conflicts = Object.keys(files);
  const fake = fakePlatform({
    folders: [repository.root],
    commands: {
      ...store.commands,
      openRepository: () => ({ ok: true, value: repository }),
      operationInProgress: () => ({
        ok: true,
        value: { kind: "merge", into: "main", merging: [feature], conflicts, resolved: [] } satisfies InProgressOperation,
      }),
      conflictedFile: ({ path }) => ({ ok: true, value: files[path]! }),
      resolveConflict: ({ path }) => {
        conflicts = conflicts.filter((each) => each !== path);
        return { ok: true, value: null };
      },
    },
    fetch: (url, init) => {
      if (isVersionCheck(url)) return upToDate();
      if (url.startsWith(JEV_API)) {
        if (jev === null) throw new TypeError("Failed to fetch");
        return Response.json({ model: "jev-1.13.0", answers: jev, usage: null });
      }
      if (hold && url.endsWith("/suggest")) {
        return new Promise<Response>((resolve) => {
          held.push({ signal: init!.signal!, answer: () => resolve(model.answer(url, init)) });
        });
      }
      return model.answer(url, init);
    },
  });
  const { container } = render(<App platform={fake.platform} modelProviders={[model.provider]} />);
  await user.click(await screen.findByRole("button", { name: "Open repository" }));
  const choose = async (path: string) => {
    const list = await screen.findByRole("region", { name: "Conflicted files" });
    await user.click(within(list).getByRole("button", { name: `${path} Conflicted` }));
    return screen.findByRole("textbox", { name: `Resolution of ${path}` });
  };
  const editor = await choose(Object.keys(files)[0]!);
  const widget = screen.getByRole("region", { name: "AI Suggestion" });
  const resolution = screen.getByRole("region", { name: "Resolution" });
  return { user, fake, model, held, container, editor, widget, resolution, choose };
}

function textOf(editor: HTMLElement): string {
  return EditorView.findFromDOM(editor)!.state.doc.toString();
}

/** The names of the commands sent since the `from`th. */
function sentSince(fake: ReturnType<typeof fakePlatform>, from: number): CommandName[] {
  return fake.calls.slice(from).map(({ name }) => name);
}

const shownSuggestions = (within_: HTMLElement) => within(within_).queryAllByRole("region", { name: /^AI-generated Suggestion for/ });

test("Suggestions for every Conflict Hunk, each checked by Jev, and Jev's pick of a side, change nothing and write nothing until the user acts", { timeout: 20_000 }, async () => {
  const { user, fake, container, editor, widget } = await opened({
    files: { "src/main.rs": conflictedFile(true) },
    jev: {
      keeps_both: { type: "noul", noul: 0.9 },
      resolution: { type: "choice", choice: "ours", probabilities: { ours: 0.8 }, confidence: 0.8 },
    },
  });
  const before = textOf(editor);
  const from = fake.calls.length;

  await user.click(within(widget).getByRole("button", { name: "Suggest for all Conflict Hunks in this file" }));
  await waitFor(() => expect(shownSuggestions(widget)).toHaveLength(2));
  await user.click(within(widget).getByRole("button", { name: "Ask Jev which side" }));
  expect(await within(widget).findByRole("button", { name: "Use Ours" })).toBeVisible();

  expect(within(widget).getAllByText("Jev: 90% likely to keep what both sides meant.")).toHaveLength(2);
  expect(textOf(editor)).toBe(before);
  expect(sentSince(fake, from).filter((name) => !READS.includes(name))).toEqual([]);
  // The only ways in are each Suggestion's own Accept and Edit, and Jev's Use.
  const putters = within(widget)
    .getAllByRole("button")
    .map((button) => button.textContent)
    .filter((name) => /accept|edit|use|apply/i.test(name ?? ""));
  expect(putters).toEqual(["Use Ours", "Accept", "Edit", "Accept", "Edit"]);
  await expectNoAxeViolations(container);
});

test("a Suggestion shown and never accepted isn't in what Mark resolved writes", async () => {
  const { user, fake, editor, widget, resolution } = await opened();

  await user.click(within(widget).getByRole("button", { name: "Suggest a resolution" }));
  expect(await within(widget).findByRole("region", { name: /^AI-generated Suggestion for/ })).toBeVisible();
  await user.click(within(resolution).getByRole("button", { name: "Accept Ours" }));
  expect(textOf(editor)).toBe(["fn main() {", "let n = 2;", "}", ""].join("\n"));
  await user.click(within(resolution).getByRole("button", { name: "Mark resolved" }));

  await waitFor(() => expect(fake.calls.filter(({ name }) => name === "resolveConflict")).toHaveLength(1));
  expect(fake.calls.find(({ name }) => name === "resolveConflict")?.request).toEqual({
    repository: repository.root,
    path: "src/main.rs",
    content: ["fn main() {", "let n = 2;", "}", ""].join("\n"),
  });
});

test("Mark resolved while a Suggestion is still being asked for writes the Resolution as it is, and the late answer goes nowhere", async () => {
  const { user, fake, held, widget, resolution } = await opened({ hold: true });

  await user.click(within(widget).getByRole("button", { name: "Suggest a resolution" }));
  await waitFor(() => expect(held).toHaveLength(1));
  await user.click(within(resolution).getByRole("button", { name: "Accept Theirs" }));
  await user.click(within(resolution).getByRole("button", { name: "Mark resolved" }));
  await waitFor(() => expect(held[0]!.signal.aborted).toBe(true));
  held[0]!.answer();

  const written = fake.calls.filter(({ name }) => name === "resolveConflict");
  expect(written.map(({ request }) => (request as { content: string }).content)).toEqual([
    ["fn main() {", "let count = 1;", "}", ""].join("\n"),
  ]);
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Resolution of src/main.rs" })).toBeNull());
  expect(screen.queryAllByRole("region", { name: /^AI-generated Suggestion for/ })).toEqual([]);
});

test("one file's Suggestion is put in no other file's Resolution, even where it has the same Conflict Hunk", async () => {
  const { user, widget, choose } = await opened({
    files: { "src/main.rs": conflictedFile(), "src/copy.rs": conflictedFile() },
  });
  const asGitLeftIt = ["fn main() {", ...hunk("let n = 2;", "let count = 1;"), "}", ""].join("\n");

  await user.click(within(widget).getByRole("button", { name: "Suggest a resolution" }));
  expect(await within(widget).findByRole("region", { name: /^AI-generated Suggestion for/ })).toBeVisible();

  const copy = await choose("src/copy.rs");
  expect(shownSuggestions(widget)).toEqual([]);
  expect(textOf(copy)).toBe(asGitLeftIt);

  const main = await choose("src/main.rs");
  expect(shownSuggestions(widget)).toEqual([]);
  expect(textOf(main)).toBe(asGitLeftIt);
});

test.each([
  ["a person", { type: "choice", choice: "person", probabilities: { person: 0.7 }, confidence: 0.7 }, "For Conflict Hunk 1 of 1, lines 2–8: It needs a person to write it, 70% likely."],
  ["none of the five", { type: "choice", choice: "rewrite", probabilities: { rewrite: 0.9 }, confidence: 0.9 }, "Jev couldn't say. Its answer wasn't one Lanewise could use."],
])("Jev's pick of %s offers nothing to Use, and changes nothing", async (_, answer, said) => {
  const { user, editor, widget } = await opened({ jev: { resolution: answer } });
  const before = textOf(editor);

  await user.click(within(widget).getByRole("button", { name: "Ask Jev which side" }));

  expect(await within(widget).findByText(said, { exact: false })).toBeVisible();
  expect(within(widget).queryByRole("button", { name: /^Use/ })).toBeNull();
  expect(textOf(editor)).toBe(before);
});

test("with Jev not reached, a Suggestion is still only shown, saying Jev couldn't check it", async () => {
  const { user, editor, widget } = await opened({ jev: null });
  const before = textOf(editor);

  await user.click(within(widget).getByRole("button", { name: "Suggest a resolution" }));

  const shown = await within(widget).findByRole("region", { name: /^AI-generated Suggestion for/ });
  expect(within(shown).getByText("Jev couldn't check it. Lanewise couldn't reach TypeSafe.")).toBeVisible();
  expect(within(shown).getByText("Confidence: High")).toBeVisible();
  expect(textOf(editor)).toBe(before);
});
