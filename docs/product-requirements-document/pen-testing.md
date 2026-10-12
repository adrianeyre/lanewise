# Product Requirements Document: Pen-testing Lanewise

**Status:** Draft v0.1, the scope and the register of hypotheses
**Date:** 12 October 2026
**Owner:** Adi
**Label:** `prd:pen-test`

This file is the brief for Lanewise's first Pen-test round. What Lanewise is, and what it promises, stays in [`git-client.md`](./git-client.md) and the [architectural decision records](../architectural-decision-record/); nothing here restates them, and a tester who needs one reads it there. The words are [`CONTEXT.md`](../../CONTEXT.md)'s.

---

## 1. Current state of play

Lanewise is a Desktop App on Tauri 2: a Rust core that runs the system `git` and reads through `gix` (ADR 0002), a command API carried over Tauri IPC (ADR 0003), and a React UI in one main webview, with Host pages in child webviews of their own (ADR 0042). It holds three things worth taking:

1. **The user's repositories**, including private ones, and the right to write to them and push from them.
2. **The user's credentials**: Host sign-ins through `git credential` and Git Credential Manager (ADR 0016, ADR 0037), and Model Provider, Gateway and Issue Tracker keys in the OS credential store (ADR 0020, ADR 0035, ADR 0038).
3. **The user's trust in a Release**: an Update installs only what the Update key signed (ADR 0030), and every Release is built from `main` by `release.yml` (ADR 0029).

**Nothing in this tree has been probed by anyone who didn't write it.** Every review so far has been by its owner, or by agents working to the same brief they were building to. That is review, not testing.

Four facts set the tone of the round:

1. **The main webview has no Content Security Policy** (`"csp": null` in `desktop/tauri.conf.json`). The UI renders no HTML it didn't write, but if a script ever runs there, it has every command the command API has, including the one that hands the UI a Model Provider's key.
2. **Lanewise acts on a repository without being asked.** It fetches as a Tab is shown and as the window is focused (ADR 0044), and reads status and diffs through `gix` as soon as a repository opens. `SECURITY.md` leaves out "what a repository's own Git configuration or hooks run" because the system `git` runs them as it does on the command line; on the command line the user typed something first.
3. **Updates are off today.** The Update key's public half is empty in `desktop/tauri.conf.json`, so the Desktop App installs no Update until it is set. The day it is set is the day the updater becomes the most valuable thing to attack.
4. **Web Mode isn't built.** `serve/` is a placeholder until P1 (ADR 0003). Its design is in scope as a pre-condition (§9); a running server is not.

## 2. Problem statement

**Before the Update key is set, Web Mode ships or the Windows installer is signed, someone working against Lanewise, not for it, must probe this tree against a scope written for Lanewise, and file what they find, so the owner can sign those steps off against evidence rather than the care of whoever built them.**

Three reasons it should be now:

1. **The promises are the product.** No telemetry, keys only ever sent to their own Model Provider, nothing applied without the user, nothing installed the Update key didn't sign: Lanewise's case for being trusted with a private repository *is* those promises holding. A promise only its author has tested has been reviewed, not tested.
2. **The surface is still small.** Ten Tauri commands, one of which carries the command API's 87, two workflows and a placeholder server. It fits in one reading now; after Web Mode and the updater it won't.
3. **A Release can't be called back.** Once an installer or a signed Update package is on a Release, users have it. A fix is a new Release, and the old one stays on every machine that didn't take it.

## 3. Engagement shape

