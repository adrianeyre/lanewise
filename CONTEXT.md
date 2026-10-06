# Lanewise

A free, open-source desktop Git client for Windows and macOS with a visual commit graph and AI-assisted merge conflict resolution.

## Language

### Git

**Git Setup**:
The system `git` Lanewise runs, which must be 2.40 or later, and whether Git Credential Manager is one of its credential helpers. It is checked on start, with install guidance for the platform if anything is missing.
_Avoid_: Environment, prerequisites, requirements

**Label**:
A branch, remote-tracking branch or tag name, or a detached `HEAD`, shown on the commit it points at.
_Avoid_: Decoration, badge, ref chip

**Stash**:
Uncommitted changes, and untracked files if asked for, that Git has put aside to leave the working tree clean, until they are applied again. The user makes one from the Stashes Widget or the Working tree Widget, or chooses to stash before a checkout that would overwrite their changes, which includes untracked files.
_Avoid_: Shelf, shelved changes, saved changes

**Lane**:
One column of the Commit graph: a line of history drawn straight down from a commit to its parent, in one of the Theme's lane colours. A lane never moves sideways, and `HEAD`'s first-parent line is always the leftmost. A parent more than 100 rows below is not given a lane; each end shows a short arrow instead.
_Avoid_: Track, rail, column, branch line

**Hunk**:
One run of changed lines in a diff, with up to three unchanged lines around it and an `@@` header giving where it starts in the old and new files. Not a Conflict Hunk, which is a conflicted region with three versions.
_Avoid_: Chunk, change block

**Commit Message**:
What a commit says about itself: a one-line subject, then, after a blank line, an optional body. The Working tree Widget writes one to commit or amend.
_Avoid_: Title, description, summary line

**Upstream**:
The branch on a remote that a local branch pulls from and pushes to, such as `origin/main`, with how far apart the two are: how many commits the branch is ahead, which a push sends, and behind, which a pull brings in. An Upstream whose branch was deleted on the remote, and pruned by a fetch, is gone.
_Avoid_: Tracking branch, remote branch, origin

**Pull Mode**:
How a pull brings in its Upstream's commits: by merging, by rebasing, or only if it's a fast-forward. It follows the Git config (`pull.rebase`, `pull.ff`) unless the Pull button's dropdown picks one for that pull.
_Avoid_: Pull strategy, pull type, sync mode

**Recent Repositories**:
The repositories the user opened lately, most recent first, kept on this machine and listed on the Welcome screen. One whose folder has gone is marked, and can be removed.
_Avoid_: History, recent files, MRU list

### Hosting

**Host**:
A service that stores remote repositories, such as GitHub.com, a GitHub Enterprise Server instance or a GitLab instance.
_Avoid_: Provider, forge, server

**Host Integration**:
Lanewise's Host-specific support for one kind of Host, beyond plain Git remotes.
_Avoid_: Provider, Host provider, plugin

**Tier**:
The depth of a Host Integration: Tier 1 is plain Git over HTTPS/SSH, Tier 2 adds guided sign-in and repository browsing, and Tier 3 adds pull/merge requests and CI status.
_Avoid_: Level, support level

**Owner**:
The user or organization on a Host a repository belongs to: the first part of its full name, such as `adrianeyre` in `adrianeyre/lanewise`. Browse repositories lists the signed-in user and their GitHub organizations, to list only one Owner's repositories.
_Avoid_: Namespace, account, org

**Pull Request**:
A proposal on a Host to merge one branch into another, such as a fork's branch into `main`, open until it's merged or closed. Lanewise reads a repository's open ones from GitHub, lists them in the Pull requests Widget and marks each beside its branch's tip in the Commit graph. GitLab calls it a merge request.
_Avoid_: PR in UI text, merge request except when quoting GitLab

**Sign-in Failure**:
Why Git couldn't sign in to a Host for a clone, fetch, pull or push, told from what Git, the Host and SSH wrote: an organization's SAML SSO not having authorized the token, SSH key or app; credentials the Host refused; no credential to send; an SSH key the Host refused; or an SSH host key that's unknown or has changed. Each is explained with how to fix it, and never shows the credentials.
_Avoid_: Auth error, login failure, authentication problem

### Issues

