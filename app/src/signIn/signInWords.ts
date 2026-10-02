import type { SignInFailure, SsoCredential } from "../commands/api";

/** A link to a Host's own instructions for fixing a Sign-in Failure. */
export interface SignInLink {
  href: string;
  text: string;
}

/** A Sign-in Failure explained: what went wrong, how to fix it, and where the Host says more. */
export interface SignInHelp {
  /** Why Git couldn't sign in, in a sentence or two. */
  said: string;
  /** What to do about it, in order. */
  steps: string[];
  links: SignInLink[];
}

const GITHUB_SSO_DOCS = "https://docs.github.com/en/enterprise-cloud@latest/authentication/authenticating-with-single-sign-on";

/** GitHub's instructions for authorizing a personal access token for an organization's SSO. */
export const AUTHORIZE_TOKEN_URL = `${GITHUB_SSO_DOCS}/authorizing-a-personal-access-token-for-use-with-single-sign-on`;
/** GitHub's instructions for authorizing an SSH key for an organization's SSO. */
export const AUTHORIZE_SSH_KEY_URL = `${GITHUB_SSO_DOCS}/authorizing-an-ssh-key-for-use-with-single-sign-on`;
/** GitHub's account of how OAuth apps and GitHub Apps are authorized for an organization's SSO. */
export const AUTHORIZE_APPS_URL = `${GITHUB_SSO_DOCS}/about-authentication-with-single-sign-on#about-oauth-apps-github-apps-and-sso`;
/** GitHub's own SSH host key fingerprints. */
export const GITHUB_FINGERPRINTS_URL =
  "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints";
/** GitHub's instructions for adding an SSH key to an account. */
export const GITHUB_ADD_SSH_KEY_URL =
  "https://docs.github.com/en/authentication/connecting-to-github-with-ssh/adding-a-new-ssh-key-to-your-github-account";
/** How to install Git Credential Manager, as the Git setup screen links to it. */
export const GCM_INSTALL_URL = "https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/install.md";

/** The Host a Sign-in Failure was with, in a sentence: `github.com`, or "the Host". */
function hostName(host: string | null): string {
  return host ?? "the Host";
}

/** Whether `host` is, or could be, GitHub's, so its own instructions apply. */
function mayBeGitHub(host: string | null): boolean {
  return host === null || host.includes("github");
}

/** How to try SSH to `host` in a terminal, or to the Host in the remote's URL if Git didn't say which. */
function sshTest(host: string | null): string {
  return host === null ? "ssh -T and the user and host in the remote's URL, such as ssh -T git@github.com" : `ssh -T git@${host}`;
}

/** Who Git couldn't sign in to, in "Git couldn't sign in to …". */
export function signedInTo(failure: SignInFailure): string {
  return failure.kind === "ssoNotAuthorized" ? "GitHub" : hostName(failure.host);
}

/** What GitHub's SSO hasn't authorized, in "your … hasn't been authorized". */
function credentialWords(credential: SsoCredential): string {
  switch (credential.kind) {
    case "token":
      return "personal access token";
    case "sshKey":
      return "SSH key";
    case "oauthApp":
    case "githubApp": {
      const app = credential.kind === "oauthApp" ? "the OAuth app" : "the GitHub App";
      return credential.name === null ? `${app} you signed in with` : `${app} you signed in with, ${credential.name},`;
    }
  }
}

