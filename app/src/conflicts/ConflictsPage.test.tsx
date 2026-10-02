// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "../App";
import type { InProgressOperation, Outcome, Stash } from "../commands/api";
import { expectNoAxeViolations } from "../test/axe";
import { fakePlatform, type FakeCommands, historyCommit } from "../test/fakePlatform";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const lanewise = { root: "/work/lanewise", name: "lanewise" };
const request = { repository: lanewise.root };
const onto = historyCommit(0, { labels: [{ kind: "remoteBranch", name: "origin/main" }] });

function rebaseAt(step: number, found: { conflicts?: string[]; resolved?: string[] } = {}): InProgressOperation {
  return {
    kind: "rebase",
    branch: "main",
    onto,
    step,
    steps: 7,
    conflicts: ["src/lanes.rs", "src/merge.rs"],
    resolved: [],
    ...found,
  };
}

/** Lanewise, opening `lanewise` with `commands` answering, and the page shown once it's open. */
async function opened(commands: FakeCommands) {
  const user = userEvent.setup();
  const fake = fakePlatform({
    folders: [lanewise.root],
    commands: { openRepository: () => ({ ok: true, value: lanewise }), ...commands },
  });
  const { container } = render(<App platform={fake.platform} />);
  await user.click(await screen.findByRole("button", { name: "Open repository" }));
  return { user, fake, container };
}

function calledWith(fake: ReturnType<typeof fakePlatform>, name: string) {
  return fake.calls.filter((call) => call.name === name).map((call) => call.request);
}

