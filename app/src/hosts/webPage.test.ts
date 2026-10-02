import { expect, test } from "vitest";

import { isHostPage, webPageOf } from "./webPage";

test("a remote's HTTPS, SSH or scp-like URL is its repository's page on its Host, without credentials or .git", () => {
  expect(webPageOf("https://github.com/adrianeyre/lanewise.git")).toEqual({
    url: "https://github.com/adrianeyre/lanewise",
    integration: "github",
  });
  expect(webPageOf("https://octocat:token@github.com/adrianeyre/lanewise/")?.url).toBe(
    "https://github.com/adrianeyre/lanewise",
  );
  expect(webPageOf("git@github.com:adrianeyre/lanewise.git")?.url).toBe("https://github.com/adrianeyre/lanewise");
  expect(webPageOf("ssh://git@ssh.github.com:443/adrianeyre/lanewise.git")?.url).toBe(
    "https://github.com/adrianeyre/lanewise",
  );
  expect(webPageOf("git@gitlab.com:gitlab-org/gitlab.git")).toEqual({
    url: "https://gitlab.com/gitlab-org/gitlab",
    integration: "gitLab",
  });
  expect(webPageOf("https://bitbucket.org/atlassian/lanewise.git")?.integration).toBe("bitbucket");
  expect(webPageOf("https://git.example.com/team/lanewise.git")).toEqual({
    url: "https://git.example.com/team/lanewise",
    integration: "generic",
  });
});

test("Azure DevOps' SSH URL is its repository's _git page", () => {
  expect(webPageOf("git@ssh.dev.azure.com:v3/fabrikam/Web/lanewise")).toEqual({
    url: "https://dev.azure.com/fabrikam/Web/_git/lanewise",
    integration: "azureDevOps",
  });
  expect(webPageOf("https://fabrikam@dev.azure.com/fabrikam/Web/_git/lanewise")?.url).toBe(
    "https://dev.azure.com/fabrikam/Web/_git/lanewise",
  );
});

test("a local path, a file URL or no URL has no page", () => {
  expect(webPageOf(null)).toBeNull();
  expect(webPageOf("/work/lanewise")).toBeNull();
  expect(webPageOf("C:\\work\\lanewise")).toBeNull();
  expect(webPageOf("file:///work/lanewise")).toBeNull();
  expect(webPageOf("https://github.com/")).toBeNull();
});

test("a Host's own pages are Host pages, to show in a Tab, but its documentation and other sites aren't", () => {
  expect(isHostPage("https://github.com/adrianeyre/lanewise/pull/42")).toBe(true);
  expect(isHostPage("https://www.github.com/adrianeyre")).toBe(true);
  expect(isHostPage("https://gitlab.com/gitlab-org/gitlab/-/merge_requests/1")).toBe(true);
  expect(isHostPage("https://bitbucket.org/atlassian/lanewise")).toBe(true);
  expect(isHostPage("https://dev.azure.com/fabrikam/Web/_git/lanewise")).toBe(true);
  expect(isHostPage("https://fabrikam.visualstudio.com/Web")).toBe(true);
  expect(isHostPage("https://ghe.example.com/team/lanewise")).toBe(false);
  expect(isHostPage("https://ghe.example.com/team/lanewise", ["ghe.example.com"])).toBe(true);
  expect(isHostPage("https://docs.github.com/en/authentication")).toBe(false);
  expect(isHostPage("https://git-scm.com/downloads")).toBe(false);
  expect(isHostPage("http://github.com/adrianeyre/lanewise")).toBe(false);
  expect(isHostPage("not a link")).toBe(false);
});
