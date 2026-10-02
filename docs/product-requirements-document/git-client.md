# Product Requirements Document: Open-Source Desktop Git Client

**Working title:** Lanewise
**Status:** Draft v0.2
**Date:** 28 September 2026
**Owner:** Adi

---

## 1. Overview

A free, open-source, cross-platform desktop Git client for Windows and macOS, with a local web mode (`lanewise serve`) that opens the same app in a browser. It offers a GitKraken-style visual workflow (commit graph, staging, diffs, branching) with first-class AI assistance for resolving merge conflicts. It works out of the box with GitHub.com and GitHub Enterprise Server, including organizations that enforce SSO.

## 2. Problem Statement

- Popular visual Git clients are paid subscription products, and the best features sit behind the paywall.
- Free clients tend to have weaker graph visualization or lack a modern UX.
- Merge conflicts are one of the most painful parts of Git, and existing clients offer little intelligent help.
- Developers in SSO-protected organizations often struggle to authenticate GUI clients.

## 3. Goals

1. Deliver a fast, polished visual Git client that covers the daily workflow (about 80% of what GitKraken users actually do).
2. Provide AI-assisted merge conflict resolution as a signature feature, with human review always in the loop.
3. Work reliably with GitHub.com, GitHub Enterprise Server and any other Git host (GitLab, Bitbucket, Azure DevOps and more), including SSO/SAML organizations. GitLab gets first-class support soon after launch.
4. Ship as a genuine open-source project that others can install, use and contribute to.
5. Support both cloud AI models (bring-your-own key) and local models.

## 4. Non-Goals (v1)

- Issue boards, Glo-style task management, or workspace/team features
- Services other than Hosts, beyond reading the user's open Issues from an Issue Tracker, Jira Cloud or Trello, to make a branch for one (ADR 0038): nothing is written to an Issue Tracker, and no other is supported
- Deep host-specific features (pull/merge request UIs, CI status, issue linking) for every Host at launch; these arrive per Host after the generic layer ships (see section 9)
- Linux desktop builds (welcome later; not a launch target). Linux is covered by the web mode.
- Mobile versions, and any hosted or static browser version (see section 7.12 for the local web mode)
- Pixel-identical replication of any commercial product's look, icons or branding

## 5. Target Users

- **Primary:** Professional developers who prefer a visual Git workflow and work in GitHub or GitHub Enterprise organizations.
- **Secondary:** Open-source contributors and students who want a free, capable GUI.
- **Persona note:** Users are comfortable with Git concepts but want speed and clarity over terminal commands, especially when resolving conflicts.

## 6. Platforms

| Platform | Support |
|---|---|
| Windows 10 22H2+ / Windows 11 (x64) | Launch |
| macOS 14+ (Apple Silicon and Intel) | Launch |
| Linux | Post-launch (desktop); web mode from P1 |
| Any modern browser, through `lanewise serve` | P1 |

Minimum OS versions are the oldest still receiving vendor security updates at launch. Windows relies on the evergreen WebView2 runtime that Tauri installs if missing. A system Git installation (2.40 or later) is required; see section 9.3.

## 7. Functional Requirements

Priority key: **P0** = required for first public release, **P1** = soon after, **P2** = later.

### 7.1 Repository management
- P0: Open local repository; recent repositories list
- P0: Multiple repositories open in tabs
- P0: Clone from URL with progress and cancel
- P1: Initialize new repository
- P2: Submodule and worktree support

### 7.2 Commit graph and history
- P0: Lane-based commit graph with branch and tag labels
- P0: Smooth scrolling on repositories with 100k+ commits (virtualized rendering, lazy loading)
- P0: Commit detail view (author, date, message, changed files, diff)
- P1: Search and filter by author, message, file, date
- P1: Show/hide branches, remotes and tags

### 7.3 Working tree and staging
- P0: File status list (modified, added, deleted, untracked, conflicted)
- P0: Stage/unstage whole files
- P0: Hunk-level staging
- P1: Line-level staging
- P0: Commit with message; amend last commit
- P1: Discard changes with confirmation