**Issue Tracker**:
A service that tracks work, Jira Cloud or Trello, which Lanewise reads the user's Issues from with their own API token, kept in the OS credential store, and never writes to (ADR 0038). Not a Host.
_Avoid_: Project management tool, integration, ticketing system

**Issue**:
One piece of work in an Issue Tracker, a Jira issue or a Trello card, which a branch can be made for. The Issues Widget, in the Repository page's left column below the Stashes Widget, lists the user's open ones.
_Avoid_: Ticket, task, card (say "Trello card" only when quoting Trello)

### AI

**Model Provider**:
A source of AI model responses, either a cloud API or a local inference server the user runs.
_Avoid_: Provider, AI provider, backend, LLM

**Suggestion**:
An AI-proposed resolution for one Conflict Hunk, with an explanation and a Confidence. It is never applied without explicit user action.
_Avoid_: Resolution, fix, AI answer

**Confidence**:
How far a Suggestion can be trusted: high, medium or low. Low-Confidence Suggestions are flagged for human attention.
_Avoid_: Score, certainty

**Effort**:
How hard a model thinks before it answers, in the levels that model supports, in plain words: Off, Minimal, Low, Medium, High, Extra high or Maximum. Its default is the Model Provider's own for that model. Some models take none.
_Avoid_: Reasoning level, thinking budget

**Model catalog**:
The JSON file in the repository that describes the models each Model Provider's live list returns: which model and version each is, and the Effort levels it takes. Lanewise ships with a copy and refreshes it from the repository. It never decides which models exist: a model it doesn't describe is still offered, under Other versions, with only the Model Provider's default Effort.
_Avoid_: Model registry, model database, model list

**First-use disclosure**:
What Settings shows before AI first sends anything to a Model Provider: exactly what goes with each Suggestion request, and the Model Provider it goes to. AI is off until the user accepts it, and each Model Provider chosen afterwards has its own.
_Avoid_: Consent dialog, privacy notice, warning

### Conflicts

**Base**:
A conflicted file as it was before either side changed it: the commit the two sides of a merge share, the parent of the commit a rebase is replaying, or the commit a stash was made on. A file added on both sides has none.
_Avoid_: Ancestor, original

**Conflict Hunk**:
One conflicted region of a file, with its base, ours and theirs versions. In the working tree it sits between Conflict Markers.
_Avoid_: Conflict block, chunk

**Conflict Markers**:
The lines Git writes round each Conflict Hunk in a conflicted file: `<<<<<<<` before ours, `|||||||` before the Base when Git shows it, `=======` before theirs, and `>>>>>>>` after.
_Avoid_: Conflict marks, separators

**Cherry-pick**:
Applying the change one commit made onto the current branch, as a new commit with its message (ADR 0034).
_Avoid_: Copy commit, pick

**Revert**:
Undoing the change one commit made, in a new commit, leaving the history as it was (ADR 0034).
_Avoid_: Undo commit, roll back

**Reset**:
Moving the current branch, or a detached `HEAD`, to another commit: Soft keeps the changes since staged, Mixed keeps them unstaged, and Hard loses them, with every uncommitted change (ADR 0034).
_Avoid_: Rewind, roll back

**In-Progress Operation**:
A merge, rebase, stash apply, Cherry-pick or Revert that Git has stopped partway through because of conflicts, waiting for the user to continue, skip or abort.
_Avoid_: Pending merge, conflict state

**Ours and Theirs**:
The two sides of a conflicted file, as Git names them. Ours is `HEAD`: the branch being merged into, the commit a rebase is onto with the commits replayed so far, or the working tree a stash is applied to. Theirs is what's brought in: the commits being merged, the commit a rebase is replaying, or the stash.
_Avoid_: Local and remote, mine and yours, left and right

**Resolution**:
The final content the user chooses for a Conflict Hunk, whether picked by hand or accepted from a Suggestion, and the conflicted file it makes with the rest, which the Resolution Widget edits and marking it resolved writes to the working tree.
_Avoid_: Merge result, fix

**Three-way view**:
The Conflicts page's Widget showing a conflicted file's Base, Ours and Theirs side by side, read-only, each with the lines it changed from the Base marked.
_Avoid_: Diff3 view, merge view, compare view