- **Who tests.** Lanewise uses free tooling only, so there is no vendor. The round is run by the owner and by agents briefed to break Lanewise rather than build it, each working one scope issue (§6). The same scope is what an outside researcher is pointed at through `SECURITY.md`'s private vulnerability reporting, and a report that arrives that way is welcomed into the round. **A round run by the people who built the tree isn't independent**, and its report says so.
- **Type: grey-box.** The tester has the whole source, which is public anyway; release builds; throwaway Host accounts on GitHub.com, GitLab, Bitbucket and Azure DevOps; throwaway Model Provider, Jira and Trello keys; and the Hostile repositories of E1. They **don't** have the Update key, the Windows signing secrets, the release workflow's tokens, or write access to `adrianeyre/lanewise`. Black-box would spend the round finding out what the source already says; the line that matters is the maintainer's secrets.
- **Target: the latest Release** on Windows and macOS, each in a disposable virtual machine or user account whose credential store holds only throwaway credentials. A source build on Linux is fine for exploring, but **a Finding is confirmed on a Release**. Never the tester's own machine account, credential store or repositories.
- **Data: synthetic.** No real project's repository, no real person's credentials, no real organization on a Host. Hostile repositories are made by a script that ships with the round's fixtures (E1).
- **Rules of engagement** (E3) are written before the window opens: the window's dates, the throwaway accounts every request may use, nothing done to a Host, Model Provider or Issue Tracker beyond what a normal user's account does, no pushing to any repository but the round's own, and a private channel for a critical Finding. They are in [`pen-testing-rules-of-engagement.md`](./pen-testing-rules-of-engagement.md), with the window's dates.

### 3.1 Out of scope

- **Hosts, Model Providers, Issue Trackers and Jev themselves.** GitHub, GitLab, Bitbucket, Azure DevOps, Jira, Trello, every Model Provider's API and TypeSafe AI's. A Finding is about what Lanewise sends them and does with their answers, never about them.
- **Git, Git Credential Manager, `gix`, Tauri and the OS credential stores themselves.** As `SECURITY.md` says, these are reported to their own projects. They are in scope only where Lanewise uses them unsafely, such as running `git` with an argument a branch name chose, or asking `gix` to run something the user didn't.
- **Gatekeeper and SmartScreen warnings.** The Mac app is signed ad hoc and never notarized, and the Windows installer is unsigned until SignPath Foundation signs it. Known, and documented in the README.
- **Denial of service.** A repository that is slow to draw is a bug, not a Finding. One that hangs or crashes Lanewise from a small crafted input is a Finding (low unless it loses work).
- **Social engineering, phishing of the owner, and physical access.**
- **A running Web Mode.** It doesn't exist yet; §9 is its pre-condition.
- **The Project website's host.** GitHub Pages is GitHub's; the website's own content and build are in scope (R4).

## 4. Disclosure

This file is public. A Finding is not, until it's fixed.

- **The register (§5) holds hypotheses about design and defence in depth**: what the tree reads like from outside, and the file that has to disprove it.
- **A lead with a concrete way to do harm is never written here, or in a public issue, first.** It goes through `SECURITY.md`'s private vulnerability reporting as a draft GitHub security advisory, is fixed in a Release, and is published as an advisory. Only then is it added to §5 and filed as a public Finding.
- A Finding shown on a Release to be critical or high (§7) is handled privately whoever found it, the owner included.
- Leads from the reconnaissance behind §5 that met this bar are held back from it under this rule, and join it once their fixes are released.

## 5. The tester's opening register

What follows is the reconnaissance a tester would do on day one, done in advance so the round starts from hypotheses rather than a directory listing. **Each entry is a hypothesis, not a Finding.** Where a behaviour is deliberate and documented, it says so; a documented decision is still a Finding when nothing records when it has to stop being true.

Severities are the opening estimate, for the order of work only.

### H1. Any script in the main webview has the whole command API · **high**

The main webview has no CSP (`desktop/tauri.conf.json`, and `app/index.html` says why: its inline theme script would need a hash). The capability in `desktop/capabilities/default.json` gives it the HTTP plugin, the opener for `https://*`, and every command `desktop/src/lib.rs` registers, including `call`, which carries all 87 of the command API's.

No HTML-rendering sink was found: no `dangerouslySetInnerHTML`, no Markdown library, Suggestions shown in CodeMirror as text, the Changelog parsed by hand. So this is about blast radius, not a known way in: one injected script reads every Model Provider key (`modelProviderKey`), makes requests through `gatewayRequest`, opens URLs, clones and pushes. Probe: every place untrusted text reaches the DOM or an attribute (Commit Messages, author names, branch and tag names, paths, Host page titles, Pull Request titles, Issue Tracker summaries, Release notes, `simple-icons` SVGs, CodeMirror language data), and whether a dependency renders HTML. And: is there a dated decision on the CSP?

### H2. A Host page reaches no command, but only its top-level origin is tested · **medium**

