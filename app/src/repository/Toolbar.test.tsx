// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";

import type { CommandClient, GitProgress, Remote, RemoteOperationKind, Stash, Upstream } from "../commands/api";
import { expectNoAxeViolations } from "../test/axe";
import { fakePlatform, fakeRemoteOperations, listedBranches } from "../test/fakePlatform";
import { Toolbar } from "./Toolbar";
import { forgetUndoHistories } from "./undo";
import { FOCUS_FETCH_GAP } from "./useRemoteOperation";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  forgetUndoHistories();
});

const lanewise = { root: "/work/lanewise", name: "lanewise" };

/** The Toolbar as the Repository page draws it, counting the times it said the repository changed. */
function Page({
  commands,
  onOpenLink,
  fetchOnShow,
  historyRead,
  stashes,
}: {
  commands: CommandClient;
  onOpenLink?: (url: string) => void;
  fetchOnShow?: boolean;
  historyRead?: boolean;
  stashes?: readonly Stash[];
}) {
  const [changed, setChanged] = useState(0);
  return (
    <>
      <p data-testid="changed">{changed}</p>
      <Toolbar
        commands={commands}
        repository={lanewise}
        refreshes={changed}
        onChanged={() => setChanged((n) => n + 1)}
        onOpenLink={onOpenLink}
        fetchOnShow={fetchOnShow}
        historyRead={historyRead}
        heading={<h2>lanewise</h2>}
        stashes={stashes}
      />
    </>
  );
}

function platformFor(
  upstream: Upstream | null = null,
  running: RemoteOperationKind | null = null,
  remotes: Remote[] = [],
) {
  const remote = fakeRemoteOperations(running);
  const fake = fakePlatform({
    commands: {
      branches: listedBranches({
        local: [{ name: "main", commit: "a".repeat(40), current: true, upstream }],
        remotes,
      }),
      ...remote.commands,
    },
  });
  return { ...fake, remote };
}

/** A remote in the Git config, with no remote-tracking branches yet. */
const configured = (name: string): Remote => ({
  name,
  url: `https://example.com/${name}.git`,
  pushUrl: null,
  configured: true,
  branches: [],
});

const originMain = (ahead: number, behind: number): Upstream => ({
  name: "origin/main",
  remote: "origin",
  ahead,
  behind,
  gone: false,
});

function writing(done: number, total = 100): GitProgress {
  return { phase: "Writing objects", remote: false, done, total, percent: done, finished: done === total };
}

const toolbar = () => screen.getByRole("region", { name: "Toolbar" });
const changed = () => screen.getByTestId("changed").textContent;
const started = (fake: ReturnType<typeof platformFor>) =>
  fake.calls.filter(({ name }) => name.startsWith("start")).map(({ name, request }) => ({ name, request }));

test("the Toolbar shows the current branch and how far it is ahead of and behind its Upstream, in words too", async () => {
  const fake = platformFor(originMain(2, 1));
  const { container } = render(<Page commands={fake.platform.commands} />);

  expect(await within(toolbar()).findByText("2 commits ahead of origin/main and 1 behind")).toBeInTheDocument();
  expect(toolbar()).toHaveTextContent("Current branch: main");
  for (const name of ["Fetch", "Pull", "Push"]) expect(within(toolbar()).getByRole("button", { name })).toBeVisible();
  expect(within(toolbar()).getByRole("button", { name: "Choose how to pull" })).toHaveAttribute("aria-haspopup", "menu");
  expect(within(toolbar()).queryByRole("button", { name: /force/i })).toBeNull();
  await expectNoAxeViolations(container);
  cleanup();

  render(<Page commands={platformFor(null).platform.commands} />);
  expect(await within(toolbar()).findByText("No Upstream")).toBeVisible();
});

