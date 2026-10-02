// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, test } from "vitest";

import type { BranchesAndRemotes, CommandClient, ResetPreview } from "../commands/api";
import { expectNoAxeViolations } from "../test/axe";
import { detailsOf, fakePlatform, type FakeCommands, graphRow, graphWindows, historyCommit } from "../test/fakePlatform";
import { CommitHistory } from "./CommitHistory";

afterEach(cleanup);

const lanewise = { root: "/work/lanewise", name: "lanewise" };

// `main` at 0, with the tag v1; `feature` at 1, which isn't HEAD.
const rows = [
  graphRow(0, {
    labels: [
      { kind: "currentBranch", name: "main" },
      { kind: "tag", name: "v1" },
    ],
  }),
  graphRow(1, { summary: "Read the refs", labels: [{ kind: "branch", name: "feature" }] }),
  graphRow(2, { summary: "Start" }),
];

function History({
  commands,
  copied,
  refs = null,
}: {
  commands: CommandClient;
  copied?: string[];
  refs?: BranchesAndRemotes | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <CommitHistory
      commands={commands}
      repository={lanewise}
      selected={selected}
      onSelect={setSelected}
      refreshes={0}
      onChanged={() => {}}
      refs={refs}
      copyText={
        copied &&
        (async (text) => {
          copied.push(text);
        })
      }
    />
  );
}

function renderHistory(commands: FakeCommands, copied?: string[], refs: BranchesAndRemotes | null = null) {
  const fake = fakePlatform({ commands: { graphWindow: graphWindows(rows), ...commands } });
  const view = render(<History commands={fake.platform.commands} copied={copied} refs={refs} />);
  return { fake, ...view };
}

/** Opens the commit menu on the row whose summary is `summary`, as a right click does. */
async function menuOn(summary: string) {
  await screen.findByRole("grid", { name: "Commit graph" });
  fireEvent.contextMenu(screen.getByRole("row", { name: new RegExp(`^${summary}, `) }), { clientX: 10, clientY: 10 });
  return screen.findByRole("menu", { name: /^Actions for commit/ });
}

const requests = (fake: ReturnType<typeof fakePlatform>, name: string) =>
  fake.calls.filter((call) => call.name === name).map((call) => call.request);

test("a tag is made at the commit, annotated when it has a message, and a tag it carries is deleted once confirmed", async () => {
  const user = userEvent.setup();
  const { fake, container } = renderHistory({
    createTag: () => ({ ok: true, value: null }),
    deleteTag: () => ({ ok: true, value: null }),
  });

  await user.click(within(await menuOn("Read the refs")).getByRole("menuitem", { name: `New tag at ${rows[1]!.shortId}…` }));
  const dialog = screen.getByRole("dialog", { name: "New tag" });
  expect(within(dialog).getByRole("textbox", { name: "Tag name" })).toHaveFocus();
  await expectNoAxeViolations(container);
  await user.keyboard("v2");
  await user.type(within(dialog).getByRole("textbox", { name: "Message (optional)" }), "The second");
  await user.click(within(dialog).getByRole("button", { name: "Create tag" }));

  expect(await screen.findByText(`Made annotated tag “v2” at ${rows[1]!.shortId} “Read the refs”.`)).toBeInTheDocument();
  expect(requests(fake, "createTag")).toEqual([
    { repository: lanewise.root, name: "v2", commit: rows[1]!.id, message: "The second" },
  ]);

  await user.click(within(await menuOn("Commit 0")).getByRole("menuitem", { name: "Delete tag “v1”…" }));
  const confirm = screen.getByRole("dialog", { name: "Delete tag “v1”?" });
  expect(within(confirm).getByRole("button", { name: "Keep the tag" })).toHaveFocus();
  await user.click(within(confirm).getByRole("button", { name: "Delete tag" }));
  expect(await screen.findByText("Deleted tag “v1”.")).toBeInTheDocument();
  expect(requests(fake, "deleteTag")).toEqual([{ repository: lanewise.root, name: "v1" }]);
});

