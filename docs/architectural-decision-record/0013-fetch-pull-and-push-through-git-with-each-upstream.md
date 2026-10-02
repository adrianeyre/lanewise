# Fetch, pull and push run through `git`, one at a time in a repository, and each branch's Upstream is read with its counts

The Repository page's Toolbar fetches, pulls and pushes (PRD §7.6), with their progress and a Cancel. Pull follows the user's Git config, and its menu picks a Pull Mode for one pull instead. Each local branch with an Upstream shows how far it is ahead and behind, in the Branches & remotes Widget and in the Toolbar. A push the remote rejects says why and offers to pull. A pull that stops with conflicts, including a rebase partway through, leaves a merge or rebase in progress for the page to show. This ADR records how the core does each, and how they travel over the command API.

## Each is the system `git`, as a terminal would run it

Fetch, pull and push are network operations, so they run the system `git` (ADR 0002), with `--progress`, `GIT_TERMINAL_PROMPT=0` and the user's own configuration, as a clone does (ADR 0012). Signing in goes through the user's credential helpers and SSH agent. Lanewise never asks for a password.

- **Fetch** is `git fetch --all --progress`: every remote, as the Toolbar's one Fetch button promises. A repository with no remotes is refused as `noRemotes` before Git runs.
- **Pull** is `git pull --progress --no-edit`, into the current branch from its Upstream. Git decides, from `pull.rebase`, `branch.<name>.rebase` and `pull.ff`, whether to merge, rebase or only fast-forward, so Lanewise follows the config exactly by not deciding. `--no-edit` keeps Git from opening an editor for a merge commit's message, which has no terminal to open in.
- **Push** is `git push --progress --porcelain -- <remote> refs/heads/<branch>:<the Upstream's branch>`. It always pushes the current branch to its Upstream, whatever `push.default` says, because that's what the Toolbar's Push shows the counts for. Nothing forces a push. Force push with lease is P1 (PRD §7.6).

A Pull Mode picked from the menu adds one option, for that pull only:

| Pull Mode | Options |
|---|---|
| Merge | `--no-rebase`, and `--ff` if `pull.ff` is `only` |
| Rebase | `--rebase`, and `--ff` if `pull.ff` is `only` |
| Fast-forward only | `--ff-only` |

Git lets `pull.ff=only` win over `--rebase` and `--no-rebase`. So a user who picks Merge or Rebase, with `pull.ff=only` set, would be refused. `--ff` lifts it for that one pull, as picking the mode meant.

Before running, a pull is refused as `operationInProgress` if a merge, rebase, cherry-pick or other operation is in progress, or a file is still conflicted. It's refused as `detached` with no branch checked out, and as `noUpstream` with no Upstream. A push is also refused with no commits to push.

## How each outcome is told apart

Git's messages are translated, and most change between versions, so they are read as little as possible:

