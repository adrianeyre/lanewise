import { expect, test } from "vitest";

import type { HostError } from "../commands/api";
import { AUTHORIZE_TOKEN_URL, GCM_INSTALL_URL } from "../signIn/signInWords";
import { hostLabel, integrationFor } from "./browsableHosts";
import {
  AZURE_DEVOPS_TOKENS_URL,
  BITBUCKET_TOKENS_URL,
  explainHostError,
  explainMissingScopes,
  explainSsoLeftOut,
  GITHUB_TOKENS_URL,
  GITLAB_TOKENS_URL,
} from "./hostWords";

const host = "github.com";

const EVERY_ERROR: HostError[] = [
  { kind: "gitUnavailable" },
  { kind: "invalidHost", host: "bad host" },
  { kind: "notOffered", host: "gitlab.example.com", tier: 1 },
  { kind: "noCredential", host, message: "fatal: terminal prompts disabled" },
  { kind: "tokenRefused", host },
  { kind: "missingScope", host, needed: ["repo"] },
  { kind: "ssoNotAuthorized", host, url: null },
  { kind: "rateLimited", host, resetsAt: null },
  { kind: "notGitHub", host: "ghe.example.com" },
  { kind: "unreachable", host, message: "Connection refused" },
  { kind: "hostFailed", host, status: 502, message: "Server Error" },
  { kind: "invalidCursor" },
];

test("every Host error says what went wrong and what to do", () => {
  const unexplained = EVERY_ERROR.filter((error) => {
    const { said, steps } = explainHostError(error);
    return said === "" || steps.length === 0;
  });
  expect(unexplained).toEqual([]);
});

test("a token without a scope it needs names the scope, and offers to sign in afresh", () => {
  const help = explainHostError({ kind: "missingScope", host, needed: ["repo", "read:org"] });
  expect(help.said).toBe(
    "Your token for github.com lacks the repo scope or the read:org scope that listing your repositories needs, so github.com refused it.",
  );
  expect(help.signInAgain).toBe(true);
  expect(help.steps.join(" ")).toMatch(/repo scope.*fine-grained token, read access to Metadata and Contents/);
  expect(help.links.map(({ href }) => href)).toEqual([GITHUB_TOKENS_URL]);
  expect(explainHostError({ kind: "missingScope", host, needed: [] }).said).toMatch(/lacks a permission/);
  expect(explainHostError({ kind: "tokenRefused", host }).signInAgain).toBe(false);
});

test("no credential links to installing Git Credential Manager", () => {
  const help = explainHostError({ kind: "noCredential", host, message: "" });
  expect(help.said).toMatch(/Lanewise never asks for your password itself/);
  expect(help.links.map(({ href }) => href)).toEqual([GCM_INSTALL_URL]);
});

test("SSO links to where GitHub said to authorize the token, and to GitHub's instructions", () => {
  const url = "https://github.com/orgs/octo-org/sso?authorization_request=A1";
  expect(explainHostError({ kind: "ssoNotAuthorized", host, url }).links.map(({ href }) => href)).toEqual([
    url,
    AUTHORIZE_TOKEN_URL,
  ]);
  expect(explainHostError({ kind: "ssoNotAuthorized", host, url: null }).links.map(({ href }) => href)).toEqual([
    AUTHORIZE_TOKEN_URL,
  ]);
});

test("a rate limit says when to try again, if the Host said", () => {
  const resetsAt = Date.UTC(2026, 8, 29, 14, 5) / 1000;
  const time = new Date(resetsAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  expect(explainHostError({ kind: "rateLimited", host, resetsAt }).steps).toEqual([`Try again after ${time}.`]);
});

test("a token that lists only public repositories, and SSO that left some out, say what to do", () => {
  expect(explainMissingScopes(host, ["repo"]).said).toBe(
    "Your token for github.com lacks the repo scope, so only your public repositories are listed.",
  );
  expect(explainSsoLeftOut(host).said).toMatch(/their repositories aren't listed/);
});

test("each Host's token help names its own scopes and links to its own instructions", () => {
  const cases = [
    { host: "github.com", link: GITHUB_TOKENS_URL, step: /repo scope/ },
    { host: "github.example.com", link: GITHUB_TOKENS_URL, step: /repo scope/ },
    { host: "gitlab.com", link: GITLAB_TOKENS_URL, step: /read_api and read_user scopes/ },
    { host: "bitbucket.org", link: BITBUCKET_TOKENS_URL, step: /Account: Read and Repositories: Read permissions/ },
    { host: "dev.azure.com", link: AZURE_DEVOPS_TOKENS_URL, step: /Code \(Read\) and User Profile \(Read\) scopes/ },
    { host: "fabrikam.visualstudio.com", link: AZURE_DEVOPS_TOKENS_URL, step: /Code \(Read\)/ },
  ];
  for (const { host: on, link, step } of cases) {
    const missing = explainHostError({ kind: "missingScope", host: on, needed: [] });
    expect(missing.steps.join(" ")).toMatch(step);
    expect(missing.links.map(({ href }) => href)).toEqual([link]);
    expect(explainHostError({ kind: "tokenRefused", host: on }).links.map(({ href }) => href)).toEqual([link]);
    expect(explainMissingScopes(on, ["x"]).links.map(({ href }) => href)).toEqual([link]);
  }
  expect(explainHostError({ kind: "tokenRefused", host: "bitbucket.org" }).steps.join(" ")).toMatch(
    /If you signed in with an API token or app password/,
  );
});

function unreachable(on: string): string {
  return explainHostError({ kind: "unreachable", host: on, message: "Connection refused" }).steps.join(" ");
}

test("only a GitHub Enterprise Server is told its certificate must be trusted", () => {
  expect(unreachable("github.example.com")).toMatch(/GitHub Enterprise Server's certificate/);
  for (const on of ["github.com", "gitlab.com", "bitbucket.org", "dev.azure.com"]) {
    expect(unreachable(on)).not.toMatch(/certificate/);
  }
});

test("each Host is named in words, with its address", () => {
  const hosts = ["github.com", "gitlab.com", "bitbucket.org", "dev.azure.com", "fabrikam.visualstudio.com", "ghe.example.com"];
  expect(hosts.map(hostLabel)).toEqual([
    "GitHub.com (github.com)",
    "GitLab.com (gitlab.com)",
    "Bitbucket (bitbucket.org)",
    "Azure DevOps (dev.azure.com)",
    "Azure DevOps (fabrikam.visualstudio.com)",
    "GitHub Enterprise Server (ghe.example.com)",
  ]);
  expect(hosts.map(integrationFor)).toEqual(["github", "gitLab", "bitbucket", "azureDevOps", "azureDevOps", "github"]);
});
