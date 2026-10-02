# Pull Requests read from GitHub, and branches moved to their remote-tracking branch

The owner asked to see a repository's open Pull Requests beside its Commit graph, to open the repository on its Host, and to bring a local branch level with its remote-tracking branch in one step. This ADR records how each is made. It builds on ADR 0009, ADR 0016 and ADR 0037.

## Pull Requests at Tier 3, for GitHub only

`pullRequests` reads a repository's open Pull Requests, newest first, through `GET /repos/{owner}/{repo}/pulls?state=open&per_page=100` on GitHub's REST API, following the `Link` header's next page up to five pages, 500 Pull Requests. The Host and the owner and name come from the `origin` remote's URL, or else the first remote's that has one, as `detectHost` reads a Host from it. It's the first of Tier 3 (PRD §9.1): the GitHub Host Integration stays at Tier 2 until it has CI status as well. `HostIntegration::pull_requests` answers `notOffered` for every other Host Integration. TODO(PRD §9.1, post-launch): merge requests on GitLab, Pull Requests on Bitbucket and Azure DevOps, and CI status.

Each Pull Request carries its head branch's tip, by its full ID, so the Commit graph can mark the commit it would merge where the repository has it, as it does a Label.

## No sign-in unless the user asks

A Widget that loads on its own mustn't open a browser, or wait for one. So `pullRequests` asks the credential helpers quietly unless it's `interactive`: `git credential fill` runs with `GCM_INTERACTIVE=never`, so Git Credential Manager fails rather than signing in, and an empty `GIT_ASKPASS`, so Git has no program to ask with, as well as its usual `GIT_TERMINAL_PROMPT=0`. With no credential, GitHub is asked as nobody, which answers for a public repository at its lower rate limit; a private one answers 404 or 401, which is told as `noCredential`, for the Widget to offer signing in. With `interactive`, as from that offer, the helpers sign in as they do for `signInToHost` (ADR 0016). A refused token is told to the helpers, and failures are told as the other GitHub calls tell them, rate limits and SAML SSO included. Nothing sent or answered is logged (ADR 0028).

## The repository's web page

`openRepository` gives the repository's web page on its Host, from the same remote: `https://<host>/<path>`, the path without `.git`, credentials left out, `ssh.github.com` as `github.com`, and Azure DevOps's SSH `v3/org/project/repo` as `org/project/_git/repo`. A local path, or a remote that can't be read, has none, and the repository still opens. GitHub Enterprise Servers aren't known to `openRepository`, so theirs is a Generic Host's page, at the same address.

## A local branch moved to its remote-tracking branch

`checkOut` takes `localAt`, a local branch and a remote-tracking branch, such as `main` and `origin/main`, and checks the branch out with its tip moved there first, as `git switch --no-track --force-create main refs/remotes/origin/main` does, whether or not it's the current branch. `--no-track` leaves the branch's Upstream config as it was. Uncommitted changes it would overwrite, and stashing them first, are as for any checkout. Commits only the branch had are no longer on it, so the UI asks first when the branch has commits the remote-tracking branch doesn't, naming how many.

## Considered options

- **Reading Pull Requests through GitHub's GraphQL API.** Left out for now: the REST list has everything the Widget shows, and every other GitHub call is REST.
- **Always signing in for Pull Requests, as Browse repositories does.** Left out: a Widget loading as a repository opens would open a browser the user didn't ask for.
- **Moving the branch with `git reset --hard`.** Left out: it only moves the current branch, and would lose uncommitted changes where `git switch` refuses.

## Hand checks

- A GitHub repository's Pull Requests with Git Credential Manager signed in, signed out (a public repository's still listed, and no browser opens), and for a private repository signed out, then signed in from the Widget.
- Opening a repository on GitHub, GitLab, Bitbucket and Azure DevOps from their SSH and HTTPS remotes.