**Whole-file choice**:
How a conflicted file that can't be resolved Conflict Hunk by Conflict Hunk is resolved instead: a binary file, or one a side deleted or renamed away, is kept as Ours or Theirs has it, or deleted where a side has no version of it. It has no Three-way view and no Suggestion.
_Avoid_: Take file, pick file, file-level resolution

**Evaluation corpus**:
Conflict Hunks found by replaying real merges from open-source repositories, each kept with its ground truth, on which the evaluation harness measures how often Suggestions match it and how well Confidence flags the ones that don't. It's in `eval/corpus/`, with each repository credited and its licence beside it.
_Avoid_: Test set, benchmark, dataset

**Ground truth**:
What a merge commit has in a Conflict Hunk's place, which a Suggestion for it is measured against. A Conflict Hunk's is only kept where the lines round it are unchanged in the merge commit, so its place is certain.
_Avoid_: Expected answer, correct resolution, merge result

### Shells

**Desktop App**:
Lanewise as an installed Windows or macOS application.
_Avoid_: Native app, client

**Web Mode**:
Lanewise's core running as a local server on the machine that has the repositories, used from a browser.
_Avoid_: Browser version, web app, hosted version

### Settings

**Settings**:
Lanewise's own preferences, such as the Theme, kept on this machine and changed in the Settings dialog, which the title bar opens. Each change is made and kept as it is chosen. Not Git's configuration, which lives in a repository's or the user's Git config.
_Avoid_: Preferences, options, config

**Base folder**:
The folder on this machine the user keeps their repositories in, such as `C:\projects`, set in Settings, which Open repository's folder dialog opens in and Clone clones into until another is chosen (ADR 0039).
_Avoid_: Root folder, workspace, projects folder

**Theme**:
The colours Lanewise is drawn in: Light, Dark, or System, the default, which follows the OS's light or dark setting as it changes. Every colour comes from the Theme's tokens.
_Avoid_: Skin, colour scheme, appearance, mode

### Support

**Logs**:
Lanewise's own record of what it did, such as a command that failed and why, kept in rolling files in the OS's log folder on this machine and sent nowhere. They name commands, kinds of failure and versions, never credentials, API keys, file contents or prompts.
_Avoid_: Telemetry, analytics, crash reports, tracing

**Diagnostics**:
What Copy diagnostics, in Settings, copies for a bug report: the Lanewise, operating system, Git and Git Credential Manager versions and the latest lines of the Logs. It also opens the bug-report form on GitHub with them filled in, which the user reads and submits themselves.
_Avoid_: Debug info, system info, support bundle

### Releases

**Release**:
A version of Lanewise, numbered by semantic-release from the Conventional Commits merged to `main` and published as a GitHub Release with the Desktop App's installers: a universal disk image for Apple Silicon and Intel Macs, signed ad hoc and never notarized, and a Windows NSIS installer, signed only once a signing secret is set. Its notes list the changes and say how to open an app macOS or Windows warns about. Its version is the one the footer shows.
_Avoid_: Build, drop, distribution, ship

**Changelog**:
`CHANGELOG.md`, every Release's notes, newest first, which semantic-release writes and commits with each Release's version. Choosing the footer's version opens it in a dialog, as the build has it.
_Avoid_: Release history, what's new, patch notes

**Update**:
A newer Release than the one running, which the installed Desktop App finds in the latest Release's `latest.json` and installs, restarting into it, only when the user chooses Install and restart and no In-Progress Operation, clone, fetch, pull or push would be cut short. Web Mode has none.
_Avoid_: Upgrade, patch, new version

**Update key**:
The minisign key pair every Update's package is signed with, for its version: the public half is built into the Desktop App, and the private half is a secret only the release workflow has. The app installs nothing the key didn't sign.
_Avoid_: Updater key, signing key, code signing certificate

**Project website**:
Lanewise's page on GitHub Pages, `https://lanewise.adrianeyre.co.uk/`: what Lanewise is, screenshots, download buttons for the latest Release, a link to the documentation and the footer. It is not the app and not Web Mode, stores nothing on your device, and follows the OS's light or dark setting.
_Avoid_: Homepage, marketing site, web app

### Layout

**Tab**:
One repository open in the window, with its own Repository page. Several can be open at once; the Welcome screen can take a Tab of its own too, and so can each Host page.
_Avoid_: Window, workspace, project