Host pages are child webviews (`desktop/src/host_pages.rs`) that no capability names, and `a_remote_page_such_as_a_host_page_reaches_no_command` (`desktop/src/lib.rs`) holds a top-level `https://github.com` to that, against Tauri's mock runtime. Navigation is limited to `https://` and `about:blank`. Probe on a Release: frames that inherit an origin (`about:srcdoc`, `blob:`, `data:`), a navigation to the app's own origin (`tauri://localhost`, `http://tauri.localhost` on Windows), whether `__TAURI_INTERNALS__` is reachable from any of them, and what spoofing the page's `lanewise.invalid` signals can do.

### H3. A Host page's Tab can be any https site · **low**

A Host page may navigate on to any `https://` page and keep its Tab, which looks like part of Lanewise. Probe: does the Tab show where it is now, well enough that a sign-in form on another site isn't taken for GitHub's?

### H4. The allow-list lets the window talk to any local port · **medium**

The HTTP plugin's scope allows `http://localhost:*` and `http://127.0.0.1:*`, for local Model Providers. Those requests are made from Rust, with any method, headers and body and no CORS: Docker's API, a dev server, a database's admin page. PRD §11 says every network call is over TLS. Probe: what a script in the main webview could do through those entries, and whether they could be narrowed to the Model Providers' own paths.

### H5. The allow-list isn't the only way out · **medium**

`SECURITY.md` says "the window can only make requests to the URLs on its allow-list, which a test holds it to". The test (`app/src/platform/allowList.test.ts`) holds the plugin's scope to the list. The webview's own `<img>`, `fetch`, `<link>` and `navigator.sendBeacon` aren't governed by it, because there is no CSP. Authors' pictures from `avatars.githubusercontent.com` (ADR 0035, opt-in) are one such request already, outside the list. Probe: every request a Release makes that isn't through the plugin. A control weaker than its documentation is a Finding even without an attack (§7).

### H6. Opening a Hostile repository runs what it says · **medium**

Lanewise reads status and diffs through `gix` (`core/src/status.rs`, `core/src/diff.rs`), which can run a repository's own filter drivers, and runs `git fetch --all --prune` on focus with no click (`core/src/remote.rs`, ADR 0044), which reads `.git/config`. `SECURITY.md` leaves out what a repository's configuration runs, on the grounds that `git` runs it on the command line too. Probe: what a repository downloaded as an archive, or shared on a network drive, runs when it's opened in Lanewise and the user does nothing else; whether `gix` applies ownership checks (`safe.directory`) as `git` does; and whether the exclusion in `SECURITY.md` still holds once nobody typed a command.

### H7. A ref name chooses an argument · **low**

`git` is run as an argument list, never through a shell (`core/src/git.rs`), and most commands take `--` before their arguments. A few, such as `branch` and `merge` (`core/src/branch.rs`, `core/src/merge.rs`), rely on validation that a name doesn't start with `-` instead. Probe: refs from a Hostile repository's `packed-refs` or a remote, remote URLs and paths starting with `-`, and whether every path that runs `git` with a name it didn't make has `--` or a check that can't be passed round.

### H8. A Model Provider's key crosses IPC in plaintext · **medium**

Gateway headers and Issue Tracker tokens never reach the UI; Model Provider keys do (`commands/src/model_provider.rs`, `app/src/ai/requests.ts`), because each Model Provider's SDK runs in the webview on the Platform's fetch (ADR 0022 to ADR 0024). That's a documented trade-off. Probe: whether a key ever outlives its request in the UI, reaches the Logs, devtools or a crash, and whether a release build can open devtools.

### H9. The Logs keep what they say they don't · **low**

The Logs redact anything shaped like a credential as they're written and read (`commands/src/logs.rs`, ADR 0028), by known prefixes and by name. Probe: tokens without a known prefix (Atlassian, Trello, Azure DevOps, Bitbucket), panic and internal-error messages built from untrusted text, `writeLog` with whatever the UI sends, the Log files' permissions, and what Copy diagnostics puts in a public bug-report form.

### H10. A Conflict Hunk can write its own Suggestion · **medium**

