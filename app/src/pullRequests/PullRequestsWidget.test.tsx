// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import type { PullRequest, PullRequestsRequest } from "../commands/api";
import { expectNoAxeViolations } from "../test/axe";
import { type FakeCommands, fakePlatform } from "../test/fakePlatform";
import { PullRequestsWidget } from "./PullRequestsWidget";
import { usePullRequests } from "./usePullRequests";

afterEach(cleanup);

const lanewise = { root: "/work/lanewise", name: "lanewise" };

const pull: PullRequest = {
  number: 42,
  title: "Mark Pull Requests in the Commit graph",
  url: "https://github.com/adrianeyre/lanewise/pull/42",
  author: "octocat",
  draft: false,
  head: { branch: "feature/pulls", commit: "a".repeat(40), repository: "adrianeyre/lanewise" },
  base: "main",
  updatedAt: null,
};

function Widget({ onShowCommit, commands }: { onShowCommit: (commit: string) => void; commands: ReturnType<typeof fakePlatform>["platform"]["commands"] }) {
  const pulls = usePullRequests(commands, lanewise);
  return <PullRequestsWidget pullRequests={pulls} onOpenLink={(url) => void links.push(url)} onShowCommit={onShowCommit} />;
}

let links: string[] = [];

function renderWidget(commands: FakeCommands) {
  links = [];
  const shown: string[] = [];
  const fake = fakePlatform({ commands });
  const view = render(
    <main>
      <Widget commands={fake.platform.commands} onShowCommit={(commit) => shown.push(commit)} />
    </main>,
  );
  return { fake, shown, ...view };
}

test("the open Pull Requests are listed by number and title, and a click opens one in the browser", async () => {
  const user = userEvent.setup();
  const { fake, shown, container } = renderWidget({
    pullRequests: () => ({ ok: true, value: { host: "github.com", integration: "github", pullRequests: [pull] } }),
  });
  const list = await screen.findByRole("list", { name: "Open Pull Requests on github.com" });
  expect(screen.getByRole("heading", { level: 3, name: "Pull requests" })).toBeVisible();
  expect(screen.getByText("1 open.")).toBeVisible();
  // Only a credential already kept is used as it loads: no browser opens to sign in.
  expect(fake.calls.filter((call) => call.name === "pullRequests").map((call) => call.request)).toEqual([
    { repository: lanewise.root, enterpriseHosts: [], interactive: false },
  ]);
  const open = within(list).getByRole("button", {
    name: /^#42 Mark Pull Requests in the Commit graph/,
  });
  await user.click(open);
  expect(links).toEqual([pull.url]);
  await user.click(within(list).getByRole("button", { name: "Show #42's branch in the Commit graph" }));
  expect(shown).toEqual([pull.head.commit]);
  await expectNoAxeViolations(container);
});

test("a private repository's Pull Requests are read once the user asks to sign in", async () => {
  const user = userEvent.setup();
  const { fake } = renderWidget({
    pullRequests: (request) =>
      request.interactive
        ? { ok: true, value: { host: "github.com", integration: "github", pullRequests: [] } }
        : { ok: false, error: { kind: "noCredential", host: "github.com", message: "" } },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("Sign in to github.com to see this repository's Pull Requests");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByText("No open Pull Requests on github.com.")).toBeVisible();
  await waitFor(() =>
    expect(fake.calls.filter((call) => call.name === "pullRequests").map((call) => (call.request as PullRequestsRequest).interactive)).toEqual([
      false,
      true,
    ]),
  );
});

test("a repository on no Host, or on one whose Pull Requests aren't read yet, says so without an alert", async () => {
  renderWidget({ pullRequests: () => ({ ok: false, error: { kind: "notOffered", host: "gitlab.com", tier: 2 } }) });
  expect(await screen.findByText("Lanewise reads Pull Requests from GitHub only, so far, not gitlab.com.")).toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull();
});