test("a tag name Git refuses is said in the dialog, which stays open", async () => {
  const user = userEvent.setup();
  renderHistory({ createTag: ({ name }) => ({ ok: false, error: { kind: "tagExists", name } }) });

  await user.click(within(await menuOn("Read the refs")).getByRole("menuitem", { name: `New tag at ${rows[1]!.shortId}…` }));
  await user.keyboard("v1{Enter}");

  const dialog = screen.getByRole("dialog", { name: "New tag" });
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("The tag wasn't made: there's already a tag called “v1”.");
});

test("a commit is checked out with HEAD detached only once confirmed", async () => {
  const user = userEvent.setup();
  const { fake, container } = renderHistory({ checkOut: () => ({ ok: true, value: { branch: null, stash: null } }) });

  await user.click(within(await menuOn("Read the refs")).getByRole("menuitem", { name: `Check out commit ${rows[1]!.shortId}…` }));
  const dialog = screen.getByRole("dialog", { name: `Check out commit ${rows[1]!.shortId}?` });
  expect(dialog).toHaveTextContent("HEAD will be detached");
  expect(requests(fake, "checkOut")).toEqual([]);
  await expectNoAxeViolations(container);
  await user.click(within(dialog).getByRole("button", { name: "Check out with HEAD detached" }));

  // Named by its ID's first seven characters, as Git abbreviates it.
  expect(
    await screen.findByText(`Checked out commit ${rows[1]!.id.slice(0, 7)}, with HEAD detached on no branch.`),
  ).toBeInTheDocument();
  expect(requests(fake, "checkOut")).toEqual([
    { repository: lanewise.root, branch: { kind: "commit", commit: rows[1]!.id }, stashFirst: false },
  ]);
});