A Conflict Hunk's text, its path and the Commit Messages around it go into the prompt. A Hostile repository can say whatever it likes there. The checks in `app/src/ai/confidence.ts` (ADR 0025) catch leftover Conflict Markers, empty answers and a side's lines dropped; they don't catch a plausible Resolution that quietly removes a check. Probe: a Suggestion that passes every check at high Confidence and is harmful, as evidence for how the AI Suggestion Widget presents Confidence; and that nothing, including the Suggestions for every Conflict Hunk (ADR 0026) and Jev's answers (ADR 0036), ever puts anything in a Resolution without Accept or Edit.

### H11. A downgrade is refused once the Update key exists · **low today, high once it's set**

The updater checks the Update key's signature (`desktop/src/update.rs`, ADR 0030), and the release workflow checks it again before writing `latest.json`. Probe, before the key is set: whether an older, genuinely signed Update is refused; who can edit a Release's assets, and so `latest.json`; and how the key would be rotated if it leaked.

### H12. The release job's secrets are open to every build script · **medium**

`TAURI_SIGNING_PRIVATE_KEY` and its password (and, once set, the Windows signing secrets) are in the environment of `pnpm desktop:build` in `release.yml`. Every Cargo `build.rs`, proc macro and Vite plugin in the tree runs in that step. The release job runs `semantic-release` with a token that can write contents, issues and Pull Requests. Probe: what a malicious transitive dependency could take or do in each job, whether caches restored into those jobs can be written by anything else, and what `main`'s branch protection allows.

### H13. The Model catalog is trusted because it's on `main` · **low**

The Model catalog is fetched from `main` over TLS and checked against its schema, with no signature (`app/src/ai/modelCatalog.ts`, ADR 0021). It holds names, Efforts and `match` regular expressions, and no URLs. Probe: what a hostile catalog could do with a regular expression (catastrophic backtracking) or a misleading name.

### H14. Sandcastle hands an agent public text and a token · **medium**

Sandcastle gives its agent an issue and its comments, which anyone can write, inside a container that holds a Model Provider credential and a read-only GitHub token, and its commits come back to the owner's branch (`docs/processes/running-sandcastle.md`). Probe: what an issue comment can make the agent do, what the container can reach on the network, and what review a commit gets before it reaches `main`.

### H15. No static analysis reads the tree · **low**

Dependabot keeps dependencies current (`.github/dependabot.yml`) and every action is pinned to a commit. No code scanning or secret scanning workflow is in the repository. Probe: what GitHub's own settings have turned on, and who reads its alerts.

## 6. Scope partition

The round's scope issues, each labelled `prd:pen-test` and titled `pen-test [<ID>]: <surface>`, split the surface along Lanewise's own boundaries. Each names its trust boundary, links the `CONTEXT.md` terms and ADRs that govern it, points at the code, and lists the hypotheses of §5 it starts from.

- **Enablement (E1 to E4).**
  - E1: the fixtures, a script that makes Hostile repositories: crafted refs and paths, configuration and attributes, symlinks, case collisions, and merges left in conflict.
  - E2: the throwaway accounts and keys, and the disposable machines.
  - E3: the rules of engagement (§3), in [`pen-testing-rules-of-engagement.md`](./pen-testing-rules-of-engagement.md).
  - E4: the Findings workflow, its labels and its issue form (§7).
- **Webview and IPC (W1 to W4).**
  - W1: the main webview's CSP and the blast radius of the command API (H1).
  - W2: Host pages' isolation (H2, H3).
  - W3: the HTTP allow-list and every request outside it (H4, H5).
  - W4: Gateways: that the headers the UI never sees go only where they were saved for, and that `gatewayRequest` stays under its address.
- **Hostile repository (G1 to G4).**
  - G1: what opening, fetching and diffing runs (H6).
  - G2: arguments chosen by refs, URLs and paths (H7).
  - G3: Lanewise's own writes and deletes: every place it writes or removes a file by a path a Hostile repository chose.
  - G4: clone URLs, transports and submodules.
- **Secrets and the Logs (S1 to S3).**
  - S1: keys and tokens crossing IPC (H8).
  - S2: the OS credential store entries and who else can read them.
  - S3: the Logs and Diagnostics (H9).