- **A pull that stopped.** After a failed pull, the core looks at the repository rather than at what Git said. A merge in progress (`MERGE_HEAD`) or a rebase in progress (`rebase-merge/` or `rebase-apply/`, but not `git am`'s `rebase-apply/applying`) means the pull stopped, and it's `stopped` with the files still conflicted and what Git wrote. That's not an error: the page shows the merge or rebase in progress, and the Conflicts page (PRD §7.7, M5) will take over from it.
- **A pull that was refused.** Otherwise, the core checks why in the repository: the Upstream gone from the remote (`upstreamGone`), branches that diverged with only a fast-forward allowed (`notFastForward`), or diverged with none of `pull.ff`, `branch.<name>.rebase` and `pull.rebase` set, so Git refused to guess (`noPullMode`). Uncommitted changes that the incoming commits touch (`wouldOverwrite`) are found by listing the files changed between `HEAD` and the Upstream. Anything else is Git's own error, in its own words.
- **What a pull did.** If `HEAD` didn't move, the branch was up to date. Otherwise, `git rev-list --count` counts the commits it took in.
- **A rejected push.** `--porcelain` writes one line per ref to standard output, untranslated: `<flag>\t<from>:<to>\t<summary>`. A `!` flag with `(non-fast-forward)` or `(fetch first)` is `rejected`, and the UI offers to pull. Any other `!`, such as a hook the remote ran that declined it, is a failure with Git's words. `=` is up to date.
- **Upstreams and their counts.** `git for-each-ref` over `refs/heads` reads each branch's Upstream, remote and `%(upstream:track,nobracket)` in one run. The counts come as words (`ahead 2, behind 1`, or `gone`), so it runs with `LC_ALL=C` and `LANGUAGE` empty, and they're always English. `gix` could compute them too, but the Upstream is Git config (`branch.<name>.remote` and `branch.<name>.merge`, mapped through `remote.<name>.fetch`) that `for-each-ref` already resolves as Git does. `branches` reads the Upstreams when there's a `git` to read them with, and leaves them `null` when there isn't, or when it can't read them, rather than failing the whole list.

A fetch, pull or push that couldn't sign in is a Sign-in Failure (`signInFailed`), recognised in what Git, the Host and SSH said, and explained with how to fix it (ADR 0015).

## `startFetch`, `startPull` and `startPush` start one; `remoteProgress` follows it

Each can take minutes, so each travels as a clone does (ADR 0012): a start command that answers at once with a number, `remoteProgress`, a long poll for how it's going, and `cancelRemote`. The long poll and its registry move from the clone into `running.rs`, shared by both: at most one wake-up every 100 ms except for a new phase or a finished one, 25 seconds at most per poll, and the outcome kept for a minute. The clone's progress update is renamed `GitProgress` for both.

Only one fetch, pull or push runs in a repository at a time. Two at once would race for the same refs and index, and Git would fail one with a lock error. A second start is refused as `alreadyRunning`, naming the one running, and the UI follows that one instead.

Only the shown Tab's page is drawn, so a Toolbar can be drawn again while its operation runs. `remoteOperation` gives the one running in a repository, if there is one, and the Toolbar follows it again when it's drawn.

Errors found before Git runs, such as `operationInProgress`, are found on the operation's own thread and arrive through `remoteProgress` as `failed`, not from the start command. The start command only refuses what it can say at once: no repository, no `git`, or one running already.

`rebaseInProgress` and `abortRebase` cover a rebasing pull that stops, as `mergeInProgress` and `abortMerge` do for a merge (ADR 0010). The rebase is read from Git's own state files: which branch, onto what, which commit of how many, and the files still conflicted. Continue and Skip wait for the Conflicts page.

## Consequences

- The integration tests fetch, pull and push against local bare repositories, with a second clone to push from elsewhere. They cover each Pull Mode, `pull.rebase`, `pull.ff=only` and the override lifting it, the refusal with no Pull Mode, a merge and a rebase that stop with conflicts (the rebase at commit 1 of 2) and aborting it, uncommitted changes in the way, no Upstream, a detached `HEAD`, a gone Upstream, a push rejected as `fetch first` and then as `non-fast-forward`, and a pull that lets it push. In the core, a fetch cancelled before it starts says so. Through the command API, a fetch waiting on a server that never answers is cancelled, and a second operation started while it runs is refused, naming it.
- A pull, like any `git`, can be cancelled partway. Cancelling while Git is fetching leaves nothing changed. Cancelling while it merges or rebases can leave that merge or rebase in progress, and the page then shows it.
- Setting an Upstream, pushing a branch that has none, and managing remotes followed in ADR 0014.
- Auto-fetch is P1 (PRD §7.9).

## Still to check by hand

- In the Desktop App on each OS: a fetch, pull and push over HTTPS with Git Credential Manager, and over SSH with the agent holding a key, against GitHub and another Host. A push the Host rejects offers Pull, and Pull then lets the push through. Cancel stops each partway, and on Windows, where Git is killed outright, leaves no `.lock` file behind.
- With a screen reader (NVDA, VoiceOver): the counts are read as words, "2 commits ahead of origin/main and 1 behind", not as arrows and numbers. Progress is announced politely at each new phase and each quarter of one. Focus moves to Cancel as an operation starts and back to its button as it finishes, and a failure is read as an alert.
- In both Themes and under forced colours: the progress bar, the split Pull button and the counts can be seen.