### 7.4 Diff viewer
- P0: Unified diff with syntax highlighting
- P1: Side-by-side diff
- P1: Word-level diff highlighting
- P1: Image diff (basic)

### 7.5 Branching and history operations
- P0: Create, rename, delete, checkout branches
- P0: Merge
- P0: Stash (create, apply, pop, drop)
- P1: Cherry-pick, revert, from the commit menu, each left as an In-Progress Operation when it conflicts (ADR 0034)
- P1: Reset the current branch to a commit, soft, mixed or hard, naming the commits it would leave first (ADR 0034)
- P1: Check out a commit, with `HEAD` detached, asked first (ADR 0034)
- P1: Rebase (non-interactive first)
- P2: Interactive rebase UI
- P1: Tag create/delete, from the commit menu (ADR 0034), and push tags (TODO: push tags, with the remote operations)

### 7.6 Remotes
- P0: Fetch, pull (merge and rebase modes), push. Pull follows the user's Git config (`pull.rebase`, `pull.ff`); the Pull button's dropdown overrides it for one pull.
- P0: Manage remotes; set upstream
- P0: Ahead/behind indicators
- P1: Force push with lease and clear warning

### 7.7 Merge conflict resolution
- P0: Three-way conflict view (base / ours / theirs / result)
- P0: The conflict flow handles any operation that stops with conflicts: merge, pull (merge mode), pull (rebase mode), and stash apply/pop. It shows which operation is in progress (for a rebase, "commit 3 of 7") and offers that operation's actions: Continue, Skip (rebase only) and Abort.
- P0: Abort for every in-progress operation
- P0: Per-Conflict-Hunk accept ours / theirs / both / manual edit
- P0: Binary files and delete/modify conflicts get a whole-file choice only (keep ours, keep theirs, delete), with no three-way view and no AI. Rename conflicts show what Git reports, with the same whole-file choices.
- P0: Mark file resolved and continue the operation
- **P0: AI-assisted resolution (see section 8)**

### 7.8 Authentication and hosting
See section 9.

### 7.9 Settings and quality of life
- P0: Light and dark themes
- P1: Keyboard shortcuts and command palette
- P1: Configurable Git identity per repository
- P1: Auto-fetch interval