/** A Sign-in Failure, explained with how to fix it. */
export function explainSignInFailure(failure: SignInFailure): SignInHelp {
  switch (failure.kind) {
    case "ssoNotAuthorized": {
      const organization =
        failure.organization === null ? "the organization" : `the ${failure.organization} organization`;
      const Organization = organization.charAt(0).toUpperCase() + organization.slice(1);
      const { credential } = failure;
      const yours = credential.kind === "token" || credential.kind === "sshKey" ? "your " : "";
      const said = `${Organization} uses SAML single sign-on (SSO), and ${yours}${credentialWords(credential)} hasn't been authorized for it, so GitHub refused it.`;
      switch (credential.kind) {
        case "token":
          return {
            said,
            steps: [
              "On GitHub, open Settings, then Developer settings, then Personal access tokens.",
              `Next to the token, choose Configure SSO, then Authorize next to ${organization}, signing in through its SSO if you're asked to.`,
              "Try again. If your credential helper has a different token saved, remove it, so it asks for the new one.",
            ],
            links: [{ href: AUTHORIZE_TOKEN_URL, text: "Authorizing a personal access token for use with SSO" }],
          };
        case "sshKey":
          return {
            said,
            steps: [
              "On GitHub, open Settings, then SSH and GPG keys.",
              `Next to the key, choose Configure SSO, then Authorize next to ${organization}, signing in through its SSO if you're asked to.`,
              "Try again.",
            ],
            links: [{ href: AUTHORIZE_SSH_KEY_URL, text: "Authorizing an SSH key for use with SSO" }],
          };
        case "oauthApp":
        case "githubApp": {
          const apps = credential.kind === "oauthApp" ? "Authorized OAuth Apps" : "Authorized GitHub Apps";
          const app = credential.name ?? "the app";
          return {
            said,
            steps: [
              `In your browser, sign in to ${organization} through its SSO.`,
              `On GitHub, open Settings, then Applications, then ${apps}, and revoke ${app}.`,
              "Try again, and sign in again when your credential helper asks: it authorizes the app for the organization as you do.",
            ],
            links: [{ href: AUTHORIZE_APPS_URL, text: "About OAuth apps, GitHub Apps and SSO" }],
          };
        }
      }
      break;
    }
    case "credentialsRefused": {
      const host = hostName(failure.host);
      return {
        said: `${host} refused the username and password or token Git sent.`,
        steps: [
          "If you signed in with a personal access token, check it hasn't expired or been revoked, and that it can reach the repository.",
          "Many Hosts, GitHub among them, no longer take your account's password here: use a token, or sign in through Git Credential Manager.",
          `Remove the credential saved for ${host}, from Windows Credential Manager or the macOS Keychain, so your credential helper asks again. Then try again.`,
        ],
        links: [{ href: GCM_INSTALL_URL, text: "Installing Git Credential Manager" }],
      };
    }
    case "noCredential":
      return {
        said: `Git had no credential to sign in to ${hostName(failure.host)} with: no credential helper gave it one, and Lanewise never asks for your password itself.`,
        steps: [
          "Install Git Credential Manager, which signs you in through your browser and keeps the credential in your system's own store. Git for Windows comes with it.",
          "Or set up the credential helper you use instead. Then try again.",
        ],
        links: [{ href: GCM_INSTALL_URL, text: "Installing Git Credential Manager" }],
      };
    case "sshKeyRefused": {
      const host = hostName(failure.host);
      return {
        said: `${host} refused your SSH key, or SSH had no key to offer it.`,
        steps: [
          "In a terminal, check your key is loaded with ssh-add -l, and add it with ssh-add if it isn't listed.",
          `Check the key's public half is added to your account on ${host}.`,
          `Test it with ${sshTest(failure.host)}, then try again.`,
        ],
        links: mayBeGitHub(failure.host)
          ? [{ href: GITHUB_ADD_SSH_KEY_URL, text: "Adding an SSH key to your GitHub account" }]
          : [],
      };
    }
    case "unknownHostKey": {
      const host = hostName(failure.host);
      return {
        said: `SSH doesn't know ${host}'s host key yet, so it couldn't check it was really talking to ${host}, and stopped.`,
        steps: [
          `In a terminal, connect once with ${sshTest(failure.host)}. Check the fingerprint it shows is one ${host} publishes, and only then answer yes.`,
          "Then try again.",
        ],
        links: mayBeGitHub(failure.host) ? [{ href: GITHUB_FINGERPRINTS_URL, text: "GitHub's SSH key fingerprints" }] : [],
      };
    }
    case "changedHostKey": {
      const host = hostName(failure.host);
      const forget =
        failure.host === null
          ? "ssh-keygen -R and the Host's name, such as ssh-keygen -R github.com"
          : `ssh-keygen -R ${failure.host}`;
      return {
        said: `The host key ${host} sent isn't the one SSH has saved for it. Either ${host} changed its key, or someone is between you and it, so SSH stopped.`,
        steps: [
          `Check the fingerprints ${host} publishes, and don't go on unless ${host} says it changed its key.`,
          `If it did, remove the old key with ${forget}.`,
          `Connect once with ${sshTest(failure.host)} to check and save the new key, then try again.`,
        ],
        links: mayBeGitHub(failure.host) ? [{ href: GITHUB_FINGERPRINTS_URL, text: "GitHub's SSH key fingerprints" }] : [],
      };
    }
  }
}

/** A Sign-in Failure in plain text, after `lead`, such as "Nothing was fetched". */
export function describeSignInFailure(lead: string, failure: SignInFailure): string {
  const { said, steps } = explainSignInFailure(failure);
  return `${lead}: Git couldn't sign in to ${signedInTo(failure)}. ${said}\n${steps.map((step, at) => `${at + 1}. ${step}`).join("\n")}`;
}