test("a push shows Git's progress, announces it politely, and says what it pushed, handing focus back", async () => {
  const user = userEvent.setup();
  const fake = platformFor(originMain(2, 0));
  const { container } = render(<Page commands={fake.platform.commands} />);
  const push = await within(toolbar()).findByRole("button", { name: "Push" });

  push.focus();
  await user.keyboard("{Enter}");

  const cancel = await within(toolbar()).findByRole("button", { name: "Cancel push" });
  expect(cancel).toHaveFocus();
  expect(started(fake)).toEqual([{ name: "startPush", request: { repository: lanewise.root, setUpstream: null } }]);
  expect(within(toolbar()).getByRole("progressbar", { name: "Pushing…" })).toBeVisible();
  for (const name of ["Fetch", "Pull", "Push"]) {
    expect(within(toolbar()).getByRole("button", { name })).toHaveAttribute("aria-disabled", "true");
  }
  await expectNoAxeViolations(container);

  act(() => fake.remote.report({ kind: "running", progress: writing(50) }));
  const bar = await within(toolbar()).findByRole("progressbar", { name: "Writing objects: 50% (50 of 100)" });
  expect(bar).toHaveAttribute("aria-valuenow", "50");
  expect(within(toolbar()).getAllByRole("status").map((status) => status.textContent)).toContain(
    "Writing objects: 50%",
  );

  act(() => fake.remote.report({ kind: "pushed", pushed: { kind: "updated", commits: 2 } }));
  expect(await within(toolbar()).findByText("Pushed 2 commits.")).toBeVisible();
  expect(within(toolbar()).queryByRole("progressbar")).toBeNull();
  expect(within(toolbar()).getByRole("button", { name: "Push" })).toHaveFocus();
  expect(changed()).toBe("1");
  await expectNoAxeViolations(container);
});

test("a fetch is cancelled from the keyboard, and says it was", async () => {
  const user = userEvent.setup();
  const fake = platformFor(originMain(0, 0));
  render(<Page commands={fake.platform.commands} />);
  await user.click(await within(toolbar()).findByRole("button", { name: "Fetch" }));

  expect(await within(toolbar()).findByRole("button", { name: "Cancel fetch" })).toHaveFocus();
  await user.keyboard("{Enter}");

  expect(fake.remote.cancelled).toEqual([1]);
  expect(within(toolbar()).getByText("Cancelling the fetch…")).toBeVisible();
  act(() => fake.remote.report({ kind: "cancelled" }));
  expect(await within(toolbar()).findByText("The fetch was cancelled.")).toBeVisible();
  expect(within(toolbar()).getByRole("button", { name: "Fetch" })).toHaveFocus();
});

test("Pull follows the Git config, and its menu picks a Pull Mode for one pull", async () => {
  const user = userEvent.setup();
  const fake = platformFor(originMain(0, 3));
  render(<Page commands={fake.platform.commands} />);

  await user.click(await within(toolbar()).findByRole("button", { name: "Pull" }));
  act(() => fake.remote.report({ kind: "pulled", pulled: { kind: "updated", commits: 3 } }));
  expect(await within(toolbar()).findByText("Pulled 3 commits.")).toBeVisible();

  within(toolbar()).getByRole("button", { name: "Choose how to pull" }).focus();
  await user.keyboard("{Enter}");
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "Pull with merge",
    "Pull with rebase",
    "Pull fast-forward only",
  ]);
  await user.keyboard("{ArrowDown}{Enter}");
  expect(await within(toolbar()).findByRole("progressbar", { name: "Pulling with rebase…" })).toBeVisible();
  act(() => fake.remote.report({ kind: "pulled", pulled: { kind: "upToDate" } }));
  expect(await within(toolbar()).findByText("Pulled: already up to date.")).toBeVisible();

  expect(started(fake)).toEqual([
    { name: "startPull", request: { repository: lanewise.root, mode: null } },
    { name: "startPull", request: { repository: lanewise.root, mode: "rebase" } },
  ]);
});

test("a push the remote rejects explains why and offers to pull, never to force push", async () => {
  const user = userEvent.setup();
  const fake = platformFor(originMain(1, 1));
  const { container } = render(<Page commands={fake.platform.commands} />);
  await user.click(await within(toolbar()).findByRole("button", { name: "Push" }));

  act(() => fake.remote.report({ kind: "failed", error: { kind: "rejected", upstream: "origin/main" } }));

  expect(await within(toolbar()).findByRole("alert")).toHaveTextContent(
    "The push was rejected: origin/main has commits the branch doesn't. Pull them in first, then push again.",
  );
  const offers = within(toolbar()).getAllByRole("button", { name: "Pull" });
  expect(offers).toHaveLength(2);
  expect(within(toolbar()).queryByRole("button", { name: /force/i })).toBeNull();
  await expectNoAxeViolations(container);

  offers[1]?.focus();
  await user.keyboard("{Enter}");
  expect(await within(toolbar()).findByRole("button", { name: "Cancel pull" })).toHaveFocus();
  expect(started(fake).at(-1)).toEqual({ name: "startPull", request: { repository: lanewise.root, mode: null } });
  expect(within(toolbar()).queryByRole("alert")).toBeNull();
});