### 7.10 A fixed layout, as GitKraken's is
Lanewise's pages have one fixed layout each, as GitKraken's do, so that it is familiar (ADR 0032, which supersedes ADR 0004's Grid).

- P0: **Title bar:** the App menu at the left (File: open, clone, open recent, new and close Tab, Settings; Help), Lanewise's name in the middle, Settings at the right.
- P0: **Repository page:** under the Tabs, the Toolbar's row of buttons, as GitKraken's is: Undo, Redo, Fetch, Pull, Push, Branch, Stash and Pop; under it the repository's name and folder, the current branch and its Upstream in one bar; then Branches & remotes over Pull Requests, Stashes and Issues at the left, with Local branches, Remotes, Tags, Pull Requests, Stashes and Issues each a section of an accordion, opened and closed by its heading and remembered (Tags starts closed), the Commit graph in the middle, and the Working tree, or Commit details with a commit selected, at the right. A file's diff takes the Commit graph's place until it is closed.
- P0: **Commit graph:** one line a commit; each commit its author's Avatar, and each stash a dotted square beside the commit it was made on; a right click, Shift+F10 or the Menu key on a commit opens its actions, grouped as GitKraken's are: checking it out, a new branch, reset, revert and cherry-pick; tags; each branch Label's; and copying its ID and message (ADR 0034).
- P0: **Undo and Redo** of Lanewise's own last actions: a commit or amend, a checkout, a branch made or deleted, a reset, a stash made or popped, each only while the repository is as the action left it (ADR 0045).
- P0: **Diff:** the Split view by default, the unified view one click away (ADR 0033).
- P0: **Conflicts page:** the In-Progress Operation Widget along the top; Conflicted files at the left; the Three-way view over the Resolution in the middle; AI Suggestion at the right.
- P0: **Dense:** no space between or around the Widgets beyond what separates them; each panel scrolls on its own and the window never does.
- P0: **Narrow windows** (below 768 px): the columns stack and the page scrolls.
- P0: **Accessibility:** every pointer action has a keyboard alternative (WCAG 2.2 AA).

### 7.11 Footer
- P0: Every page (Desktop App, Web Mode and the project website) has the same footer as soundcheck, from one React component:
  - **Site design:** GitHub's mark, linking to `https://github.com/adrianeyre/lanewise`, announced as "source on GitHub, opens in a new tab".
  - **Version:** the build's version, which opens a modal with the Changelog, `CHANGELOG.md` as the build has it.
  - **Cookie Policy:** opens a modal.
  - **Accessibility:** opens a modal with the accessibility statement.
  - **Credits:** opens a modal with the open-source licence notices the dependencies require.
- P0: **No cookie banner.** Lanewise stores only essential settings (theme, the diff view, recent repositories, Model Provider choice) and the website stores nothing. The Cookie Policy lists exactly what is stored and states there are no tracking, analytics or advertising cookies.

### 7.12 Web mode
- P1: `lanewise serve` runs the Rust core as a local server and serves the same React build, so the full app works in any modern browser. Typical use: a remote or headless machine, reached through an SSH tunnel.
- The server binds to `127.0.0.1` only and requires a random access token, generated at start and printed as part of the URL (as Jupyter does), so no other website can send it commands.
- Features that need a desktop window (native file dialogs, opening a folder in the OS file manager) fall back to in-app equivalents. The web mode has the same Git, credential and AI capabilities as the desktop app, because they run in the same Rust core on the same machine.
- The command API is transport-agnostic from M0: every UI↔core command goes through one interface, carried by Tauri IPC in the desktop app and by a WebSocket in the web mode.
- Rust makes all Model Provider HTTP requests in both modes (see section 10.1), so browser CORS never applies.

## 8. AI Features

### 8.1 AI merge conflict resolution (signature feature)

**Behavior**
- For each conflicted hunk, the user can request an AI-suggested resolution.
- The model receives the base, "ours" and "theirs" versions of the Conflict Hunk, 20 lines of surrounding context above and below (configurable), the file path, and the commit subjects from both sides.
- The suggestion appears alongside the raw conflict with a short plain-English explanation of the reasoning.
- Each Suggestion carries a Confidence (high, medium or low). The model reports a Confidence in structured output, and the app downgrades it to low when checks fail: the result still contains conflict markers, is empty, or drops lines that exist only on one side. Low-Confidence Suggestions are flagged for human attention and are never applied automatically.
- The user accepts, edits or rejects each suggestion. Nothing is written to the working tree without explicit user action.
- Optional: "Resolve all conflicts in file" produces suggestions for every hunk for review, not a silent bulk apply.

**Safeguards**
- No automatic application of AI output.
- P1 (fast follow, not v1): optional verification step that runs a user-configured build or test command against the resolved result before the user marks the file resolved.
- Clear labeling of AI-generated content in the UI.

### 8.2 Model Providers
- **Local:** Local models run in an external inference server the user installs; the app does not bundle an inference runtime.
- Keys are stored in the OS credential store, never in plain text config.
- **Cloud Model Providers (bring-your-own API key):** Claude (Anthropic), ChatGPT models (OpenAI), Grok (xAI), Meta (Muse Spark) and Gemini (Google). Adapter design: see section 8.3.
- **API keys only:** Consumer subscriptions (Claude Pro/Max, ChatGPT Plus, SuperGrok, Gemini Advanced, Meta AI) cannot be used by third-party apps. Settings links to each provider's API-key page and says so plainly. API usage is billed by the provider, separately from any subscription.
- **Model, version and effort:** Users pick a model (for example Claude Opus, GPT, Grok, Gemini Pro, Llama), then its version (newest first, newest by default), then an effort level from the levels that model supports. Lists come live from each Model Provider's model-list API, filtered to chat-capable models, with a "Refresh models" action. Nothing is hard-coded, so new models appear without a Lanewise release.
- **Local models** (for example Llama through Ollama or LM Studio) stay supported through the OpenAI-compatible adapter. Effort is offered only where the model supports it.
- Users choose one Model Provider, model, version and effort globally and can override them per repository. Per-feature choices arrive with the P1 AI features.
- Send only the conflicted hunks plus limited context, not entire files, to control cost and reduce exposure.
- A clear first-use disclosure explains what data is sent to which Model Provider. AI features are opt-in and off by default.

### 8.3 Model Provider adapters, catalog and effort
- **Three adapters behind one abstraction:**
  - **Anthropic** (native `@anthropic-ai/sdk`): Claude.
  - **Gemini** (native `@google/genai`): Google's OpenAI-compatible layer is beta and silently ignores unsupported settings, so it isn't used.
  - **OpenAI-compatible** (`openai` SDK, Chat Completions): used by presets for OpenAI (ChatGPT models), xAI (Grok), Meta and local servers. Each preset has its own base URL, API-key page and effort levels.
- **Meta:** Meta's cloud API is the Meta Model API (`api.meta.ai`), serving the Muse Spark models. It is a public preview for US developers only, and the picker labels it "Meta (Muse Spark), preview, US only". Llama runs locally through the local preset.
- **Model catalog:** Claude's and Gemini's model-list APIs report display names, versions and supported effort levels. OpenAI's, xAI's and (unconfirmed) Meta's do not. A small model catalog (JSON) in `adrianeyre/lanewise` maps model ID patterns to model, version and effort levels. The app ships with a copy and refreshes it from the repository, so it can be updated without a release. The live model lists decide which models exist; the catalog only describes them. A model missing from the catalog appears under "Other versions" and offers only the provider's default effort.
- **Effort:** The picker shows each model's own levels in plain words (Off, Minimal, Low, Medium, High, Extra high, Maximum), never a single shared Lanewise scale. The default is the provider's own default for that model. Older Gemini models that take a thinking budget in tokens get their levels mapped to budgets through the catalog.

### 8.4 Additional AI features (P1, after conflict resolution)
- Commit message generation from the staged diff
- "Explain this commit" plain-English summary
- Branch summary (what changed relative to the base branch)

## 9. Authentication and Git Hosting

### 9.1 Supported hosts
Support is layered so that every Host works, and popular Hosts get deeper integration.

- **Tier 1, generic (all Hosts, launch):** Any standard Git remote over HTTPS or SSH, including GitLab (SaaS and self-managed), Bitbucket, Azure DevOps, Gitea/Forgejo, AWS CodeCommit and self-hosted servers. Clone, fetch, pull and push work everywhere, with credentials handled through the OS credential store.
- **Tier 2, first-class:** Guided sign-in, SSO error handling and repository browsing for clone. Host API calls (such as listing repositories) use the token GCM already holds, fetched through `git credential fill`, so there is no second sign-in. If that token lacks a needed scope, the app says so clearly.
  - **Launch:** GitHub.com and GitHub Enterprise Server (custom host URL).
  - **P1, soon after launch:** GitLab.com and self-managed GitLab (custom host URL). GitLab works at Tier 1 from launch.
  - **Since added:** GitLab.com, Bitbucket Cloud and Azure DevOps Services (ADR 0037). Self-managed GitLab, Bitbucket Data Center and Azure DevOps Server stay at Tier 1 for now.
- **Tier 3, deeper integration (post-launch, per provider):** Pull/merge request views, CI status, avatars and issue linking, added one Host at a time behind the common Host Integration interface.

### 9.2 Authentication requirements
- Must work with organizations that enforce SAML SSO.
- The app must never collect or store the user's SSO/IdP password. Sign-in happens in the user's browser.
- Credentials are stored in the OS credential store (Windows Credential Manager, macOS Keychain).

### 9.3 Approach
- **Git dependency (v1):** The app requires a system Git installation (2.40 or later) and does not bundle one. All network operations (clone, fetch, pull, push) and porcelain-heavy operations (merge, rebase, anything that runs hooks) go through the `git` CLI, so they use the user's own credential helpers, SSH configuration and hooks. gitoxide (`gix`) is used for fast reads only. (GCM only plugs in through Git's credential-helper protocol, and the CLI gives us the user's SSH setup and hooks for free.)
- **First run:** Detect a missing or too-old `git` and a missing GCM, and show platform-specific install guidance (Git for Windows bundles GCM; on macOS, Git and GCM are installed separately).
- **Primary credential helper (v1):** Integrate with Git Credential Manager (GCM) as the credential helper. GCM handles browser-based sign-in, SSO and secure storage, and supports GitHub Enterprise Server.
- **Optional later:** A native OAuth device-flow or localhost-redirect sign-in via a registered GitHub OAuth App / GitHub App, for a smoother first-run experience. This may require org-admin approval in some organizations.
- **SSH:** Support SSH remotes using the user's existing keys and agent. Show a clear message when a key has not been authorized for an organization's SSO.
- **Error handling:** Detect SSO-authorization errors and explain how to fix them, with a link to the relevant provider's instructions.
- **Other Hosts:** GCM also supports GitLab, Bitbucket and Azure DevOps, so the same credential approach covers them without extra auth code. Hosts GCM does not cover fall back to standard HTTPS token or SSH key authentication.

### 9.4 Host Integration abstraction
- Define an `IHostIntegration` interface (Host detection from remote URL, repository listing for clone, sign-in guidance, and later PR/MR and CI status).
- Ship a `GenericHostIntegration` (Tier 1) and `GitHubHostIntegration` (Tier 2) at launch, and `GitLabHostIntegration` (Tier 2) as P1. `BitbucketHostIntegration` and `AzureDevOpsHostIntegration` (Tier 2) have followed (ADR 0037). New Host Integrations plug in without changing Core.

## 10. Technical Approach

### 10.1 Stack
- **Shell:** Tauri 2 desktop app (Windows, macOS; Linux builds for development and CI only)
- **Core:** Rust (edition 2024). gitoxide (`gix`) for fast reads (log, graph, status, diff), falling back to the `git` CLI wherever `gix` is incomplete; the system `git` CLI for network operations and porcelain-heavy operations (see section 9.3)
- **UI:** React and TypeScript, built with Vite; plain CSS and lucide-react icons, matching soundcheck
- **Editor:** CodeMirror 6 for every text view, with `@codemirror/merge` for the three-way conflict views. The unified diff is drawn as its own text from the core's hunks instead (ADR 0006)
- **Web mode:** A `serve` binary built from the same Rust crates, serving `app/`'s production build and the command API over a WebSocket (ADR 0003)
- **AI calls:** Prompt construction, response parsing and Confidence checks live in TypeScript and use the official `@anthropic-ai/sdk` and `openai` SDKs. Their `fetch` is supplied by the platform: Tauri's HTTP plugin in the desktop app, or a forwarding endpoint on the local server in the web mode, so CORS never applies and keys never reach browser storage. Model Provider keys are held in the OS credential store through the Rust `keyring` crate.
- **Repository tooling:** pnpm workspace on Node 26 for the UI and for Sandcastle; Cargo workspace for Rust.
- **Dependencies:** Always the latest versions of npm packages, crates and GitHub Actions, kept current by Dependabot (`npm`, `cargo` and `github-actions` ecosystems).
- **Lint:** rustfmt, clippy with warnings denied, oxlint and `tsc --noEmit`, as in soundcheck.
- **Tooling cost:** Everything is free and open source.
- **Reuse:** Signing, installer, updater, semantic-release and CI setup are adapted from soundcheck (its ADRs 0009–0011), not vendored blindly.
- See ADR 0001 for why Tauri, Rust and React were chosen.

### 10.2 Proposed solution structure
- `core/` (Rust crate): Git operations behind traits (`gix` reader plus `git` CLI runner), UI-free and unit-tested
- `graph/` (Rust crate): lane assignment and layout, UI-free and unit-tested; sends only the visible window of the graph across the IPC boundary
- `commands/` (Rust crate): the transport-agnostic command API, credential store access and Host Integrations, shared by both shells
- `desktop/` (Rust, Tauri): the desktop shell, carrying commands over Tauri IPC
- `serve/` (Rust): the web-mode shell, carrying commands over a WebSocket and serving the UI
- `app/` (TypeScript, React): the UI, including the graph canvas, the CodeMirror views, theming and the `ai/` module (Model Provider abstraction, prompt construction, response parsing, Confidence checks)

### 10.3 Key technical risks
- **Graph performance and layout quality:** the most distinctive and riskiest component. A timeboxed spike in M0 prototypes lane layout in Rust and a virtualized canvas in the webview against `git/git`, and records its findings in an ADR that M2 builds on.
- **IPC boundary:** Large repositories must never cross the Rust↔TypeScript boundary in bulk. Commands return pages and windows, and the command API is designed up front.
- **Webview differences:** WebView2 (Chromium) on Windows, WKWebView (Safari) on macOS and WebKitGTK in CI and the sandbox. Look-and-feel checks happen by hand on real machines.
- **`gix` feature gaps:** mitigated by the `git` CLI fallback.
- **Cross-platform credential edge cases:** test against a real SSO-protected organization and a GitHub Enterprise Server instance early.

## 11. Non-Functional Requirements

- **Performance:** Open a large repository (100k+ commits) and render the first graph screen in a few seconds; scrolling stays smooth.
- **Performance targets:** On a 100k-commit repository (benchmarked against `git/git`), the first graph screen renders in under 2 seconds and scrolling holds 60fps.
- **Reliability:** Never lose user work; destructive actions require confirmation; operations are cancellable.
- **Security:** No secrets in plain text; all network calls over TLS; AI data disclosure as described above.
- **Telemetry:** None in v1, not even opt-in. The app writes local rolling log files, and a "Copy diagnostics" action fills in the bug-report issue template.
- **Privacy:** Fully functional offline (aside from remote and cloud AI operations); local AI option keeps code on the machine.
- **Accessibility:** WCAG 2.2 AA across the Desktop App, Web Mode and the website, as in soundcheck.
  - Automated axe checks run in the Vitest suite and fail CI.
  - Every action has a keyboard alternative, including the commit graph: the canvas is paired with an accessible commit grid (`role="grid"`) that screen readers and arrow keys use.
  - Visible focus, reduced motion respected, contrast checked in both themes, and the OS theme and scaling respected.
  - A manual VoiceOver pass happens before the public beta.
- **Testing:** `cargo test` for the Rust crates, with integration tests that build temporary repositories with the real `git` CLI. Vitest and Testing Library (jsdom) for the UI and the `ai/` module. Everything runs headless, so agents can run it in the sandbox. CI builds and tests on Ubuntu, Windows and macOS, and packages for Windows and macOS only.

## 12. Distribution and Open-Source Considerations

- **License:** MIT. Review the licenses of all dependencies to confirm compatibility (Tauri, `gix` and CodeMirror are MIT or MIT/Apache-2.0).
- **Naming and branding:** The name is Lanewise. The GitHub repository is `adrianeyre/lanewise`. Pick an original logo and visual identity. Replicate common workflows, not another product's trade dress.
- **macOS:** No Apple Developer account, so builds are ad-hoc signed and not notarized. Downloaded builds are quarantined by Gatekeeper; the README and release notes explain how to allow the app (System Settings → Privacy & Security → Open Anyway, or `xattr -d com.apple.quarantine`). Building from source runs without warnings. Notarization is not planned.
- **Windows:** Apply to SignPath Foundation (free code signing for open-source projects). Ship unsigned, with SmartScreen guidance in the README, until approved.
- **CI/CD:** GitHub Actions matrix build for Windows and macOS producing installers/packages and GitHub Releases.
- **Auto-update:** P0, in M7. The app updates itself from the latest GitHub Release with Tauri's updater plugin and signed update packages, as soundcheck does.
- **Community:** README, CONTRIBUTING guide, issue templates, code of conduct.

### 12.1 Project website and SEO
- A static project website on GitHub Pages at `https://adrianeyre.github.io/lanewise/`, deployed from CI on pushes to `main`, as soundcheck's is. It is a landing and download page, not the app (ADR 0003 stands).
- Content: the logo, a description, screenshots, download buttons for the latest release, a link to the docs, and the shared footer.
- Full SEO, as soundcheck's `index.html` has: title, description, keywords, author, canonical URL, robots, Open Graph (with a 1200×630 image and alt text), a Twitter card, favicons (ICO, SVG, PNG sizes), an Apple touch icon, a web app manifest, `theme-color` and `color-scheme` for both themes, and `SoftwareApplication` JSON-LD. Also `sitemap.xml` and `robots.txt`.
- The app's own `index.html` (Desktop App and Web Mode) has the title, description, icons and manifest, and is marked `noindex`.

### 12.2 Logo and brand assets
- An agent drafts an original SVG logo (lanes merging, not resembling any other Git client's marks). The owner approves the design before anything else is generated from it.
- Generated from the approved logo: favicons, app icons for Windows and macOS, a maskable icon, and the Open Graph image.

## 13. Milestones (indicative)

| Milestone | Scope |
|---|---|
| M0: Foundations | Sandbox image, pnpm and Cargo workspaces, CI matrix, transport-agnostic command API, `git` CLI runner with first-run Git/GCM detection, graph spike, open a repo and show status |
| M1: Read-only client | The fixed layout, footer and its modals, logo, commit history list, commit details, diff viewer |
| M2: Graph | Lane-based graph with labels, performance work on large repos |
| M3: Daily driver | Staging (file and hunk), commit, branches, stash |
| M4: Remotes and auth | Clone, fetch/pull/push via the `git` CLI, GCM integration, GitHub.com and Enterprise Server, SSO testing |
| M5: Conflicts | Three-way conflict UI and manual resolution |
| M6: AI | Model Provider abstraction, Anthropic and OpenAI-compatible adapters, AI conflict Suggestions with Confidence, conflict evaluation corpus and harness |
| M7: Public beta | Signing, installers, auto-update, project website with SEO, manual accessibility pass, docs, first release |
| Post-launch | P1 items (including the web mode, GitLab Tier 2 and conflict verification), Linux, native OAuth sign-in, commit message generation |

## 14. Success Metrics

- Author uses it as their daily Git client for at least a month without falling back to another tool for routine tasks.
- Graph renders and scrolls smoothly on a 100k+ commit repository.
- Successful sign-in and push/pull against an SSO-protected GitHub organization and a GitHub Enterprise Server instance.
- A majority of AI Suggestions on the evaluation corpus match or nearly match the real merge result, and low-Confidence cases are correctly flagged. The corpus is built by replaying real merges from open-source repositories and treating the committed merge result as ground truth. The evaluation harness runs manually with the author's own API key and never in CI.
- Community signals after release: stars, issues filed, external contributions.

## 15. Resolved Questions

1. **Name and license:** Lanewise, MIT.
2. **Cloud AI providers:** Claude, ChatGPT models, Grok, Meta (Muse Spark, US-only preview) and Gemini, through three adapters (section 8.3).
3. **Local inference:** An external OpenAI-compatible server; no bundled runtime.
4. **Conflict verification:** Fast follow (P1), not v1.
5. **Git dependency:** A system Git installation (2.40 or later) is required; nothing is bundled.
6. **Auto-update:** In v1 (M7), reusing soundcheck's updater approach.
7. **Minimum OS:** Windows 10 22H2+/11 x64, macOS 14+ on Apple Silicon and Intel.
8. **Code signing:** macOS ad-hoc signed only (no Apple Developer account); Windows via SignPath Foundation once approved.
9. **Stack:** Tauri 2, Rust and React/TypeScript, matching soundcheck (ADR 0001).
10. **Web version:** A local web mode (`lanewise serve`) at P1, not a hosted or static site (ADR 0003).

## 16. Open Questions

1. Which Host gets Tier 3 (pull/merge request and CI) integration first after GitHub and GitLab: Bitbucket, Azure DevOps or another?
