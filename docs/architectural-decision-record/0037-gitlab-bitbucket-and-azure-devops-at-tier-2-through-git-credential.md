# GitLab, Bitbucket and Azure DevOps at Tier 2, through `git credential`

ADR 0016 made GitHub's the first Tier 2 Host Integration, with guided sign-in and repository browsing for clone, and said a new one is one more in `HostIntegrations`. The PRD plans GitLab next (§9.1, §9.4), and says Git Credential Manager already signs in to GitLab, Bitbucket and Azure DevOps (§9.3). This ADR records how the `GitLabHostIntegration`, the `BitbucketHostIntegration` and the `AzureDevOpsHostIntegration` sign in, list repositories and tell refusals apart, and what they leave for later.

## Three more Host Integrations, signing in as GitHub's does

Each lives beside GitHub's in `commands/src/hosts/` (`gitlab.rs`, `bitbucket.rs`, `azure_devops.rs`), and `HostIntegrations::system` asks them in turn, GitHub's first and the `GenericHostIntegration` last. `IntegrationKind` names them `gitLab`, `bitbucket` and `azureDevOps`, and `app/src/commands/api.ts` mirrors it. They serve:

- GitLab.com: `gitlab.com`, and `altssh.gitlab.com`, its SSH over port 443, as `gitlab.com`.
- Bitbucket Cloud: `bitbucket.org`, and `altssh.bitbucket.org`, as `bitbucket.org`.
- Azure DevOps Services: `dev.azure.com`, `ssh.dev.azure.com` and `vs-ssh.visualstudio.com`, as `dev.azure.com`, and each organization's older `{org}.visualstudio.com` as itself.

Signing in is ADR 0016's, unchanged. `git credential fill` gives the credential, Git Credential Manager signing the user in in their browser first if it has none, and `approve` or `reject` tells the helpers whether the Host took it. "Sign in again" rejects every credential for the Host, then fills afresh. The token is used for the call it was filled for, and not kept.

What they share with GitHub's moved out of `github.rs`:

