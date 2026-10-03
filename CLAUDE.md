# Lanewise

A free, open-source desktop Git client for Windows and macOS with a visual commit graph and AI-assisted merge conflict resolution. The repository is `adrianeyre/lanewise`. Read these before changing anything:

- `CONTEXT.md`: the glossary. Use its terms in code, issues and docs, and never the words it lists under _Avoid_.
- `docs/product-requirements-document/git-client.md`: what is being built.
- `docs/architectural-decision-record/`: decisions already made, and why.
- `docs/processes/`: how Sandcastle runs work, and the owner's own guides, such as applying for Windows code signing.

## Layout

The Cargo workspace (Rust, edition 2024) and the pnpm workspace (Node 26) share the repository root (PRD §10.2).

- `core/`: Git operations behind traits, `gix` for fast reads and the system `git` CLI for network and porcelain-heavy operations (ADR 0002). UI-free.
- `graph/`: lane assignment and layout for the commit graph. UI-free. Only the visible window crosses the IPC boundary (ADR 0001).
- `commands/`: the transport-agnostic command API, credential store access, Host Integrations and the Logs, rolling files on this machine that Copy diagnostics reads for a bug report, shared by both shells (ADR 0003, ADR 0028).
- `desktop/`: the Desktop App, a Tauri 2 shell carrying the command API over Tauri IPC.
- `serve/`: Web Mode, a local server carrying the command API over a WebSocket and serving the UI (ADR 0003). A placeholder until P1.
- `catalog/`: the model catalog (`models.json` and its schema), which describes each Model Provider's live model list. The app ships with it and refreshes it from `main` (ADR 0021).
- `app/`: the React UI (TypeScript, Vite, plain CSS, lucide-react icons), including the `ai/` module. It sends commands through the `CommandClient` in `app/src/commands/api.ts`, which mirrors the `commands` crate, and reaches its shell through a `Platform` (`app/src/platform/`). Only `app/src/platform/tauri.ts` imports Tauri; oxlint enforces it, so Web Mode can supply its own `Platform`.
- `website/`: the project website, the landing and download page on GitHub Pages at `https://lanewise.adrianeyre.co.uk/`, not the app. It is drawn to HTML when built, with the app's footer and stylesheet, and `release.yml` deploys it after each push to `main` (ADR 0031, `website/README.md`).
- `bench/`: benchmarks of the built Desktop App, driven over WebDriver, starting with the Commit graph's PRD §11 targets on `git/git` (`bench/README.md`).
- `eval/`: the Evaluation corpus of Conflict Hunks from real merges in open-source repositories, each with its ground truth and credited (`eval/corpus/`), and the manual harness that measures Suggestions on it, made and run by `app/scripts/eval/` (PRD §14, ADR 0027, `eval/README.md`).

## Commands

Run from the repo root:

- `pnpm lint`: `cargo fmt --check`, `cargo clippy -D warnings`, `oxlint --deny-warnings`
- `pnpm typecheck`
- `pnpm test`: the Rust tests, then the UI tests (Vitest, Testing Library, jsdom). A Rust test that needs Git gets its `git` from `core/tests/support/`, which fails clearly if the one on `PATH` is older than 2.40
- `pnpm dev`: the UI alone in the browser
- `pnpm desktop:dev`: the Desktop App
- `pnpm website:dev` and `pnpm website:build`: the project website (`website/README.md`); `pnpm website:screenshots` takes its and the README's screenshots again
- `pnpm desktop:build`: the Desktop App's release build and, on macOS and Windows, its disk image or NSIS installer (ADR 0029), with signed update packages when it has the Update key (ADR 0030, the README's "Updates")
- `pnpm bench:graph --repository <a git/git clone>`: the Commit graph benchmark, against a release build under `xvfb-run` on Linux (`bench/README.md`)
- `pnpm eval:corpus`: replays the merges `eval/repositories.json` lists to make `eval/corpus/` again (`eval/README.md`)
- `pnpm eval:suggestions <model provider> …`: the Suggestion evaluation, run by hand in a terminal with your own API key, after its estimated cost; never in CI or a test (`eval/README.md`)

`pnpm lint`, `pnpm typecheck` and `pnpm test` must all pass before a commit, and CI (`.github/workflows/ci.yml`) runs all three on Ubuntu, Windows and macOS for every pull request. A push to `main` runs them again through `.github/workflows/release.yml`, where semantic-release makes a Release from the Conventional Commits merged (ADR 0029). Everything runs headless; a UI check that needs a real window (`xvfb-run -a` on Linux) or macOS or Windows is recorded as a hand check, not faked.

## Rules

- **Glossary.** Use `CONTEXT.md`'s terms: a Widget, not a panel; a Model Provider, not an AI provider; a Host, not a forge. Add a term there before using a new one.
- **Versions.** Node 26. pnpm at the version in `packageManager`, which is kept at the latest release. Every npm package, crate and GitHub Action you add or touch goes in at its latest version; look it up (`npm view <pkg> version`, `cargo search <crate>` or crates.io's `max_stable_version`, the action's latest release) instead of recalling one. Dependabot keeps them there afterwards. If the latest versions don't work together, say so in the PR; don't quietly pin an older one. Commit `pnpm-lock.yaml` and `Cargo.lock` with the change: installs use `--frozen-lockfile`.
- **Accessibility.** WCAG 2.2 AA everywhere: the Desktop App, Web Mode and the website. Every action has a keyboard alternative, focus is visible, reduced motion is respected and contrast holds in both themes. A UI test that draws something checks it with `expectNoAxeViolations` from `app/src/test/axe.ts`.
- **Widgets.** Every Widget follows ADR 0032: it has its fixed place in its page's layout, as GitKraken's are, scrolls on its own, and has a keyboard alternative to anything done by pointer, such as Shift+F10 for a right click.
- **The repository is always `adrianeyre/lanewise`**, in code, docs, URLs and metadata. Never write any other slug for it.
- **Free tooling only.** No paid services or licences. macOS builds are ad-hoc signed and never notarized.
- **AI.** The app only ever calls Model Providers with the user's own API keys, and never applies a Suggestion without explicit user action.
- **No telemetry** (PRD §11). Nothing is sent about how Lanewise is used. The Logs never hold credentials, API keys, file contents or prompts: log a command by its name and a failure by its `kind`, never a request, a response or a message (ADR 0028). A new URL the UI requests goes in the HTTP allow-list and in `app/src/platform/allowList.test.ts` with it.
- **Don't weaken a check to get green.** No skipped or loosened tests, no disabled lint rules, no `#[allow]`, `oxlint-disable` or `@ts-ignore` to silence a real problem.
- **Docs.** A new command, path or setup step goes in `docs/development.md`, the local setup the README links to, and in `CONTRIBUTING.md` if it changes how a contribution is made. `app/scripts/community.test.ts` holds every `pnpm` command, path, heading link and repository slug in them and in the README's `docs/` pages, the code of conduct, `SECURITY.md` and the issue forms to the tree.
- **Scope.** One issue at a time. Where a later issue fills something in, leave a short `TODO` naming it.