- **Suggestions (M1, M2).**
  - M1: prompt injection from a Hostile repository (H10).
  - M2: proving that nothing is applied without the user, across every Model Provider and Jev.
- **Releases and delivery (R1 to R5).**
  - R1: Updates, their signature and downgrades (H11).
  - R2: the release workflow's secrets and tokens (H12).
  - R3: caches, branch protection and the Model catalog (H13).
  - R4: the Project website's content and build.
  - R5: Sandcastle (H14).
- **Web Mode (P1).** The design review of §9, before any of it is built.

One more issue builds rather than probes: code scanning for the tree, with a named owner for its alerts (H15).

## 7. Findings workflow

Every Finding is an issue of its own, titled `[finding] <ID> — <what it does>`, where `<ID>` is its scope issue's with a number (`G3-1`). It carries `prd:pen-test`, one of `severity:critical`, `severity:high`, `severity:medium` or `severity:low`, and a link to its scope issue. It says which promise it breaks, from the PRD, an ADR or `SECURITY.md`, the Release it was shown on, and the test that would have caught it. A critical or high Finding is a private security advisory until its fix is released (§4). A public Finding is filed with the [Finding issue form](../../.github/ISSUE_TEMPLATE/finding.yml), which asks for each of these and says first that a critical or high one goes privately instead. The owner triages it, labels its severity and sets its target as [Triaging a Finding](../processes/triaging-a-finding.md) says (E4).

Targets, in days after the Finding is confirmed on a Release:

| Severity | Target | What it means here |
|---|---|---|
| critical | 7, as a Release and an advisory | Code runs, a credential or API key leaves, or a file outside the working tree is written, from something the user only opened, cloned or fetched; or an Update not signed by the Update key installs. |
| high | 30 | The same, but it needs the user to do one more ordinary thing, such as resolve a conflict; or a promise is kept in one layer only, with nothing behind it. |
| medium | 90 | A control is weaker than its documentation says, or a boundary has nothing behind it if the one in front fails. |
| low | best effort | Hygiene, disclosure, or a documented decision with no date it has to stop being true. |

A Finding that won't be fixed needs the owner's written reason in the issue **before** `wontfix` goes on it.

## 8. Pre-condition: setting the Update key

Before `pubkey` in `desktop/tauri.conf.json` is set and the Update key's secret goes into `release.yml`:

1. R1 and R2 are closed, with every Finding above low fixed or waived.
2. It is written down who holds the private half, where its backup is, and how it is rotated, including the Release that would ship a new public half if the old one leaked.
3. An older, genuinely signed Update is shown to be refused.
4. It is written down who can edit a Release's assets.

## 9. Pre-condition: Web Mode, before it is built

ADR 0003 and PRD §7.12 say Web Mode listens on `127.0.0.1` only, with an access token made fresh at every start. Before P1's first line of `serve/`, a design review answers, and records in an ADR:

1. How the token is made, how long it is, and where it can leak: a Referer, the browser's history, the Logs, a shell's history.
2. How the WebSocket checks a connection's `Origin`, and how DNS rebinding is refused.
3. Whether a page on another site can open the WebSocket (cross-site WebSocket hijacking), and what it gets.
4. Which commands cross the WebSocket. In particular, whether `modelProviderKey` does, or whether Web Mode's Model Provider requests are made by the server.
5. What happens with two browsers, or two users on one machine.

## 10. Success criteria

1. Every scope issue in §6 is filed, labelled and anchored before the window opens, so the round works against a scope written for Lanewise, not a copy of a generic checklist.
2. The fixtures, the throwaway accounts and the disposable machines are ready, and none holds a real credential or a real project's repository.
3. Every Finding is filed, publicly or as a private advisory as §4 says, within a day of being confirmed.
4. **H1 has a dated answer:** a CSP for the main webview, or a recorded decision saying why not, with the date it will be looked at again.
5. **H6 has a dated answer:** what Lanewise runs from a repository the user only opened, written in `SECURITY.md` in words that match what the code does.
6. Every Finding above low is fixed or waived before the first of these: the Update key is set (§8), Web Mode ships (§9), or the Windows installer is signed.
7. The round's report says who ran it, and that a round run by the tree's own authors and their agents isn't independent.
