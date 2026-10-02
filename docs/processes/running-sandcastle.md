# Running Sandcastle

[Sandcastle](https://github.com/mattpocock/sandcastle) runs a coding agent
against this repository inside a container and merges the commits it makes back
to the branch you launched from. Lanewise's slices are worked this way: one
GitHub issue of `adrianeyre/lanewise` per run, with the runs' commits collecting
on one branch that becomes one pull request.

`.sandcastle/` holds the configuration. This file says how to use it here, and
what an agent running here has to be told.

## What is in `.sandcastle/`

| Path           | What it is                                                              |
| -------------- | ----------------------------------------------------------------------- |
| `Dockerfile`   | The sandbox image: Node 26, git, `gh`, Claude Code, Rust, Tauri's deps  |
| `main.ts`      | The entrypoint: which prompt, which issue, which branch, which hooks    |
| `prompt.md`    | The committed template every run's prompt starts from                   |
| `prompt-*.md`  | A run's own prompt, **gitignored**: written per run and not kept        |
| `.env.example` | The keys a run needs, with nothing filled in                            |
| `.gitignore`   | Keeps `.env`, `logs/`, `worktrees/` and your own prompts out of git     |

`logs/` and `worktrees/` appear the first time you run something. Both are
ignored, and so is `.env`. **Never commit a token.**

## One-time setup

**1. A container runtime.** Docker Desktop or the Docker engine, running:
`docker info` should print rather than fail. `main.ts` uses Sandcastle's
`docker()` sandbox, so `.sandcastle/Dockerfile` is the image.

**2. Dependencies at this checkout.** `pnpm install`. `@ai-hero/sandcastle` and
`tsx` are devDependencies, and `pnpm sandcastle` runs `main.ts` with `tsx` on
the host.

**3. Keys.**

```bash
cp .sandcastle/.env.example .sandcastle/.env
claude setup-token          # prints a CLAUDE_CODE_OAUTH_TOKEN
```

Put that in `CLAUDE_CODE_OAUTH_TOKEN` to run the agent on your Claude
subscription, or use `ANTHROPIC_API_KEY` instead. `GH_TOKEN` is a
[fine-grained token](https://github.com/settings/personal-access-tokens/new) on
`adrianeyre/lanewise` with **Issues: read** and **Metadata: read**. The prompt
fetches the brief with `gh issue view`, so without it the run fails before the
agent starts.

**A key named with no value is filled from your shell.** Sandcastle forwards
exactly the keys `.sandcastle/.env` names. For each one it takes the file's
value if there is one and your shell's (`process.env`) if not. So a secret you
already export reaches the sandbox without ever being written to a file:

```bash
CLAUDE_CODE_OAUTH_TOKEN=
GH_TOKEN=
ANTHROPIC_BASE_URL=
```

is complete, not unfinished. The corollary is the failure mode: a variable your
shell exports and `.env` does not name is **not** forwarded, and nothing in the
log says it was dropped.

**A private CA needs the file, not the path.** If you reach Anthropic through a
gateway with its own certificate authority, `NODE_EXTRA_CA_CERTS` on the host
names a file the container cannot see. `main.ts` mounts that file read-only at
`/home/agent/ca-certificates.pem` and points the variable there. The container
also has to be able to route to the gateway: a private address works on
Docker's default bridge, a gateway reachable only through the host's loopback
does not.

**4. Build the image.**

```bash
npx sandcastle docker build-image
```

It builds `.sandcastle/Dockerfile` as `sandcastle:<repo-dir-name>` and passes
your own UID and GID as `AGENT_UID`/`AGENT_GID`, so files the image writes and
files the bind mount writes share an owner. **Run it again after every
Dockerfile change**: runs use the image you last built, not the Dockerfile on
the branch. `npx sandcastle docker remove-image` throws it away.

## What the image carries, and why

The Dockerfile's comments are the detail. In short:

- **What Sandcastle needs**: the non-root `agent` user (Claude Code refuses to
  run as root), `git`, `gh` and `claude` on `PATH`. Keep all four whatever else
  changes.
- **Node 26 and pnpm through corepack.** The base is `node:26-trixie` because
  the workspace declares `"node": ">=26"`. Corepack reads `packageManager` from
  `package.json`, so pnpm's version is pinned in one place.
- **`git` 2.40 or later**, the minimum Lanewise supports (ADR 0002). Debian 13
  ships 2.47, and the build fails if the image's `git` is ever older than 2.40.
- **Tauri 2's Linux build dependencies**: WebKitGTK 4.1, GTK 3, librsvg,
  OpenSSL, pkg-config, libxdo and `file`. Linux builds are for development and
  CI only (PRD §10.1).
- **Rust stable** with clippy and rustfmt, which `pnpm lint` runs.
- **xvfb and xauth**, so the WebKitGTK webview can run headlessly. Use
  `xvfb-run -a <command>`.

## Dependencies are a hook's job, not the image's

The image installs no workspace dependencies, because they would be baked in at
build time and go stale at the next lockfile change. `main.ts` runs
`corepack pnpm install --frozen-lockfile` in an `onSandboxReady` hook instead,
so every run gets the tree's own versions. `--frozen-lockfile` is deliberate: a
slice that adds a dependency commits the updated `pnpm-lock.yaml`, which keeps
the change reviewable.

**`onSandboxReady` hooks run in parallel**, not in order. A hook that needs
`node_modules` must not be a sibling of the install hook. Chain it onto the
install with `&&` instead, under one timeout that covers both.

## Running it

Launch from a branch, **never from `main`**:

```bash
git checkout -b slice-2-sandbox-image origin/main
pnpm sandcastle 2
```

`main.ts` gives the agent its own worktree and branch (`merge-to-head`), then
merges the result back into the branch you launched from. On `main` that would
put unreviewed agent commits straight on the trunk, so `main.ts` refuses to
start there. Commit or stash your own changes before you launch, since the
merge lands in this checkout.

The three forms:

```bash
pnpm sandcastle 7                        # .sandcastle/prompt.md, against issue #7
pnpm sandcastle prompt-issue-7.md 7      # your own prompt beside it, against #7
pnpm sandcastle                          # only for a prompt naming no issue
```

A bare number is read as the issue. A prompt that contains `{{ISSUE}}` needs
one, and `main.ts` refuses to start without it rather than failing after the
sandbox is built.

The startup lines name the prompt, issue, branch and forwarded CA. Progress
streams to the terminal and a full log lands under `.sandcastle/logs/`. At the
end `main.ts` prints the number of commits, the completion signal that stopped
the run, and the log's path.

**Don't run heavy commands on the host while a sandbox is up.** The container
has no memory limit and competes with the host. If the host's OOM killer takes
the agent, the run ends with `exited with code 137`.

## Writing the prompt

`prompt.md` is the committed template. For a run that needs more than the
issue, copy it to a gitignored `prompt-<something>.md`, add what you know, and
launch that. A committed prompt is a snapshot of a tree that has since moved,
which is why only the template is tracked.

A prompt here has five parts, and the template carries all of them:

1. **What to read first**: `CLAUDE.md`, `CONTEXT.md` (use its terms, never the
   _Avoid_ words), the PRD, every ADR, and the recent history.
2. **The brief itself**, fetched from the issue with
   `gh issue view {{ISSUE}} --repo adrianeyre/lanewise`, then its comments.
3. **What must survive**: the harness in `.sandcastle/`, the `sandcastle` script
   and its devDependencies, `pnpm-workspace.yaml`'s `allowBuilds`, the
   lockfile, and everything earlier slices built.
4. **The invariants**: the `adrianeyre/lanewise` slug, latest versions of
   everything checked rather than remembered, free tooling only, users' own
   API keys, WCAG 2.2 AA and ADR 0004, staying in scope with `TODO(#n)`, and no
   weakened tests or lint rules.
5. **The verification commands**, `pnpm lint`, `pnpm typecheck` and
   `pnpm test`, plus how to commit (`Refs #<issue>` and the co-author line).

Three pieces of Sandcastle syntax do the work:

- <code>!&#96;command&#96;</code> is replaced by the command's output **before**
  the agent sees the prompt. The commands run inside the sandbox, after the
  hooks, so they see the installed tree. They run in parallel, and a non-zero
  exit fails the run. The pattern matches anywhere in the file, so never write
  an exclamation mark directly before a backtick in a prompt's prose.
- `{{KEY}}` is filled from `promptArgs` on the host, before the commands run, so
  a placeholder inside a command is resolved by then. `main.ts` passes `ISSUE`.
  `{{SOURCE_BRANCH}}` and `{{TARGET_BRANCH}}` are built in. A placeholder with
  no value is an error.
- `<promise>COMPLETE</promise>` ends the run early. Sandcastle never injects
  it: the prompt has to ask for it, and one that forgets runs until
  `maxIterations` (6) or the 30-minute idle timeout.

## What a sandbox here cannot do

- **Push, or open a pull request.** The host merges the commits back and you
  open the pull request.
- **Show a screen.** `xvfb-run -a` gives the WebKitGTK webview a virtual
  display, which is enough for headless UI checks and performance measurement.
  It is not a look-and-feel check.
- **Run macOS or Windows.** WKWebView, WebView2, the installers, signing and the
  OS credential stores can only be checked on real machines (ADR 0001). A run
  records those as hand checks for the pull request rather than faking them.

## Cleaning up

Worktrees live under `.sandcastle/worktrees/`. A clean one is deleted when the
run ends. A dirty one is kept on purpose, so uncommitted work survives a crash,
and `main.ts` prints its path as `kept`. Recover what you need with
`git -C <path> diff`, then `git worktree remove <path>`.

## Troubleshooting

| Symptom                                                | Cause                                                                              |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `Image 'sandcastle:…' not found locally`               | The image was never built here: `npx sandcastle docker build-image`                |
| `ERR_MODULE_NOT_FOUND` for `@ai-hero/…`                | `pnpm install` not run at this checkout                                            |
| `Refusing to run on main`                              | You launched from `main`; cut a branch first                                       |
| `contains {{ISSUE}}, so it needs an issue number`      | Pass the issue: `pnpm sandcastle <issue>`                                          |
| The run fails on `gh issue view`                       | `GH_TOKEN` missing from `.sandcastle/.env`, or it lacks **Issues: read**           |
| The agent exits asking to authenticate                 | `.sandcastle/.env` missing, or it doesn't name `CLAUDE_CODE_OAUTH_TOKEN`           |
| A variable set in your shell never reaches the sandbox | `.sandcastle/.env` doesn't name that key, so it was not forwarded                  |
| `unable to verify the first certificate`               | `NODE_EXTRA_CA_CERTS` points at a file that doesn't exist on the host              |
| Permission errors on files the agent wrote             | The image was built for another UID: rebuild it                                    |
| A tool the Dockerfile installs is missing              | The image predates that Dockerfile change: rebuild it                              |
| `ERR_PNPM_IGNORED_BUILDS` in the install hook          | A dependency with a build script is missing from `allowBuilds`                     |
| The run goes on long after the work is done            | The prompt never asked for `<promise>COMPLETE</promise>`                           |
| `exited with code 137`                                 | The host's OOM killer; don't run heavy work on the host during a run               |

## See also

- [Sandcastle](https://github.com/mattpocock/sandcastle): the upstream README
  is the reference for `run()`, the sandbox providers and the hooks.
- [ADR 0001](../architectural-decision-record/0001-tauri-rust-react-stack.md)
  for the stack the image builds, and
  [ADR 0002](../architectural-decision-record/0002-system-git-for-network-operations.md)
  for the `git` it requires.
