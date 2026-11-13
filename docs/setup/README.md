# Setup guides

[Back to the README](../../README.md)

Step-by-step guides from a computer with nothing installed to Lanewise running, with a picture of every step.

| Your computer | Install a Release | Build from source |
| --- | --- | --- |
| **Windows** 10 22H2 or later, or 11, on x64 | [Part 1](windows.md#part-1-install-lanewise-from-a-release): Git, the installer, SmartScreen | [Part 2](windows.md#part-2-build-lanewise-from-source): the C++ Build Tools, Rust, Node, pnpm |
| **macOS** 14 or later, Apple Silicon or Intel | [Part 1](macos.md#part-1-install-lanewise-from-a-release): Homebrew, Git, the disk image, Gatekeeper, and every Terminal command for an app that isn't notarized | [Part 2](macos.md#part-2-build-lanewise-from-source): the Command Line Tools, Node, pnpm, Rust |
| **Linux**, x86_64 or aarch64 | No installer: build it | [The whole guide](linux.md): the system packages, Git Credential Manager, Node, pnpm, Rust, and an entry in your applications |

Then [First steps in Lanewise](first-steps.md): opening and cloning a repository, signing in to a Host, and turning on AI Suggestions.

## Where to get everything

Every tool is free. Install each from where this table says, at the version it says; each guide has the commands, in order, and how to check each one worked.

| Tool | What Lanewise uses it for | Windows | macOS | Linux |
| --- | --- | --- | --- | --- |
| **Git** 2.40 or later | Every Git operation (ADR 0002) | [Git for Windows](https://git-scm.com/install/windows), or `winget install --id Git.Git -e --source winget` | [Homebrew](https://brew.sh): `brew install git` | Your package manager ([Git for Linux](https://git-scm.com/install/linux)) |
| **[Git Credential Manager](https://github.com/git-ecosystem/git-credential-manager)** | Signing in to Hosts | Included with Git for Windows | `brew install --cask git-credential-manager` | [Its latest Release](https://github.com/git-ecosystem/git-credential-manager/releases/latest)'s `.deb` or tarball, then `git-credential-manager configure` |
| **[Homebrew](https://brew.sh)** | Installing Git and Git Credential Manager | | The command on [brew.sh](https://brew.sh) | |
| **[winget](https://learn.microsoft.com/windows/package-manager/winget/)** | Installing the rest | **App Installer** in the Microsoft Store; already in Windows 11 | | |
| **A C toolchain** | Building Rust code | [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/), with **Desktop development with C++** | `xcode-select --install` | `build-essential`, or your distribution's equivalent |
| **The webview** | Drawing Lanewise's window | [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/), already in Windows 10 (1803 and later) and 11 | WKWebView, part of macOS | WebKitGTK 4.1: `libwebkit2gtk-4.1-dev` and [Tauri's other packages](https://v2.tauri.app/start/prerequisites/#linux) |
| **A Node version manager** | Installing Node 26 | [fnm](https://github.com/Schniz/fnm): `winget install --id Schniz.fnm -e --source winget`, or [nvm-windows](https://github.com/coreybutler/nvm-windows) | [nvm](https://github.com/nvm-sh/nvm): the script in [its README](https://github.com/nvm-sh/nvm#installing-and-updating), or `brew install fnm` | [nvm](https://github.com/nvm-sh/nvm): the script in [its README](https://github.com/nvm-sh/nvm#installing-and-updating), or [fnm](https://github.com/Schniz/fnm) |
| **[Node](https://nodejs.org/en/download) 26** | Building and testing the UI | `fnm install 26`, or the `.msi` from [nodejs.org](https://nodejs.org/en/download) | `nvm install 26`, or the `.pkg` from [nodejs.org](https://nodejs.org/en/download) | `nvm install 26` |
| **[corepack](https://github.com/nodejs/corepack)** | Providing pnpm at the version in `packageManager` | `npm install -g corepack@latest`, then `corepack enable` | The same | The same |
| **[pnpm](https://pnpm.io)** | Lanewise's packages and commands | From corepack: run `pnpm --version` in your clone | The same | The same |
| **[rustup](https://rustup.rs)** and Rust stable, with `clippy` and `rustfmt` | Building Lanewise's core | `winget install --id Rustlang.Rustup -e --source winget`, then `rustup default stable-msvc` | The command on [rustup.rs](https://rustup.rs) | The command on [rustup.rs](https://rustup.rs) |
| **A Secret Service** | Keeping API keys and Hosts' credentials | Windows Credential Manager, built in | Keychain, built in | GNOME Keyring or KWallet |
| **[Docker](https://docs.docker.com/get-started/get-docker/)** | Only to take the Setup pictures again, with `pnpm docs:pictures` | Docker Desktop | Docker Desktop | Docker Engine |

To run the Lanewise you install from a Release, you need only Git and Git Credential Manager. Everything else in the table is for building it.

## The pictures

Each step's picture is one of three kinds, and says which:

- **A screenshot of Lanewise**, drawn by the app's own code over the fake core its UI tests use, so it shows exactly what Lanewise shows. The Repository page, diff and Conflicts screenshots are of the Desktop App itself, from the [project website](https://lanewise.adrianeyre.co.uk/).
- **A drawing of what the operating system shows**, such as SmartScreen or Gatekeeper, labelled as a drawing in the picture itself. Your version of Windows or macOS may word or lay it out a little differently.
- **A terminal's output.** The Linux guide's were recorded running its steps in order on a fresh Ubuntu 24.04, and say so; the rest show the output you can expect, with long output shortened.

They're in `docs/setup/pictures/`. `pnpm docs:pictures` takes them all again, with Docker, from `app/scripts/setupGuide/` ([Setting Lanewise up locally](../development.md#8-everything-else)).
