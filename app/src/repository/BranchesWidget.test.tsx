// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, test } from "vitest";

import type {
  AddRemoteRequest,
  BranchesAndRemotes,
  CheckOutRequest,
  CommandClient,
  CreateBranchRequest,
  DeleteBranchRequest,
  DeleteRemoteBranchRequest,
  MergePreview,
  MergeRequest,
  Outcome,
  RemoveRemoteRequest,
  RenameBranchRequest,
  RenameRemoteRequest,
  SetRemoteUrlRequest,
  SetUpstreamRequest,
} from "../commands/api";
import { expectNoAxeViolations } from "../test/axe";
import { fakePlatform, type FakeCommands, historyCommit } from "../test/fakePlatform";
import { Copying } from "../ui/Copyable";
import { BranchesWidget } from "./BranchesWidget";
import { forgetUndoHistories, historyOf } from "./undo";

afterEach(() => {
  cleanup();
  forgetUndoHistories();
  // Which sections are open is kept in local storage: each test starts as a first launch does.
  localStorage.clear();
});

const lanewise = { root: "/work/lanewise", name: "lanewise" };
const head = historyCommit(0).id;

/** The Widget as the Repository page draws it: read again after each change it makes. */
function Page({ commands, selectedCommit = null }: { commands: CommandClient; selectedCommit?: string | null }) {
  const [changed, setChanged] = useState(0);
  return (
    <BranchesWidget
      commands={commands}
      repository={lanewise}
      refreshes={changed}
      selectedCommit={selectedCommit}
      onChanged={() => setChanged((count) => count + 1)}
    />
  );
}

/**
 * A repository's branches, which `createBranch`, `renameBranch`,
 * `deleteBranch` and `checkOut` change as Git would. `unmerged` names the
 * branches with commits no other ref has; `inTheWay` the files a checkout of
 * a branch other than `main` would overwrite.
 */
function branchRepository({
  unmerged = [],
  inTheWay = [],
  tracking = false,
}: { unmerged?: string[]; inTheWay?: string[]; tracking?: boolean } = {}) {
  const list: BranchesAndRemotes = {
    local: [
      { name: "main", commit: head, current: true, upstream: null },
      {
        name: "feature/x",
        commit: historyCommit(1).id,
        current: false,
        // With `tracking`, its Upstream is on `origin`.
        upstream: tracking ? { name: "origin/dev", remote: "origin", ahead: 1, behind: 0, gone: false } : null,
      },
      { name: "done", commit: head, current: false, upstream: null },
    ],
    remotes: [
      {
        name: "origin",
        url: "https://example.com/lanewise.git",
        pushUrl: null,
        configured: true,
        branches: [{ name: "origin/dev", branch: "dev", commit: historyCommit(2).id }],
      },
      {
        name: "team/upstream",
        url: "https://example.com/team.git",
        pushUrl: "ssh://git@example.com/team.git",
        configured: true,
        branches: [{ name: "team/upstream/main", branch: "main", commit: head }],
      },
    ],
    tags: [{ name: "v0.1.0", commit: head }],
    detached: null,
  };
  const lost = Array.from({ length: 10 }, (_, n) => historyCommit(n + 1, { summary: `Lost ${n + 1}` }));
  const tip = lost[0]?.id ?? "";
  const calls: unknown[] = [];
  const commands: FakeCommands = {
    branches: () => ({ ok: true, value: structuredClone(list) }),
    createBranch: (request: CreateBranchRequest) => {
      calls.push(request);
      if (request.name.includes(" ")) return { ok: false, error: { kind: "invalidName", name: request.name } };
      list.local.push({ name: request.name, commit: request.start ?? head, current: false, upstream: null });
      return { ok: true, value: null };
    },
    renameBranch: (request: RenameBranchRequest) => {
      calls.push(request);
      const branch = list.local.find(({ name }) => name === request.from);
      if (branch) branch.name = request.to;
      return { ok: true, value: null };
    },
    deleteBranch: (request: DeleteBranchRequest) => {
      calls.push(request);
      if (!list.local.some(({ name }) => name === request.name)) {
        return { ok: false, error: { kind: "branchNotFound", name: request.name } };
      }
      if (unmerged.includes(request.name) && request.confirmedTip !== tip) {
        return { ok: false, error: { kind: "unmerged", name: request.name, tip, count: 12, commits: lost } };
      }
      list.local = list.local.filter(({ name }) => name !== request.name);
      return { ok: true, value: null };
    },
    checkOut: (request: CheckOutRequest) => {
      calls.push(request);
      const { branch: target } = request;
      const name =
        target.kind === "remote" ? (target.name.split("/").at(-1) ?? "") : target.kind === "local" ? target.name : null;
      if (inTheWay.length > 0 && !request.stashFirst) {
        return { ok: false, error: { kind: "wouldOverwrite", paths: inTheWay } };
      }
      if (request.branch.kind === "remote") list.local.push({ name: name ?? "", commit: historyCommit(2).id, current: false, upstream: null });
      for (const branch of list.local) branch.current = branch.name === name;
      const stash = request.stashFirst ? `Lanewise: uncommitted changes before checking out ${name}` : null;
      return { ok: true, value: { branch: name, stash } };
    },
    // Git's own checks, as far as the tests need them.
    addRemote: (request: AddRemoteRequest) => {
      calls.push(request);
      if (request.name.includes(" ")) return { ok: false, error: { kind: "invalidName", name: request.name } };
      if (list.remotes.some(({ name }) => name === request.name)) {
        return { ok: false, error: { kind: "alreadyExists", name: request.name } };
      }
      if (request.url.trim() === "") return { ok: false, error: { kind: "emptyUrl" } };
      list.remotes.push({ name: request.name, url: request.url, pushUrl: null, configured: true, branches: [] });
      list.remotes.sort((a, b) => a.name.localeCompare(b.name));
      return { ok: true, value: null };
    },
    renameRemote: (request: RenameRemoteRequest) => {
      calls.push(request);
      const remote = list.remotes.find(({ name }) => name === request.from);
      if (!remote) return { ok: false, error: { kind: "remoteNotFound", name: request.from } };
      if (list.remotes.some(({ name }) => name === request.to)) {
        return { ok: false, error: { kind: "alreadyExists", name: request.to } };
      }
      remote.name = request.to;
      for (const branch of remote.branches) branch.name = `${request.to}/${branch.branch}`;
      for (const { upstream } of list.local) {
        if (upstream?.remote === request.from) {
          upstream.remote = request.to;
          upstream.name = `${request.to}/${upstream.name.slice(request.from.length + 1)}`;
        }
      }
      return { ok: true, value: null };
    },
    setRemoteUrl: (request: SetRemoteUrlRequest) => {
      calls.push(request);
      if (request.url.trim() === "") return { ok: false, error: { kind: "emptyUrl" } };
      const remote = list.remotes.find(({ name }) => name === request.name);
      if (remote) remote.url = request.url;
      return { ok: true, value: null };
    },
    removeRemote: (request: RemoveRemoteRequest) => {
      calls.push(request);
      list.remotes = list.remotes.filter(({ name }) => name !== request.name);
      for (const branch of list.local) {
        if (branch.upstream?.remote === request.name) branch.upstream = null;
      }
      return { ok: true, value: null };
    },
    deleteRemoteBranch: (request: DeleteRemoteBranchRequest) => {
      calls.push(request);
      const remote = list.remotes.find(({ name }) => name === request.remote);
      if (request.branch === "protected") {
        return {
          ok: false,
          error: { kind: "gitFailed", command: "git push", code: 1, message: "remote: GH006: Protected branch update failed" },
        };
      }
      if (remote) remote.branches = remote.branches.filter(({ branch }) => branch !== request.branch);
      for (const branch of list.local) {
        if (branch.upstream?.name === `${request.remote}/${request.branch}`) branch.upstream.gone = true;
      }
      return { ok: true, value: { kind: "deleted" } };
    },
    setUpstream: (request: SetUpstreamRequest) => {
      calls.push(request);
      const remote = list.remotes.find(({ branches }) => branches.some(({ name }) => name === request.upstream));
      const branch = list.local.find(({ name }) => name === request.branch);
      if (!remote) return { ok: false, error: { kind: "upstreamNotFound", name: request.upstream } };
      if (branch) branch.upstream = { name: request.upstream, remote: remote.name, ahead: 0, behind: 0, gone: false };
      return { ok: true, value: null };
    },
  };
  return { commands, calls, tip, list };
}