test("a cherry-pick says the commit it made, and one that stops says where to resolve it", async () => {
  const user = userEvent.setup();
  let stops = false;
  const { fake } = renderHistory({
    cherryPick: () =>
      stops
        ? { ok: true, value: { kind: "stopped", conflicts: ["a.txt", "b.txt"] } }
        : { ok: true, value: { kind: "committed", commit: "abcdef0123" } },
    revertCommit: () => ({ ok: false, error: { kind: "operationInProgress" } }),
  });
  const pick = `Cherry-pick commit ${rows[1]!.shortId} onto “main”`;

  await user.click(within(await menuOn("Read the refs")).getByRole("menuitem", { name: pick }));
  expect(await screen.findByText(`Cherry-picked ${rows[1]!.shortId} “Read the refs” in commit abcdef0.`)).toBeInTheDocument();

  stops = true;
  await user.click(within(await menuOn("Read the refs")).getByRole("menuitem", { name: pick }));
  expect(
    await screen.findByText(
      `Cherry-picking ${rows[1]!.shortId} “Read the refs” stopped with conflicts in 2 files. Resolve them on the Conflicts page.`,
    ),
  ).toBeInTheDocument();
  expect(requests(fake, "cherryPick")).toHaveLength(2);

  await user.click(within(await menuOn("Read the refs")).getByRole("menuitem", { name: `Revert commit ${rows[1]!.shortId}` }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Nothing was reverted: a merge, rebase, stash apply, cherry-pick or revert is in progress.",
  );
});

test("a reset shows the commits it would leave and the changes a hard one loses, and resets as HEAD was shown", async () => {
  const user = userEvent.setup();
  const lost = historyCommit(0, { summary: "Draw the lanes" });
  let heads = [rows[0]!.id, historyCommit(9).id];
  const preview = (): ResetPreview => ({ branch: "main", head: heads[0]!, count: 1, lost: [lost], uncommitted: true });
  const { fake, container } = renderHistory({
    previewReset: () => ({ ok: true, value: preview() }),
    reset: ({ head }) => {
      if (head !== heads[0]) return { ok: false, error: { kind: "headMoved" } };
      return { ok: true, value: null };
    },
  });

  const menu = await menuOn("Read the refs");
  await user.click(within(menu).getByRole("menuitem", { name: `Reset “main” to ${rows[1]!.shortId}` }));
  await user.click(await screen.findByRole("menuitem", { name: "Hard: lose the changes…" }));

  const dialog = await screen.findByRole("dialog", { name: `Reset “main” to ${rows[1]!.shortId}?` });
  expect(within(dialog).getByRole("radio", { name: /^Hard/ })).toBeChecked();
  expect(dialog).toHaveTextContent("“main” would leave 1 commit that no other branch, remote-tracking branch or tag has:");
  expect(within(dialog).getByRole("listitem")).toHaveTextContent(`${lost.shortId} Draw the lanes by Ada Lovelace`);
  expect(dialog).toHaveTextContent("A hard reset also loses every uncommitted change in the working tree.");
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
  await expectNoAxeViolations(container);

  // HEAD moves before it's confirmed: it's shown again, as HEAD is now.
  heads = [heads[1]!];
  await user.click(within(dialog).getByRole("button", { name: "Reset “main” (hard)" }));
  expect(await within(screen.getByRole("dialog")).findByText(/HEAD has moved since this was shown/)).toBeVisible();

  // Soft keeps the changes, and says nothing about losing them.
  await user.click(within(screen.getByRole("dialog")).getByRole("radio", { name: /^Soft/ }));
  expect(screen.getByRole("dialog")).not.toHaveTextContent("A hard reset also loses");
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Reset “main” (soft)" }));

  expect(await screen.findByText(`Reset “main” to ${rows[1]!.shortId} “Read the refs” (soft).`)).toBeInTheDocument();
  expect(requests(fake, "reset")).toEqual([
    { repository: lanewise.root, commit: rows[1]!.id, mode: "hard", head: rows[0]!.id },
    { repository: lanewise.root, commit: rows[1]!.id, mode: "soft", head: historyCommit(9).id },
  ]);
});

test("the commit's ID and whole message are copied, where the platform can copy", async () => {
  const user = userEvent.setup();
  const copied: string[] = [];
  renderHistory({ commitDetails: detailsOf(3, () => ({ message: "Read the refs\n\nAll of them." })) }, copied);

  await user.click(within(await menuOn("Read the refs")).getByRole("menuitem", { name: "Copy commit ID" }));
  await waitFor(() => expect(copied).toEqual([rows[1]!.id]));
  await user.click(within(await menuOn("Read the refs")).getByRole("menuitem", { name: "Copy commit message" }));
  await waitFor(() => expect(copied).toEqual([rows[1]!.id, "Read the refs\n\nAll of them."]));
  expect(screen.getByText("Copied the commit message.")).toBeInTheDocument();
});

test("a branch whose Label the commit carries is deleted here, on its Upstream's remote, or both", async () => {
  const user = userEvent.setup();
  const refs: BranchesAndRemotes = {
    local: [
      { name: "main", commit: rows[0]!.id, current: true, upstream: null },
      {
        name: "feature",
        commit: rows[1]!.id,
        current: false,
        upstream: { name: "origin/feature", remote: "origin", ahead: 0, behind: 0, gone: false },
      },
    ],
    remotes: [
      {
        name: "origin",
        url: "https://example.com/lanewise.git",
        pushUrl: null,
        configured: true,
        branches: [{ name: "origin/feature", branch: "feature", commit: rows[1]!.id }],
      },
    ],
    tags: [],
    detached: null,
  };
  const { fake, container } = renderHistory(
    {
      deleteRemoteBranch: () => ({ ok: true, value: { kind: "deleted" } }),
      deleteBranch: () => ({ ok: true, value: null }),
    },
    undefined,
    refs,
  );

  const menu = await menuOn("Read the refs");
  const labels = within(menu).getAllByRole("menuitem").map((item) => item.textContent);
  expect(labels).toContain("Delete “feature”");
  expect(labels).toContain("Delete “origin/feature” on origin…");
  await user.click(within(menu).getByRole("menuitem", { name: "Delete “feature” and “origin/feature”…" }));
  const dialog = screen.getByRole("dialog", { name: "Delete “feature” and “origin/feature”?" });
  await expectNoAxeViolations(container);
  await user.click(within(dialog).getByRole("button", { name: "Delete on origin and locally" }));

  await waitFor(() => expect(requests(fake, "deleteBranch")).toHaveLength(1));
  expect(requests(fake, "deleteRemoteBranch")).toEqual([{ repository: lanewise.root, remote: "origin", branch: "feature" }]);
  expect(requests(fake, "deleteBranch")).toEqual([{ repository: lanewise.root, name: "feature", confirmedTip: null }]);
});

test("a tag it carries is renamed, the dialog saying a name Git refuses", async () => {
  const user = userEvent.setup();
  let refused = true;
  const { fake, container } = renderHistory({
    renameTag: ({ to }) => {
      if (refused) {
        refused = false;
        return { ok: false, error: { kind: "tagExists", name: to } };
      }
      return { ok: true, value: null };
    },
  });

  await user.click(within(await menuOn("Commit 0")).getByRole("menuitem", { name: "Rename tag “v1”…" }));
  const dialog = screen.getByRole("dialog", { name: "Rename tag “v1”" });
  const name = within(dialog).getByRole("textbox", { name: "New name" });
  expect(name).toHaveFocus();
  expect(name).toHaveValue("v1");
  await expectNoAxeViolations(container);
  await user.clear(name);
  await user.keyboard("v0{Enter}");
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "The tag wasn't renamed: there's already a tag called “v0”.",
  );
  await user.clear(name);
  await user.keyboard("v1.0{Enter}");

  expect(await screen.findByText("Renamed tag “v1” to “v1.0”.")).toBeInTheDocument();
  expect(requests(fake, "renameTag").at(-1)).toEqual({ repository: lanewise.root, from: "v1", to: "v1.0" });
});