test("a repository opened partway through a rebase started in a terminal shows the Conflicts page, commit 3 of 7", async () => {
  const { container } = await opened({ operationInProgress: () => ({ ok: true, value: rebaseAt(3) }) });

  const operation = await screen.findByRole("region", { name: "Rebase in progress" });
  expect(within(operation).getByText("Rebasing “main” onto “origin/main”, commit 3 of 7: 2 files still conflicted.")).toBeVisible();
  // Along the top, above the conflicted files.
  expect(operation.closest(".conflicts-operation")).not.toBeNull();
  expect(screen.getByRole("heading", { level: 2, name: "lanewise: Conflicts" })).toBeVisible();
  // The Repository page's Widgets and Toolbar aren't drawn in its place.
  expect(screen.queryByRole("region", { name: "Commit graph" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Stash changes…" })).toBeNull();
  // Opened, not changed to, it leaves focus where it was.
  expect(within(operation).getByRole("heading", { name: "Rebase in progress" })).not.toHaveFocus();

  const files = screen.getByRole("region", { name: "Conflicted files" });
  expect(within(files).getByText(/^0 of 2 files resolved\./)).toBeVisible();
  expect(within(files).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "src/lanes.rs ConflictedMark resolved",
    "src/merge.rs ConflictedMark resolved",
  ]);
  expect(within(operation).getByRole("button", { name: "Continue" })).toHaveAttribute("aria-disabled", "true");
  expect(within(operation).getByRole("button", { name: "Continue" })).toHaveAccessibleDescription(
    /^Mark every file resolved to continue\./,
  );
  expect(within(operation).getByRole("button", { name: "Skip commit" })).toBeVisible();
  expect(within(operation).getByRole("button", { name: "Abort rebase" })).toBeVisible();

  // Until a file is chosen, the Three-way view, the Resolution and the AI Suggestion wait, hidden.
  expect(screen.getByText("Choose a conflicted file to resolve it.")).toBeVisible();
  expect(screen.queryByRole("region", { name: "Resolution" })).toBeNull();
  expect(screen.queryByRole("region", { name: "AI Suggestion" })).toBeNull();

  await expectNoAxeViolations(container);
});

test("Continue is used only once every file is marked resolved, and a rebase continued moves on to the next commit's conflicts", async () => {
  let shown = rebaseAt(3);
  const { user, fake, container } = await opened({
    operationInProgress: () => ({ ok: true, value: shown }),
    markResolved: ({ paths }) => {
      shown = rebaseAt(3, {
        conflicts: shown.conflicts.filter((path) => !paths.includes(path)),
        resolved: [...shown.resolved, ...paths].toSorted(),
      });
      return { ok: true, value: null };
    },
    markUnresolved: ({ paths }) => {
      shown = rebaseAt(3, {
        conflicts: [...shown.conflicts, ...paths].toSorted(),
        resolved: shown.resolved.filter((path) => !paths.includes(path)),
      });
      return { ok: true, value: null };
    },
    continueOperation: () => {
      shown = rebaseAt(5, { conflicts: ["README.md"] });
      return { ok: true, value: shown };
    },
  });
  const operation = await screen.findByRole("region", { name: "Rebase in progress" });
  const files = screen.getByRole("region", { name: "Conflicted files" });
  const continued = within(operation).getByRole("button", { name: "Continue" });

  // With files conflicted, Continue says why it can't, and runs nothing.
  await user.click(continued);
  expect(within(operation).getByRole("alert")).toHaveTextContent(
    "The In-Progress Operation didn't continue: 2 files are still conflicted. Mark every file resolved first.",
  );
  expect(calledWith(fake, "continueOperation")).toEqual([]);

  // Marking a file resolved moves it to Resolved, and focus to the row that took its place.
  within(files).getByRole("button", { name: "Mark src/lanes.rs resolved" }).focus();
  await user.keyboard("{Enter}");
  await waitFor(() => expect(within(files).getByRole("button", { name: "Mark src/merge.rs resolved" })).toHaveFocus());
  expect(within(files).getByRole("status")).toHaveTextContent("Marked “src/lanes.rs” resolved.");
  expect(within(files).getByText(/^1 of 2 files resolved\./)).toBeVisible();
  expect(within(within(files).getByRole("region", { name: "Resolved" })).getByRole("listitem")).toHaveTextContent(
    "src/lanes.rs Resolved",
  );
  expect(within(operation).getByRole("button", { name: "Continue" })).toHaveAttribute("aria-disabled", "true");

  // Marked unresolved again, it's conflicted again.
  await user.click(within(files).getByRole("button", { name: "Mark src/lanes.rs unresolved" }));
  await waitFor(() => expect(within(files).queryByRole("region", { name: "Resolved" })).toBeNull());
  expect(calledWith(fake, "markUnresolved")).toEqual([{ ...request, paths: ["src/lanes.rs"] }]);

  // Mark all resolved, and Continue can be used.
  await user.click(within(files).getByRole("button", { name: "Mark all resolved" }));
  await waitFor(() => expect(within(operation).getByRole("button", { name: "Continue" })).not.toHaveAttribute("aria-disabled"));
  expect(within(operation).getByText("Rebasing “main” onto “origin/main”, commit 3 of 7. Nothing is conflicted.")).toBeVisible();
  expect(calledWith(fake, "markResolved")).toEqual([
    { ...request, paths: ["src/lanes.rs"] },
    { ...request, paths: ["src/lanes.rs", "src/merge.rs"] },
  ]);
  await expectNoAxeViolations(container);

  // Continued, the rebase stops at its next commit that conflicts, which the page shows.
  await user.click(within(operation).getByRole("button", { name: "Continue" }));
  await waitFor(() =>
    expect(within(operation).getByText("Rebasing “main” onto “origin/main”, commit 5 of 7: 1 file still conflicted.")).toBeVisible(),
  );
  expect(within(operation).getByRole("heading", { name: "Rebase in progress" })).toHaveFocus();
  expect(screen.getByText(/^Continued\. Rebasing “main” onto “origin\/main”, commit 5 of 7, stopped with conflicts in 1 file\.$/)).toHaveAttribute(
    "role",
    "status",
  );
  expect(within(files).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["README.md ConflictedMark resolved"]);
  expect(calledWith(fake, "continueOperation")).toEqual([request]);
});

test("Skip is a rebase's alone, and skipping the last commit ends the rebase, back on the Repository page", async () => {
  let shown: InProgressOperation | null = rebaseAt(7);
  const { user, fake } = await opened({
    operationInProgress: () => ({ ok: true, value: shown }),
    skipCommit: () => {
      shown = null;
      return { ok: true, value: null };
    },
  });
  const operation = await screen.findByRole("region", { name: "Rebase in progress" });

  await user.click(within(operation).getByRole("button", { name: "Skip commit" }));

  await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "lanewise" })).toHaveFocus());
  expect(screen.queryByRole("region", { name: "Rebase in progress" })).toBeNull();
  expect(screen.getByText("Skipped the commit, and the rebase finished.")).toHaveAttribute("role", "status");
  expect(await screen.findByRole("button", { name: "Stash changes…" })).toBeVisible();
  expect(calledWith(fake, "skipCommit")).toEqual([request]);
});

