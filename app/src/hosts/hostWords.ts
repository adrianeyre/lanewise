import type { HostError } from "../commands/api";
import { AUTHORIZE_APPS_URL, AUTHORIZE_TOKEN_URL, GCM_INSTALL_URL, type SignInHelp } from "../signIn/signInWords";
import { GITHUB_COM } from "./enterpriseHosts";
import { integrationFor, type TierTwoIntegration } from "./browsableHosts";

/** GitHub's instructions for making and changing personal access tokens, and their scopes. */
export const GITHUB_TOKENS_URL =
  "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens";

/** GitLab's instructions for personal access tokens, and their scopes. */
export const GITLAB_TOKENS_URL = "https://docs.gitlab.com/user/profile/personal_access_tokens/";

/** Bitbucket Cloud's instructions for API tokens, and their permissions. */
export const BITBUCKET_TOKENS_URL = "https://support.atlassian.com/bitbucket-cloud/docs/api-tokens/";

/** Azure DevOps's instructions for personal access tokens, and their scopes. */
export const AZURE_DEVOPS_TOKENS_URL =
  "https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate";

const INSTALL_GCM = { href: GCM_INSTALL_URL, text: "Installing Git Credential Manager" };

/** What a Host Integration's Host calls a token the user makes, what it needs to list repositories, and where the Host says how. */
interface TokenWords {
  /** Such as "a personal access token". */
  token: string;
  /** What to do for a token without the scopes or permissions to list repositories. */
  scopeStep: string;
  link: SignInHelp["links"][number];
}

const TOKEN_WORDS: Record<TierTwoIntegration, TokenWords> = {
  github: {
    token: "a personal access token",
    scopeStep:
      "If you signed in with a personal access token, give it the repo scope, or for a fine-grained token, read access to Metadata and Contents, then sign in again.",
    link: { href: GITHUB_TOKENS_URL, text: "Managing your personal access tokens" },
  },
  gitLab: {
    token: "a personal access token",
    scopeStep:
      "If you signed in with a personal access token, give it the read_api and read_user scopes, then sign in again.",
    link: { href: GITLAB_TOKENS_URL, text: "GitLab's personal access tokens" },
  },
  bitbucket: {
    token: "an API token or app password",
    scopeStep:
      "If you signed in with an API token or app password, give it the Account: Read and Repositories: Read permissions, then sign in again.",
    link: { href: BITBUCKET_TOKENS_URL, text: "Bitbucket's API tokens" },
  },
  azureDevOps: {
    token: "a personal access token",
    scopeStep:
      "If you signed in with a personal access token, give it the Code (Read) and User Profile (Read) scopes, then sign in again.",
    link: { href: AZURE_DEVOPS_TOKENS_URL, text: "Azure DevOps's personal access tokens" },
  },
};

/** A Host error explained, and whether signing in again, afresh, is the fix. */
export interface HostHelp extends SignInHelp {
  /** Offer to forget the credential helper's token for the Host, and sign in afresh. */
  signInAgain: boolean;
}

function scopes(needed: readonly string[]): string {
  if (needed.length === 0) return "a permission";
  const named = needed.map((scope) => `the ${scope} scope`);
  return named.length === 1 ? named[0]! : `${named.slice(0, -1).join(", ")} or ${named.at(-1)!}`;
}

