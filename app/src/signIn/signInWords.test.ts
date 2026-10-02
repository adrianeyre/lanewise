import { expect, test } from "vitest";

import type { SignInFailure } from "../commands/api";
import { describeRemoteError } from "../repository/remoteWords";
import { describeCloneError } from "../welcome/cloneProblems";
import {
  AUTHORIZE_APPS_URL,
  AUTHORIZE_SSH_KEY_URL,
  AUTHORIZE_TOKEN_URL,
  GCM_INSTALL_URL,
  GITHUB_ADD_SSH_KEY_URL,
  GITHUB_FINGERPRINTS_URL,
  describeSignInFailure,
  explainSignInFailure,
  signedInTo,
} from "./signInWords";

const hrefs = (failure: SignInFailure) => explainSignInFailure(failure).links.map(({ href }) => href);

test("GitHub's SSO refusing a token or an SSH key names the organization, and links to how to authorize that one", () => {
  const token: SignInFailure = { kind: "ssoNotAuthorized", organization: "axa-ch", credential: { kind: "token" } };
  expect(signedInTo(token)).toBe("GitHub");
  expect(explainSignInFailure(token).said).toBe(
    "The axa-ch organization uses SAML single sign-on (SSO), and your personal access token hasn't been authorized for it, so GitHub refused it.",
  );
  expect(explainSignInFailure(token).steps[1]).toBe(
    "Next to the token, choose Configure SSO, then Authorize next to the axa-ch organization, signing in through its SSO if you're asked to.",
  );
  expect(hrefs(token)).toEqual([AUTHORIZE_TOKEN_URL]);

  const key: SignInFailure = { kind: "ssoNotAuthorized", organization: null, credential: { kind: "sshKey" } };
  expect(explainSignInFailure(key).said).toBe(
    "The organization uses SAML single sign-on (SSO), and your SSH key hasn't been authorized for it, so GitHub refused it.",
  );
  expect(explainSignInFailure(key).steps[1]).toContain("Authorize next to the organization,");
  expect(hrefs(key)).toEqual([AUTHORIZE_SSH_KEY_URL]);
});

test("GitHub's SSO refusing an app names it, and says how to authorize it again", () => {
  const gcm: SignInFailure = {
    kind: "ssoNotAuthorized",
    organization: "my-company",
    credential: { kind: "oauthApp", name: "Git Credential Manager" },
  };
  expect(explainSignInFailure(gcm).said).toBe(
    "The my-company organization uses SAML single sign-on (SSO), and the OAuth app you signed in with, Git Credential Manager, hasn't been authorized for it, so GitHub refused it.",
  );
  expect(explainSignInFailure(gcm).steps[1]).toBe(
    "On GitHub, open Settings, then Applications, then Authorized OAuth Apps, and revoke Git Credential Manager.",
  );
  expect(hrefs(gcm)).toEqual([AUTHORIZE_APPS_URL]);

  const app: SignInFailure = { kind: "ssoNotAuthorized", organization: null, credential: { kind: "githubApp", name: null } };
  expect(explainSignInFailure(app).said).toContain("the GitHub App you signed in with hasn't been authorized");
  expect(explainSignInFailure(app).steps[1]).toContain("Authorized GitHub Apps, and revoke the app.");
});

test("each other Sign-in Failure has its own explanation, naming the Host where Git did", () => {
  const refused: SignInFailure = { kind: "credentialsRefused", host: "github.com" };
  expect(signedInTo(refused)).toBe("github.com");
  expect(explainSignInFailure(refused).said).toBe("github.com refused the username and password or token Git sent.");
  expect(hrefs(refused)).toEqual([GCM_INSTALL_URL]);

  const none: SignInFailure = { kind: "noCredential", host: null };
  expect(signedInTo(none)).toBe("the Host");
  expect(explainSignInFailure(none).said).toBe(
    "Git had no credential to sign in to the Host with: no credential helper gave it one, and Lanewise never asks for your password itself.",
  );
  expect(hrefs(none)).toEqual([GCM_INSTALL_URL]);

  const key: SignInFailure = { kind: "sshKeyRefused", host: "github.com" };
  expect(explainSignInFailure(key).said).toBe("github.com refused your SSH key, or SSH had no key to offer it.");
  expect(explainSignInFailure(key).steps[2]).toBe("Test it with ssh -T git@github.com, then try again.");
  expect(hrefs(key)).toEqual([GITHUB_ADD_SSH_KEY_URL]);
  // Another Host's own instructions aren't GitHub's.
  expect(hrefs({ kind: "sshKeyRefused", host: "gitlab.example.com" })).toEqual([]);

  const unknown: SignInFailure = { kind: "unknownHostKey", host: null };
  expect(explainSignInFailure(unknown).said).toBe(
    "SSH doesn't know the Host's host key yet, so it couldn't check it was really talking to the Host, and stopped.",
  );
  expect(explainSignInFailure(unknown).steps[0]).toContain("such as ssh -T git@github.com");
  expect(hrefs(unknown)).toEqual([GITHUB_FINGERPRINTS_URL]);

  const changed: SignInFailure = { kind: "changedHostKey", host: "github.com" };
  expect(explainSignInFailure(changed).said).toBe(
    "The host key github.com sent isn't the one SSH has saved for it. Either github.com changed its key, or someone is between you and it, so SSH stopped.",
  );
  expect(explainSignInFailure(changed).steps[1]).toBe("If it did, remove the old key with ssh-keygen -R github.com.");
  expect(hrefs(changed)).toEqual([GITHUB_FINGERPRINTS_URL]);
});

test("a Sign-in Failure reads as plain text after what didn't happen, for a fetch, pull, push or clone", () => {
  const failure: SignInFailure = { kind: "changedHostKey", host: "github.com" };
  const described = describeSignInFailure("Nothing was pushed", failure);
  expect(described).toMatch(/^Nothing was pushed: Git couldn't sign in to github\.com\. The host key github\.com sent/);
  expect(described).toContain("\n1. Check the fingerprints github.com publishes");
  expect(described).toContain("\n3. Connect once with ssh -T git@github.com");

  const error = { kind: "signInFailed", failure, message: "Host key verification failed." } as const;
  expect(describeRemoteError(error, "push")).toBe(described);
  expect(describeRemoteError(error, "fetch")).toMatch(/^Nothing was fetched: /);
  expect(describeCloneError(error)).toBe(describeSignInFailure("Nothing was cloned", failure));
});
