// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import type { AmendableCommit, Outcome } from "../commands/api";
import { expectNoAxeViolations } from "../test/axe";
import { fakePlatform, type FakeCommands } from "../test/fakePlatform";
import type { CommitCheck } from "../ai/jevDecisions";
import { CommitForm } from "./CommitForm";
import { forgetUndoHistories, historyOf } from "./undo";

afterEach(() => {
  cleanup();
  forgetUndoHistories();
});

const lanewise = { root: "/work/lanewise", name: "lanewise" };

function renderForm(commands: FakeCommands) {
  const fake = fakePlatform({ commands });
  const committed: number[] = [];
  const view = render(
    <CommitForm
      commands={fake.platform.commands}
      repository={lanewise}
      onCommitted={() => committed.push(committed.length + 1)}
    />,
  );
  return { fake, committed, ...view };
}

function commits(shortId = "4f2a9c1", messages = ""): () => Outcome<"commit"> {
  return () => ({ ok: true, value: { id: `${shortId}${"0".repeat(33)}`, shortId, messages } });
}

const last: AmendableCommit = {
  id: `9b1d2e3${"0".repeat(33)}`,
  shortId: "9b1d2e3",
  subject: "Draw the lane graph",
  body: "Beside the history, in step with its grid.",
  pushedTo: [],
};

function subject(): HTMLElement {
  return screen.getByRole("textbox", { name: "Subject" });
}

function body(): HTMLElement {
  return screen.getByRole("textbox", { name: "Body (optional)" });
}

function commitCalls(fake: { calls: { name: string; request: unknown }[] }) {
  return fake.calls.filter((call) => call.name === "commit").map((call) => call.request);
}

test("a subject and a body commit the staged changes, and the box empties for the next", async () => {
  const user = userEvent.setup();
  const { fake, committed, container } = renderForm({ commit: commits() });
  await expectNoAxeViolations(container);

  await user.type(subject(), "Stage files from the Working tree");
  await user.type(body(), "One at a time, or all at once.");
  await user.click(screen.getByRole("button", { name: "Commit" }));

  expect(await screen.findByText("Committed 4f2a9c1.")).toBeVisible();
  expect(commitCalls(fake)).toEqual([
    {
      repository: lanewise.root,
      message: "Stage files from the Working tree\n\nOne at a time, or all at once.",
      amend: false,
    },
  ]);
  expect(committed).toEqual([1]);
  expect(subject()).toHaveValue("");
  expect(body()).toHaveValue("");
  // For the Toolbar's Undo.
  expect(historyOf(lanewise.root).undo).toEqual([
    { kind: "commit", id: `4f2a9c1${"0".repeat(33)}`, subject: "Stage files from the Working tree" },
  ]);
  await expectNoAxeViolations(container);
});

test("Ctrl+Enter or Cmd+Enter commits from either field, and a message without a body is its subject", async () => {
  const user = userEvent.setup();
  const { fake } = renderForm({ commit: commits() });

  await user.click(subject());
  await user.keyboard("Fix the typo{Control>}{Enter}{/Control}");
  expect(await screen.findByText("Committed 4f2a9c1.")).toBeVisible();

  await user.type(subject(), "Fix another");
  await user.click(body());
  await user.keyboard("{Meta>}{Enter}{/Meta}");
  await screen.findByText("Committed 4f2a9c1.");

  expect(commitCalls(fake)).toEqual([
    { repository: lanewise.root, message: "Fix the typo", amend: false },
    { repository: lanewise.root, message: "Fix another", amend: false },
  ]);
  expect(screen.getByRole("button", { name: "Commit" })).toHaveAttribute(
    "aria-keyshortcuts",
    "Control+Enter Meta+Enter",
  );
});

test("without a subject, nothing is committed and the subject says what it needs", async () => {
  const user = userEvent.setup();
  const { fake, container } = renderForm({ commit: commits() });

  await user.type(body(), "A body alone");
  await user.click(screen.getByRole("button", { name: "Commit" }));

  expect(screen.getByRole("alert")).toHaveTextContent("Write a subject: one line saying what the commit does.");
  expect(subject()).toHaveFocus();
  expect(subject()).toHaveAttribute("aria-invalid", "true");
  expect(subject()).toHaveAccessibleDescription("Write a subject: one line saying what the commit does.");
  expect(commitCalls(fake)).toEqual([]);
  await expectNoAxeViolations(container);
});