/** When a rate limit ends, in the user's own time, such as "14:05". */
function resetTime(resetsAt: number): string {
  return new Date(resetsAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function help(said: string, steps: string[], links: SignInHelp["links"] = [], signInAgain = false): HostHelp {
  return { said, steps, links, signInAgain };
}

/** Why a Host Integration couldn't sign in, or list repositories, with how to fix it. */
export function explainHostError(error: HostError): HostHelp {
  switch (error.kind) {
    case "gitUnavailable":
      return help("There's no Git that Lanewise can ask for your credential.", [
        "Install Git 2.40 or later, as the Git Setup screen says, then sign in again.",
      ]);
    case "invalidHost":
      return help(`“${error.host}” isn't a Host's address.`, [
        "Check the GitHub Enterprise Server's address in Settings, and add it again if it's wrong.",
      ]);
    case "notOffered":
      return help(`Lanewise can't sign in to ${error.host} itself, or list its repositories.`, [
        "Enter the repository's URL instead: Git signs in to the Host with your credential helper or SSH key as it clones.",
      ]);
    case "noCredential":
      return help(
        `No credential helper gave Lanewise a credential for ${error.host}: none is set up, or signing in was cancelled. Lanewise never asks for your password itself.`,
        [
          "Install Git Credential Manager, which signs you in through your browser and keeps the token in your system's own store. Git for Windows comes with it.",
          "Sign in again, and finish signing in in the browser window it opens.",
        ],
        [INSTALL_GCM],
      );
    case "tokenRefused": {
      const words = TOKEN_WORDS[integrationFor(error.host)];
      return help(
        `${error.host} refused the token your credential helper gave, so the helper was told to forget it.`,
        [
          "Sign in again: Git Credential Manager asks you to sign in afresh, in your browser.",
          `If you signed in with ${words.token}, check it hasn't expired or been revoked, or make a new one.`,
        ],
        [words.link],
      );
    }
    case "missingScope": {
      const words = TOKEN_WORDS[integrationFor(error.host)];
      return help(
        `Your token for ${error.host} lacks ${scopes(error.needed)} that listing your repositories needs, so ${error.host} refused it.`,
        [
          "Forget this token and sign in again: Git Credential Manager asks you to sign in afresh, and its new token has the scopes it asks for.",
          words.scopeStep,
        ],
        [words.link],
        true,
      );
    }
    case "ssoNotAuthorized":
      return help(
        `An organization on ${error.host} uses SAML single sign-on (SSO), and your token hasn't been authorized for it, so ${error.host} refused it.`,
        [
          error.url === null
            ? "In your browser, sign in to the organization through its SSO, and authorize the token for it."
            : "Authorize the token for the organization's SSO, at the link below, signing in through its SSO if you're asked to.",
          "Then sign in again.",
        ],
        [
          ...(error.url === null ? [] : [{ href: error.url, text: "Authorize your token for the organization's SSO" }]),
          { href: AUTHORIZE_TOKEN_URL, text: "Authorizing a personal access token for use with SSO" },
        ],
      );
    case "rateLimited":
      return help(`${error.host} has had too many requests from you for now.`, [
        error.resetsAt === null ? "Try again in a few minutes." : `Try again after ${resetTime(error.resetsAt)}.`,
      ]);
    case "notGitHub":
      return help(
        `${error.host} isn't a GitHub Enterprise Server: GitHub's API isn't at https://${error.host}/api/v3.`,
        [
          "In Settings, remove it, and add the address you sign in to GitHub Enterprise Server at in your browser, such as https://github.example.com.",
        ],
      );
    case "unreachable":
      return help(`Lanewise couldn't reach ${error.host}: ${error.message}`, [
        "Check your network connection, and any proxy you use.",
        integrationFor(error.host) === "github" && error.host !== GITHUB_COM
          ? "A GitHub Enterprise Server's certificate must be one your operating system trusts. Then try again."
          : "Then try again.",
      ]);
    case "hostFailed":
      return help(`${error.host} answered with an error (${error.status}): ${error.message}`, ["Try again in a while."]);
    case "invalidCursor":
      return help("The list of repositories changed while you were reading it.", [
        "Search again, to start the list from the top.",
      ]);
  }
}

/** What a signed-in token that lacks `missing` scopes can't do, and what to do about it. */
export function explainMissingScopes(host: string, missing: readonly string[]): SignInHelp {
  const words = TOKEN_WORDS[integrationFor(host)];
  return {
    said: `Your token for ${host} lacks ${scopes(missing)}, so only your public repositories are listed.`,
    steps: ["Forget this token and sign in again: Git Credential Manager asks you to sign in afresh.", words.scopeStep],
    links: [words.link],
  };
}

/** Why some of an organization's repositories weren't listed, and what to do about it. */
export function explainSsoLeftOut(host: string): SignInHelp {
  return {
    said: `Some organizations on ${host} use SAML single sign-on (SSO), and haven't authorized your token, so their repositories aren't listed.`,
    steps: [
      "In your browser, sign in to each organization through its SSO.",
      "If you signed in with Git Credential Manager, sign in again once you have. If you use a personal access token, authorize it for each organization's SSO.",
    ],
    links: [
      { href: AUTHORIZE_APPS_URL, text: "About OAuth apps, GitHub Apps and SSO" },
      { href: AUTHORIZE_TOKEN_URL, text: "Authorizing a personal access token for use with SSO" },
    ],
  };
}
