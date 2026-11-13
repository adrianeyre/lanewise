# Lanewise

[![CI](https://github.com/adrianeyre/lanewise/actions/workflows/ci.yml/badge.svg)](https://github.com/adrianeyre/lanewise/actions/workflows/ci.yml)
[![Release](https://github.com/adrianeyre/lanewise/actions/workflows/release.yml/badge.svg)](https://github.com/adrianeyre/lanewise/actions/workflows/release.yml)

A free, open-source desktop Git client for Windows and macOS, with a visual commit graph and AI-assisted merge conflict resolution. Its source is at [`adrianeyre/lanewise`](https://github.com/adrianeyre/lanewise), under the MIT licence.

- **The project website:** [lanewise.adrianeyre.co.uk](https://lanewise.adrianeyre.co.uk/), with the latest downloads.
- **What is being built, and why:** the [product requirements document](docs/product-requirements-document/git-client.md) and the [architectural decision records](docs/architectural-decision-record/).
- **Releases:** [every Release](https://github.com/adrianeyre/lanewise/releases), with its notes.

![Lanewise's Repository page in the light Theme, laid out as GitKraken's is. Under the Tabs, the Toolbar's row of buttons: Undo, Redo, Fetch, Pull, Push, Branch, Stash and Pop, and under it the repository, station, on main, level with origin/main. On the left, Branches & remotes lists the local branches feature/alerts, feature/humidity, feature/units and main, the current branch, the remote origin with its branches, and its two tags, closed; under it Pull requests, Stashes, with one stash, Try a larger font, and Issues. Local branches, Remotes, Tags, Pull requests, Stashes and Issues are each a section that opens and closes by its heading. In the middle, above the Commit graph, its Working tree row stands out in the accent, saying Uncommitted changes, with 2 unstaged. The Commit graph draws 12 commits in coloured lanes, each with its author's initials, with a column of branch and tag Labels at its left, among them the tags v0.1.0 and v0.2.0, feature/humidity merged back into main, feature/units and feature/alerts open, and the stash as a dotted square beside the commit it was made on. The commit Round temperatures to a tenth before showing them is selected, and on the right Commit details shows its author, committer, parent and the one file it changed.](website/public/screenshots/repository.webp)

![Lanewise's Repository page in the light Theme with a file's diff in the Commit graph's place, under the Toolbar's row of buttons: src/format.ts as the commit Show the temperature in Fahrenheit too changed it, split side by side, the file as it was on the left, with its removed line in red and marked with a minus, and as it is on the right, with its four added lines in green and marked with a plus, each numbered as it is in its own file. On the right, Commit details shows the commit, by Margaret Hamilton, and the file.](website/public/screenshots/diff.webp)

![Lanewise's Conflicts page in the dark Theme, during a merge of origin/feature/units into main. A bar along the top says the merge is in progress with one file still conflicted, with Continue and Abort merge. On the left, Conflicted files lists src/format.ts, conflicted, with Mark resolved. In the middle, the Three-way view shows that file's Base, Ours and Theirs side by side, coloured as a diff is: the Base's line they changed in red, marked with a minus, and the lines Ours and Theirs changed in green, each marked with a plus, and under it the Resolution, at its one Conflict Hunk, with Accept Ours, Accept Theirs, and Accept both, Ours first or Theirs first. On the right, the AI Suggestion Widget says AI is off until it is turned on in Settings.](website/public/screenshots/conflicts.webp)

## What Lanewise does

- **The Commit graph.** The whole history in lanes, each commit drawn with its author's avatar and each stash as a dotted square, with branches and tags as Labels and open Pull Requests beside them. Right-click a commit, or any of its Labels, to merge, check out, rename or delete its branches, here, on their remote or both, and double-click a remote branch to bring your local branch to it.
- **The working tree.** Stage whole files or single Hunks, see each diff side by side, commit or amend, and stash.
- **Branches, remotes and Hosts.** Branch, merge after a preview, clone, fetch, pull and push, signing in to GitHub, GitHub Enterprise Server, GitLab.com, Bitbucket and Azure DevOps through Git Credential Manager to browse your repositories. Every branch action from a right click in the sidebar, a fetch as you switch tabs, and a base folder, such as `C:\projects`, that opening and cloning start in.
- **Pull Requests from GitHub.** Each open one by its number and title, opened in your browser with a click, and marked in the Commit graph. Every repository has Open repository, with its Host's logo, to open it on its Host, in a Tab of its own beside your repositories, or in your browser if you'd rather.
- **Issues from Jira Cloud and Trello.** Your open Issues beside your branches, with your own API token kept in your system's credential store, and a branch made for any of them.
- **Merge conflicts, with AI Suggestions never applied for you.** Base, Ours and Theirs side by side, a Resolution built one Conflict Hunk at a time, and Suggestions from your own Model Provider's API key.
- **Laid out as GitKraken is**, with columns you can resize, a spinner and progress bar saying what's running whenever something takes time, Light, Dark and System Themes, no telemetry, and WCAG 2.2 AA throughout.

## Getting started

**[The Setup guides](docs/setup/README.md)** take you step by step, with a picture of every step, from a computer with nothing installed to Lanewise running:

| | Install a Release | Build from source |
| --- | --- | --- |
| **Windows** 10 22H2 or later, or 11 | [Install on Windows](docs/setup/windows.md#part-1-install-lanewise-from-a-release) | [Build on Windows](docs/setup/windows.md#part-2-build-lanewise-from-source) |
| **macOS** 14 or later, Apple Silicon or Intel | [Install on macOS](docs/setup/macos.md#part-1-install-lanewise-from-a-release), with [every Terminal command for an app that isn't notarized](docs/setup/macos.md#8-or-allow-lanewise-from-terminal) | [Build on macOS](docs/setup/macos.md#part-2-build-lanewise-from-source) |
| **Linux** | No installer yet | [Build on Linux](docs/setup/linux.md) |

Each guide says where to get every tool it needs, such as Git, Git Credential Manager, Homebrew, nvm or fnm, Node 26, corepack, pnpm and rustup, with [the whole list in one table](docs/setup/README.md#where-to-get-everything). Then see [First steps in Lanewise](docs/setup/first-steps.md).

- **The short version:** download the latest [Release](https://github.com/adrianeyre/lanewise/releases/latest). [Installing Lanewise](docs/installing.md) covers macOS, Windows, Git 2.40 or later and Git Credential Manager. On a Mac, the first time you open a downloaded copy, choose **Open Anyway** in **System Settings → Privacy & Security**, or run `xattr -d com.apple.quarantine /Applications/Lanewise.app`.
- **Turn on AI:** [Suggestions from your own Model Provider](docs/ai-suggestions.md).
- **Build it from source:** [Setting Lanewise up locally](docs/development.md), with [common setup problems](docs/development.md#common-setup-problems). In short, with Node 26, Rust and Tauri 2's system dependencies installed:

  ```bash
  corepack enable
  pnpm install --frozen-lockfile
  pnpm desktop:dev
  ```

- **Releases, signing, updates and the website:** [Releases](docs/releases.md).

## Documentation

Every document in `docs/` is linked here, and from [the documentation's own index](docs/README.md).

### Setting Lanewise up

- [The Setup guides](docs/setup/README.md): step by step, with a picture of every step.
  - [Setting up Lanewise on Windows](docs/setup/windows.md): Git, the installer and SmartScreen, then building from source.
  - [Setting up Lanewise on macOS](docs/setup/macos.md): Homebrew, Git, the disk image, Gatekeeper and every Terminal command for an app that isn't notarized, then building from source.
  - [Setting up Lanewise on Linux](docs/setup/linux.md): building from source, from the system packages to an entry in your applications.
  - [First steps in Lanewise](docs/setup/first-steps.md): opening and cloning a repository, signing in to a Host and turning on AI.
- [Installing Lanewise](docs/installing.md): the short version, with Git, Git Credential Manager and Updates.
- [Suggestions from your own Model Provider](docs/ai-suggestions.md): Model Providers, API keys, gateways and Jev decisions.

### Working on Lanewise

- [Setting Lanewise up locally](docs/development.md): every command, the checks, the benchmark, the installers, code scanning and [common setup problems](docs/development.md#common-setup-problems).
- [Releases](docs/releases.md): how a Release is made and signed, the Update key, and the project website.
- [Running Sandcastle](docs/processes/running-sandcastle.md): a coding agent working one issue in a container.
- [Windows code signing through SignPath Foundation](docs/processes/windows-code-signing.md): applying for free code signing for the Windows installer.
- [Getting the project website into search engines](docs/processes/search-engines.md): what the owner does outside the code.
- [Triaging a Finding](docs/processes/triaging-a-finding.md): how the owner triages a Finding from a Pen-test round.

### What is being built, and why

- [The product requirements document](docs/product-requirements-document/git-client.md): what Lanewise is and does.
- [The pen-testing product requirements document](docs/product-requirements-document/pen-testing.md), with its [rules of engagement](docs/product-requirements-document/pen-testing-rules-of-engagement.md).
- [TypeSafe AI's Jev: calling it over HTTP](docs/research/jev-ai.md): research behind Jev decisions.
- [The architectural decision records](docs/architectural-decision-record), every decision made so far and why:

<details>
<summary>All 56 architectural decision records</summary>

- [ADR 0001: Tauri 2, a Rust core and a React/TypeScript UI](docs/architectural-decision-record/0001-tauri-rust-react-stack.md)
- [ADR 0002: Require system Git; route network operations through the git CLI](docs/architectural-decision-record/0002-system-git-for-network-operations.md)
- [ADR 0003: The web version is a local server, not a static site](docs/architectural-decision-record/0003-web-version-is-a-local-server.md)
- [ADR 0004: Pages are Widgets on a hand-written snapping Grid](docs/architectural-decision-record/0004-widgets-on-a-hand-written-grid.md)
- [ADR 0005: The commit graph: straight lanes with long edges cut, drawn from index-addressed windows of segments](docs/architectural-decision-record/0005-graph-layout-and-windowed-canvas.md)
- [ADR 0006: The Diff Widget draws a unified diff as its own text, from the core's hunks, highlighted a side at a time](docs/architectural-decision-record/0006-unified-diff-as-its-own-text.md)
- [ADR 0007: The working tree's changes reach the UI as a long-polled generation from a core file watcher](docs/architectural-decision-record/0007-working-tree-changes-by-long-poll.md)
- [ADR 0008: A hunk is staged by finding it again in the core and applying it alone through `git apply --cached`](docs/architectural-decision-record/0008-hunks-staged-through-git-apply.md)
- [ADR 0009: Branches are changed through `git`, and deleting one asks first only when it would lose commits](docs/architectural-decision-record/0009-branches-changed-through-git-with-lost-commits-named.md)
- [ADR 0010: Merges are previewed from the Git config and made through `git merge`](docs/architectural-decision-record/0010-merges-previewed-from-git-config-and-made-through-git.md)
- [ADR 0011: Stashes are named by their commit and applied through `git stash`](docs/architectural-decision-record/0011-stashes-named-by-commit-and-applied-through-git.md)
- [ADR 0012: Clones run through `git clone`, followed by a long poll, and leave nothing behind when stopped](docs/architectural-decision-record/0012-clones-through-git-clone-followed-by-long-poll.md)
- [ADR 0013: Fetch, pull and push run through `git`, one at a time in a repository, and each branch's Upstream is read with its counts](docs/architectural-decision-record/0013-fetch-pull-and-push-through-git-with-each-upstream.md)
- [ADR 0014: Remotes are managed through `git remote`, and an Upstream is set by `git branch` or by the push that makes it](docs/architectural-decision-record/0014-remotes-managed-through-git-remote.md)
- [ADR 0015: Sign-in Failures are told from what Git says, and credentials are hidden wherever Git's words are kept](docs/architectural-decision-record/0015-sign-in-failures-told-from-what-git-says.md)
- [ADR 0016: Host Integrations sign in through `git credential`, and GitHub's repositories are browsed through its REST API](docs/architectural-decision-record/0016-host-integrations-sign-in-through-git-credential.md)
- [ADR 0017: In-Progress Operations are read from Git's own state and resolved through `git` on the Conflicts page](docs/architectural-decision-record/0017-in-progress-operations-resolved-through-git-on-the-conflicts-page.md)
- [ADR 0018: Conflicts are resolved in a Three-way view and a Resolution editor, and written through `git add`](docs/architectural-decision-record/0018-conflicts-resolved-in-a-three-way-view-and-a-resolution-editor.md)
- [ADR 0019: Whole-file choices are made through the index, with what Git reports read from `git merge-tree`](docs/architectural-decision-record/0019-whole-file-choices-through-the-index-with-what-git-reports.md)
- [ADR 0020: Model Providers are reached through the platform, with API keys in the OS credential store](docs/architectural-decision-record/0020-model-providers-reached-through-the-platform-with-keys-in-the-os-credential-store.md)
- [ADR 0021: A model catalog in the repository describes the live model lists](docs/architectural-decision-record/0021-a-model-catalog-in-the-repository-describes-the-live-model-lists.md)
- [ADR 0022: Claude through the Anthropic SDK, on the platform's `fetch`](docs/architectural-decision-record/0022-claude-through-the-anthropic-sdk-on-the-platforms-fetch.md)
- [ADR 0023: Gemini through the Google Gen AI SDK, on the platform's `fetch`](docs/architectural-decision-record/0023-gemini-through-the-google-genai-sdk-on-the-platforms-fetch.md)
- [ADR 0024: OpenAI-compatible Model Providers through the OpenAI SDK, on the platform's `fetch`](docs/architectural-decision-record/0024-openai-compatible-model-providers-through-the-openai-sdk-on-the-platforms-fetch.md)
- [ADR 0025: Suggestions are asked for the Resolution's Conflict Hunk, checked, and put in only by Accept or Edit](docs/architectural-decision-record/0025-suggestions-asked-for-the-resolutions-conflict-hunk-checked-and-put-in-only-by-accept-or-edit.md)
- [ADR 0026: Suggestions for every Conflict Hunk in a file are asked one at a time and reviewed each on its own](docs/architectural-decision-record/0026-suggestions-for-every-conflict-hunk-asked-one-at-a-time-and-reviewed-each-on-its-own.md)
- [ADR 0027: An Evaluation corpus replayed from real merges, measured by hand with the owner's own key](docs/architectural-decision-record/0027-an-evaluation-corpus-replayed-from-real-merges-measured-by-hand-with-the-owners-own-key.md)
- [ADR 0028: Local rolling logs and Copy diagnostics, with no telemetry](docs/architectural-decision-record/0028-local-rolling-logs-and-copy-diagnostics-with-no-telemetry.md)
- [ADR 0029: Releases by semantic-release, with an ad hoc signed universal Mac app and an NSIS installer](docs/architectural-decision-record/0029-releases-by-semantic-release-with-an-ad-hoc-signed-universal-mac-app-and-an-nsis-installer.md)
- [ADR 0030: Updates from the latest Release, signed by the Update key, installed only when the user agrees](docs/architectural-decision-record/0030-updates-from-the-latest-release-signed-by-the-update-key-installed-only-when-the-user-agrees.md)
- [ADR 0031: The project website, prerendered from React and deployed to GitHub Pages after each push to main](docs/architectural-decision-record/0031-the-project-website-prerendered-from-react-and-deployed-to-github-pages-after-each-push-to-main.md)
- [ADR 0032: A fixed layout, as GitKraken's is, in place of the Grid](docs/architectural-decision-record/0032-a-fixed-layout-as-gitkrakens-in-place-of-the-grid.md)
- [ADR 0033: Diffs shown split by default, beside the unified view](docs/architectural-decision-record/0033-diffs-shown-split-by-default-beside-the-unified-view.md)
- [ADR 0034: Commit actions through Git, with cherry-picks and reverts as In-Progress Operations](docs/architectural-decision-record/0034-commit-actions-through-git-with-cherry-picks-and-reverts-as-in-progress-operations.md)
- [ADR 0035: Gateways through the core, and authors' pictures from GitHub](docs/architectural-decision-record/0035-gateways-through-the-core-and-authors-pictures-from-github.md)
- [ADR 0036: Jev as a decision layer beside the Model Providers](docs/architectural-decision-record/0036-jev-as-a-decision-layer-beside-the-model-providers.md)
- [ADR 0037: GitLab, Bitbucket and Azure DevOps at Tier 2, through `git credential`](docs/architectural-decision-record/0037-gitlab-bitbucket-and-azure-devops-at-tier-2-through-git-credential.md)
- [ADR 0038: Issue Trackers, Jira Cloud and Trello, read through the core with tokens in the OS credential store](docs/architectural-decision-record/0038-issue-trackers-jira-cloud-and-trello-with-tokens-in-the-os-credential-store.md)
- [ADR 0039: Branches deleted on their remote, menus over the page, resizable columns and fetching as a Tab is shown](docs/architectural-decision-record/0039-branches-deleted-on-their-remote-menus-over-the-page-and-resizable-columns.md)
- [ADR 0040: Pull Requests read from GitHub, and branches moved to their remote-tracking branch](docs/architectural-decision-record/0040-pull-requests-read-from-github-and-branches-moved-to-their-remote-tracking-branch.md)
- [ADR 0041: An Activity indicator for every command, and Host pages in the browser](docs/architectural-decision-record/0041-an-activity-indicator-for-every-command-and-host-pages-in-the-browser.md)
- [ADR 0042: Host pages in Tabs, through child webviews](docs/architectural-decision-record/0042-host-pages-in-tabs-through-child-webviews.md)
- [ADR 0043: Tags drawn once their group is opened, a Tab's fetch and side Widgets after its first window, and a warm-up launch](docs/architectural-decision-record/0043-tags-drawn-once-opened-a-tabs-fetch-after-its-first-window-and-a-warm-up-launch.md)
- [ADR 0044: Fetching as the window is focused](docs/architectural-decision-record/0044-fetching-as-the-window-is-focused.md)
- [ADR 0045: The Toolbar's row of buttons, Undo and Redo, and the left column's accordion](docs/architectural-decision-record/0045-the-toolbars-row-of-buttons-and-undo-and-redo.md)
- [ADR 0046: A fetch prunes, and can be skipped or closed](docs/architectural-decision-record/0046-a-fetch-prunes-and-can-be-skipped-or-closed.md)
- [ADR 0047: The latest version checked as Lanewise starts](docs/architectural-decision-record/0047-the-latest-version-checked-as-lanewise-starts.md)
- [ADR 0048: Long edges cut only in a wide graph](docs/architectural-decision-record/0048-long-edges-cut-only-in-a-wide-graph.md)
- [ADR 0049: Code scanning by CodeQL in a workflow, with its alerts read by the owner](docs/architectural-decision-record/0049-code-scanning-by-codeql-in-a-workflow-with-its-alerts-read-by-the-owner.md)
- [ADR 0050: A Content-Security-Policy for the main webview, and only the core permissions it uses](docs/architectural-decision-record/0050-a-content-security-policy-for-the-main-webview-and-only-the-core-permissions-it-uses.md)
- [ADR 0051: A Model Provider on this computer reached only at its API's two paths](docs/architectural-decision-record/0051-a-model-provider-on-this-computer-reached-only-at-its-apis-two-paths.md)
- [ADR 0052: Releases unchanged once published, and the Update key held, backed up and rotated](docs/architectural-decision-record/0052-releases-unchanged-once-published-and-the-update-key-held-backed-up-and-rotated.md)
- [ADR 0053: The Update key in a job of its own, that only `main` can use](docs/architectural-decision-record/0053-the-update-key-in-a-job-of-its-own-that-only-main-can-use.md)
- [ADR 0054: A Content-Security-Policy for the project website, and its downloads the Release it is built from](docs/architectural-decision-record/0054-a-content-security-policy-for-the-project-website-and-its-downloads-the-release-it-is-built-from.md)
- [ADR 0055: Web Mode reached only from its own page, with a fresh Access token, and never handed a key](docs/architectural-decision-record/0055-web-mode-reached-only-from-its-own-page-with-a-fresh-access-token-and-never-handed-a-key.md)
- [ADR 0056: The Activity indicator moved by the user, and the Working tree row with its counts](docs/architectural-decision-record/0056-the-activity-indicator-moved-by-the-user-and-the-working-tree-row-with-its-counts.md)

</details>

### Checks by hand

- [Hand checks](docs/hand-checks/README.md): what can't run headless, done by a person on a real machine.
  - [Hand check: the Windows beta build](docs/hand-checks/windows-beta.md)
  - [Hand check: the macOS beta build](docs/hand-checks/macos-beta.md)
  - [Hand check: VoiceOver accessibility pass](docs/hand-checks/voiceover.md)
- [Pen-test round 1 — the public record](docs/pen-test/README.md), and each of its scope issues:

<details>
<summary>All 24 Pen-test round 1 scope issues</summary>

- [E1 — the fixtures: a script that makes Hostile repositories](docs/pen-test/E1.md)
- [E2 — throwaway accounts, keys and disposable machines](docs/pen-test/E2.md)
- [E3 — rules of engagement](docs/pen-test/E3.md)
- [E4 — the Findings workflow: labels and an issue form](docs/pen-test/E4.md)
- [G1 — what opening, fetching and diffing a repository runs](docs/pen-test/G1.md)
- [G2 — arguments chosen by refs, URLs and paths](docs/pen-test/G2.md)
- [G3 — Lanewise's own writes and deletes](docs/pen-test/G3.md)
- [G4 — clone URLs, transports and submodules](docs/pen-test/G4.md)
- [H15 — code scanning for the tree, with a named owner for its alerts](docs/pen-test/H15.md)
- [M1 — prompt injection from a Hostile repository](docs/pen-test/M1.md)
- [M2 — nothing applied without the user](docs/pen-test/M2.md)
- [P1 — Web Mode's design, before it is built](docs/pen-test/P1.md)
- [R1 — Updates: signatures and downgrades](docs/pen-test/R1.md)
- [R2 — The release workflow's secrets and tokens](docs/pen-test/R2.md)
- [R3 — Caches, branch protection and the Model catalog](docs/pen-test/R3.md)
- [R4 — The Project website's content and build](docs/pen-test/R4.md)
- [R5 — Sandcastle](docs/pen-test/R5.md)
- [S1 — keys and tokens crossing IPC](docs/pen-test/S1.md)
- [S2 — the OS credential store entries](docs/pen-test/S2.md)
- [S3 — the Logs and Diagnostics](docs/pen-test/S3.md)
- [W1 — the main webview's CSP and the blast radius of the command API](docs/pen-test/W1.md)
- [W2 — Host pages' isolation](docs/pen-test/W2.md)
- [W3 — the HTTP allow-list and every request outside it](docs/pen-test/W3.md)
- [W4 — Gateways](docs/pen-test/W4.md)

</details>


## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) says how to set up, test and lint a change, how to write its commits, the glossary Lanewise uses and how a decision is recorded. Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). Report a security problem privately, as [SECURITY.md](SECURITY.md) says, never in an issue.

[Open an issue](https://github.com/adrianeyre/lanewise/issues/new/choose) to report a bug (Settings' **Copy diagnostics** fills its form in), ask for a feature, or tell us about an accessibility barrier.

## Licence

MIT. See `LICENSE`.