test("a fetch GitHub's SSO refuses explains how to authorize the SSH key, links to GitHub's instructions, and keeps what Git said", async () => {
  const user = userEvent.setup();
  const fake = platformFor(originMain(0, 0));
  const opened: string[] = [];
  const { container } = render(<Page commands={fake.platform.commands} onOpenLink={(url) => opened.push(url)} />);
  await user.click(await within(toolbar()).findByRole("button", { name: "Fetch" }));

  const said =
    "ERROR: The `example-org' organization has enabled or enforced SAML SSO. To access\nthis repository, you must use the HTTPS remote with a personal access token\nor SSH with an SSH key and passphrase\nthat has been authorized for this organization.\nfatal: Could not read from remote repository.";
  act(() =>
    fake.remote.report({
      kind: "failed",
      error: {
        kind: "signInFailed",
        failure: { kind: "ssoNotAuthorized", organization: "example-org", credential: { kind: "sshKey" } },
        message: said,
      },
    }),
  );

  const alert = await within(toolbar()).findByRole("alert");
  expect(alert).toHaveTextContent(
    "Nothing was fetched: Git couldn't sign in to GitHub. The example-org organization uses SAML single sign-on (SSO), and your SSH key hasn't been authorized for it, so GitHub refused it.",
  );
  expect(within(alert).getAllByRole("listitem")[1]).toHaveTextContent(
    "Next to the key, choose Configure SSO, then Authorize next to the example-org organization",
  );
  const link = within(alert).getByRole("link", { name: /Authorizing an SSH key for use with SSO/ });
  expect(link).toHaveAttribute(
    "href",
    "https://docs.github.com/en/enterprise-cloud@latest/authentication/authenticating-with-single-sign-on/authorizing-an-ssh-key-for-use-with-single-sign-on",
  );
  await expectNoAxeViolations(container);

  // Git's own words are there on request (a summary opens from the keyboard in a browser; jsdom only clicks it).
  await user.click(within(alert).getByText("What Git said"));
  expect(within(alert).getByText(/enabled or enforced SAML SSO/)).toBeVisible();
  link.focus();
  await user.keyboard("{Enter}");
  expect(opened).toEqual([link.getAttribute("href")]);
});

test("pushing a branch with no Upstream asks where to push it, from the keyboard, and sets that as its Upstream", async () => {
  const user = userEvent.setup();
  // A remote only its remote-tracking branches are left of can't be pushed to.
  const gone = { ...configured("old"), url: null, configured: false };
  const fake = platformFor(null, null, [gone, configured("origin"), configured("team")]);
  const { container } = render(<Page commands={fake.platform.commands} />);
  const push = await within(toolbar()).findByRole("button", { name: "Push" });
  expect(await within(toolbar()).findByText("No Upstream")).toBeVisible();

  push.focus();
  await user.keyboard("{Enter}");

  const dialog = screen.getByRole("dialog", { name: "Push “main” and set its Upstream" });
  const remote = within(dialog).getByRole("combobox", { name: "Remote" });
  expect(remote).toHaveFocus();
  expect(remote).toHaveValue("origin");
  expect(within(remote).getAllByRole("option").map((option) => option.textContent)).toEqual(["origin", "team"]);
  const name = within(dialog).getByRole("textbox", { name: "Branch on the remote" });
  expect(name).toHaveValue("main");
  expect(started(fake)).toEqual([]);
  await expectNoAxeViolations(container);

  // A name with nothing in it is said in the dialog, and nothing is pushed.
  await user.clear(name);
  await user.keyboard("{Enter}");
  expect(within(dialog).getByRole("alert")).toHaveTextContent("The branch on the remote needs a name.");
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(started(fake)).toEqual([]);
  await expectNoAxeViolations(container);

  await user.selectOptions(remote, "team");
  await user.type(name, "topic{Enter}");

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(await within(toolbar()).findByRole("button", { name: "Cancel push" })).toHaveFocus();
  expect(started(fake)).toEqual([
    { name: "startPush", request: { repository: lanewise.root, setUpstream: { remote: "team", branch: "topic" } } },
  ]);
  expect(within(toolbar()).getByRole("progressbar", { name: "Pushing to team/topic…" })).toBeVisible();

  act(() => fake.remote.report({ kind: "pushed", pushed: { kind: "updated", commits: 3 } }));
  expect(await within(toolbar()).findByText("Pushed 3 commits. team/topic is the branch's Upstream now.")).toBeVisible();
  expect(within(toolbar()).getByRole("button", { name: "Push" })).toHaveFocus();
  expect(changed()).toBe("1");
  await expectNoAxeViolations(container);
});

