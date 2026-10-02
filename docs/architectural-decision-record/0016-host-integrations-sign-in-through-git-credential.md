# Host Integrations sign in through `git credential`, and GitHub's repositories are browsed through its REST API

A Tier 2 Host Integration offers guided sign-in and repository browsing for clone (PRD §9.1). The first is GitHub's, for GitHub.com and each GitHub Enterprise Server the user adds in Settings. Listing repositories takes a token, and the PRD says it's the one Git Credential Manager already holds, so there's no second sign-in, and Lanewise never sees a password (§9.1, §9.3). This ADR records where the Host Integrations live, how they sign in and how GitHub's repositories are listed, searched and paged.

## Host Integrations live in `commands`, behind `HostIntegration`

`HostIntegration` (`commands/src/hosts/mod.rs`) is the PRD's `IHostIntegration` (§9.4). Each one says:

- its kind and Tier;
- which Hosts it serves, by the name in a remote's URL;
- how to sign in to one, and who as;
- a page of the repositories there to clone.

`HostIntegrations` asks each in turn whether it serves a Host. The `GenericHostIntegration` comes last, and serves every Host at Tier 1, where Git does all the signing in, so it refuses to sign in or list repositories (`notOffered`). The `GitHubHostIntegration` serves `github.com`, `ssh.github.com` and the GitHub Enterprise Servers the user added. A new Host Integration, such as GitLab's (P1), is one more in the list, and the core doesn't change.

The GitHub Enterprise Servers are the UI's to keep (`lanewise.github-enterprise-hosts`, listed in the Cookie Policy), and every command that needs them is sent them: `detectHost`, `signInToHost` and `hostRepositories`. So the command API keeps no state of its own, as ADR 0003 has it, and Web Mode will work the same way. Only HTTPS is offered for one, since the token goes with every call. It's added by its address, with a port only if that isn't 443. GitHub.com is always there, and can't be added again.

## Signing in is `git credential fill`, and the token isn't kept

`Credentials` (`core/src/credential.rs`) is Git's own credential protocol, run through the system `git` (ADR 0002):

- `fill` sends `protocol=https` and `host=…`, and reads back what the helper gave. A helper with no credential, such as Git Credential Manager, signs the user in its own way first: in their browser, through their organization's SSO if it has one. With no helper at all, Git would ask at a terminal. There's none, so it fails, and the user is told to install Git Credential Manager (`noCredential`).
- `approve` tells the helpers the Host took the credential, as Git does after a fetch, so a helper that keeps one only once it has worked keeps it.
- `reject` tells them the Host refused it, so they forget it. Any 401 does this (`tokenRefused`).

The credential is handed back to `approve` and `reject` exactly as the helper gave it, including fields such as `password_expiry_utc`. Its `Debug` hides the password. The token is used for the call it was filled for, then dropped. Lanewise asks the helper again for each call, and never writes it anywhere. What the UI keeps of a sign-in is who was signed in, for as long as the app is open.

`fill` blocks until the helper answers, which can take as long as the user's browser sign-in does. Desktop runs every command on a blocking thread, so the UI stays live. The helper's own window is where the user cancels, and a cancelled sign-in is `noCredential` too.

## A missing scope is told from GitHub's headers

Listing private repositories takes a classic token or an OAuth app's with the `repo` scope. Git Credential Manager's has it. GitHub says which scopes a token has in `X-OAuth-Scopes`:

- If `/user` or the first page of `/user/repos` says the token lacks `repo`, Lanewise lists what it can, the public repositories, and says so. It offers to forget the token and sign in again, which rejects every credential the helpers have for the Host, then fills afresh (`again`).
- A refusal with `X-Accepted-OAuth-Scopes`, or "Resource not accessible by", is `missingScope`, naming the scopes GitHub wanted, and offers the same.
- A fine-grained token gives no scopes to read, so nothing is said until GitHub refuses it. The explanation then names the permissions such a token needs.

The other refusals are told apart as well:

- `X-GitHub-SSO: required; url=…` is `ssoNotAuthorized`, with GitHub's link to authorize the token.
- `X-GitHub-SSO: partial-results` means some organizations' repositories were left out for their SSO. They're listed without them, and the UI says why.
- A 429, or a 403 with `X-RateLimit-Remaining: 0`, is `rateLimited`, with the time from `X-RateLimit-Reset`.
- A GitHub Enterprise Server whose `/api/v3/user` answers 404, or with something that isn't GitHub's JSON, is `notGitHub`.
- Anything else is `hostFailed`, with GitHub's status and message.