function renderBranches(commands: FakeCommands, selectedCommit: string | null = null) {
  const fake = fakePlatform({ commands });
  const view = render(<Page commands={fake.platform.commands} selectedCommit={selectedCommit} />);
  return { fake, ...view };
}

const widget = () => screen.getByRole("region", { name: "Branches & remotes" });
const announced = () => within(widget()).getAllByRole("status")[0];
/** Opens the Tags group, whose rows are drawn only once it is opened. */
const openTags = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: /^Tags/ }));
const namesIn = (group: string) =>
  within(screen.getByRole("region", { name: group }))
    .getAllByRole("listitem")
    .map((item) => item.querySelector(".branch-name")?.textContent);

/** Opens the menu of the branch named `name`, from the keyboard, and chooses `item`. */
async function choose(user: ReturnType<typeof userEvent.setup>, name: string, item: string) {
  screen.getByRole("button", { name: `Actions for ${name}` }).focus();
  await user.keyboard("{Enter}");
  const menu = screen.getByRole("menu", { name: `Actions for ${name}` });
  const wanted = within(menu).getByRole("menuitem", { name: item });
  while (document.activeElement !== wanted) await user.keyboard("{ArrowDown}");
  await user.keyboard("{Enter}");
}

test("the Widget lists the local branches, with the current one marked, the remote-tracking branches by remote, and the tags", async () => {
  const user = userEvent.setup();
  const { container } = renderBranches(branchRepository().commands);

  expect(await screen.findByRole("heading", { level: 3, name: "Branches & remotes" })).toBeVisible();
  expect(await screen.findByRole("region", { name: "Local branches" })).toBeVisible();
  expect(namesIn("Local branches")).toEqual(["main", "feature/x", "done"]);
  const current = screen.getByRole("listitem", { current: true });
  expect(current).toHaveTextContent("mainCurrent");
  expect(namesIn("origin")).toEqual(["dev"]);
  expect(namesIn("team/upstream")).toEqual(["main"]);
  await openTags(user);
  expect(namesIn("Tags")).toEqual(["v0.1.0"]);

  // The current branch can't be checked out again, merged into itself, reset to or deleted.
  await user.click(screen.getByRole("button", { name: "Actions for main" }));
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "Set Upstream…",
    "Rename…",
    "New branch from “main”…",
    "New tag at “main”…",
  ]);
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Actions for feature/x" }));
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "Check out",
    "Merge into “main”…",
    "Set Upstream…",
    "Rename…",
    "New branch from “feature/x”…",
    "New tag at “feature/x”…",
    "Reset “main” to “feature/x”",
    "Delete “feature/x”",
  ]);
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Actions for origin/dev" }));
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "Check out as “dev”",
    "Merge into “main”…",
    "New branch from “origin/dev”…",
    "New tag at “origin/dev”…",
    "Reset “main” to “origin/dev”",
    "Delete on origin…",
  ]);
  await user.keyboard("{Escape}");
  // A tag's commit is HEAD's here, so it isn't offered to check out.
  await user.click(screen.getByRole("button", { name: "Actions for tag v0.1.0" }));
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "New branch from “v0.1.0”…",
    "Rename…",
    "Delete tag “v0.1.0”…",
  ]);
  await expectNoAxeViolations(container);
});