**Host page**:
A page on a Host, such as a repository or a Pull Request on GitHub, shown in a Tab of its own in the Desktop App, with Back, Forward, Reload and Open in browser, unless Settings says to open them in the browser. Web Mode opens them in the browser.
_Avoid_: Web tab, browser tab, embedded page, web view

**Toolbar**:
The two rows across the top of a Repository page, under the Tabs. The first has its buttons, as GitKraken's has: Undo and Redo; Fetch, Pull and Push; and Branch, Stash and Pop, which pops the newest stash. The second has the repository's name, the current branch, its Upstream's ahead and behind counts, and what the last fetch, pull or push did or the progress of the one running, with Cancel, or for a fetch Skip, which leaves it running in the background, and Close, which stops it. It fetches as its Tab is shown, once the Commit graph has its first window, and as the window is focused again, at most every 30 seconds, unless Settings says not to. It is not a Widget, and doesn't move.
_Avoid_: Action bar, header, ribbon, command bar

**Undo**:
Taking back the last of Lanewise's own actions on a repository, from the Toolbar or with Ctrl+Z (⌘Z): a commit or amend, a checkout, a branch made or deleted, a reset, a stash made or popped. Redo does it again. Each is taken back only while the repository is as the action left it, and moves refs back rather than making a commit, so it is not a Revert. What can be undone is kept for each repository while Lanewise runs, and a new action leaves nothing to redo.
_Avoid_: Revert, rollback, history

**Conflicts page**:
The page a Tab shows in place of its Repository page while an In-Progress Operation is: the In-Progress Operation Widget along the top, the Conflicted files Widget at the left, and, for the file chosen there, the Three-way view over the Resolution Widget in the middle and the AI Suggestion Widget at the right.
_Avoid_: Merge tool, conflict editor, conflict view

**Welcome screen**:
The page shown when no repository is chosen: opening a repository, cloning one from a URL, and the Recent Repositories.
_Avoid_: Start page, home page, landing page

**Widget**:
One section of a page, with its own heading, in its fixed place in the page's layout (ADR 0032), such as the Commit graph or the Working tree.
_Avoid_: Panel, pane, card, tile

**App menu**:
The menu at the left of the title bar, whose File menu opens, clones and closes repositories and Tabs and opens Settings, and whose Help menu links to Lanewise's repository; after them, the Privacy Policy, Terms and Conditions, Cookie Policy, Accessibility and Credits, as the footer has them, and the version running.
_Avoid_: Hamburger menu, main menu

**Activity**:
Something Lanewise is doing that takes time, such as a command running, a Suggestion asked for or an Update installing: what it's doing now, in words that change as it moves on, and how far it has got, as a percentage where that's known.
_Avoid_: Task, job, loading state, busy state

**Activity indicator**:
Where the newest Activity running shows, once it has run a moment: a spinner, its words, its step, a bar of how far it has got and how long it has run, in its fixed place at the bottom right of the window, above the footer.
_Avoid_: Spinner, loader, progress toast, status bar

**Avatar**:
The circle a commit is drawn as in the Commit graph: its author's initials, in a colour of their own, ringed in the commit's lane colour. Drawn from the author's name alone, never fetched.
_Avoid_: Profile picture, gravatar

**Palette**:
A set of the page's and panels' colours, an accent and a gradient behind the title bar, the Tabs and the Welcome screen, chosen in Settings beside the Theme and drawn in either Theme.
_Avoid_: Skin, colour scheme

**Gateway**:
An address a Model Provider's or Jev's requests go to in place of its own API, with headers of its own, kept by the core in the OS credential store (ADR 0035).
_Avoid_: Proxy, relay

**Jev**:
TypeSafe AI's decision model, which answers typed questions rather than writing text. Lanewise asks it, with the user's own key, how far to trust a Suggestion, which side a Conflict Hunk takes, and whether staged changes are fit to commit, and never acts on its answer (ADR 0036).
_Avoid_: Jev AI, the decision engine

**Split view**:
The Diff Widget's default view: the file as it was on the left beside the file as it is on the right, hunk by hunk, removed lines red and added ones green (ADR 0033). The unified view is its alternative.
_Avoid_: Side-by-side diff, diff2
