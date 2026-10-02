// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "../App";
import type {
  Cursor,
  HostError,
  HostRepositoriesRequest,
  HostRepository,
  Outcome,
  SignInToHostRequest,
} from "../commands/api";
import { ENTERPRISE_HOSTS_KEY } from "../settings/localSettings";
import { GCM_INSTALL_URL } from "../signIn/signInWords";
import { expectNoAxeViolations } from "../test/axe";
import { type FakeCommands, fakePlatform } from "../test/fakePlatform";
import { GITHUB_TOKENS_URL, GITLAB_TOKENS_URL } from "./hostWords";

/** A repository listed, to choose, rather than its "Open repository". */
const CHOOSE = /^(?!Open repository )/;

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function repository(fullName: string, extra: Partial<HostRepository> = {}): HostRepository {
  return {
    fullName,
    description: null,
    private: false,
    fork: false,
    archived: false,
    cloneUrl: `https://github.com/${fullName}.git`,
    sshUrl: `git@github.com:${fullName}.git`,
    ...extra,
  };
}

const REPOSITORIES = [
  repository("adrianeyre/lanewise", { description: "A Git client with a visual commit graph" }),
  repository("adrianeyre/soundcheck", { private: true }),
  repository("octo-org/hello-world", { fork: true, archived: true }),
];

/**
 * A GitHub for Browse repositories: `signInToHost` signs in as octocat,
 * lacking `missingScopes`, and `hostRepositories` lists `repositories`,
 * searched by name, `limit` at a time, with each cursor the index to go on from.
 */