## Repositories are listed from `/user/repos`, and searched in Rust

`/user/repos?affiliation=owner,collaborator,organization_member&sort=full_name&direction=asc` lists every repository the user can clone: their own, those they collaborate on, and their organizations'. It needs no `read:org` scope, which Git Credential Manager's token may lack. The alternative, listing `/user/orgs` and then each organization's repositories, would need that scope, and many more requests.

GitHub's search API can't be limited to the repositories a user can reach, and has its own, lower rate limit. So a search matches each word, ignoring case, against GitHub's own pages of 100 repositories, in the repository's full name or its description. One `hostRepositories` call reads at most 10 of GitHub's pages. If a page doesn't fill up by then, it's answered short, even empty, with a cursor to look further. The UI then says "Look further" instead of "Show more". So a search on an account with thousands of repositories never makes one command wait on dozens of requests.

The cursor is opaque to the UI (`Cursor::naming`). Inside, it's GitHub's page number and the full name of the last repository given from that page. The next call starts after that repository on that page, so a page of 30 can end partway through one of GitHub's pages. If that repository has gone from its page by then, the call is `invalidCursor`, and the UI says to search again from the top. The list is sorted by name, so this is rare. `Link: rel="next"` says whether GitHub has another page.

## Calls go through `ureq`, trusting the system's certificates

Every Host Integration's calls share one `ureq` agent, which:

- trusts the operating system's certificates (`rustls-platform-verifier`), so a GitHub Enterprise Server whose certificate comes from a company's own authority is trusted as the user's browser trusts it;
- takes a proxy from `HTTPS_PROXY`;
- gives up after 30 seconds (`unreachable`);
- never follows a redirect, which could carry the token to another Host.

`ureq` is blocking, like the rest of the command API, and doesn't bring an async runtime into `commands`.

## The UI

In Settings, the GitHub Enterprise Server section adds one by its address, explaining any address that isn't one, and lists those added, each with a Remove button. The Clone form's "Browse repositories…" opens a dialog with:

- a Host select, which starts on the Host of the URL already typed, if that's a GitHub one;
- Sign in, then who is signed in;
- a search field, and the choice of cloning over HTTPS or SSH;
- the repositories, as buttons that put the chosen URL in the Clone form;
- Show more, which moves focus to the first repository it added.

Each problem is an alert that says what to do, with links to GitHub's instructions. How many repositories are listed is announced.

## Consequences

- Git Credential Manager, or any helper, does all the signing in. Lanewise needs no OAuth app of its own, and has nothing of the user's to keep safe. The cost is a `git` process for each call, which is small beside the call to GitHub.
- Searching reads a user's repositories 100 at a time, and pages over at most 10 of GitHub's pages per call. An account with more than 1,000 repositories is searched a call at a time, with "Look further".
- The tests stand a local HTTP server in for GitHub's API, and a fake in for the credential helpers. They cover:
  - signing in, and signing in again, afresh;
  - a missing scope, as the token says and as GitHub refuses it;
  - SSO, both refused and partial;
  - rate limits;
  - a Host that isn't GitHub, and one that can't be reached;
  - a refused token being rejected;
  - paging, searching, looking further and an out-of-date cursor.

  The core's tests run the real `git credential` against a helper script. The UI's tests cover Settings adding and removing a GitHub Enterprise Server, and the Browse repositories dialog end to end, each with axe checks.

## Still to check by hand

- With Git Credential Manager on Windows and macOS, in the Desktop App:
  - sign in to GitHub.com with no credential kept, and check that the browser sign-in opens and that Lanewise lists the repositories once it's done;
  - cancel the browser sign-in, and check that it's explained;
  - sign in again, afresh, and check that GCM asks again.
- Against a real GitHub Enterprise Server: adding it, signing in, and listing its repositories, including over a company's own certificate authority and through a proxy.
- Against an organization that enforces SAML SSO: a token not authorized for it lists the other repositories, and says why that organization's are missing.
- With a classic personal access token without `repo`: only public repositories are listed, and it says so.
- With a screen reader (NVDA, VoiceOver): the dialog, the alerts and the announcements are read, and the whole of it works from the keyboard.
- In both Themes and under forced colours: the dialog and the Settings section can be seen, and have enough contrast.