- `answer.rs`: one API call through the shared `ureq` agent (no redirects, the system's certificates), with its status, headers and body, and what a Host said with an error in any of the shapes they send one.
- `listing.rs`: ADR 0016's paging and search. A Host Integration says how to fetch one of its Host's pages, and which page is next, and `list` matches every word in the full name or description, answers `limit` at a time, reads at most 10 of the Host's pages a call, and names the Host's page and the last repository given in the cursor.

Each Host's API has its own shape, set out below. Their tests stand a local HTTP server in for it (`stand_in.rs`), with a fake for the credential helpers, as GitHub's do.

## GitLab.com

- **API:** `https://gitlab.com/api/v4`, with the token as `Authorization: Bearer`. GitLab takes an OAuth app's token, such as Git Credential Manager's, and a personal access token that way.
- **Signing in:** `GET /user`, whose `username` is the login.
- **Repositories:** `GET /projects?membership=true&order_by=path&sort=asc&per_page=100`. The page after is `X-Next-Page`, empty on the last. For a very long list GitLab leaves that header out, and a page short of 100 is the last. The view isn't `simple=true`, since that leaves out `visibility`, `archived` and `forked_from_project`, which say whether each is private, archived or a fork.
- **Search:** GitLab's `search` takes one string, not words, and ignores fewer than three letters. So the longest word of three letters or more is sent, with `search_namespaces=true` so a group's name matches, and Rust matches every word, as it does for GitHub.
- **Refusals:** a 401 is `tokenRefused`, and the credential is rejected. A 403 with `insufficient_scope`, in `WWW-Authenticate` or the body, is `missingScope`, naming `read_api`, which listing projects needs, where `read_user` is enough to sign in. A 429 is `rateLimited`, with `RateLimit-Reset`.

GitLab doesn't say which scopes an OAuth app's token has, so nothing is said of scopes until GitLab refuses one.

## Bitbucket Cloud

- **API:** `https://api.bitbucket.org/2.0`.
- **How the credential is sent:** Git Credential Manager's credential for Bitbucket is an OAuth token, taken as a bearer token. An app password or API token is taken only with HTTP Basic authentication and its username. So a call sends a bearer token first. If Bitbucket answers 401 and the credential has a username, it's sent once more with Basic, and the rest of the call keeps whichever worked. Only a 401 both ways is `tokenRefused`, and rejects the credential.
- **Signing in:** `GET /user`, whose `username`, or else `nickname`, is the login, and `display_name` the name.
- **Repositories:** `GET /repositories?role=member&pagelen=100&sort=full_name`. Bitbucket searches every word itself, in its query language: `(full_name ~ "word" OR description ~ "word")` for each, joined with `AND`, with quotes and backslashes escaped and the whole percent-encoded. Rust matches the words again.
- **Paging:** the next page is the `page` in the JSON's `next` URL. Only that value is taken, and sent to Bitbucket's own API. The URL itself is never followed, so the credential can't be sent to wherever it points.
- **Mapping:** the HTTPS clone URL has its `user@` removed, so Git asks the credential helper for whoever is signed in.
- **Refusals:** a 403 whose `error.detail.required` names scopes is `missingScope`, with them. A 429 is `rateLimited`.

## Azure DevOps Services

- **How the credential is sent:** Git Credential Manager's credential for Azure DevOps is a Microsoft Entra token, a JWT, taken as a bearer token. A personal access token is taken with HTTP Basic authentication and no username. So a token of three dot-separated parts starting `eyJ` is sent as a bearer token, and any other with Basic.
- **Signing in:** `GET https://app.vssps.visualstudio.com/_apis/profile/profiles/me`. The login is the profile's `emailAddress`, or else its `publicAlias`.
- **Organizations:** there's no one list of a user's repositories. `GET /_apis/accounts?memberId={profile id}` on the same service lists the organizations the user is a member of. A `{org}.visualstudio.com` Host is that one organization alone.
- **Repositories:** for each organization, `GET https://dev.azure.com/{org}/_apis/git/repositories`, or on a `{org}.visualstudio.com` Host `https://{org}.visualstudio.com/_apis/git/repositories`. Every call asks for `api-version=7.1`.
  - Each organization's repositories come all at once, so each is one of the Host's pages for `listing.rs`. The cursor names the organization's place, sorted by name, and the last repository given from it, sorted by project and name.
  - Azure DevOps has no search of repositories by name, so Rust matches every word.
  - A repository's full name is `{org}/{project}/{name}`. It's private unless its project is public, a fork if `isFork`, and archived if `isDisabled`. Its `remoteUrl` has its `user@` removed.
- **Refusals:** a 401 is `tokenRefused`, and so is a 203, or any page of HTML: Azure DevOps answers a credential it doesn't take with its sign-in page. Each rejects the credential. A 403 is `missingScope`, with no scope named, since Azure DevOps doesn't say which. A 429 is `rateLimited`, with `X-RateLimit-Reset`, or `Retry-After` from now.

## The UI

The Browse repositories dialog's Host select always offers the four Hosts first, named in words with their addresses, such as "GitLab.com (gitlab.com)", then the GitHub Enterprise Servers added in Settings. The Clone form's URL still chooses the Host first, now whichever Tier 2 Host Integration serves it. A `{org}.visualstudio.com` Host is added to the choices when it's the URL's.

`hostWords.ts` tells each Host's own help from the Host in the error: what its tokens are called, the scopes or permissions they need to list repositories, and a link to the Host's instructions. The GitHub Enterprise Server's certificate is only mentioned for a GitHub Enterprise Server.

## Consequences

- Git Credential Manager signs in to all four Host Integrations' Hosts, and Lanewise still needs no OAuth app of its own, nor keeps anything of the user's.
- Azure DevOps makes one request per organization, and a search across many organizations reads 10 of them a call, with "Look further" for the rest.
- A Bitbucket app password costs one refused request per call, before the Basic one that works.
- Self-managed GitLab, Bitbucket Data Center and Azure DevOps Server are still Tier 1. Each would be added in Settings as a GitHub Enterprise Server is, with its own API's address (a `TODO` beside `HostIntegrations::system`).

## Still to check by hand

- With Git Credential Manager on Windows and macOS, in the Desktop App, for each of GitLab.com, Bitbucket and Azure DevOps: sign in with no credential kept, check that the browser sign-in opens and that the repositories are listed once it's done, then sign in again, afresh.
- With a personal access token for GitLab.com with `read_user` alone: signing in works, and listing says `read_api` is needed.
- With a Bitbucket app password, and with an Atlassian API token, kept by the credential helper with the Bitbucket username: signing in and listing work.
- With Azure DevOps: that `git credential fill` for `dev.azure.com`, with no path, gives Git Credential Manager's Entra token, and with a personal access token, that one lacking Code (Read) is explained. A user in several organizations sees each one's repositories. A `{org}.visualstudio.com` URL in the Clone form chooses that organization.
- That a 403, or a sign-in page, from each Host is explained as the tests expect of it.