test("Local branches opens and closes by its heading, from the keyboard too, as the left column's other sections do", async () => {
  const user = userEvent.setup();
  const { container } = renderBranches(branchRepository().commands);

  const heading = await screen.findByRole("button", { name: "Local branches (3)" });
  expect(heading).toHaveAttribute("aria-expanded", "true");
  expect(namesIn("Local branches")).toEqual(["main", "feature/x", "done"]);

  heading.focus();
  await user.keyboard("{Enter}");
  expect(heading).toHaveAttribute("aria-expanded", "false");
  // The region keeps its name, with its branches no longer drawn.
  expect(screen.getByRole("region", { name: "Local branches" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Actions for main" })).toBeNull();
  await expectNoAxeViolations(container);

  await user.keyboard(" ");
  expect(namesIn("Local branches")).toEqual(["main", "feature/x", "done"]);
});

test("a new branch is made from the keyboard, at HEAD or the commit selected in the Commit graph, and announced", async () => {
  const user = userEvent.setup();
  const selected = historyCommit(3);
  const repository = branchRepository();
  const { container } = renderBranches(repository.commands, selected.id);
  const button = await screen.findByRole("button", { name: "New branch…" });

  button.focus();
  await user.keyboard("{Enter}");
  const dialog = screen.getByRole("dialog", { name: "New branch" });
  expect(within(dialog).getByRole("textbox", { name: "Branch name" })).toHaveFocus();
  expect(within(dialog).getByRole("radio", { name: /^The commit selected in the Commit graph, / })).toBeChecked();
  await expectNoAxeViolations(container);

  // A name Git doesn't allow is said in the dialog, which stays open to fix it.
  await user.keyboard("my topic{Enter}");
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "The branch wasn't created: Git doesn't allow “my topic” as a branch name.",
  );
  expect(within(dialog).getByRole("textbox", { name: "Branch name" })).toHaveAccessibleDescription(
    /Git doesn't allow/,
  );

  await user.clear(within(dialog).getByRole("textbox", { name: "Branch name" }));
  await user.keyboard("topic");
  await user.click(within(dialog).getByRole("radio", { name: "HEAD, where you are now" }));
  await user.click(within(dialog).getByRole("button", { name: "Create branch" }));

  expect(await within(widget()).findByText("Created branch “topic” at HEAD.")).toBeVisible();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(button).toHaveFocus();
  expect(namesIn("Local branches")).toContain("topic");

  // At the selected commit, as the dialog chooses first.
  button.focus();
  await user.keyboard("{Enter}");
  await user.keyboard("at-three{Enter}");
  expect(await within(widget()).findByText(`Created branch “at-three” at ${selected.id.slice(0, 7)}.`)).toBeVisible();
  expect(repository.calls.slice(1)).toEqual([
    { repository: lanewise.root, name: "topic", start: null },
    { repository: lanewise.root, name: "at-three", start: selected.id },
  ]);
});

test("with no commit selected, a new branch starts at HEAD, as the dialog says", async () => {
  const user = userEvent.setup();
  renderBranches(branchRepository().commands);

  await user.click(await screen.findByRole("button", { name: "New branch…" }));

  const dialog = screen.getByRole("dialog", { name: "New branch" });
  expect(within(dialog).queryByRole("radio")).toBeNull();
  expect(dialog).toHaveTextContent("It starts at HEAD, where you are now, and isn't checked out.");
});

test("a branch renamed from its menu keeps focus on it, under its new name", async () => {
  const user = userEvent.setup();
  const repository = branchRepository();
  renderBranches(repository.commands);
  await screen.findByRole("button", { name: "Actions for feature/x" });

  await choose(user, "feature/x", "Rename…");
  const field = within(screen.getByRole("dialog", { name: "Rename “feature/x”" })).getByRole("textbox", {
    name: "New name",
  });
  expect(field).toHaveFocus();
  expect(field).toHaveValue("feature/x");
  await user.clear(field);
  await user.keyboard("feature/y{Enter}");

  expect(await within(widget()).findByText("Renamed branch “feature/x” to “feature/y”.")).toBeVisible();
  expect(await screen.findByRole("button", { name: "Actions for feature/y" })).toHaveFocus();
  expect(repository.calls).toEqual([{ repository: lanewise.root, from: "feature/x", to: "feature/y" }]);
});

test("a branch whose commits no other ref has is only deleted once the user confirms, knowing what's lost", async () => {
  const user = userEvent.setup();
  const repository = branchRepository({ unmerged: ["feature/x"] });
  const { container } = renderBranches(repository.commands);
  await screen.findByRole("button", { name: "Actions for feature/x" });

  await choose(user, "feature/x", "Delete “feature/x”");
  const dialog = await screen.findByRole("dialog", { name: "Delete “feature/x”?" });
  expect(dialog).toHaveTextContent(
    "“feature/x” has 12 commits that no other branch, remote-tracking branch or tag has. Deleting it loses them:",
  );
  const lost = within(dialog).getAllByRole("listitem");
  expect(lost).toHaveLength(10);
  expect(lost[0]).toHaveTextContent(`${historyCommit(1).shortId} Lost 1 by Ada Lovelace`);
  expect(dialog).toHaveTextContent("and 2 commits older.");
  await expectNoAxeViolations(container);

  // Kept, nothing changes, and focus goes back to the branch's menu.
  await user.click(within(dialog).getByRole("button", { name: "Keep the branch" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Actions for feature/x" })).toHaveFocus();
  expect(namesIn("Local branches")).toContain("feature/x");

  await choose(user, "feature/x", "Delete “feature/x”");
  await user.click(
    within(await screen.findByRole("dialog", { name: "Delete “feature/x”?" })).getByRole("button", {
      name: "Delete and lose 12 commits",
    }),
  );
  expect(await within(widget()).findByText("Deleted branch “feature/x”. 12 commits went with it.")).toBeVisible();
  expect(namesIn("Local branches")).not.toContain("feature/x");
  expect(screen.getByRole("button", { name: "New branch…" })).toHaveFocus();
  expect(repository.calls).toEqual([
    { repository: lanewise.root, name: "feature/x", confirmedTip: null },
    { repository: lanewise.root, name: "feature/x", confirmedTip: null },
    { repository: lanewise.root, name: "feature/x", confirmedTip: repository.tip },
  ]);
});

test("a branch whose commits another ref has is deleted at once, and announced", async () => {
  const user = userEvent.setup();
  renderBranches(branchRepository().commands);
  await screen.findByRole("button", { name: "Actions for done" });

  await choose(user, "done", "Delete “done”");

  expect(await within(widget()).findByText("Deleted branch “done”.")).toBeVisible();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(namesIn("Local branches")).toEqual(["main", "feature/x"]);
});

test("checking out over uncommitted changes it would overwrite says which, and offers to stash them first", async () => {
  const user = userEvent.setup();
  const repository = branchRepository({ inTheWay: ["src/lib.rs", "README.md"] });
  const { container } = renderBranches(repository.commands);
  await screen.findByRole("button", { name: "Actions for feature/x" });

  await choose(user, "feature/x", "Check out");
  const dialog = await screen.findByRole("dialog", { name: "Check out “feature/x”?" });
  expect(dialog).toHaveTextContent(
    "Checking out “feature/x” would overwrite your uncommitted changes to these 2 files, so Git didn't. Nothing has changed.",
  );
  expect(within(dialog).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "src/lib.rs",
    "README.md",
  ]);
  await expectNoAxeViolations(container);

  await user.click(within(dialog).getByRole("button", { name: "Stash changes and check out" }));

  expect(
    await within(widget()).findByText(
      "Checked out “feature/x”. Your uncommitted changes are in the stash “Lanewise: uncommitted changes before checking out feature/x”.",
    ),
  ).toBeVisible();
  expect(screen.getByRole("listitem", { current: true })).toHaveTextContent("feature/xCurrent");
  expect(repository.calls).toEqual([
    { repository: lanewise.root, branch: { kind: "local", name: "feature/x" }, stashFirst: false },
    { repository: lanewise.root, branch: { kind: "local", name: "feature/x" }, stashFirst: true },
  ]);
});

test("a remote-tracking branch is checked out as a local branch tracking it", async () => {
  const user = userEvent.setup();
  const repository = branchRepository();
  renderBranches(repository.commands);
  await screen.findByRole("button", { name: "Actions for origin/dev" });

  await choose(user, "origin/dev", "Check out as “dev”");

  expect(
    await within(widget()).findByText("Checked out “dev”, a new branch tracking “origin/dev”."),
  ).toBeVisible();
  expect(screen.getByRole("listitem", { current: true })).toHaveTextContent("devCurrent");
  expect(repository.calls).toEqual([
    { repository: lanewise.root, branch: { kind: "remote", name: "origin/dev" }, stashFirst: false },
  ]);
});

test("an action that fails outside a dialog says why", async () => {
  const user = userEvent.setup();
  const { commands } = branchRepository();
  // Deleted outside Lanewise, after the list was read.
  commands.deleteBranch = (request) => ({ ok: false, error: { kind: "branchNotFound", name: request.name } });
  const { container } = renderBranches(commands);
  await screen.findByRole("button", { name: "Actions for done" });

  await choose(user, "done", "Delete “done”");

  expect(await within(widget()).findByRole("alert")).toHaveTextContent(
    "The branch wasn't deleted: there's no branch called “done” any more.",
  );
  expect(announced()).toBeEmptyDOMElement();
  await expectNoAxeViolations(container);
});

test("the tags are drawn only once their group is opened, from the keyboard too, so thousands of them don't hold up opening a Tab", async () => {
  const user = userEvent.setup();
  const tags = Array.from({ length: 1012 }, (_, n) => ({ name: `v${n}`, commit: head }));
  const { container } = renderBranches({
    branches: () => ({
      ok: true,
      value: { local: [{ name: "main", commit: head, current: true, upstream: null }], remotes: [], tags, detached: null },
    }),
  });

  const toggle = await screen.findByRole("button", { name: "Tags (1,012)" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(container.querySelectorAll("[data-tag]")).toHaveLength(0);
  expect(screen.getByRole("region", { name: "Tags" })).toBeVisible();
  await expectNoAxeViolations(container);

  toggle.focus();
  await user.keyboard("{Enter}");
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  const list = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
  expect(list).not.toBeNull();
  expect(list!.querySelectorAll(":scope > li")).toHaveLength(1012);

  await user.keyboard(" ");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(container.querySelectorAll("[data-tag]")).toHaveLength(0);
});

test("a detached HEAD is said, and a list the repository can't give says why", async () => {
  renderBranches({
    branches: () => ({
      ok: true,
      value: { local: [{ name: "main", commit: head, current: false, upstream: null }], remotes: [], tags: [], detached: head },
    }),
  });

  expect(await screen.findByText(`HEAD is detached at commit ${head.slice(0, 7)}, on no branch.`)).toBeVisible();
  expect(screen.queryByRole("listitem", { current: true })).toBeNull();
  expect(screen.getByText("No remotes.")).toBeVisible();
  // Tags is closed when a Tab opens, with or without tags.
  await userEvent.click(screen.getByRole("button", { name: "Tags" }));
  expect(screen.getByText("No tags.")).toBeVisible();
  cleanup();

  renderBranches({ branches: () => ({ ok: false, error: { kind: "notARepository", path: lanewise.root } }) });
  expect(await screen.findByRole("alert")).toBeVisible();
});

/** The preview of merging a branch `commits` ahead of `main`, which `kind` says how it goes. */
function mergePreview(kind: Partial<MergePreview> = {}, commits = 2): MergePreview {
  return { into: "main", head, tip: historyCommit(1).id, commits, kind: "fastForward", ...kind } as MergePreview;
}

test("a branch is merged from its menu, from the keyboard, once its preview is confirmed", async () => {
  const user = userEvent.setup();
  const { commands } = branchRepository();
  const merges: MergeRequest[] = [];
  commands.previewMerge = () => ({ ok: true, value: mergePreview() });
  commands.merge = (request) => {
    merges.push(request);
    return { ok: true, value: { kind: "fastForward", commits: 2 } };
  };
  const { container, fake } = renderBranches(commands);
  await screen.findByRole("button", { name: "Actions for feature/x" });

  await choose(user, "feature/x", "Merge into “main”…");
  const dialog = await screen.findByRole("dialog", { name: "Merge “feature/x” into “main”?" });
  expect(dialog).toHaveTextContent(
    "A fast-forward. “main” moves forward to “feature/x”, bringing in 2 commits. No merge commit is made.",
  );
  await expectNoAxeViolations(container);
  const fastForward = within(dialog).getByRole("button", { name: "Fast-forward “main”" });
  fastForward.focus();
  await user.keyboard("{Enter}");

  expect(
    await within(widget()).findByText("Fast-forwarded “main” to “feature/x”, bringing in 2 commits."),
  ).toBeVisible();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(fake.calls.filter(({ name }) => name === "previewMerge").map(({ request }) => request)).toEqual([
    { repository: lanewise.root, branch: { kind: "local", name: "feature/x" } },
  ]);
  expect(merges).toEqual([
    { repository: lanewise.root, branch: { kind: "local", name: "feature/x" }, head, tip: historyCommit(1).id },
  ]);
});

test("the merge preview says when the Git config asks for a merge commit, and shows the new preview if a branch moved", async () => {
  const user = userEvent.setup();
  const { commands } = branchRepository();
  const moved = mergePreview({ tip: historyCommit(3).id, kind: "mergeCommit", insteadOfFastForward: false }, 3);
  const merges: MergeRequest[] = [];
  commands.previewMerge = () => ({ ok: true, value: mergePreview({ kind: "mergeCommit", insteadOfFastForward: true }) });
  commands.merge = (request) => {
    merges.push(request);
    if (request.tip !== moved.tip) return { ok: false, error: { kind: "moved", preview: moved } };
    return { ok: true, value: { kind: "mergeCommit", commit: historyCommit(4).id, commits: 3 } };
  };
  const { container } = renderBranches(commands);
  await screen.findByRole("button", { name: "Actions for origin/dev" });

  await choose(user, "origin/dev", "Merge into “main”…");
  const dialog = await screen.findByRole("dialog", { name: "Merge “origin/dev” into “main”?" });
  expect(dialog).toHaveTextContent(
    "A merge commit. A new commit on “main” joins it with “origin/dev”, bringing in 2 commits. A fast-forward would do, but your Git config asks for a merge commit.",
  );
  await user.click(within(dialog).getByRole("button", { name: "Merge" }));

  expect(
    await within(dialog).findByText(
      "A branch moved since the merge was shown, so nothing was merged. This is what merging does now.",
    ),
  ).toBeVisible();
  expect(dialog).toHaveTextContent("joins it with “origin/dev”, bringing in 3 commits.");
  expect(dialog).not.toHaveTextContent("A fast-forward would do");
  await expectNoAxeViolations(container);
  await user.click(within(dialog).getByRole("button", { name: "Merge" }));

  expect(
    await within(widget()).findByText(
      `Merged “origin/dev” into “main” in merge commit ${historyCommit(4).id.slice(0, 7)}, bringing in 3 commits.`,
    ),
  ).toBeVisible();
  expect(merges.map(({ branch, tip }) => ({ branch, tip }))).toEqual([
    { branch: { kind: "remote", name: "origin/dev" }, tip: historyCommit(1).id },
    { branch: { kind: "remote", name: "origin/dev" }, tip: moved.tip },
  ]);
});

test("a merge with nothing to merge, or that the Git config refuses, is only explained", async () => {
  const user = userEvent.setup();
  const { commands } = branchRepository();
  let preview = mergePreview({ kind: "upToDate" }, 0);
  commands.previewMerge = () => ({ ok: true, value: preview });
  const { container } = renderBranches(commands);
  await screen.findByRole("button", { name: "Actions for done" });

  await choose(user, "done", "Merge into “main”…");
  let dialog = await screen.findByRole("dialog", { name: "Merge “done” into “main”?" });
  expect(dialog).toHaveTextContent("“main” has every commit “done” has already. There's nothing to merge.");
  expect(within(dialog).queryByRole("button", { name: /^(Merge|Fast-forward)/ })).toBeNull();
  await user.click(within(dialog).getByRole("button", { name: "Close" }));

  preview = mergePreview({ kind: "fastForwardOnly" });
  await choose(user, "feature/x", "Merge into “main”…");
  dialog = await screen.findByRole("dialog", { name: "Merge “feature/x” into “main”?" });
  expect(dialog).toHaveTextContent(
    "Your Git config allows only fast-forward merges, but “main” has commits “feature/x” doesn't, so merging it needs a merge commit. Nothing can be merged.",
  );
  expect(within(dialog).queryByRole("button", { name: /^(Merge|Fast-forward)/ })).toBeNull();
  await expectNoAxeViolations(container);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Actions for feature/x" })).toHaveFocus();
});

test("a merge that stops with conflicts says so, and one refused says why, in the dialog or out of it", async () => {
  const user = userEvent.setup();
  const { commands } = branchRepository();
  let changes = 0;
  let previewed: Outcome<"previewMerge"> = {
    ok: true,
    value: mergePreview({ kind: "mergeCommit", insteadOfFastForward: false }),
  };
  let merged: Outcome<"merge"> = { ok: false, error: { kind: "wouldOverwrite", paths: ["src/lib.rs"] } };
  commands.previewMerge = () => previewed;
  commands.merge = () => merged;
  const fake = fakePlatform({ commands });
  const { container } = render(
    <BranchesWidget
      commands={fake.platform.commands}
      repository={lanewise}
      refreshes={0}
      selectedCommit={null}
      onChanged={() => changes++}
    />,
  );
  await screen.findByRole("button", { name: "Actions for feature/x" });

  await choose(user, "feature/x", "Merge into “main”…");
  const dialog = await screen.findByRole("dialog", { name: "Merge “feature/x” into “main”?" });
  await user.click(within(dialog).getByRole("button", { name: "Merge" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Nothing was merged: merging would overwrite your uncommitted changes to src/lib.rs. Commit or stash them first.",
  );
  await expectNoAxeViolations(container);
  expect(changes).toBe(0);

  merged = { ok: true, value: { kind: "stopped", conflicts: ["a.txt", "b.txt"], messages: "" } };
  await user.click(within(dialog).getByRole("button", { name: "Merge" }));
  expect(
    await within(widget()).findByText(
      "Merging “feature/x” into “main” stopped with conflicts in 2 files. The merge is in progress.",
    ),
  ).toBeVisible();
  expect(changes).toBe(1);

  previewed = { ok: false, error: { kind: "mergeInProgress" } };
  await choose(user, "done", "Merge into “main”…");
  expect(await within(widget()).findByRole("alert")).toHaveTextContent(
    "Nothing can be merged: a merge is in progress already. Finish it or abort it first.",
  );
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("each local branch with an Upstream shows how far it's ahead and behind, with a text alternative", async () => {
  const { container } = renderBranches({
    branches: () => ({
      ok: true,
      value: {
        local: [
          {
            name: "main",
            commit: head,
            current: true,
            upstream: { name: "origin/main", remote: "origin", ahead: 2, behind: 1, gone: false },
          },
          {
            name: "old",
            commit: head,
            current: false,
            upstream: { name: "origin/old", remote: "origin", ahead: 0, behind: 0, gone: true },
          },
          { name: "mine", commit: head, current: false, upstream: null },
        ],
        remotes: [],
        tags: [],
        detached: null,
      },
    }),
  });

  const row = (name: string) => within(widget()).getAllByRole("listitem").find((item) => item.dataset.branch === name);
  expect(await within(widget()).findByText("2 commits ahead of origin/main and 1 behind")).toBeInTheDocument();
  expect(row("main")).toHaveTextContent("mainCurrent21");
  expect(row("old")).toHaveTextContent("Its Upstream, origin/old, is gone from the remote");
  expect(row("mine")?.querySelector(".upstream")).toBeNull();
  // The arrows and counts are drawn for the eye; the words are what's read.
  for (const shown of container.querySelectorAll(".upstream-shown")) expect(shown).toHaveAttribute("aria-hidden", "true");
  await expectNoAxeViolations(container);
});


test("each remote shows its URLs, and one only its remote-tracking branches are left of says so, with no actions", async () => {
  const { commands } = branchRepository();
  const { container } = renderBranches({
    ...commands,
    branches: () => ({
      ok: true,
      value: {
        local: [{ name: "main", commit: head, current: true, upstream: null }],
        remotes: [
          { name: "fork", url: "https://example.com/fork.git", pushUrl: null, configured: true, branches: [] },
          {
            name: "old",
            url: null,
            pushUrl: null,
            configured: false,
            branches: [{ name: "old/main", branch: "main", commit: head }],
          },
          {
            name: "team",
            url: "https://example.com/team.git",
            pushUrl: "ssh://git@example.com/team.git",
            configured: true,
            branches: [],
          },
        ],
        tags: [],
        detached: null,
      },
    }),
  });

  const fork = await screen.findByRole("region", { name: "fork" });
  expect(fork).toHaveTextContent("Fetches from and pushes to https://example.com/fork.git");
  expect(fork).toHaveTextContent("No remote-tracking branches yet. Fetch to see its branches.");
  const team = screen.getByRole("region", { name: "team" });
  expect(team).toHaveTextContent("Fetches from https://example.com/team.git");
  expect(team).toHaveTextContent("Pushes to ssh://git@example.com/team.git");
  const old = screen.getByRole("region", { name: "old" });
  expect(old).toHaveTextContent("Not in the Git config: only its remote-tracking branches are left.");
  expect(within(old).queryByRole("button", { name: "Actions for remote old" })).toBeNull();
  expect(within(fork).getByRole("button", { name: "Actions for remote fork" })).toBeVisible();
  await expectNoAxeViolations(container);
});

test("a remote is added from the keyboard, and a name or URL Git refuses is said in the dialog, by its field", async () => {
  const user = userEvent.setup();
  const repository = branchRepository();
  const { container } = renderBranches(repository.commands);
  const add = await screen.findByRole("button", { name: "Add remote…" });

  add.focus();
  await user.keyboard("{Enter}");
  const dialog = screen.getByRole("dialog", { name: "Add remote" });
  const name = within(dialog).getByRole("textbox", { name: "Name" });
  const url = within(dialog).getByRole("textbox", { name: "URL" });
  expect(name).toHaveFocus();
  await expectNoAxeViolations(container);

  await user.keyboard("my fork");
  await user.tab();
  await user.keyboard("https://example.com/fork.git{Enter}");
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "The remote wasn't added: Git doesn't allow “my fork” as a remote's name.",
  );
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(url).toHaveAttribute("aria-invalid", "false");
  await expectNoAxeViolations(container);

  await user.clear(name);
  await user.type(name, "fork");
  await user.clear(url);
  await user.type(url, "{Enter}");
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "The remote wasn't added: a remote needs a URL, such as https://example.com/project.git.",
  );
  expect(url).toHaveAttribute("aria-invalid", "true");
  expect(name).toHaveAttribute("aria-invalid", "false");

  await user.type(url, "https://example.com/fork.git{Enter}");
  expect(await within(widget()).findByText("Added remote “fork”. Fetch to see its branches.")).toBeVisible();
  expect(screen.queryByRole("dialog")).toBeNull();
  const fork = await screen.findByRole("region", { name: "fork" });
  expect(fork).toHaveTextContent("Fetches from and pushes to https://example.com/fork.git");
  expect(within(fork).getByRole("button", { name: "Actions for remote fork" })).toHaveFocus();
  expect(repository.calls).toEqual([
    { repository: lanewise.root, name: "my fork", url: "https://example.com/fork.git" },
    { repository: lanewise.root, name: "fork", url: "" },
    { repository: lanewise.root, name: "fork", url: "https://example.com/fork.git" },
  ]);
  await expectNoAxeViolations(container);
});

test("a remote is renamed from its menu, with its remote-tracking branches, keeping focus on it", async () => {
  const user = userEvent.setup();
  const repository = branchRepository();
  const { container } = renderBranches(repository.commands);
  await screen.findByRole("button", { name: "Actions for remote team/upstream" });

  await choose(user, "remote team/upstream", "Rename…");
  const dialog = screen.getByRole("dialog", { name: "Rename remote “team/upstream”" });
  const field = within(dialog).getByRole("textbox", { name: "New name" });
  expect(field).toHaveFocus();
  expect(field).toHaveValue("team/upstream");
  expect(dialog).toHaveTextContent("Its remote-tracking branches, and the Upstreams of the branches that track it");
  await expectNoAxeViolations(container);

  // A name another remote has is said in the dialog.
  await user.clear(field);
  await user.keyboard("origin{Enter}");
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "The remote wasn't renamed: there's already a remote called “origin”.",
  );
  expect(field).toHaveAttribute("aria-invalid", "true");
  await expectNoAxeViolations(container);
  await user.clear(field);
  await user.keyboard("team{Enter}");

  expect(await within(widget()).findByText("Renamed remote “team/upstream” to “team”.")).toBeVisible();
  expect(screen.queryByRole("region", { name: "team/upstream" })).toBeNull();
  expect(namesIn("team")).toEqual(["main"]);
  expect(await screen.findByRole("button", { name: "Actions for remote team" })).toHaveFocus();
  expect(screen.getByRole("button", { name: "Actions for team/main" })).toBeVisible();
  expect(repository.calls).toEqual([
    { repository: lanewise.root, from: "team/upstream", to: "origin" },
    { repository: lanewise.root, from: "team/upstream", to: "team" },
  ]);
});

test("a remote's URL is changed from its menu, keeping the push URL it has of its own", async () => {
  const user = userEvent.setup();
  const repository = branchRepository();
  const { container } = renderBranches(repository.commands);
  await screen.findByRole("button", { name: "Actions for remote team/upstream" });

  await choose(user, "remote team/upstream", "Change URL…");
  const dialog = screen.getByRole("dialog", { name: "Change remote “team/upstream”'s URL" });
  const field = within(dialog).getByRole("textbox", { name: "URL" });
  expect(field).toHaveFocus();
  expect(field).toHaveValue("https://example.com/team.git");
  expect(dialog).toHaveTextContent(
    "It pushes to a URL of its own, ssh://git@example.com/team.git, which doesn't change.",
  );

  await user.clear(field);
  await user.keyboard("{Enter}");
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "The remote's URL wasn't changed: a remote needs a URL, such as https://example.com/project.git.",
  );
  await expectNoAxeViolations(container);

  await user.keyboard("https://example.com/moved.git{Enter}");
  expect(
    await within(widget()).findByText("Changed remote “team/upstream”'s URL to https://example.com/moved.git."),
  ).toBeVisible();
  const team = screen.getByRole("region", { name: "team/upstream" });
  expect(team).toHaveTextContent("Fetches from https://example.com/moved.git");
  expect(team).toHaveTextContent("Pushes to ssh://git@example.com/team.git");
  expect(screen.getByRole("button", { name: "Actions for remote team/upstream" })).toHaveFocus();
  expect(repository.calls).toEqual([
    { repository: lanewise.root, name: "team/upstream", url: "" },
    { repository: lanewise.root, name: "team/upstream", url: "https://example.com/moved.git" },
  ]);
});

test("a remote's URL with credentials in it, which Lanewise hides, is changed only to a whole new URL", async () => {
  const user = userEvent.setup();
  const repository = branchRepository();
  const origin = repository.list.remotes.find(({ name }) => name === "origin");
  if (origin) origin.url = "https://***@github.com/adrianeyre/lanewise.git";
  const { container } = renderBranches(repository.commands);
  expect(await screen.findByRole("region", { name: "origin" })).toHaveTextContent(
    "Fetches from and pushes to https://***@github.com/adrianeyre/lanewise.git",
  );

  await choose(user, "remote origin", "Change URL…");
  const dialog = screen.getByRole("dialog", { name: "Change remote “origin”'s URL" });
  const field = within(dialog).getByRole("textbox", { name: "URL" });
  expect(field).toHaveFocus();
  // Not prefilled with the hidden credentials, which would replace the real ones.
  expect(field).toHaveValue("");
  expect(dialog).toHaveTextContent(
    "Its URL, https://***@github.com/adrianeyre/lanewise.git, has credentials in it, which Lanewise doesn't show. Enter the whole of the new URL.",
  );
  await expectNoAxeViolations(container);

  await user.keyboard("https://github.com/adrianeyre/lanewise.git{Enter}");
  expect(await screen.findByRole("region", { name: "origin" })).toHaveTextContent(
    "Fetches from and pushes to https://github.com/adrianeyre/lanewise.git",
  );
  expect(repository.calls).toEqual([
    { repository: lanewise.root, name: "origin", url: "https://github.com/adrianeyre/lanewise.git" },
  ]);
});

test("a remote is only removed once the user confirms, knowing which branches lose their Upstream", async () => {
  const user = userEvent.setup();
  const repository = branchRepository({ tracking: true });
  const { container } = renderBranches(repository.commands);
  await screen.findByRole("button", { name: "Actions for remote origin" });

  await choose(user, "remote origin", "Remove…");
  const dialog = screen.getByRole("dialog", { name: "Remove remote “origin”?" });
  expect(dialog).toHaveTextContent(
    "Its remote-tracking branch goes from this repository. 1 local branch tracks it, and will have no Upstream:",
  );
  expect(within(dialog).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["feature/x"]);
  expect(dialog).toHaveTextContent("Nothing on the remote changes, and no local branch is deleted.");
  await expectNoAxeViolations(container);

  // Kept, nothing changes, and focus goes back to the remote's menu.
  await user.click(within(dialog).getByRole("button", { name: "Keep the remote" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Actions for remote origin" })).toHaveFocus();
  expect(repository.calls).toEqual([]);

  await choose(user, "remote origin", "Remove…");
  await user.click(
    within(screen.getByRole("dialog", { name: "Remove remote “origin”?" })).getByRole("button", {
      name: "Remove remote",
    }),
  );
  expect(await within(widget()).findByText("Removed remote “origin”.")).toBeVisible();
  expect(screen.queryByRole("region", { name: "origin" })).toBeNull();
  expect(namesIn("Local branches")).toEqual(["main", "feature/x", "done"]);
  expect(screen.getByRole("button", { name: "Add remote…" })).toHaveFocus();
  expect(repository.calls).toEqual([{ repository: lanewise.root, name: "origin" }]);
  await expectNoAxeViolations(container);
});

test("a branch's Upstream is set, then changed, from its menu, from the keyboard", async () => {
  const user = userEvent.setup();
  const repository = branchRepository();
  const { container } = renderBranches(repository.commands);
  await screen.findByRole("button", { name: "Actions for feature/x" });

  await choose(user, "feature/x", "Set Upstream…");
  const dialog = screen.getByRole("dialog", { name: "Set “feature/x”'s Upstream" });
  const upstream = within(dialog).getByRole("combobox", { name: "Upstream" });
  expect(upstream).toHaveFocus();
  expect(within(upstream).getAllByRole("option").map((option) => option.textContent)).toEqual([
    "origin/dev",
    "team/upstream/main",
  ]);
  expect(upstream).toHaveValue("origin/dev");
  expect(dialog).toHaveTextContent("“feature/x” pulls from and pushes to it from now on.");
  await expectNoAxeViolations(container);

  await user.tab();
  expect(within(dialog).getByRole("button", { name: "Set Upstream" })).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(await within(widget()).findByText("“feature/x”'s Upstream is origin/dev now.")).toBeVisible();
  expect(screen.queryByRole("dialog")).toBeNull();
  const actions = screen.getByRole("button", { name: "Actions for feature/x" });
  expect(actions).toHaveFocus();
  expect(actions.closest("li")).toHaveTextContent("origin/dev");

  await choose(user, "feature/x", "Change Upstream…");
  const again = screen.getByRole("dialog", { name: "Set “feature/x”'s Upstream" });
  expect(within(again).getByRole("combobox", { name: "Upstream" })).toHaveValue("origin/dev");
  expect(again).toHaveTextContent("It's origin/dev now.");
  await user.selectOptions(within(again).getByRole("combobox", { name: "Upstream" }), "team/upstream/main");
  await user.click(within(again).getByRole("button", { name: "Set Upstream" }));
  expect(await within(widget()).findByText("“feature/x”'s Upstream is team/upstream/main now.")).toBeVisible();
  expect(repository.calls).toEqual([
    { repository: lanewise.root, branch: "feature/x", upstream: "origin/dev" },
    { repository: lanewise.root, branch: "feature/x", upstream: "team/upstream/main" },
  ]);
});

test("with no remote-tracking branch to choose, setting an Upstream says how to get one", async () => {
  const user = userEvent.setup();
  const { container } = renderBranches({
    ...branchRepository().commands,
    branches: () => ({
      ok: true,
      value: { local: [{ name: "main", commit: head, current: true, upstream: null }], remotes: [], tags: [], detached: null },
    }),
  });
  await screen.findByRole("button", { name: "Actions for main" });

  await choose(user, "main", "Set Upstream…");
  const dialog = screen.getByRole("dialog", { name: "Set “main”'s Upstream" });
  expect(dialog).toHaveTextContent(
    "There are no remote-tracking branches to choose from. Add a remote and fetch from it, or push “main” from the Toolbar",
  );
  expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();
  await expectNoAxeViolations(container);
  await user.keyboard("{Enter}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Actions for main" })).toHaveFocus();
});

test("a branch is deleted on its Upstream's remote, alone or with the local branch, once the user confirms", async () => {
  const user = userEvent.setup();
  const repository = branchRepository({ tracking: true });
  const { container } = renderBranches(repository.commands);
  await screen.findByRole("region", { name: "Local branches" });

  await user.click(screen.getByRole("button", { name: "Actions for feature/x" }));
  const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
  expect(items.slice(-3)).toEqual([
    "Delete “feature/x”",
    "Delete “origin/dev” on origin…",
    "Delete “feature/x” and “origin/dev”…",
  ]);
  await user.click(screen.getByRole("menuitem", { name: "Delete “feature/x” and “origin/dev”…" }));
  const dialog = screen.getByRole("dialog", { name: "Delete “feature/x” and “origin/dev”?" });
  // Focus starts on keeping it: a branch deleted on a remote goes for everyone.
  expect(within(dialog).getByRole("button", { name: "Keep the branch" })).toHaveFocus();
  expect(dialog).toHaveTextContent("This deletes “dev” on origin for everyone who uses it");
  await expectNoAxeViolations(container);
  expect(repository.calls).toEqual([]);

  await user.click(within(dialog).getByRole("button", { name: "Delete on origin and locally" }));
  expect(await within(widget()).findByText("Deleted “dev” on origin, and “origin/dev” with it. Deleted branch “feature/x”.")).toBeVisible();
  expect(repository.calls).toEqual([
    { repository: lanewise.root, remote: "origin", branch: "dev" },
    { repository: lanewise.root, name: "feature/x", confirmedTip: null },
  ]);
  expect(namesIn("Local branches")).toEqual(["main", "done"]);
  expect(within(screen.getByRole("region", { name: "origin" })).queryByRole("listitem")).toBeNull();
  // The row went with it: focus moves on, never left on the page's body.
  expect(screen.getByRole("button", { name: "New branch…" })).toHaveFocus();
});

test("a remote-tracking branch is deleted on its remote alone, and a remote's refusal is said in the dialog", async () => {
  const user = userEvent.setup();
  const repository = branchRepository();
  repository.list.remotes[0]?.branches.push({ name: "origin/protected", branch: "protected", commit: head });
  renderBranches(repository.commands);
  await screen.findByRole("region", { name: "Local branches" });

  await choose(user, "origin/protected", "Delete on origin…");
  const dialog = screen.getByRole("dialog", { name: "Delete “protected” on origin?" });
  await user.click(within(dialog).getByRole("button", { name: "Delete on origin" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "“origin/protected” wasn't deleted on its remote. The remote may protect it, or it may be the remote's default branch. Git stopped with exit code 1: remote: GH006: Protected branch update failed",
  );
  await user.click(within(dialog).getByRole("button", { name: "Keep the branch" }));

  await choose(user, "origin/dev", "Delete on origin…");
  await user.click(
    within(screen.getByRole("dialog", { name: "Delete “dev” on origin?" })).getByRole("button", { name: "Delete on origin" }),
  );
  expect(await within(widget()).findByText("Deleted “dev” on origin, and “origin/dev” with it.")).toBeVisible();
  expect(namesIn("origin")).toEqual(["protected"]);
});

test("a right click, Shift+F10 or the Menu key opens a row's menu, which gives focus back as it closes", async () => {
  const user = userEvent.setup();
  const copied: string[] = [];
  const fake = fakePlatform({ commands: branchRepository().commands });
  const { container } = render(
    <BranchesWidget
      commands={fake.platform.commands}
      repository={lanewise}
      refreshes={0}
      selectedCommit={null}
      onChanged={() => {}}
      copyText={async (text) => {
        copied.push(text);
      }}
    />,
  );
  const name = await screen.findByRole("button", { name: "feature/x" });

  await user.pointer({ keys: "[MouseRight]", target: name });
  const menu = screen.getByRole("menu", { name: "Actions for feature/x" });
  expect(within(menu).getAllByRole("menuitem")[0]).toHaveFocus();
  expect(within(menu).getAllByRole("menuitem").at(-1)).toHaveTextContent("Copy branch name");
  await expectNoAxeViolations(container);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(name).toHaveFocus();

  await user.keyboard("{Shift>}{F10}{/Shift}");
  expect(screen.getByRole("menu", { name: "Actions for feature/x" })).toBeVisible();
  await user.keyboard("{End}{Enter}");
  expect(copied).toEqual(["feature/x"]);
  expect(await within(widget()).findByText("Copied the branch name.")).toBeVisible();

  await openTags(user);
  screen.getByRole("button", { name: "v0.1.0" }).focus();
  await user.keyboard("{ContextMenu}");
  expect(screen.getByRole("menu", { name: "Actions for tag v0.1.0" })).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "v0.1.0" })).toHaveFocus();
});

test("a double click on a remote-tracking branch checks it out as a local branch, and a click on a name copies it", async () => {
  const user = userEvent.setup();
  const repository = branchRepository();
  const copied: [string, string][] = [];
  const fake = fakePlatform({ commands: repository.commands });
  render(
    <Copying.Provider value={(text, what) => copied.push([text, what])}>
      <Page commands={fake.platform.commands} />
    </Copying.Provider>,
  );
  const remote = await screen.findByRole("button", { name: "dev" });

  await user.dblClick(remote);

  expect(
    await within(widget()).findByText("Checked out “dev”, a new branch tracking “origin/dev”."),
  ).toBeVisible();
  expect(repository.calls).toEqual([
    { repository: lanewise.root, branch: { kind: "remote", name: "origin/dev" }, stashFirst: false },
  ]);
  // For the Toolbar's Undo, from where HEAD was.
  expect(historyOf(lanewise.root).undo).toEqual([
    { kind: "checkOut", from: { kind: "branch", name: "main" }, to: { kind: "branch", name: "dev" } },
  ]);
  expect(copied[0]).toEqual(["origin/dev", "branch name"]);
  await user.click(screen.getByRole("button", { name: "feature/x" }));
  expect(copied.at(-1)).toEqual(["feature/x", "branch name"]);
});

test("a tag is renamed from its menu", async () => {
  const user = userEvent.setup();
  const repository = branchRepository();
  const fake = fakePlatform({
    commands: { ...repository.commands, renameTag: () => ({ ok: true, value: null }) },
  });
  render(<Page commands={fake.platform.commands} />);
  await user.click(await screen.findByRole("button", { name: /^Tags/ }));
  await user.click(screen.getByRole("button", { name: "Actions for tag v0.1.0" }));
  await user.click(screen.getByRole("menuitem", { name: "Rename…" }));
  const dialog = screen.getByRole("dialog", { name: "Rename tag “v0.1.0”" });
  await user.clear(within(dialog).getByRole("textbox", { name: "New name" }));
  await user.keyboard("v0.1{Enter}");

  expect(await within(widget()).findByText("Renamed tag “v0.1.0” to “v0.1”.")).toBeVisible();
  expect(fake.calls.filter((call) => call.name === "renameTag").map((call) => call.request)).toEqual([
    { repository: lanewise.root, from: "v0.1.0", to: "v0.1" },
  ]);
});