test("with nothing staged, it says to stage something first", async () => {
  const user = userEvent.setup();
  renderForm({ commit: () => ({ ok: false, error: { kind: "nothingStaged" } }) });

  await user.type(subject(), "Nothing yet");
  await user.click(screen.getByRole("button", { name: "Commit" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Nothing is staged, so there's nothing to commit");
  expect(subject()).toHaveValue("Nothing yet");
});

test("a failing pre-commit hook stops the commit, shows what it said and keeps the message", async () => {
  const user = userEvent.setup();
  const { committed, container } = renderForm({
    commit: () => ({
      ok: false,
      error: {
        kind: "gitFailed",
        command: "git commit",
        code: 1,
        message: "lint: a.txt:1 has trailing whitespace\nlint: 1 problem",
      },
    }),
  });

  await user.type(subject(), "Add a");
  await user.type(body(), "With a body.");
  await user.click(screen.getByRole("button", { name: "Commit" }));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(
    "Nothing was committed. Git stopped with exit code 1, and the message is kept to try again.",
  );
  const said = within(alert).getByRole("figure", { name: "What Git and the hooks said" });
  expect(said.querySelector("pre")?.textContent).toBe("lint: a.txt:1 has trailing whitespace\nlint: 1 problem");
  expect(subject()).toHaveValue("Add a");
  expect(body()).toHaveValue("With a body.");
  expect(committed).toEqual([]);
  await expectNoAxeViolations(container);
});

test("what a passing hook said is shown with the commit", async () => {
  const user = userEvent.setup();
  const { container } = renderForm({ commit: commits("4f2a9c1", "lint: 1 file checked") });

  await user.type(subject(), "Add a");
  await user.click(screen.getByRole("button", { name: "Commit" }));

  await screen.findByText("Committed 4f2a9c1.");
  const said = screen.getByRole("figure", { name: "What the hooks said" });
  expect(said.querySelector("pre")?.textContent).toBe("lint: 1 file checked");
  await expectNoAxeViolations(container);
});

test("amending puts the last commit's message in the box to edit, and replaces the commit", async () => {
  const user = userEvent.setup();
  const { fake, committed, container } = renderForm({
    lastCommit: () => ({ ok: true, value: last }),
    commit: commits("7c8d9e0"),
  });

  await user.click(screen.getByRole("checkbox", { name: "Amend the last commit" }));

  expect(await screen.findByRole("button", { name: "Amend" })).toBeVisible();
  expect(subject()).toHaveValue("Draw the lane graph");
  expect(body()).toHaveValue("Beside the history, in step with its grid.");
  expect(screen.getByText(/^Amending 9b1d2e3, Draw the lane graph:/)).toBeVisible();
  // Not pushed, so no warning.
  expect(screen.queryByRole("alert")).toBeNull();
  await expectNoAxeViolations(container);

  await user.clear(subject());
  await user.type(subject(), "Draw the lane graph beside the history");
  await user.click(screen.getByRole("button", { name: "Amend" }));

  expect(await screen.findByText("Amended the last commit: it is now 7c8d9e0.")).toBeVisible();
  expect(commitCalls(fake)).toEqual([
    {
      repository: lanewise.root,
      message: "Draw the lane graph beside the history\n\nBeside the history, in step with its grid.",
      amend: true,
    },
  ]);
  expect(committed).toEqual([1]);
  expect(historyOf(lanewise.root).undo).toEqual([
    { kind: "amend", id: `7c8d9e0${"0".repeat(33)}`, replaced: last.id, subject: "Draw the lane graph beside the history" },
  ]);
  expect(screen.getByRole("checkbox", { name: "Amend the last commit" })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Commit" })).toBeVisible();
});

test("amending a commit that's been pushed warns that it rewrites history others may have", async () => {
  const user = userEvent.setup();
  const { container } = renderForm({
    lastCommit: () => ({ ok: true, value: { ...last, pushedTo: ["origin/main", "upstream/main"] } }),
  });

  const amend = screen.getByRole("checkbox", { name: "Amend the last commit" });
  await user.click(amend);

  const warning = await screen.findByRole("alert");
  expect(warning).toHaveTextContent("9b1d2e3 is already on origin/main and upstream/main.");
  expect(warning).toHaveTextContent("pushing it then needs a force push");
  expect(amend).toHaveAccessibleDescription(warning.textContent ?? "");
  await expectNoAxeViolations(container);
});

test("a message already written is kept when amending, and one only read from the last commit goes when it's unticked", async () => {
  const user = userEvent.setup();
  renderForm({ lastCommit: () => ({ ok: true, value: last }) });
  const amend = screen.getByRole("checkbox", { name: "Amend the last commit" });

  await user.click(amend);
  await screen.findByRole("button", { name: "Amend" });
  await user.click(amend);
  expect(subject()).toHaveValue("");
  expect(body()).toHaveValue("");

  await user.type(subject(), "A better subject");
  await user.click(amend);
  await screen.findByRole("button", { name: "Amend" });
  expect(subject()).toHaveValue("A better subject");
  expect(body()).toHaveValue("");
  await user.click(amend);
  expect(subject()).toHaveValue("A better subject");
});

test("with no commits yet, there's nothing to amend", async () => {
  const user = userEvent.setup();
  renderForm({ lastCommit: () => ({ ok: true, value: null }) });

  await user.click(screen.getByRole("checkbox", { name: "Amend the last commit" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("There's no commit to amend yet.");
  expect(screen.getByRole("checkbox", { name: "Amend the last commit" })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Commit" })).toBeVisible();
});

test("with Jev on, a commit whose staged changes look to hold a secret waits for Commit anyway, and Jev's type can start the subject", async () => {
  const user = userEvent.setup();
  const fake = fakePlatform({ commands: { commit: commits() } });
  const asked: string[] = [];
  const check: CommitCheck = { secret: 0.92, leftover: 0.1, type: "fix" };
  const { container } = render(
    <CommitForm
      commands={fake.platform.commands}
      repository={lanewise}
      onCommitted={() => {}}
      checkWithJev={async (message) => {
        asked.push(message);
        return check;
      }}
    />,
  );

  await user.type(screen.getByRole("textbox", { name: "Subject" }), "Mend the parser");
  await user.click(screen.getByRole("button", { name: "Commit" }));

  const found = await screen.findByRole("alert");
  expect(found).toHaveTextContent("It looks likely (92%) that the staged changes hold a secret");
  expect(asked).toEqual(["Mend the parser"]);
  // Nothing is committed until the user says.
  expect(fake.calls.filter(({ name }) => name === "commit")).toEqual([]);
  await expectNoAxeViolations(container);

  await user.click(within(found).getByRole("button", { name: "Start the subject with fix:" }));
  expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue("fix: Mend the parser");

  await user.click(within(screen.getByRole("alert")).getByRole("button", { name: "Commit anyway" }));
  expect(await screen.findByText("Committed 4f2a9c1.")).toBeVisible();
  expect(fake.calls.filter(({ name }) => name === "commit").map(({ request }) => request)).toEqual([
    { repository: "/work/lanewise", message: "fix: Mend the parser", amend: false },
  ]);
});

test("with Jev on and nothing found, the commit goes ahead at once", async () => {
  const user = userEvent.setup();
  const fake = fakePlatform({ commands: { commit: commits() } });
  render(
    <CommitForm
      commands={fake.platform.commands}
      repository={lanewise}
      onCommitted={() => {}}
      checkWithJev={async () => ({ secret: 0.02, leftover: 0.03, type: "feat" })}
    />,
  );

  await user.type(screen.getByRole("textbox", { name: "Subject" }), "Add lanes");
  await user.click(screen.getByRole("button", { name: "Commit" }));

  expect(await screen.findByText("Committed 4f2a9c1.")).toBeVisible();
});