test("Abort asks first, saying what it undoes, and a merge aborted goes back to the Repository page", async () => {
  let shown: InProgressOperation | null = {
    kind: "merge",
    into: "main",
    merging: [historyCommit(1, { labels: [{ kind: "branch", name: "feature" }] })],
    conflicts: ["src/merge.rs"],
    resolved: ["README.md"],
  };
  let aborted: Outcome<"abortOperation"> = {
    ok: false,
    error: { kind: "gitFailed", command: "git merge --abort", code: 128, message: "fatal: index.lock exists" },
  };
  const { user, fake, container } = await opened({
    operationInProgress: () => ({ ok: true, value: shown }),
    abortOperation: () => {
      if (aborted.ok) shown = null;
      return aborted;
    },
  });
  const operation = await screen.findByRole("region", { name: "Merge in progress" });
  expect(within(operation).getByText("Merging “feature” into “main”: 1 file still conflicted.")).toBeVisible();
  expect(within(operation).queryByRole("button", { name: "Skip commit" })).toBeNull();
  const abort = within(operation).getByRole("button", { name: "Abort merge" });

  // Kept going, nothing is aborted, and focus goes back to Abort.
  await user.click(abort);
  let dialog = screen.getByRole("dialog", { name: "Abort the merge?" });
  expect(dialog).toHaveTextContent(
    "Aborting puts the branch, index and working tree back as they were before the merge, with git merge --abort. Every resolution made so far is lost.",
  );
  expect(within(dialog).getByRole("button", { name: "Keep going" })).toHaveFocus();
  await expectNoAxeViolations(container);
  await user.keyboard("{Enter}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(abort).toHaveFocus();
  expect(calledWith(fake, "abortOperation")).toEqual([]);

  // Git failing says why, and the merge stays.
  await user.click(abort);
  await user.click(within(screen.getByRole("dialog", { name: "Abort the merge?" })).getByRole("button", { name: "Abort merge" }));
  expect(await within(operation).findByRole("alert")).toHaveTextContent(
    "The In-Progress Operation wasn't aborted. Git stopped with exit code 128: fatal: index.lock exists",
  );
  expect(screen.getByRole("region", { name: "Merge in progress" })).toBe(operation);

  aborted = { ok: true, value: null };
  await user.click(abort);
  dialog = screen.getByRole("dialog", { name: "Abort the merge?" });
  await user.click(within(dialog).getByRole("button", { name: "Abort merge" }));
  await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "lanewise" })).toHaveFocus());
  expect(screen.queryByRole("region", { name: "Merge in progress" })).toBeNull();
  expect(screen.getByText("Aborted the merge. Everything it changed is back as it was before it.")).toHaveAttribute("role", "status");
  expect(calledWith(fake, "abortOperation")).toEqual([request, request]);
});

test("a stash apply started outside Lanewise says Abort unstages what was staged before it", async () => {
  const { user } = await opened({
    operationInProgress: () => ({
      ok: true,
      value: { kind: "stashApply", stash: null, pop: false, conflicts: ["a.txt"], resolved: [] },
    }),
  });
  const operation = await screen.findByRole("region", { name: "Stash apply in progress" });
  expect(within(operation).getByText("Applying a stash: 1 file still conflicted.")).toBeVisible();

  await user.click(within(operation).getByRole("button", { name: "Abort stash apply" }));

  expect(screen.getByRole("dialog", { name: "Abort the stash apply?" })).toHaveTextContent(
    /it runs git reset --merge, which unstages any changes staged before it too, and leaves the stash's untracked files/,
  );
});

