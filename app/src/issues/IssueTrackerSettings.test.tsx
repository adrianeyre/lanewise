// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { expectNoAxeViolations } from "../test/axe";
import { fakePlatform } from "../test/fakePlatform";
import { IssueTrackerSettings } from "./IssueTrackerSettings";
import { JIRA_TOKEN_PAGE, TRELLO_KEY_PAGE } from "./issueWords";
import { fakeIssueTrackers } from "./testTrackers";

afterEach(cleanup);

const section = () => screen.getByRole("region", { name: "Issue Trackers" });
const jira = () => within(within(section()).getByRole("region", { name: "Jira Cloud" }));
const trello = () => within(within(section()).getByRole("region", { name: "Trello" }));

function setUp(trackers = fakeIssueTrackers()) {
  const fake = fakePlatform({ commands: trackers.commands });
  const opened: string[] = [];
  const view = render(<IssueTrackerSettings commands={fake.platform.commands} onOpenLink={(url) => opened.push(url)} />);
  return { ...trackers, fake, view, opened, user: userEvent.setup() };
}

test("Jira Cloud is signed in to once its site, email and API token check out, and forgotten", async () => {
  const changed = vi.fn<() => void>();
  window.addEventListener("lanewise:issue-trackers-changed", changed);
  const { user, view, saved, opened, accounts, fake } = setUp();

  const token = await jira().findByLabelText("API token");
  expect(token).toHaveAttribute("type", "password");
  expect(token).toHaveAttribute("autocomplete", "off");
  await expectNoAxeViolations(view.container);

  await user.click(jira().getByRole("link", { name: /Create an API token/ }));
  expect(opened).toEqual([JIRA_TOKEN_PAGE]);

  await user.type(jira().getByRole("textbox", { name: "Site" }), "https://lanewise.atlassian.net/");
  await user.type(jira().getByRole("textbox", { name: "Email" }), "ada@example.com");
  await user.type(token, "wrong-token");
  await user.click(jira().getByRole("button", { name: "Show API token" }));
  expect(token).toHaveAttribute("type", "text");
  expect(jira().getByRole("button", { name: "Show API token" })).toHaveAttribute("aria-pressed", "true");
  await user.click(jira().getByRole("button", { name: "Save and check the Jira Cloud account" }));

  expect(await jira().findByRole("alert")).toHaveTextContent(
    "Jira refused the email and API token. Check both, or create a new API token.",
  );
  expect(token).toHaveFocus();
  expect(accounts.size).toBe(0);
  await expectNoAxeViolations(view.container);

  await user.clear(token);
  await user.type(token, "good-token");
  await user.click(jira().getByRole("button", { name: "Save and check the Jira Cloud account" }));

  expect(await jira().findByText("Signed in to lanewise.atlassian.net as ada@example.com.")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Signed in to Jira Cloud as Ada Lovelace.");
  const forget = jira().getByRole("button", { name: "Forget the Jira Cloud account" });
  expect(forget).toHaveFocus();
  expect(jira().queryByLabelText("API token")).toBeNull();
  expect(saved.at(-1)).toEqual({
    tracker: "jira",
    site: "https://lanewise.atlassian.net/",
    email: "ada@example.com",
    token: "good-token",
  });
  expect(changed).toHaveBeenCalledTimes(1);
  // The token went to the core alone, never to a fetch from the window.
  expect(fake.fetches).toEqual([]);
  await expectNoAxeViolations(view.container);

  await user.click(forget);
  expect(await jira().findByRole("textbox", { name: "Site" })).toHaveFocus();
  expect(screen.getByRole("status")).toHaveTextContent("Forgot your Jira Cloud account.");
  expect(accounts.size).toBe(0);
  expect(changed).toHaveBeenCalledTimes(2);
  window.removeEventListener("lanewise:issue-trackers-changed", changed);
});

test("a problem with a field is said beside it", async () => {
  const { user, view } = setUp();

  const site = await jira().findByRole("textbox", { name: "Site" });
  await user.type(site, "jira.example.com");
  await user.click(jira().getByRole("button", { name: "Save and check the Jira Cloud account" }));

  expect(await jira().findByRole("alert")).toHaveTextContent("That isn't a Jira Cloud site.");
  expect(site).toHaveAttribute("aria-invalid", "true");
  expect(site).toHaveAccessibleDescription(expect.stringContaining("That isn't a Jira Cloud site."));
  await expectNoAxeViolations(view.container);

  await user.type(site, "x");
  expect(jira().queryByRole("alert")).toBeNull();
});

test("Trello is signed in to with an API key and a token", async () => {
  const { user, opened, saved, view } = setUp();

  await user.click(await trello().findByRole("link", { name: /Get a Trello API key/ }));
  expect(opened).toEqual([TRELLO_KEY_PAGE]);
  expect(trello().getByLabelText("API key")).toHaveAttribute("type", "password");
  await user.type(trello().getByLabelText("API key"), "trello-key");
  await user.type(trello().getByLabelText("Token"), "good-token");
  await user.click(trello().getByRole("button", { name: "Save and check the Trello account" }));

  expect(await trello().findByText("Signed in to Trello as Grace Hopper.")).toBeVisible();
  expect(saved).toEqual([{ tracker: "trello", key: "trello-key", token: "good-token" }]);
  await expectNoAxeViolations(view.container);
});

test("an account already saved says who is signed in", async () => {
  setUp(
    fakeIssueTrackers({
      kept: { jira: { site: "lanewise.atlassian.net", email: "ada@example.com", name: "Ada Lovelace" } },
    }),
  );

  expect(await jira().findByText("Signed in to lanewise.atlassian.net as ada@example.com.")).toBeVisible();
  expect(await trello().findByLabelText("API key")).toBeVisible();
});
