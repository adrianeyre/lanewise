# Setting Lanewise up locally

[Back to the README](../README.md)

These steps take you from nothing to a running Desktop App built from source, with the tests passing. Lanewise is developed and tested on Linux, and ships for Windows and macOS; every command here runs from the root of your clone.

## 1. What you need, and how to check it

| | Version | Check with | Should print |
| --- | --- | --- | --- |
| Node | 26 | `node --version` | `v26.…` |
| corepack | latest | `corepack --version` | a version |
| pnpm | the one in `package.json`'s `packageManager` | `pnpm --version` | the same version as `packageManager` |
| Rust | stable, with `clippy` and `rustfmt` | `rustc --version`, `cargo clippy --version`, `cargo fmt --version` | a version from each |
| Git | 2.40 or later | `git --version` | `git version 2.40.0` or later |
| Tauri 2's system dependencies | for your platform | [below](#2-tauri-2s-system-dependencies) | |

**Node 26.** Install it from [nodejs.org](https://nodejs.org/en/download), or with a version manager such as [nvm](https://github.com/nvm-sh/nvm) (`nvm install 26`) or [fnm](https://github.com/Schniz/fnm) (`fnm install 26`). The workspace declares `"node": ">=26"`, and CI runs 26.

**pnpm, through corepack.** Node no longer ships corepack, so install it, then let it provide pnpm:

```bash
npm install -g corepack@latest
corepack enable
pnpm --version   # run inside your clone: corepack reads packageManager from package.json
```

corepack downloads the pnpm version in `packageManager` the first time, and may ask before it does. Don't install pnpm globally at another version; `corepack enable` puts its `pnpm` first on your `PATH`.

**Rust stable, with clippy and rustfmt.** Install [rustup](https://rustup.rs) (on Windows, `winget install --id Rustlang.Rustup` also works), then:

```bash
rustup toolchain install stable --component clippy,rustfmt
rustup default stable
```

The workspace is edition 2024. Keep it current with `rustup update stable`.

**Git 2.40 or later**, as [Git and Git Credential Manager](installing.md#git-and-git-credential-manager) says. Git Credential Manager is needed only to sign in to Hosts from the app you run, not to build it or run its tests. The Rust tests run the `git` on your `PATH`, and stop, naming it, if it's older than 2.40.

## 2. Tauri 2's system dependencies

The Desktop App is a [Tauri 2](https://v2.tauri.app/start/prerequisites/) app, so it needs a webview and a native toolchain.

**Linux** (Debian or Ubuntu; Linux builds are for development and CI only). The packages CI installs, plus a C toolchain:

```bash
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  build-essential pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libssl-dev libxdo-dev file
pkg-config --modversion webkit2gtk-4.1   # prints WebKitGTK's version
```

On Fedora, Arch and others, install the equivalents from [Tauri's list](https://v2.tauri.app/start/prerequisites/#linux). The benchmark needs `webkit2gtk-driver` and `xvfb` as well ([step 6](#6-the-commit-graph-benchmark)). Saving a Model Provider's API key in the app needs a running Secret Service, such as GNOME Keyring or KWallet.

**macOS.** The Xcode Command Line Tools, which are enough for a desktop app; full Xcode works too:

```bash
xcode-select --install
xcode-select -p   # prints where they are once installed
```

The macOS webview, WKWebView, is part of the system. To build the universal app a Release has, add both Mac targets: `rustup target add aarch64-apple-darwin x86_64-apple-darwin`.

**Windows.**

- **The Microsoft C++ Build Tools:** from [Visual Studio's downloads](https://visualstudio.microsoft.com/visual-cpp-build-tools/), with the **Desktop development with C++** workload.
- **WebView2:** already installed on Windows 10 (from version 1803) and Windows 11. On an older one, install the Evergreen Bootstrapper from [Microsoft's WebView2 page](https://developer.microsoft.com/microsoft-edge/webview2/).
- **Rust's MSVC toolchain:** choose an MSVC host, such as `x86_64-pc-windows-msvc`, when rustup asks, or run `rustup default stable-msvc`. Then restart your terminal.

The NSIS installer's tools are downloaded by Tauri the first time you build it.

## 3. Clone and install

```bash
git clone https://github.com/adrianeyre/lanewise.git
cd lanewise
pnpm install
```

`pnpm install` installs every package in the workspace (`app/`, `bench/` and `website/`). CI installs with `pnpm install --frozen-lockfile`, which fails rather than change `pnpm-lock.yaml`; use it too to be sure you have exactly what CI has. The Rust crates are fetched by Cargo the first time something builds.

## 4. Run it

```bash
pnpm desktop:dev
```

This is the Desktop App from source: Tauri starts the UI's Vite dev server on `http://localhost:5150`, builds the Rust workspace in debug and opens the window. The first build compiles every crate and takes several minutes; later ones are quick. A change to the UI reloads at once, and a change to the Rust code rebuilds and restarts the app. A copy run this way never updates itself.

```bash
pnpm dev
```

This is only the UI, at `http://localhost:5150`, in your browser. It has no core to talk to, so anything that needs Git fails, saying "This is Lanewise's UI on its own, in a browser". It's for working on how the UI looks. Web Mode (`serve/`), which will carry the core to a browser, isn't built yet.

```bash
pnpm website:dev
```

This is the project website at `http://localhost:5160/lanewise/` (`website/README.md`).

## 5. Lint, typecheck and test

All three must pass before a commit, and CI runs them on Ubuntu, Windows and macOS for every pull request:

```bash
pnpm lint        # cargo fmt --all --check, cargo clippy --workspace --all-targets -- -D warnings, oxlint --deny-warnings
pnpm typecheck   # tsc for app/, bench/ and website/
pnpm test        # cargo test --workspace, then Vitest in app/, bench/ and website/
```

`cargo fmt --all` fixes the formatting `pnpm lint` finds. Each package's own checks run alone too, such as `pnpm --filter @lanewise/app test`, or `pnpm --filter @lanewise/app exec vitest` to watch as you edit. The UI tests draw into jsdom and check each drawing with axe, so everything runs headless.

## 6. The Commit graph benchmark

`pnpm bench:graph` opens a clone of `git/git` in the release build and measures the Commit graph against PRD §11's targets: the first screen in under 2 seconds, and scrolling at 60 fps. On Linux, with the dependencies of [step 2](#2-tauri-2s-system-dependencies):

```bash
sudo apt-get install -y webkit2gtk-driver xvfb
cargo install tauri-driver --locked
pnpm exec tauri build --no-bundle          # target/release/lanewise-desktop
git clone https://github.com/git/git ../git
xvfb-run -a -s "-screen 0 1280x800x24" pnpm bench:graph --repository ../git
```

It writes its report to `bench/results/`, and `--check` fails if the first screen misses its target, as CI does. It replaces the Recent Repositories of the app it runs, so don't run it against a profile you care about. `bench/README.md` has every option and what each number means.

## 7. Build the installers locally

```bash
pnpm desktop:build
```

This is a release build, and on macOS and Windows the installer a Release has (ADR 0029):

| On | You get |
| --- | --- |
| Windows | `target/release/bundle/nsis/Lanewise_<version>_x64-setup.exe`, unsigned unless the signing secrets are set ([Signing the installer](releases.md#signing-the-installer)) |
| macOS | the app and disk image under `target/release/bundle/`. For the universal, ad hoc signed app CI makes: `node app/scripts/release/signMacos.ts -- pnpm desktop:build --target universal-apple-darwin`, which writes `target/universal-apple-darwin/release/bundle/dmg/Lanewise_<version>_universal.dmg` |
| Linux | `target/release/lanewise-desktop`, with no installer |

Without the Update key's secrets it makes no update packages, and says so ([the Update key](releases.md#the-update-key)); `node app/scripts/release/updater.ts --how` says whether it would. A copy you build this way opens without the Gatekeeper or SmartScreen warnings.

## 8. Everything else

| Command | What it does |
| --- | --- |
| `pnpm build` | The UI alone, into `app/dist` |
| `pnpm website:build` | The project website, into `website/dist`, with the page drawn into its HTML (`website/README.md`) |
| `pnpm website:screenshots` | The README's and the website's screenshots, taken again of a demo repository in the Desktop App's release build over WebDriver: under `xvfb-run` on Linux (`website/README.md`, "Screenshots") |
| `pnpm eval:corpus` | Replays the merges in `eval/repositories.json` to make `eval/corpus/` again (`eval/README.md`) |
| `pnpm eval:suggestions <model provider> …` | Measures Suggestions on the Evaluation corpus with your own key, showing its estimated cost and waiting for `yes` first. Run by hand, never in CI (`eval/README.md`) |
| `pnpm try:<model provider>` | Sends one real Suggestion request ([below](#trying-a-model-provider)) |
| `pnpm sandcastle <issue>` | Runs a coding agent on one issue in a container (`docs/processes/running-sandcastle.md`) |

### Trying a Model Provider

Each sends one real Suggestion request for a small Conflict Hunk through Lanewise's own adapter, with your own key, and prints what came back. A cloud Model Provider bills you a few cents for it:

```bash
LANEWISE_ANTHROPIC_API_KEY=sk-ant-… pnpm try:anthropic [--model <id>] [--effort <level>]
LANEWISE_GEMINI_API_KEY=AIza… pnpm try:gemini [--model <id>] [--effort <level>]
LANEWISE_OPENAI_API_KEY=sk-… pnpm try:openai [--model <id>] [--effort <level>]
LANEWISE_XAI_API_KEY=xai-… pnpm try:xai [--model <id>] [--effort <level>]
LANEWISE_META_API_KEY=… pnpm try:meta [--model <id>] [--effort <level>]
pnpm try:local [--base-url http://localhost:11434/v1] [--model <id>] [--effort <level>]
```

Keep keys out of your shell history: set the variable with your shell's own way of reading a secret, or from a password manager's command line, rather than typing it in the command.

## Common setup problems

**`pnpm: command not found`, or `pnpm --version` isn't `packageManager`'s.** Run `npm install -g corepack@latest && corepack enable`, open a new terminal, and run `pnpm --version` inside the clone. If an older pnpm still answers, one installed by npm or Homebrew comes first on your `PATH`: remove it (`npm uninstall -g pnpm`, `brew uninstall pnpm`).

**`pnpm install` warns about the engine, or fails in an odd place.** Your Node is older than 26: check `node --version`, then switch with `nvm use 26` or `fnm use 26`.

**`ERR_PNPM_IGNORED_BUILDS` after adding a package.** pnpm runs a package's build script only if `allowBuilds` in `pnpm-workspace.yaml` says so. Add the package there, `true` if it needs its build script and `false` if not.

**`ERR_PNPM_OUTDATED_LOCKFILE` with `--frozen-lockfile`.** `package.json` changed without `pnpm-lock.yaml`. Run `pnpm install` and commit the lockfile with the change.

**Rust tests panic with "these tests need git 2.40 or later".** The `git` on your `PATH` is too old, or isn't there. On macOS, Apple's can be; `brew install git`, then check `which git` names Homebrew's.

**`cargo clippy` or `cargo fmt` "is not installed".** `rustup component add clippy rustfmt`.

**Linux: `pkg-config` can't find `webkit2gtk-4.1`, `gtk+-3.0` or `openssl`.** Install [the system dependencies](#2-tauri-2s-system-dependencies). Only WebKitGTK 4.1 works with Tauri 2; 4.0 doesn't.

**Linux: the window opens blank or white.** Some GPU drivers can't draw WebKitGTK's accelerated compositing. Try `WEBKIT_DISABLE_DMABUF_RENDERER=1 pnpm desktop:dev`.

**Linux: saving an API key says there's no credential store.** No Secret Service is running. Start GNOME Keyring or KWallet, and unlock it.

**Windows: `link.exe` not found, or a `msvc` linker error.** The C++ Build Tools are missing, or Rust uses the GNU toolchain: install the **Desktop development with C++** workload and run `rustup default stable-msvc`.

**macOS: `xcrun: error: invalid active developer path`.** Run `xcode-select --install`.

**macOS: `can't find crate for std` building the universal app.** `rustup target add aarch64-apple-darwin x86_64-apple-darwin`.

**`Port 5150 is already in use`.** The dev server's port is fixed, since `desktop/tauri.conf.json`'s `devUrl` names it. Stop the other `pnpm dev` or `pnpm desktop:dev`.

**"This is Lanewise's UI on its own, in a browser" in the browser.** That's `pnpm dev`, the UI alone. Use `pnpm desktop:dev` for the whole app.

**The Git Setup screen says Git Credential Manager isn't Git's credential helper.** Follow its steps, or choose **Continue for now** to work without signing in to Hosts.