test("a popped stash Lanewise knows says Abort keeps the stash, and Continue drops it", async () => {
  const stash: Stash = {
    id: "5".repeat(40),
    index: 0,
    message: "Work",
    branch: "main",
    base: { id: onto.id, shortId: onto.shortId, summary: onto.summary },
    time: 1_790_000_000,
    untracked: true,
  };
  const { user, container } = await opened({
    operationInProgress: () => ({
      ok: true,
      value: { kind: "stashApply", stash, pop: true, conflicts: [], resolved: ["a.txt"] },
    }),
  });
  const operation = await screen.findByRole("region", { name: "Stash pop in progress" });
  expect(within(operation).getByText("Popping stash “Work”. Nothing is conflicted.")).toBeVisible();
  expect(within(operation).getByRole("button", { name: "Continue" })).toHaveAccessibleDescription(
    "Continue keeps the stash's changes in the working tree, as a pop with no conflicts would have, and drops the stash.",
  );

  await user.click(within(operation).getByRole("button", { name: "Abort stash pop" }));

  expect(screen.getByRole("dialog", { name: "Abort the stash pop?" })).toHaveTextContent(
    /removes the untracked files it added, and keeps the stash/,
  );
  await expectNoAxeViolations(container);
});

test("a merge Git stopped before committing, with no files conflicted, hides Conflicted files", async () => {
  const { container } = await opened({
    operationInProgress: () => ({
      ok: true,
      value: { kind: "merge", into: null, merging: [historyCommit(2)], conflicts: [], resolved: [] },
    }),
  });

  const operation = await screen.findByRole("region", { name: "Merge in progress" });
  expect(within(operation).getByText(`Merging commit ${historyCommit(2).shortId} into HEAD. Nothing is conflicted.`)).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Conflicted files" })).toBeNull();
  expect(screen.getByText("No files are conflicted. Continue, or abort, above.")).toBeVisible();
  await expectNoAxeViolations(container);
});

test("a cherry-pick Git stopped shows the Conflicts page, with Skip, and Abort saying what it undoes", async () => {
  const picked = historyCommit(1, { summary: "Add the lanes" });
  let shown: InProgressOperation | null = {
    kind: "cherryPick",
    into: "main",
    commit: picked,
    conflicts: ["src/lanes.rs"],
    resolved: [],
  };
  const { user, fake, container } = await opened({
    operationInProgress: () => ({ ok: true, value: shown }),
    skipCommit: () => {
      shown = null;
      return { ok: true, value: null };
    },
  });

  const operation = await screen.findByRole("region", { name: "Cherry-pick in progress" });
  expect(
    within(operation).getByText(`Cherry-picking commit ${picked.shortId} “Add the lanes” onto “main”: 1 file still conflicted.`),
  ).toBeVisible();
  await user.click(within(operation).getByRole("button", { name: "Abort cherry-pick" }));
  const dialog = screen.getByRole("dialog", { name: "Abort the cherry-pick?" });
  expect(dialog).toHaveTextContent("with git cherry-pick --abort. Every resolution made so far is lost.");
  await expectNoAxeViolations(container);
  await user.click(within(dialog).getByRole("button", { name: "Keep going" }));

  await user.click(within(operation).getByRole("button", { name: "Skip commit" }));
  await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "lanewise" })).toHaveFocus());
  expect(screen.getByText("Skipped the commit, and the cherry-pick finished.")).toHaveAttribute("role", "status");
  expect(calledWith(fake, "skipCommit")).toEqual([request]);
});

test("a revert Git stopped names the commit it reverts, and has Skip", async () => {
  const reverted = historyCommit(2, { summary: "Draw the lanes" });
  await opened({
    operationInProgress: () => ({
      ok: true,
      value: { kind: "revert", into: null, commit: reverted, conflicts: ["a.txt", "b.txt"], resolved: [] },
    }),
  });

  const operation = await screen.findByRole("region", { name: "Revert in progress" });
  expect(
    within(operation).getByText(`Reverting commit ${reverted.shortId} “Draw the lanes” on HEAD: 2 files still conflicted.`),
  ).toBeVisible();
  expect(within(operation).getByRole("button", { name: "Skip commit" })).toBeVisible();
  expect(within(operation).getByRole("button", { name: "Abort revert" })).toBeVisible();
});
