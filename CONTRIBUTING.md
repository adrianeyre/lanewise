# Contributing to Lanewise

Thank you for helping. Lanewise is a free, open-source Git client, and it's built in the open at [`adrianeyre/lanewise`](https://github.com/adrianeyre/lanewise). Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). A security problem is reported privately, as [SECURITY.md](SECURITY.md) says, never in an issue or a pull request.

## Before you start

- **Read what's been decided.** The [product requirements document](docs/product-requirements-document/git-client.md) says what's being built, and the [architectural decision records](docs/architectural-decision-record/) say how, and why. A change that goes against one starts with a new ADR ([below](#decisions-are-recorded-in-adrs)).
- **Find or open an issue.** For anything more than a small fix, say what you mean to do on its issue first, so nobody works on the same thing twice. Use the issue forms: [a bug](https://github.com/adrianeyre/lanewise/issues/new?template=bug-report.yml), [a feature](https://github.com/adrianeyre/lanewise/issues/new?template=feature-request.yml) or [an accessibility barrier](https://github.com/adrianeyre/lanewise/issues/new?template=accessibility.yml).
- **One issue per pull request.** Where a later issue will fill something in, leave a short `TODO(#<issue>)` naming it rather than doing it too.

## Setting up

[Setting Lanewise up locally](docs/development.md) takes you through it step by step, and [Common setup problems](docs/development.md#common-setup-problems) through what goes wrong. In short, you need Node 26, pnpm through corepack at the version in `package.json`'s `packageManager`, Rust stable with `clippy` and `rustfmt`, Git 2.40 or later and Tauri 2's system dependencies. Then:

```bash
git clone https://github.com/adrianeyre/lanewise.git
cd lanewise
pnpm install
pnpm desktop:dev   # the Desktop App, from source
```

Fork the repository to send a pull request, and clone your fork instead; add `https://github.com/adrianeyre/lanewise.git` as the `upstream` remote to keep up with `main`.

## Where things are

| Path | What it is |
| --- | --- |
| `core/` | Git operations behind traits: `gix` for fast reads, the system `git` for network and porcelain-heavy operations (ADR 0002). No UI |
| `graph/` | Lane assignment and layout for the Commit graph. No UI; only the visible window crosses to the UI (ADR 0001, ADR 0005) |
| `commands/` | The command API both shells carry, the credential store, Host Integrations and the Logs (ADR 0003, ADR 0028) |
| `desktop/` | The Desktop App: a Tauri 2 shell carrying the command API over Tauri IPC |
| `serve/` | Web Mode, a local server carrying the command API over a WebSocket. A placeholder for now |
| `catalog/` | The model catalog, `models.json`, and its schema (ADR 0021) |
| `app/` | The React UI (TypeScript, Vite, plain CSS, lucide-react icons). It sends commands through `CommandClient` in `app/src/commands/api.ts`, and reaches its shell through a `Platform` in `app/src/platform/` |
| `website/` | The project website (ADR 0031, `website/README.md`) |
| `bench/` | The Commit graph benchmark (`bench/README.md`) |
| `eval/` | The Evaluation corpus and the Suggestion evaluation's results (ADR 0027, `eval/README.md`) |
| `docs/` | The PRD, the ADRs and `docs/processes/` |

`CLAUDE.md` says the same for the coding agents that work on Lanewise, with the rules below; they hold for people too.

## Tests and lint

All three must pass before every commit, and CI (`.github/workflows/ci.yml`) runs them on Ubuntu, Windows and macOS for every pull request:

```bash
pnpm lint        # cargo fmt --check, cargo clippy -D warnings, oxlint --deny-warnings
pnpm typecheck   # tsc for app/, bench/ and website/
pnpm test        # the Rust tests, then Vitest in app/, bench/ and website/
```

- **Rust.** Unit tests sit beside the code in `#[cfg(test)]` modules, and integration tests in each crate's `tests/`. A test that needs Git takes its `git` from `core/tests/support/`, which fails clearly if the one on `PATH` is older than 2.40. `cargo fmt --all` fixes formatting.
- **The UI.** Vitest with Testing Library. A test that draws the UI starts with a `// @vitest-environment jsdom` line, and checks what it drew with `expectNoAxeViolations` from `app/src/test/axe.ts`. Test what the user sees and does, by role and name, rather than a component's insides.
- **Everything runs headless.** A check that needs a real window, macOS or Windows can't be faked in jsdom: say in the pull request what you checked by hand, and on what.
- **Never weaken a check to get green.** No skipped or loosened tests, no disabled lint rules, no `#[allow]`, `oxlint-disable` or `@ts-ignore` to hide a real problem. Fix the problem, or say in the pull request why you couldn't.

A change to the Commit graph's loading or drawing should be measured with `pnpm bench:graph` too (`bench/README.md`), and a change to how Suggestions are asked for can be measured with `pnpm eval:suggestions` with your own key (`eval/README.md`). Neither is needed for other changes, and the evaluation never runs in CI.

## The rules every change follows

- **Accessibility.** WCAG 2.2 AA in the Desktop App, Web Mode and on the website. Every action has a keyboard alternative, focus is visible, reduced motion is respected, and contrast holds in both Themes.
- **Widgets.** Every Widget follows ADR 0032: it has its fixed place in its page's layout, as GitKraken's are, scrolls on its own, and has a keyboard alternative to anything done by pointer, such as Shift+F10 for a right click.
- **No telemetry.** Nothing is sent about how Lanewise is used. The Logs never hold credentials, API keys, file contents or prompts: log a command by its name and a failure by its `kind`, never a request, a response or a message (ADR 0028). A new URL the UI requests goes in the HTTP allow-list and in `app/src/platform/allowList.test.ts`.
- **AI.** Lanewise only calls Model Providers with the user's own API key, and never applies a Suggestion without the user's explicit action.
- **Only `app/src/platform/tauri.ts` imports Tauri**, which oxlint enforces, so Web Mode can supply its own `Platform`.
- **Latest versions.** A package, crate or GitHub Action you add or touch goes in at its latest version: look it up (`npm view <package> version`, `cargo search <crate>`, the action's latest release) rather than recalling one. Commit `pnpm-lock.yaml` and `Cargo.lock` with the change; CI installs with `--frozen-lockfile`. If the latest versions don't work together, say so in the pull request rather than quietly pinning an older one. A package with a build script needs an entry in `allowBuilds` in `pnpm-workspace.yaml`.
- **Free tooling only.** No paid services or licences.
- **The repository is `adrianeyre/lanewise`** in code, docs, URLs and metadata.

## The glossary

[`CONTEXT.md`](CONTEXT.md) is Lanewise's glossary, and its words are the ones to use in code, issues, pull requests and docs: a Widget, not a panel; a Model Provider, not an AI provider; a Host, not a forge; a Conflict Hunk, not a conflict block. Each term lists the words to avoid under _Avoid_, and those stay out.

When a change brings in something the glossary has no word for, add the term to `CONTEXT.md` in the same pull request, under the section it belongs to: its name in bold, then one short paragraph saying what it is, then its _Avoid_ line. Terms are capitalized where they're used, as they are there.

## Commits and pull requests

Lanewise's Releases are made by semantic-release from the [Conventional Commits](https://www.conventionalcommits.org) merged to `main` (ADR 0029), so the type you give a change decides whether it releases, and how:

| Type | For | Release |
| --- | --- | --- |
| `feat:` | something new a user can do | minor |
| `fix:` | a bug fixed | patch |
| `perf:`, `refactor:`, `revert:`, `build:` | faster, restructured, undone, or built differently | patch |
| `docs:`, `test:`, `chore:`, `ci:`, `style:` | the docs, the tests, upkeep, CI, formatting | none |
| any type with `!`, such as `feat!:`, or a `BREAKING CHANGE:` footer | a change that breaks what worked before | major |

- **The subject** says what changed, in the imperative, after the type, such as `feat: stage a Hunk from the diff with the keyboard`. A scope is optional: `fix(graph): …`.
- **The body** says why, and what a reviewer should know. End it with `Refs #<issue>`, or `Fixes #<issue>` for the commit that finishes it.
- **Make each commit coherent**, with the three checks passing at each one.
- **The pull request's title** is a Conventional Commit too. semantic-release reads only what lands on `main`: a squash-merge lands the title, and a merge lands each commit's subject, so both have to be right. Its description says what it changes, which issue it's for, and what you checked by hand that CI can't.

## Decisions are recorded in ADRs

A decision that shapes how Lanewise is built, and would be costly or confusing to undo, is recorded as an architectural decision record in [`docs/architectural-decision-record/`](docs/architectural-decision-record/): choosing a library or a protocol, how data crosses a boundary, how something is stored or signed, or anything a later contributor would otherwise "fix" without knowing why it's so. A bug fix or a change inside what an ADR already says needs none.

1. **Number it** with the next free number, four digits, and name the file after the decision, as a sentence in lowercase words joined by hyphens: `0032-<what-was-decided>.md`.
2. **Title it** with the decision itself, such as "Stashes named by commit and applied through Git", not the question.
3. **Say what's needed** in the opening paragraph: the PRD sections and earlier ADRs it answers to.
4. **Say what was decided, and why**, under headings that each state part of the decision. Name what was weighed and turned down, and why, and keep any measurements that decided it, with how they were taken.
5. **End with its consequences**, what it makes easier and harder, and, where some of it can only be checked on a real machine, what's still to check by hand.
6. **Put it in the pull request that makes the change**, with any new term in `CONTEXT.md` and any command or layout change in `CLAUDE.md` and `docs/development.md`.

Once merged, an ADR records what was decided then. When a decision changes, a new ADR says what changed and why, naming the one it changes, rather than the old one being rewritten.

## Coding agents

Much of Lanewise is written by coding agents run with [Sandcastle](https://github.com/mattpocock/sandcastle), one issue per run; `docs/processes/running-sandcastle.md` says how. Their pull requests are reviewed as anyone's are, and a human merges them.

## Licence

By contributing, you agree that your contribution is released under the project's [MIT licence](LICENSE).
