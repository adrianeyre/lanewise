# Lanewise

[![CI](https://github.com/adrianeyre/lanewise/actions/workflows/ci.yml/badge.svg)](https://github.com/adrianeyre/lanewise/actions/workflows/ci.yml)
[![Release](https://github.com/adrianeyre/lanewise/actions/workflows/release.yml/badge.svg)](https://github.com/adrianeyre/lanewise/actions/workflows/release.yml)

A free, open-source desktop Git client for Windows and macOS, with a visual commit graph and AI-assisted merge conflict resolution. Its source is at [`adrianeyre/lanewise`](https://github.com/adrianeyre/lanewise), under the MIT licence.

- **The project website:** [adrianeyre.github.io/lanewise](https://adrianeyre.github.io/lanewise/), with the latest downloads.
- **What is being built, and why:** the [product requirements document](docs/product-requirements-document/git-client.md) and the [architectural decision records](docs/architectural-decision-record/).
- **Releases:** [every Release](https://github.com/adrianeyre/lanewise/releases), with its notes.

![Lanewise's Repository page in the light Theme, laid out as GitKraken's is. Under the Tabs, the Toolbar's row of buttons: Undo, Redo, Fetch, Pull, Push, Branch, Stash and Pop, and under it the repository, station, on main, level with origin/main. On the left, Branches & remotes lists the local branches feature/alerts, feature/humidity, feature/units and main, the current branch, the remote origin with its branches, and its two tags, closed; under it Pull requests, Stashes, with one stash, Try a larger font, and Issues. Local branches, Remotes, Tags, Pull requests, Stashes and Issues are each a section that opens and closes by its heading. In the middle, the Commit graph draws 12 commits in coloured lanes, each with its author's initials, with a column of branch and tag Labels at its left, among them the tags v0.1.0 and v0.2.0, feature/humidity merged back into main, feature/units and feature/alerts open, and the stash as a dotted square beside the commit it was made on. The commit Round temperatures to a tenth before showing them is selected, and on the right Commit details shows its author, committer, parent and the one file it changed.](website/public/screenshots/repository.webp)

![Lanewise's Repository page in the light Theme with a file's diff in the Commit graph's place, under the Toolbar's row of buttons: src/format.ts as the commit Show the temperature in Fahrenheit too changed it, split side by side, the file as it was on the left, with its removed line in red and marked with a minus, and as it is on the right, with its four added lines in green and marked with a plus, each numbered as it is in its own file. On the right, Commit details shows the commit, by Margaret Hamilton, and the file.](website/public/screenshots/diff.webp)

![Lanewise's Conflicts page in the dark Theme, during a merge of origin/feature/units into main. A bar along the top says the merge is in progress with one file still conflicted, with Continue and Abort merge. On the left, Conflicted files lists src/format.ts, conflicted, with Mark resolved. In the middle, the Three-way view shows that file's Base, Ours and Theirs side by side, coloured as a diff is: the Base's line they changed in red, marked with a minus, and the lines Ours and Theirs changed in green, each marked with a plus, and under it the Resolution, at its one Conflict Hunk, with Accept Ours, Accept Theirs and Accept both. On the right, the AI Suggestion Widget says AI is off until it is turned on in Settings.](website/public/screenshots/conflicts.webp)

## What Lanewise does

- **The Commit graph.** The whole history in lanes, each commit drawn with its author's avatar and each stash as a dotted square, with branches and tags as Labels and open Pull Requests beside them. Right-click a commit, or any of its Labels, to merge, check out, rename or delete its branches, here, on their remote or both, and double-click a remote branch to bring your local branch to it.
- **The working tree.** Stage whole files or single Hunks, see each diff side by side, commit or amend, and stash.
- **Branches, remotes and Hosts.** Branch, merge after a preview, clone, fetch, pull and push, signing in to GitHub, GitHub Enterprise Server, GitLab.com, Bitbucket and Azure DevOps through Git Credential Manager to browse your repositories. Every branch action from a right click in the sidebar, a fetch as you switch tabs, and a base folder, such as `C:\projects`, that opening and cloning start in.
- **Pull Requests from GitHub.** Each open one by its number and title, opened in your browser with a click, and marked in the Commit graph. Every repository has Open repository, with its Host's logo, to open it on its Host, in a Tab of its own beside your repositories, or in your browser if you'd rather.
- **Issues from Jira Cloud and Trello.** Your open Issues beside your branches, with your own API token kept in your system's credential store, and a branch made for any of them.
- **Merge conflicts, with AI Suggestions never applied for you.** Base, Ours and Theirs side by side, a Resolution built one Conflict Hunk at a time, and Suggestions from your own Model Provider's API key.
- **Laid out as GitKraken is**, with columns you can resize, a spinner and progress bar saying what's running whenever something takes time, Light, Dark and System Themes, no telemetry, and WCAG 2.2 AA throughout.

## Getting started

- **Use it:** download the latest [Release](https://github.com/adrianeyre/lanewise/releases/latest). [Installing Lanewise](docs/installing.md) covers macOS, Windows, Git 2.40 or later and Git Credential Manager.
- **Turn on AI:** [Suggestions from your own Model Provider](docs/ai-suggestions.md).
- **Build it from source:** [Setting Lanewise up locally](docs/development.md), with [common setup problems](docs/development.md#common-setup-problems). In short, with Node 26, Rust and Tauri 2's system dependencies installed:

  ```bash
  corepack enable
  pnpm install --frozen-lockfile
  pnpm desktop:dev
  ```

- **Releases, signing, updates and the website:** [Releases](docs/releases.md).

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) says how to set up, test and lint a change, how to write its commits, the glossary Lanewise uses and how a decision is recorded. Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). Report a security problem privately, as [SECURITY.md](SECURITY.md) says, never in an issue.

[Open an issue](https://github.com/adrianeyre/lanewise/issues/new/choose) to report a bug (Settings' **Copy diagnostics** fills its form in), ask for a feature, or tell us about an accessibility barrier.

## Licence

MIT. See `LICENSE`.
