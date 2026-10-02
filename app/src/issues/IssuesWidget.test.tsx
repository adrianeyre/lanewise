// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import type { CreateBranchRequest } from "../commands/api";
import { expectNoAxeViolations } from "../test/axe";
import { fakePlatform, listedBranches } from "../test/fakePlatform";
import { IssuesWidget } from "./IssuesWidget";
import { announceIssueTrackersChanged } from "./trackerEvents";
import { fakeIssueTrackers, issueOf } from "./testTrackers";

afterEach(cleanup);

const lanewise = { root: "/work/lanewise", name: "lanewise" };
const widget = () => within(screen.getByRole("region", { name: "Issues" }));
const ada = { site: "lanewise.atlassian.net", email: "ada@example.com", name: "Ada Lovelace" };

function setUp(trackers = fakeIssueTrackers()) {
  const created: CreateBranchRequest[] = [];
  let changes = 0;
  const fake = fakePlatform({
    commands: {
      ...trackers.commands,
      branches: listedBranches(),
      createBranch: (request) => {
        created.push(request);
        return { ok: true, value: null };
      },
    },
  });
  const view = render(
    <IssuesWidget
      commands={fake.platform.commands}
      repository={lanewise}
      onChanged={() => (changes += 1)}
      onOpenLink={(url) => void fake.platform.openLink(url)}
      copyText={(text) => fake.platform.copyText(text)}
    />,
  );
  return { ...trackers, fake, view, created, changes: () => changes, user: userEvent.setup() };
}

test("with no Issue Tracker saved, it says where to add one", async () => {
  const { view } = setUp();

  expect(await widget().findByText(/Add Jira Cloud or Trello under Issue Trackers in Settings/)).toBeVisible();
  expect(widget().queryByRole("searchbox")).toBeNull();
  await expectNoAxeViolations(view.container);
});