function github({
  repositories = REPOSITORIES,
  missingScopes = [],
  signIn,
  list,
}: {
  repositories?: HostRepository[];
  missingScopes?: string[];
  signIn?: (request: SignInToHostRequest) => HostError | null;
  list?: (request: HostRepositoriesRequest) => HostError | null;
} = {}): { commands: FakeCommands; signIns: SignInToHostRequest[]; lists: HostRepositoriesRequest[] } {
  const signIns: SignInToHostRequest[] = [];
  const lists: HostRepositoriesRequest[] = [];
  return {
    signIns,
    lists,
    commands: {
      signInToHost: (request): Outcome<"signInToHost"> => {
        signIns.push(request);
        const error = signIn?.(request) ?? null;
        if (error !== null) return { ok: false, error };
        return { ok: true, value: { host: request.host, login: "octocat", name: "The Octocat", missingScopes } };
      },
      hostRepositories: (request): Outcome<"hostRepositories"> => {
        lists.push(request);
        const error = list?.(request) ?? null;
        if (error !== null) return { ok: false, error };
        const words = (request.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        const found = repositories.filter(
          (each) =>
            words.every((word) => each.fullName.includes(word)) &&
            (request.owner == null || each.fullName.startsWith(`${request.owner}/`)),
        );
        const start = Number(request.page?.cursor ?? 0);
        const end = start + (request.page?.limit ?? 200);
        return {
          ok: true,
          value: {
            items: found.slice(start, end),
            nextCursor: end < found.length ? (String(end) as Cursor) : null,
            missingScopes,
            ssoLeftOut: false,
          },
        };
      },
    },
  };
}

async function openBrowse(user: ReturnType<typeof userEvent.setup>) {
  const section = await screen.findByRole("region", { name: "Clone a repository" });
  await user.click(within(section).getByRole("button", { name: "Browse repositories…" }));
  return { section, dialog: screen.getByRole("dialog", { name: "Browse repositories" }) };
}

test("Browse repositories signs in to GitHub.com with the credential helper, lists the repositories, and fills the Clone form in with the one chosen", async () => {
  const user = userEvent.setup();
  const host = github();
  const fake = fakePlatform({ commands: host.commands });
  const { container } = render(<App platform={fake.platform} />);

  const { section, dialog } = await openBrowse(user);
  expect(within(dialog).getByRole("combobox", { name: "Host" })).toHaveValue("github.com");
  expect(dialog).toHaveTextContent("Lanewise never sees your password, and doesn't keep the token.");
  const signIn = within(dialog).getByRole("button", { name: "Sign in to github.com" });
  expect(signIn).toHaveFocus();
  await expectNoAxeViolations(container);

  await user.keyboard("{Enter}");

  expect(host.signIns).toEqual([{ host: "github.com", enterpriseHosts: [], again: false }]);
  expect(await within(dialog).findByText(/Signed in to github.com as/)).toHaveTextContent(
    "Signed in to github.com as octocat (The Octocat).",
  );
  expect(within(dialog).getByRole("searchbox", { name: "Search repositories" })).toHaveFocus();
  const list = await within(dialog).findByRole("list", { name: "Repositories on github.com" });
  expect(within(list).getAllByRole("button", { name: CHOOSE }).map((button) => button.textContent)).toEqual([
    "adrianeyre/lanewise",
    "adrianeyre/soundcheck",
    "octo-org/hello-world",
  ]);
  expect(within(list).getByRole("button", { name: "adrianeyre/lanewise" })).toHaveAccessibleDescription(
    "Public. A Git client with a visual commit graph",
  );
  expect(within(list).getByRole("button", { name: "octo-org/hello-world" })).toHaveAccessibleDescription(
    "Public · Fork · Archived",
  );
  // Each opens its page on its Host in the browser, too, never in Lanewise.
  await user.click(within(list).getByRole("button", { name: "Open repository adrianeyre/lanewise on GitHub" }));
  expect(fake.links).toEqual(["https://github.com/adrianeyre/lanewise"]);
  expect(screen.getByText("3 repositories listed.")).toHaveAttribute("role", "status");
  expect(host.lists).toEqual([
    { host: "github.com", enterpriseHosts: [], query: "", page: { cursor: null, limit: 30 } },
  ]);
  await expectNoAxeViolations(container);

  await user.click(within(list).getByRole("button", { name: "adrianeyre/soundcheck" }));

  expect(screen.queryByRole("dialog", { name: "Browse repositories" })).not.toBeInTheDocument();
  expect(within(section).getByRole("textbox", { name: "Repository URL" })).toHaveValue(
    "https://github.com/adrianeyre/soundcheck.git",
  );
  expect(within(section).getByRole("textbox", { name: "Folder name" })).toHaveValue("soundcheck");

  // Signed in still, for this run: it lists again at once, and clones over SSH if asked.
  await openBrowse(user);
  const again = screen.getByRole("dialog", { name: "Browse repositories" });
  expect(within(again).getByRole("searchbox", { name: "Search repositories" })).toHaveFocus();
  await user.click(within(again).getByRole("radio", { name: "SSH, with your SSH key" }));
  await user.click(await within(again).findByRole("button", { name: "octo-org/hello-world" }));
  expect(within(section).getByRole("textbox", { name: "Repository URL" })).toHaveValue(
    "git@github.com:octo-org/hello-world.git",
  );
  expect(host.signIns).toHaveLength(1);
});

test("the repositories are searched, and shown a page at a time", async () => {
  const user = userEvent.setup();
  const many = Array.from({ length: 45 }, (_, n) => repository(`octocat/repo-${String(n).padStart(2, "0")}`));
  const host = github({ repositories: [...many, repository("octocat/lanewise")] });
  render(<App platform={fakePlatform({ commands: host.commands }).platform} />);
  const { dialog } = await openBrowse(user);
  await user.click(within(dialog).getByRole("button", { name: "Sign in to github.com" }));

  const list = await within(dialog).findByRole("list", { name: "Repositories on github.com" });
  expect(within(list).getAllByRole("button", { name: CHOOSE })).toHaveLength(30);
  expect(screen.getByText("30 repositories listed, with more to show.")).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Show more" }));

  expect(await within(list).findByRole("button", { name: "octocat/repo-30" })).toHaveFocus();
  expect(within(list).getAllByRole("button", { name: CHOOSE })).toHaveLength(46);
  expect(within(dialog).queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  expect(host.lists.at(-1)?.page).toEqual({ cursor: "30", limit: 30 });

  await user.type(within(dialog).getByRole("searchbox", { name: "Search repositories" }), "lanewise{Enter}");

  expect(await screen.findByText("1 repository matching “lanewise” listed.")).toBeInTheDocument();
  expect(within(list).getAllByRole("button", { name: CHOOSE }).map((button) => button.textContent)).toEqual(["octocat/lanewise"]);
  expect(host.lists.at(-1)).toMatchObject({ query: "lanewise", page: { cursor: null } });

  await user.clear(within(dialog).getByRole("searchbox", { name: "Search repositories" }));
  await user.type(within(dialog).getByRole("searchbox", { name: "Search repositories" }), "nothing{Enter}");
  expect(
    await within(dialog).findByText("No repositories matching “nothing”.", { selector: ".surface-note" }),
  ).toBeInTheDocument();
});

test("GitHub's organizations are shown with the user, and choosing one lists only the repositories it owns", async () => {
  const user = userEvent.setup();
  const host = github();
  const owners: string[] = [];
  const { container } = render(
    <App
      platform={
        fakePlatform({
          commands: {
            ...host.commands,
            hostOwners: (request) => {
              owners.push(request.host);
              return { ok: true, value: { owners: ["octocat", "adrianeyre", "octo-org"] } };
            },
          },
        }).platform
      }
    />,
  );
  const { dialog } = await openBrowse(user);
  await user.click(within(dialog).getByRole("button", { name: "Sign in to github.com" }));
  const list = await within(dialog).findByRole("list", { name: "Repositories on github.com" });

  const group = await within(dialog).findByRole("group", { name: "Owner" });
  expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual([
    "Everyone",
    "octocat (you)",
    "adrianeyre",
    "octo-org",
  ]);
  expect(within(group).getByRole("button", { name: "Everyone" })).toHaveAttribute("aria-pressed", "true");
  expect(owners).toEqual(["github.com"]);
  await expectNoAxeViolations(container);

  await user.click(within(group).getByRole("button", { name: "octo-org" }));

  expect(await screen.findByText("1 repository owned by octo-org listed.")).toBeInTheDocument();
  expect(within(list).getAllByRole("button", { name: CHOOSE }).map((button) => button.textContent)).toEqual(["octo-org/hello-world"]);
  expect(within(group).getByRole("button", { name: "octo-org" })).toHaveAttribute("aria-pressed", "true");
  expect(host.lists.at(-1)).toMatchObject({ owner: "octo-org", query: "", page: { cursor: null } });

  // A search keeps to the owner chosen, until Everyone is.
  await user.type(within(dialog).getByRole("searchbox", { name: "Search repositories" }), "lane{Enter}");
  expect(await screen.findByText("No repositories owned by octo-org matching “lane”.", { selector: ".surface-note" })).toBeInTheDocument();
  await user.click(within(group).getByRole("button", { name: "Everyone" }));
  expect(await screen.findByText("1 repository matching “lane” listed.")).toBeInTheDocument();
  expect(host.lists.at(-1)).not.toHaveProperty("owner");
});

test("a token without the repo scope says so, and signs in afresh when asked", async () => {
  const user = userEvent.setup();
  const fake = github({ missingScopes: ["repo"] });
  const fakeWithLinks = fakePlatform({ commands: fake.commands });
  const { container } = render(<App platform={fakeWithLinks.platform} />);
  const { dialog } = await openBrowse(user);
  await user.click(within(dialog).getByRole("button", { name: "Sign in to github.com" }));

  expect(
    await within(dialog).findByText(
      "Your token for github.com lacks the repo scope, so only your public repositories are listed.",
    ),
  ).toBeInTheDocument();
  await expectNoAxeViolations(container);
  await user.click(within(dialog).getByRole("link", { name: /Managing your personal access tokens/ }));
  expect(fakeWithLinks.links).toEqual([GITHUB_TOKENS_URL]);

  await user.click(within(dialog).getByRole("button", { name: "Forget this token and sign in again" }));

  expect(fake.signIns.map(({ again }) => again)).toEqual([false, true]);
});

test("a refused scope is explained in an alert, with sign in afresh", async () => {
  const user = userEvent.setup();
  const fake = github({
    list: ({ page }) => (page?.cursor === null ? { kind: "missingScope", host: "github.com", needed: ["repo"] } : null),
  });
  render(<App platform={fakePlatform({ commands: fake.commands }).platform} />);
  const { dialog } = await openBrowse(user);
  await user.click(within(dialog).getByRole("button", { name: "Sign in to github.com" }));

  const alert = await within(dialog).findByRole("alert");
  expect(alert).toHaveTextContent(/lacks the repo scope that listing your repositories needs/);
  await user.click(within(alert).getByRole("button", { name: "Forget this token and sign in again" }));
  expect(fake.signIns.at(-1)).toEqual({ host: "github.com", enterpriseHosts: [], again: true });
});

test("with no credential helper, signing in says to install Git Credential Manager, and what Git said", async () => {
  const user = userEvent.setup();
  const fake = github({
    signIn: ({ host }) => ({ kind: "noCredential", host, message: "fatal: could not read Username: terminal prompts disabled" }),
  });
  const { container } = render(<App platform={fakePlatform({ commands: fake.commands }).platform} />);
  const { dialog } = await openBrowse(user);
  await user.click(within(dialog).getByRole("button", { name: "Sign in to github.com" }));

  const alert = await within(dialog).findByRole("alert");
  expect(alert).toHaveTextContent(/No credential helper gave Lanewise a credential for github.com/);
  expect(within(alert).getByRole("link", { name: /Installing Git Credential Manager/ })).toHaveAttribute(
    "href",
    GCM_INSTALL_URL,
  );
  expect(within(alert).getByText("What Git said")).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Sign in to github.com" })).toBeInTheDocument();
  await expectNoAxeViolations(container);
});

test("a token the Host refuses while listing signs out, so it can be signed in to again", async () => {
  const user = userEvent.setup();
  const fake = github({ list: ({ host }) => ({ kind: "tokenRefused", host }) });
  render(<App platform={fakePlatform({ commands: fake.commands }).platform} />);
  const { dialog } = await openBrowse(user);
  await user.click(within(dialog).getByRole("button", { name: "Sign in to github.com" }));

  expect(await within(dialog).findByRole("alert")).toHaveTextContent(/github.com refused the token/);
  expect(within(dialog).getByRole("button", { name: "Sign in to github.com" })).toBeInTheDocument();
});

test("a GitHub Enterprise Server added in Settings can be browsed, and is chosen from the Clone form's URL", async () => {
  localStorage.setItem(ENTERPRISE_HOSTS_KEY, JSON.stringify(["github.example.com"]));
  const user = userEvent.setup();
  const fake = github();
  const detected: string[] = [];
  const platform = fakePlatform({
    commands: {
      ...fake.commands,
      detectHost: ({ url, enterpriseHosts }): Outcome<"detectHost"> => {
        detected.push(url);
        expect(enterpriseHosts).toEqual(["github.example.com"]);
        return { ok: true, value: { host: "github.example.com", integration: "github", tier: 2 } };
      },
    },
  }).platform;
  render(<App platform={platform} />);
  const section = await screen.findByRole("region", { name: "Clone a repository" });
  await user.type(within(section).getByRole("textbox", { name: "Repository URL" }), "https://github.example.com/o/r");

  const { dialog } = await openBrowse(user);

  const choice = within(dialog).getByRole("combobox", { name: "Host" });
  expect(within(choice).getAllByRole("option").map((option) => option.textContent)).toEqual([
    "GitHub.com (github.com)",
    "GitLab.com (gitlab.com)",
    "Bitbucket (bitbucket.org)",
    "Azure DevOps (dev.azure.com)",
    "GitHub Enterprise Server (github.example.com)",
  ]);
  expect(await within(dialog).findByRole("button", { name: "Sign in to github.example.com" })).toBeInTheDocument();
  expect(choice).toHaveValue("github.example.com");
  expect(detected).toEqual(["https://github.example.com/o/r"]);
  await user.click(within(dialog).getByRole("button", { name: "Sign in to github.example.com" }));
  expect(fake.signIns).toEqual([{ host: "github.example.com", enterpriseHosts: ["github.example.com"], again: false }]);
  await within(dialog).findByRole("list", { name: "Repositories on github.example.com" });

  await user.selectOptions(choice, "GitHub.com (github.com)");
  expect(within(dialog).getByRole("button", { name: "Sign in to github.com" })).toBeInTheDocument();
});

test("GitLab.com is chosen from the Clone form's URL, signed in to, and its refusals point to GitLab's own help", async () => {
  const user = userEvent.setup();
  const fake = github({
    repositories: [repository("gitlab-org/gitlab", { cloneUrl: "https://gitlab.com/gitlab-org/gitlab.git" })],
    list: ({ query }) => (query === "denied" ? { kind: "missingScope", host: "gitlab.com", needed: ["read_api"] } : null),
  });
  const opened = fakePlatform({
    commands: {
      ...fake.commands,
      detectHost: (): Outcome<"detectHost"> => ({
        ok: true,
        value: { host: "gitlab.com", integration: "gitLab", tier: 2 },
      }),
    },
  });
  const { container } = render(<App platform={opened.platform} />);
  const section = await screen.findByRole("region", { name: "Clone a repository" });
  await user.type(within(section).getByRole("textbox", { name: "Repository URL" }), "git@gitlab.com:gitlab-org/gitlab.git");

  const { dialog } = await openBrowse(user);

  const signIn = await within(dialog).findByRole("button", { name: "Sign in to gitlab.com" });
  expect(within(dialog).getByRole("combobox", { name: "Host" })).toHaveValue("gitlab.com");
  await expectNoAxeViolations(container);
  await user.click(signIn);
  expect(fake.signIns).toEqual([{ host: "gitlab.com", enterpriseHosts: [], again: false }]);
  const list = await within(dialog).findByRole("list", { name: "Repositories on gitlab.com" });
  expect(within(list).getAllByRole("button", { name: CHOOSE }).map((button) => button.textContent)).toEqual(["gitlab-org/gitlab"]);

  await user.type(within(dialog).getByRole("searchbox", { name: "Search repositories" }), "denied{Enter}");

  const alert = await within(dialog).findByRole("alert");
  expect(alert).toHaveTextContent(/lacks the read_api scope that listing your repositories needs/);
  expect(alert).toHaveTextContent(/give it the read_api and read_user scopes/);
  await user.click(within(alert).getByRole("link", { name: /GitLab's personal access tokens/ }));
  expect(opened.links).toEqual([GITLAB_TOKENS_URL]);
  await expectNoAxeViolations(container);
});

test("an Azure DevOps organization's own Host, from the Clone form's URL, is offered and chosen", async () => {
  const user = userEvent.setup();
  const fake = github();
  const platform = fakePlatform({
    commands: {
      ...fake.commands,
      detectHost: (): Outcome<"detectHost"> => ({
        ok: true,
        value: { host: "fabrikam.visualstudio.com", integration: "azureDevOps", tier: 2 },
      }),
    },
  }).platform;
  const { container } = render(<App platform={platform} />);
  const section = await screen.findByRole("region", { name: "Clone a repository" });
  await user.type(
    within(section).getByRole("textbox", { name: "Repository URL" }),
    "https://fabrikam.visualstudio.com/Web/_git/lanewise",
  );

  const { dialog } = await openBrowse(user);

  expect(await within(dialog).findByRole("button", { name: "Sign in to fabrikam.visualstudio.com" })).toBeInTheDocument();
  const choice = within(dialog).getByRole("combobox", { name: "Host" });
  expect(choice).toHaveValue("fabrikam.visualstudio.com");
  expect(within(choice).getAllByRole("option").map((option) => option.textContent)).toContain(
    "Azure DevOps (fabrikam.visualstudio.com)",
  );
  await expectNoAxeViolations(container);

  await user.selectOptions(choice, "Bitbucket (bitbucket.org)");
  expect(within(dialog).getByRole("button", { name: "Sign in to bitbucket.org" })).toBeInTheDocument();
});