test("a commit's message is edited, its subject and body filled in with its own", async () => {
  const user = userEvent.setup();
  const reworded: [string, string][] = [];
  const fake = fakePlatform({
    commands: {
      graphWindow: graphWindows(rows),
      commitDetails: detailsOf(3, () => ({ message: "Read the refs\n\nFrom gix." })),
      rewordCommit: () => ({ ok: true, value: { commit: "abcdef0123", branches: ["feature", "main"], detached: false } }),
    },
  });
  const { container } = render(
    <CommitHistory
      commands={fake.platform.commands}
      repository={lanewise}
      selected={null}
      onSelect={() => {}}
      refreshes={0}
      onChanged={() => {}}
      onReworded={(from, to) => reworded.push([from, to])}
    />,
  );

  await user.click(within(await menuOn("Read the refs")).getByRole("menuitem", { name: "Edit commit message…" }));
  const dialog = await screen.findByRole("dialog", { name: `Edit the message of commit ${rows[1]!.shortId}` });
  const subject = within(dialog).getByRole("textbox", { name: "Subject" });
  const body = within(dialog).getByRole("textbox", { name: "Body (optional)" });
  expect(subject).toHaveValue("Read the refs");
  expect(body).toHaveValue("From gix.");
  expect(subject).toHaveFocus();
  expect(dialog).toHaveTextContent("every commit after it on each local branch that has it");
  await expectNoAxeViolations(container);
  await user.clear(subject);
  await user.type(subject, "Read every ref");
  await user.type(body, "\nAnd the tags.");
  await user.click(within(dialog).getByRole("button", { name: "Change message" }));

  expect(
    await screen.findByText(`Changed the message of ${rows[1]!.shortId}: it's commit abcdef0 now, on “feature”, “main”.`),
  ).toBeInTheDocument();
  expect(requests(fake, "rewordCommit")).toEqual([
    { repository: lanewise.root, commit: rows[1]!.id, message: "Read every ref\n\nFrom gix.\nAnd the tags." },
  ]);
  expect(reworded).toEqual([[rows[1]!.id, "abcdef0123"]]);
});

test("a message Git can't give the commit is said in the dialog", async () => {
  const user = userEvent.setup();
  renderHistory({
    commitDetails: detailsOf(3),
    rewordCommit: () => ({ ok: false, error: { kind: "notOnLocalBranch" } }),
  });

  await user.click(within(await menuOn("Read the refs")).getByRole("menuitem", { name: "Edit commit message…" }));
  const dialog = await screen.findByRole("dialog", { name: /^Edit the message/ });
  await user.click(within(dialog).getByRole("button", { name: "Change message" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "The message wasn't changed: no local branch has this commit. Check out a branch that has it first.",
  );
});