test("a push that finds the branch has no Upstream offers to push and set one, or to add a remote first", async () => {
  const user = userEvent.setup();
  // The Toolbar read an Upstream the branch has lost since.
  const fake = platformFor(originMain(1, 0));
  const { container } = render(<Page commands={fake.platform.commands} />);
  await user.click(await within(toolbar()).findByRole("button", { name: "Push" }));

  act(() => fake.remote.report({ kind: "failed", error: { kind: "noUpstream", branch: "main" } }));

  expect(await within(toolbar()).findByRole("alert")).toHaveTextContent(
    "Nothing was pushed: “main” has no Upstream. Push it and set one, choosing where it goes.",
  );
  const offer = within(toolbar()).getByRole("button", { name: "Push and set Upstream…" });
  // Only the Toolbar's own Pull: with no Upstream, there's nothing to pull.
  expect(within(toolbar()).getAllByRole("button", { name: "Pull" })).toHaveLength(1);
  await expectNoAxeViolations(container);

  offer.focus();
  await user.keyboard("{Enter}");
  const dialog = screen.getByRole("dialog", { name: "Push “main” and set its Upstream" });
  expect(dialog).toHaveTextContent(
    "“main” has no Upstream, and there's no remote to push it to. Add one in the Branches & remotes Widget, then push again.",
  );
  const close = within(dialog).getByRole("button", { name: "Close" });
  expect(close).toHaveFocus();
  await expectNoAxeViolations(container);

  await user.keyboard("{Enter}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(offer).toHaveFocus();
  expect(started(fake)).toHaveLength(1);
});

test("a pull the Git config can't settle offers to merge or rebase", async () => {
  const user = userEvent.setup();
  const fake = platformFor(originMain(1, 1));
  render(<Page commands={fake.platform.commands} />);
  await user.click(await within(toolbar()).findByRole("button", { name: "Pull" }));

  act(() => fake.remote.report({ kind: "failed", error: { kind: "noPullMode", upstream: "origin/main" } }));

  expect(await within(toolbar()).findByRole("alert")).toHaveTextContent(
    "Nothing was pulled: the branch and origin/main have diverged, and your Git config doesn't say whether to merge or rebase.",
  );
  await user.click(within(toolbar()).getByRole("button", { name: "Pull with merge" }));
  expect(started(fake).at(-1)).toEqual({ name: "startPull", request: { repository: lanewise.root, mode: "merge" } });
});

test("a pull that stops partway through a rebase says so, and the page reads the repository again", async () => {
  const user = userEvent.setup();
  const fake = platformFor(originMain(1, 1));
  render(<Page commands={fake.platform.commands} />);
  await user.click(await within(toolbar()).findByRole("button", { name: "Pull" }));

  act(() =>
    fake.remote.report({
      kind: "pulled",
      pulled: { kind: "stopped", operation: "rebase", conflicts: ["README.md"], messages: "CONFLICT" },
    }),
  );

  expect(
    await within(toolbar()).findByText(
      "The pull stopped partway through rebasing, with conflicts in 1 file. The rebase is still in progress.",
    ),
  ).toBeVisible();
  expect(changed()).toBe("1");
});

test("a fetch, pull or push running before the Toolbar was drawn is followed again", async () => {
  const fake = platformFor(originMain(0, 0), "pull");
  render(<Page commands={fake.platform.commands} />);

  expect(await within(toolbar()).findByRole("button", { name: "Cancel pull" })).toBeVisible();
  expect(within(toolbar()).getByRole("progressbar", { name: "Pulling…" })).toBeVisible();
  // Not started here, so focus stays where it was.
  expect(document.body).toHaveFocus();
  expect(started(fake)).toEqual([]);

  act(() => fake.remote.report({ kind: "pulled", pulled: { kind: "upToDate" } }));
  expect(await within(toolbar()).findByText("Pulled: already up to date.")).toBeVisible();
});

test("one started elsewhere while this one starts is followed instead", async () => {
  const user = userEvent.setup();
  const fake = platformFor(originMain(0, 0));
  render(<Page commands={fake.platform.commands} />);
  await within(toolbar()).findByText("Up to date with origin/main");
  // Started as if from another window, after the Toolbar looked.
  await fake.remote.commands.startFetch?.({ repository: lanewise.root });

  await user.click(within(toolbar()).getByRole("button", { name: "Push" }));

  expect(await within(toolbar()).findByRole("button", { name: "Cancel fetch" })).toBeVisible();
  act(() => fake.remote.report({ kind: "fetched" }));
  expect(await within(toolbar()).findByText("Fetched from every remote.")).toBeVisible();
});

test("shown with Fetch when a Tab is shown on, it fetches, on the Toolbar's one row, without taking focus", async () => {
  const fake = platformFor(originMain(0, 0), null, [configured("origin")]);
  const outside = document.createElement("button");
  document.body.append(outside);
  outside.focus();
  const { container } = render(<Page commands={fake.platform.commands} fetchOnShow />);

  expect(await within(toolbar()).findByRole("progressbar", { name: "Fetching…" })).toBeVisible();
  expect(started(fake)).toEqual([{ name: "startFetch", request: { repository: lanewise.root } }]);
  // The progress is in the row with the branch and the buttons.
  const row = toolbar().querySelector(".toolbar-row");
  expect(row).toContainElement(within(toolbar()).getByRole("button", { name: "Cancel fetch" }));
  expect(outside).toHaveFocus();
  await expectNoAxeViolations(container);

  act(() => fake.remote.report({ kind: "fetched" }));
  const said = await within(toolbar()).findByText("Fetched from every remote.");
  expect(row).toContainElement(said);
  expect(said).toHaveAttribute("title", "Fetched from every remote.");
  outside.remove();
});

/** The window coming back into focus, as when the user clicks into Lanewise from another app. */
const focusWindow = () => act(() => void window.dispatchEvent(new FocusEvent("focus")));

test("with Fetch when a Tab is shown on, it fetches again each time the window is focused, but not within the gap or while one runs", async () => {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const fake = platformFor(originMain(0, 0), null, [configured("origin")]);
  const outside = document.createElement("button");
  document.body.append(outside);
  outside.focus();
  render(<Page commands={fake.platform.commands} fetchOnShow />);
  expect(await within(toolbar()).findByRole("progressbar", { name: "Fetching…" })).toBeVisible();
  act(() => fake.remote.report({ kind: "fetched" }));
  await within(toolbar()).findByText("Fetched from every remote.");

  // Too soon after the fetch as it was shown.
  now += FOCUS_FETCH_GAP - 1;
  await focusWindow();
  await act(async () => {});
  expect(started(fake)).toHaveLength(1);

  now += 1;
  await focusWindow();
  expect(await within(toolbar()).findByRole("progressbar", { name: "Fetching…" })).toBeVisible();
  expect(started(fake)).toEqual([
    { name: "startFetch", request: { repository: lanewise.root } },
    { name: "startFetch", request: { repository: lanewise.root } },
  ]);
  expect(outside).toHaveFocus();

  // Not while that one runs, however long it takes.
  now += FOCUS_FETCH_GAP * 2;
  await focusWindow();
  await act(async () => {});
  expect(started(fake)).toHaveLength(2);
  act(() => fake.remote.report({ kind: "fetched" }));
  await within(toolbar()).findByText("Fetched from every remote.");
  outside.remove();
});

test("until the Commit graph has its first window, it neither looks for one running nor fetches, so git leaves the first screen the CPU", async () => {
  const fake = platformFor(originMain(0, 0), null, [configured("origin")]);
  const { rerender } = render(<Page commands={fake.platform.commands} fetchOnShow historyRead={false} />);
  await within(toolbar()).findByRole("button", { name: "Fetch" });
  await focusWindow();
  await act(async () => {});
  expect(fake.calls.map(({ name }) => name)).not.toContain("remoteOperation");
  expect(started(fake)).toEqual([]);

  rerender(<Page commands={fake.platform.commands} fetchOnShow historyRead />);

  expect(await within(toolbar()).findByRole("progressbar", { name: "Fetching…" })).toBeVisible();
  expect(started(fake)).toEqual([{ name: "startFetch", request: { repository: lanewise.root } }]);
  act(() => fake.remote.report({ kind: "fetched" }));
  await within(toolbar()).findByText("Fetched from every remote.");
});

test("with Fetch when a Tab is shown off, focusing the window fetches nothing", async () => {
  const fake = platformFor(originMain(0, 0), null, [configured("origin")]);
  render(<Page commands={fake.platform.commands} />);
  await within(toolbar()).findByRole("button", { name: "Fetch" });

  await focusWindow();
  await act(async () => {});

  expect(started(fake)).toEqual([]);
});

test("shown with one running already, it follows that one, and a repository with no remotes fetches nothing, quietly", async () => {
  const fake = platformFor(originMain(0, 0), "pull", [configured("origin")]);
  render(<Page commands={fake.platform.commands} fetchOnShow />);
  expect(await within(toolbar()).findByRole("button", { name: "Cancel pull" })).toBeVisible();
  expect(started(fake)).toEqual([]);
  cleanup();

  const none = fakePlatform({
    commands: { branches: listedBranches(), startFetch: () => ({ ok: false, error: { kind: "noRemotes" } }) },
  });
  render(<Page commands={none.platform.commands} fetchOnShow />);
  await within(toolbar()).findByRole("button", { name: "Fetch" });
  await act(async () => {});
  expect(none.calls.map(({ name }) => name)).toContain("startFetch");
  expect(within(toolbar()).queryByRole("alert")).toBeNull();
  expect(within(toolbar()).getByRole("button", { name: "Fetch" })).not.toHaveAttribute("aria-disabled");
});

/** The names of the buttons on the Toolbar's first row, by group. */
const rowButtons = () =>
  within(toolbar())
    .getAllByRole("group")
    .map((group) => [group.getAttribute("aria-label"), within(group).getAllByRole("button").map((button) => button.textContent)]);

test("the Toolbar's first row has Undo and Redo, Fetch, Pull and Push, then Branch, Stash and Pop, as GitKraken's does, over the repository's own row", async () => {
  const fake = platformFor(originMain(0, 0));
  const { container } = render(<Page commands={fake.platform.commands} />);
  await within(toolbar()).findByText("main");

  expect(rowButtons()).toEqual([
    ["Undo and redo", ["Undo", "Redo"]],
    ["Fetch, pull and push", ["Fetch", "Pull", "", "Push"]],
    ["Branches and stashes", ["Branch", "Stash", "Pop"]],
  ]);
  // Nothing done yet to undo or redo, and no stash to pop.
  for (const name of ["Undo", "Redo", "Pop"]) {
    expect(within(toolbar()).getByRole("button", { name })).toHaveAttribute("aria-disabled", "true");
  }
  // The repository's heading, the branch and its Upstream are on the row under the buttons.
  const bar = toolbar().querySelector(".repository-bar");
  expect(bar).toContainElement(screen.getByRole("heading", { level: 2, name: "lanewise" }));
  expect(bar).toHaveTextContent("Current branch: main");
  expect(toolbar().querySelector(".toolbar-buttons")?.compareDocumentPosition(bar!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  await expectNoAxeViolations(container);
});

test("Branch makes a branch, Undo deletes it and Redo makes it again, by their buttons and by Ctrl+Z and Ctrl+Shift+Z", async () => {
  const user = userEvent.setup();
  const tips: Record<string, string> = {};
  const head = "a".repeat(40);
  const fake = fakePlatform({
    commands: {
      branches: () => ({
        ok: true,
        value: {
          local: [
            { name: "main", commit: head, current: true, upstream: null },
            ...Object.entries(tips).map(([name, commit]) => ({ name, commit, current: false, upstream: null })),
          ],
          remotes: [],
          tags: [],
          detached: null,
        },
      }),
      createBranch: ({ name, start }) => {
        tips[name] = start ?? head;
        return { ok: true, value: null };
      },
      deleteBranch: ({ name }) => {
        delete tips[name];
        return { ok: true, value: null };
      },
    },
  });
  const { container } = render(<Page commands={fake.platform.commands} />);
  await within(toolbar()).findByText("main");

  await user.click(within(toolbar()).getByRole("button", { name: "Branch" }));
  const dialog = screen.getByRole("dialog", { name: "New branch" });
  await user.type(within(dialog).getByRole("textbox", { name: "Branch name" }), "topic{Enter}");
  expect(await within(toolbar()).findByText("Created branch “topic” at HEAD.")).toBeVisible();
  expect(tips).toEqual({ topic: head });

  const undoButton = within(toolbar()).getByRole("button", { name: "Undo: the new branch “topic”" });
  expect(undoButton).not.toHaveAttribute("aria-disabled");
  expect(undoButton).toHaveAttribute("title", "Undo the new branch “topic”");
  await expectNoAxeViolations(container);
  await user.click(undoButton);
  expect(await within(toolbar()).findByText("Undid the new branch “topic”: it's deleted.")).toBeVisible();
  expect(tips).toEqual({});
  expect(within(toolbar()).getByRole("button", { name: "Undo" })).toHaveAttribute("aria-disabled", "true");

  // From the keyboard, anywhere but where text is typed.
  document.body.focus();
  await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
  expect(await within(toolbar()).findByText("Redid the new branch “topic”.")).toBeVisible();
  expect(tips).toEqual({ topic: head });
  await user.keyboard("{Control>}z{/Control}");
  expect(await within(toolbar()).findByText("Undid the new branch “topic”: it's deleted.")).toBeVisible();
  expect(tips).toEqual({});
});

test("Ctrl+Z in a text field is the field's own, and undoes nothing in the repository", async () => {
  const user = userEvent.setup();
  const fake = platformFor(originMain(0, 0));
  render(
    <>
      <input aria-label="Subject" />
      <Page commands={fake.platform.commands} />
    </>,
  );
  await within(toolbar()).findByText("main");
  await user.click(within(toolbar()).getByRole("button", { name: "Branch" }));
  await user.type(within(screen.getByRole("dialog", { name: "New branch" })).getByRole("textbox"), "{Escape}");
  const calls = fake.calls.length;

  await user.click(screen.getByRole("textbox", { name: "Subject" }));
  await user.keyboard("{Control>}z{/Control}");

  expect(fake.calls).toHaveLength(calls);
});

test("Stash stashes the changes, and Pop pops the newest stash, which Undo stashes again", async () => {
  const user = userEvent.setup();
  const stash: Stash = {
    id: "s".repeat(40),
    index: 0,
    message: "Try a larger font",
    branch: "main",
    base: { id: "a".repeat(40), shortId: "aaaaaaa", summary: "Start" },
  } as Stash;
  const fake = fakePlatform({
    commands: {
      branches: listedBranches({ local: [{ name: "main", commit: "a".repeat(40), current: true, upstream: null }] }),
      createStash: ({ message }) => ({ ok: true, value: { ...stash, id: "t".repeat(40), message: message ?? null } }),
      popStash: () => ({ ok: true, value: { kind: "applied" } }),
    },
  });
  render(<Page commands={fake.platform.commands} stashes={[stash]} />);
  await within(toolbar()).findByText("main");

  await user.click(within(toolbar()).getByRole("button", { name: "Stash" }));
  const dialog = screen.getByRole("dialog", { name: "Stash changes" });
  await user.type(within(dialog).getByRole("textbox", { name: "Message (optional)" }), "Halfway{Enter}");
  expect(await within(toolbar()).findByText("Stashed your changes as “Halfway”.")).toBeVisible();

  const popButton = within(toolbar()).getByRole("button", { name: "Pop" });
  expect(popButton).toHaveAttribute("title", "Pop “Try a larger font”");
  await user.click(popButton);
  expect(await within(toolbar()).findByText("Popped “Try a larger font”: its changes are back in the working tree.")).toBeVisible();
  expect(fake.calls.filter(({ name }) => name === "popStash").map(({ request }) => request)).toEqual([
    { repository: lanewise.root, stash: stash.id },
  ]);
  expect(within(toolbar()).getByRole("button", { name: "Undo: popping the stash “Try a larger font”" })).toBeVisible();
});
