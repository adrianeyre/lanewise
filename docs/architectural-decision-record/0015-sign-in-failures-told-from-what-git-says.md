# Sign-in Failures are told from what Git says, and credentials are hidden wherever Git's words are kept

Git signs in with the user's own credential helper and SSH setup (PRD §9.3, ADR 0002), so Lanewise never sees a password or a token. When signing in fails, all it has is what Git, the Host and SSH wrote on stderr. It needs to tell the user why, above all when a GitHub organization's SAML SSO hasn't authorized their token or SSH key (PRD §9.2, §9.3), and to explain each other way signing in fails in its own words. This ADR records how the core recognises a Sign-in Failure, how the UI explains it, and how credentials are kept out of both.

## A Sign-in Failure is recognised in the core, from the text of a failed `git`

`SignInFailure::recognise` reads the stderr of a `git` that failed. It takes a Host's `remote:` lines as one sentence, since the Host wraps its words, and trims CRLF endings. It checks in this order, and the first match wins:

| Sign-in Failure | Recognised by | From |
|---|---|---|
| `ssoNotAuthorized` | "organization has enabled or enforced SAML SSO", with the organization's name in the quotes before it, if there's one | GitHub, over HTTPS (`remote:`) or SSH (`ERROR:`) |
| `changedHostKey` | "REMOTE HOST IDENTIFICATION HAS CHANGED", or "Host key for … has changed" | SSH |
| `unknownHostKey` | "Host key verification failed" | SSH |
| `sshKeyRefused` | "Permission denied (…publickey…)" | SSH |
| `credentialsRefused` | "Authentication failed for '…'", or a Host's "Invalid username or token", "Invalid username or password" or "HTTP Basic: Access denied" | Git, the Host |
| `noCredential` | "could not read Username for '…'" or "could not read Password for '…'" | Git, with prompts off |

SSO comes first because GitHub's refusal comes with Git's own "could not read from remote repository", or a 403, and it's the more useful to say. A changed host key comes before "Host key verification failed", which SSH writes after it.

`ssoNotAuthorized` also says what wasn't authorized. The usual case is a personal access token over HTTPS, or an SSH key. When GitHub names the OAuth app or GitHub App the user signed in with, such as Git Credential Manager, it's that app, by name. The other kinds carry the Host's name wherever Git or SSH gave it. A clone fills in a missing one from the URL it was given (`or_host_in`). A fetch, pull or push doesn't have its remote's URL to hand when the failure is recognised, so a missing Host stays `null`, and the UI says "the Host".

`RemoteError::SignIn` and `CloneError::SignIn` carry the failure along with what Git said. Through the command API they become `signInFailed`, with the failure's `kind`. Anything else is the `git` failure it always was, in Git's words.

The fixtures in `core/tests/fixtures/sign-in/` are the real messages, kept as Git, GitHub and SSH wrote them. That includes both GitHub's older "whitelisted" wording and its newer "authorized" wording, and both of its quoting styles. One test runs a real `git fetch` and `git pull` through a `core.sshCommand` that answers as GitHub does.

## Git's own words are only matched in English

The Host's `remote:` lines and SSH's messages are never translated, so they're recognised whatever the user's locale. Git's own messages are translated (`could not read Username`, `Authentication failed`), and Lanewise matches the English only. Running every `git` with `LC_ALL=C` would lose the user's own language wherever Git's words are shown as they are. So in another language, a failure that only Git's own words describe is shown as a plain `git` failure, with what Git said, as it was before. SSO refusals and every SSH failure are still recognised.

## The UI explains each one, and links to the Host's instructions

`explainSignInFailure` (`app/src/signIn/signInWords.ts`) gives each kind:

- what happened, in a sentence or two, naming the organization or Host where Git did;
- numbered steps to fix it;
- links to the Host's own instructions:
  - GitHub's guides to authorizing a token or an SSH key for SSO, and how OAuth apps and GitHub Apps are authorized for it;
  - installing Git Credential Manager, for refused credentials and no credential helper;
  - adding an SSH key, and GitHub's SSH host key fingerprints, when the Host could be GitHub's.

`SignInFailureHelp` shows this inside the Clone form's alert or the Toolbar's, so it's announced as it appears. Its links open in the user's browser (`onOpenLink`), and what Git said is in a `<details>`, shown on request. `describeSignInFailure` gives the same words as plain text for `describeRemoteError` and `describeCloneError`.

GitHub's guidance lives in the UI for now. It belongs to its Host Integration once there's a Host Integration interface: `TODO` in `commands/src/sign_in.rs` (PRD §9.4, M4).

## Credentials are hidden wherever Git's words are kept

A remote's URL may have a token in it (`https://user:token@host/…`), and Git repeats that URL in its errors. `hide_credentials` (`core/src/git/credentials.rs`) replaces a URL's userinfo with `***`. A user with no password is kept for SSH's schemes, such as `ssh://git@host`, since that user is only a name. The core runs it:

- on every stderr line a `git` writes, before it's kept or put in an error. A progress line is only read for its phase and counts;
- on the arguments in a failed command's name.

So no error, log or Sign-in Failure carries a credential. The `branches` command hides them in each remote's URL and push URL too. The Branches & remotes Widget's Change URL doesn't prefill a URL whose credentials are hidden, because saving it would replace the real credentials with `***`. It says why, and asks for the whole of the new URL.

## Consequences

- A new way for signing in to fail, or new wording from GitHub, needs a fixture and a match. An unrecognised one is still shown in Git's words.
- The core tests cover:
  - each fixture;
  - CRLF endings;
  - an SSO refusal with no organization named;
  - a failure that isn't a Sign-in Failure;
  - an SSO-refused fetch and pull end to end;
  - a clone that fails with no credential helper;
  - credentials hidden from a failing command and its message.

  The command API tests cover the wire form and URLs listed with their credentials hidden. The UI tests cover:
  - each explanation and its links;
  - the Toolbar's and the Clone form's alerts, with axe checks;
  - links opening in the browser;
  - the Change URL guard.

## Still to check by hand

- Against a GitHub organization that enforces SAML SSO, in the Desktop App on each OS:
  - clone and fetch over HTTPS with a token not authorized for it, and over SSH with a key not authorized for it;
  - check that each explanation names the organization, and its link opens GitHub's instructions in the browser;
  - authorize the token or key, and check that trying again works.
- With Git Credential Manager on Windows and macOS: a refused or revoked credential, and none at all (GCM uninstalled), each give their own explanation.
- Over SSH: an unknown host key (a fresh `known_hosts`) and a changed one (a wrong key saved for the host) each give theirs.
- With a screen reader (NVDA, VoiceOver): the alert is read in full as it appears, the links are reached from the keyboard, and "What Git said" opens from the keyboard.
- In both Themes and under forced colours: the explanation, its steps and links, and what Git said can be seen, and have enough contrast.