test("lists the open Issues, a page at a time, with Load more handing focus to the first added", async () => {
  const issues = Array.from({ length: 30 }, (_, n) => issueOf(n));
  const { user, view } = setUp(fakeIssueTrackers({ kept: { jira: ada }, issues: { jira: issues } }));

  const list = await widget().findByRole("list", { name: "Issues in Jira Cloud" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(25);
  expect(within(list).getAllByRole("button", { name: /^LW-0 Issue 0 In Progress$/ })).toHaveLength(1);
  expect(widget().getByText("From lanewise.atlassian.net")).toBeVisible();
  await expectNoAxeViolations(view.container);

  await user.click(widget().getByRole("button", { name: "Load more" }));

  expect(await within(list).findByRole("button", { name: /^LW-25 Issue 25/ })).toHaveFocus();
  expect(within(list).getAllByRole("listitem")).toHaveLength(30);
  expect(widget().queryByRole("button", { name: "Load more" })).toBeNull();
});

test("a search lists only the Issues with its words, and says when none match", async () => {
  const issues = [issueOf(1, "jira", { title: "Draw the lanes" }), issueOf(2, "jira", { title: "Fix the diff" })];
  const { user, calls } = setUpWithCalls(fakeIssueTrackers({ kept: { jira: ada }, issues: { jira: issues } }));

  await widget().findByRole("list", { name: "Issues in Jira Cloud" });
  await user.type(widget().getByRole("searchbox", { name: "Search Issues" }), "lanes{Enter}");

  expect(await widget().findByRole("button", { name: /^LW-1 Draw the lanes/ })).toBeVisible();
  expect(widget().queryByRole("button", { name: /^LW-2/ })).toBeNull();
  expect(calls().at(-1)).toEqual({ tracker: "jira", query: "lanes", page: { cursor: null, limit: 25 } });

  await user.clear(widget().getByRole("searchbox", { name: "Search Issues" }));
  await user.type(widget().getByRole("searchbox", { name: "Search Issues" }), "nothing{Enter}");
  expect(await widget().findByText("No open Issues match “nothing”.")).toBeVisible();
});

function setUpWithCalls(trackers: ReturnType<typeof fakeIssueTrackers>) {
  const set = setUp(trackers);
  return {
    ...set,
    calls: () => set.fake.calls.filter((call) => call.name === "issues").map((call) => call.request),
  };
}

test("an Issue's menu makes a branch named for it, opens it and copies its key and link", async () => {
  const issue = issueOf(12, "jira", { title: "Draw the lanes straight down" });
  const { user, created, fake, view } = setUp(
    fakeIssueTrackers({ kept: { jira: ada }, issues: { jira: [issue] } }),
  );

  const row = await widget().findByRole("button", { name: /^LW-12 Draw the lanes/ });
  await user.click(row);
  let menu = screen.getByRole("menu", { name: "Actions for LW-12" });
  expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "Create branch for this Issue…",
    "Open in browser",
    "Copy key",
    "Copy link",
  ]);
  await expectNoAxeViolations(view.container);
  await user.click(within(menu).getByRole("menuitem", { name: "Create branch for this Issue…" }));

  const dialog = screen.getByRole("dialog", { name: "New branch" });
  const name = within(dialog).getByRole("textbox", { name: "Branch name" });
  expect(name).toHaveValue("LW-12-draw-the-lanes-straight-down");
  await expectNoAxeViolations(view.container);
  await user.click(within(dialog).getByRole("button", { name: "Create branch" }));
  expect(await widget().findByText("Created branch “LW-12-draw-the-lanes-straight-down” at HEAD.")).toBeVisible();
  expect(created).toEqual([{ repository: lanewise.root, name: "LW-12-draw-the-lanes-straight-down", start: null }]);

  // Shift+F10 opens the same menu from the keyboard, beside the row.
  row.focus();
  await user.keyboard("{Shift>}{F10}{/Shift}");
  menu = screen.getByRole("menu", { name: "Actions for LW-12" });
  expect(within(menu).getAllByRole("menuitem")[0]).toHaveFocus();
  await user.click(within(menu).getByRole("menuitem", { name: "Open in browser" }));
  expect(fake.links).toEqual([issue.url]);

  // As does a right click, and the "…" button.
  fireEvent.contextMenu(row);
  await user.click(within(screen.getByRole("menu", { name: "Actions for LW-12" })).getByRole("menuitem", { name: "Copy key" }));
  await user.click(widget().getByRole("button", { name: "Actions for LW-12" }));
  await user.click(screen.getByRole("menuitem", { name: "Copy link" }));
  expect(fake.copied).toEqual(["LW-12", issue.url]);
  expect(widget().getByRole("status")).toHaveTextContent("Copied the link to LW-12.");
});

test("with both saved, the Issue Tracker is chosen, and one saved in Settings is read again", async () => {
  const trackers = fakeIssueTrackers({
    kept: { jira: ada },
    issues: { jira: [issueOf(1)], trello: [issueOf(3, "trello", { title: "A Trello card" })] },
  });
  const { user, accounts, view } = setUp(trackers);

  await widget().findByRole("list", { name: "Issues in Jira Cloud" });
  expect(widget().queryByRole("combobox", { name: "Issue Tracker" })).toBeNull();

  accounts.set("trello", { site: null, email: null, name: "Grace Hopper" });
  act(() => announceIssueTrackersChanged());

  const choice = await widget().findByRole("combobox", { name: "Issue Tracker" });
  await user.selectOptions(choice, "trello");
  expect(await widget().findByRole("button", { name: /^#3 A Trello card$/ })).toBeVisible();
  await expectNoAxeViolations(view.container);
});

test("a refused token is said, with a way to try again", async () => {
  const trackers = fakeIssueTrackers({ kept: { jira: ada } });
  let refuse = true;
  const listing = trackers.commands.issues;
  if (!listing) throw new Error("The fake lists Issues.");
  trackers.commands.issues = (request) => (refuse ? { ok: false, error: { kind: "tokenRefused" } } : listing(request));
  const { user, view } = setUp(trackers);

  expect(await widget().findByRole("alert")).toHaveTextContent("Jira refused the email and API token.");
  await expectNoAxeViolations(view.container);

  refuse = false;
  await user.click(widget().getByRole("button", { name: "Try again" }));
  expect(await widget().findByText("No open Issues for you.")).toBeVisible();
});
