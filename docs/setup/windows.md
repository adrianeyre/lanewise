# Setting up Lanewise on Windows

[Back to the Setup guides](README.md) · [Back to the README](../../README.md)

This guide takes a Windows computer with nothing installed to Lanewise running. [Part 1](#part-1-install-lanewise-from-a-release) installs the Desktop App from a Release, which is all most people need. [Part 2](#part-2-build-lanewise-from-source) builds it from source, to work on Lanewise itself. Each step has a picture. The pictures of Lanewise are screenshots of the app. The pictures of Windows are drawings of what it shows, labelled as drawings, so yours may look a little different with your version of Windows and its theme.

Everything Lanewise needs is free.

## What you need

| | Where it comes from | Needed for |
| --- | --- | --- |
| Windows 10 22H2 or later, or Windows 11, on x64 | | Both parts |
| [Git for Windows](https://git-scm.com/install/windows) 2.40 or later, with Git Credential Manager | `winget install --id Git.Git -e --source winget` | Both parts |
| [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/), with **Desktop development with C++** | `winget install --id Microsoft.VisualStudio.2022.BuildTools` ([step 9](#9-install-the-microsoft-c-build-tools)) | Part 2 |
| [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) | Already in Windows 10 (1803 and later) and Windows 11 | Both parts |
| [rustup](https://rustup.rs), for Rust stable with `clippy` and `rustfmt` | `winget install --id Rustlang.Rustup -e --source winget` | Part 2 |
| [fnm](https://github.com/Schniz/fnm), to install Node 26 (or [nvm-windows](https://github.com/coreybutler/nvm-windows), or the installer from [nodejs.org](https://nodejs.org/en/download)) | `winget install --id Schniz.fnm -e --source winget` | Part 2 |
| [corepack](https://github.com/nodejs/corepack), which provides [pnpm](https://pnpm.io) at the version in `packageManager` | `npm install -g corepack@latest` | Part 2 |

[winget](https://learn.microsoft.com/windows/package-manager/winget/), the Windows Package Manager, comes with Windows 11 and recent Windows 10 as **App Installer**. If `winget` isn't found, install **App Installer** from the Microsoft Store, or download each tool from the link in the first column instead.

## Part 1: install Lanewise from a Release

### 1. Check your version of Windows

Open **Start**, type `winver` and press Enter, or run this in PowerShell. Lanewise needs version 22H2 or later on Windows 10, any Windows 11, and a 64-bit Windows.

```powershell
Get-ComputerInfo -Property OsName, OSDisplayVersion, OsArchitecture
```

![PowerShell running Get-ComputerInfo, which prints OsName Microsoft Windows 11 Pro, OSDisplayVersion 24H2 and OsArchitecture 64-bit.](pictures/windows-version.png)

### 2. Open a terminal

Open **Start**, type `Terminal`, and choose **Terminal**. On Windows 10 without Terminal, choose **Windows PowerShell**. Every command in this guide runs there. You don't need to run it as administrator.

![The Start menu's search, with Terminal typed, showing Terminal as the best match, chosen, and Windows PowerShell under it.](pictures/windows-terminal.png)

### 3. Install Git and Git Credential Manager

Lanewise runs the Git installed on your computer, which must be 2.40 or later, and signs in to Hosts through Git Credential Manager. Git for Windows includes both, and sets Git Credential Manager up as Git's credential helper. Install it with winget, or download it from [git-scm.com/install/windows](https://git-scm.com/install/windows) and keep the installer's defaults:

```powershell
winget install --id Git.Git -e --source winget
```

![PowerShell running winget install for Git.Git: it finds Git version 2.56.1, downloads and verifies the installer, and says Successfully installed.](pictures/windows-git.png)

### 4. Check Git and Git Credential Manager

Close the terminal and open a new one, so it finds the Git you just installed, then:

```powershell
git --version                            # git version 2.40.0 or later
git credential-manager --version         # any version
git config --get-all credential.helper   # manager
```

If the last command doesn't print `manager`, run `git config --global credential.helper manager`.

![A new PowerShell window: git --version prints git version 2.56.1.windows.1, git credential-manager --version prints 3.0.2, and git config --get-all credential.helper prints manager.](pictures/windows-git-check.png)

### 5. Download the installer

On [the project website](https://lanewise.adrianeyre.co.uk/#download), choose **Download for Windows**, or download `Lanewise_<version>_x64-setup.exe` from the [latest Release](https://github.com/adrianeyre/lanewise/releases/latest). It's saved to your Downloads folder.

![The project website's Download section in a browser, at lanewise.adrianeyre.co.uk/#download, with Download for Windows chosen, Version 1.5.0 under the buttons, and Lanewise_1.5.0_x64-setup.exe saved to Downloads.](pictures/windows-download.png)

Or download it from PowerShell, which asks GitHub for the latest Release's installer:

```powershell
$release = Invoke-RestMethod https://api.github.com/repos/adrianeyre/lanewise/releases/latest
$installer = $release.assets | Where-Object name -like '*_x64-setup.exe'
Invoke-WebRequest $installer.browser_download_url -OutFile "$HOME\Downloads\$($installer.name)"
```

![PowerShell asking GitHub's API for the latest Release, choosing its x64-setup.exe asset, downloading it to Downloads, and listing Lanewise_1.5.0_x64-setup.exe there.](pictures/windows-download-terminal.png)

### 6. Run the installer, past SmartScreen

Double-click the installer in your Downloads folder. The installer isn't signed yet, so Microsoft Defender SmartScreen may say **Windows protected your PC**. It will be signed once SignPath Foundation, which signs open-source projects for free, has approved Lanewise ([Windows code signing](../processes/windows-code-signing.md)). Choose **More info**:

![Microsoft Defender SmartScreen's Windows protected your PC, saying it prevented an unrecognised app from starting, with More info chosen and Don't run.](pictures/windows-smartscreen.png)

Check that the app is `Lanewise_<version>_x64-setup.exe`, then choose **Run anyway**:

![The same SmartScreen message after More info, naming the app Lanewise_1.5.0_x64-setup.exe and the publisher Unknown publisher, with Run anyway chosen and Don't run.](pictures/windows-smartscreen-run.png)

Or, instead, remove the mark Windows puts on a downloaded file, and run the installer from PowerShell. SmartScreen doesn't stop it then:

```powershell
Unblock-File "$HOME\Downloads\Lanewise_*_x64-setup.exe"
Start-Process (Get-Item "$HOME\Downloads\Lanewise_*_x64-setup.exe")
```

![PowerShell running Unblock-File on the installer in Downloads, then Start-Process to run it.](pictures/windows-unblock.png)

### 7. Install Lanewise

The installer installs Lanewise for you alone, in `C:\Users\<you>\AppData\Local\Lanewise`, without asking for administrator rights, and fetches WebView2 if it isn't there. Choose **Install**:

![Lanewise Setup's Choose Install Location page, installing to C:\Users\you\AppData\Local\Lanewise and saying no administrator rights are needed, with Install chosen.](pictures/windows-installer.png)

Leave **Run Lanewise** ticked and choose **Finish**:

![Lanewise Setup's last page, Completing Lanewise Setup, with Run Lanewise ticked and Finish chosen.](pictures/windows-installer-finish.png)

### 8. Open Lanewise

If you left **Run Lanewise** ticked, it's already open. From then on, open **Start**, type `Lanewise` and choose it:

![The Start menu's search, with Lanewise typed, showing the Lanewise app as the best match, chosen.](pictures/windows-start.png)

If anything Lanewise needs from Git is missing, it opens on **Set up Git for Lanewise**, which says what it found and what to install, with **Check again** to look again once you have:

![Lanewise's Set up Git for Lanewise screen on Windows. What Lanewise found: Git isn't installed, or isn't where Lanewise looks for it, and Git Credential Manager can be checked once Git is set up. What to do on Windows: install Git for Windows, with a Download Git for Windows link and the winget command, then choose Check again. Under it, Check again and Continue for now.](pictures/app-git-setup-windows.png)

Once Git is set up, it opens on the Welcome screen. Carry on with [First steps in Lanewise](first-steps.md).

Lanewise updates itself from then on: **Settings → Updates** says which version is running ([Updates](../installing.md#updates)).

### Uninstalling

Open **Settings → Apps → Installed apps**, find Lanewise, choose **…** beside it and then **Uninstall**. Your API keys stay in Windows Credential Manager until you choose **Forget the API key** in Lanewise's Settings first.

![Windows Settings, Apps then Installed apps, searched for Lanewise, showing Lanewise 1.5.0 by Adrian Eyre with its menu open and Uninstall chosen.](pictures/windows-uninstall.png)

## Part 2: build Lanewise from source

Part 2 needs Git from [step 3](#3-install-git-and-git-credential-manager). It ends with Lanewise running from your clone, its checks passing and its installer built. [Setting Lanewise up locally](../development.md) says more about each command.

### 9. Install the Microsoft C++ Build Tools

Rust builds Windows programs with Microsoft's linker, which comes with the C++ Build Tools. Install them with the **Desktop development with C++** workload, from PowerShell:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --source winget --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

![PowerShell running winget install for Microsoft.VisualStudio.2022.BuildTools with the VCTools workload, ending Successfully installed.](pictures/windows-build-tools.png)

Or download **Build Tools for Visual Studio** from [Visual Studio's downloads](https://visualstudio.microsoft.com/visual-cpp-build-tools/), run it, tick **Desktop development with C++** and choose **Install**:

![The Visual Studio Installer's Workloads for the Build Tools, with Desktop development with C++ ticked and chosen, Node.js build tools not ticked, and Install chosen.](pictures/windows-workload.png)

### 10. Check WebView2

WebView2 draws Lanewise's window. It's already on Windows 10 from version 1803, and on Windows 11. To check:

```powershell
Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -Name pv
```

A version means it's installed. If PowerShell says the path doesn't exist, install the **Evergreen Bootstrapper** from [Microsoft's WebView2 page](https://developer.microsoft.com/microsoft-edge/webview2/).

![PowerShell reading WebView2's pv value from the registry, which prints a version, with a note that a version means WebView2 is installed.](pictures/windows-webview2.png)

### 11. Install Rust

Install rustup, Rust's installer, from [rustup.rs](https://rustup.rs) or with winget. Open a new terminal, then make the MSVC toolchain the default and add clippy and rustfmt:

```powershell
winget install --id Rustlang.Rustup -e --source winget
# Open a new terminal, then:
rustup default stable-msvc
rustup component add clippy rustfmt
rustc --version
```

![PowerShell installing Rustlang.Rustup with winget, then in a new window rustup default stable-msvc, which sets stable-x86_64-pc-windows-msvc, rustup component add clippy rustfmt, and rustc --version printing rustc 1.100.0.](pictures/windows-rust.png)

### 12. Install Node 26 with fnm

[fnm](https://github.com/Schniz/fnm), the Fast Node Manager, installs Node versions and switches between them. Install it, have PowerShell load it in every window, then install Node 26:

```powershell
winget install --id Schniz.fnm -e --source winget
# Open a new terminal, then:
New-Item -ItemType File -Force $PROFILE | Out-Null
Add-Content $PROFILE 'fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression'
. $PROFILE
fnm install 26
fnm default 26
node --version
```

If PowerShell says running scripts is disabled when it loads `$PROFILE`, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` and open a new terminal.

Prefer another way? [nvm-windows](https://github.com/coreybutler/nvm-windows) (`winget install --id CoreyButler.NVMforWindows -e`, then `nvm install 26` and `nvm use 26`), which is a different project from the nvm macOS and Linux use, or the **Windows Installer (.msi)** for Node 26 from [nodejs.org](https://nodejs.org/en/download).

![PowerShell installing Schniz.fnm with winget, adding fnm env to the PowerShell profile, then fnm install 26, fnm default 26 and node --version printing v26.13.0.](pictures/windows-node.png)

### 13. Turn on corepack, for pnpm

Lanewise uses [pnpm](https://pnpm.io) at the exact version in `package.json`'s `packageManager`. [corepack](https://github.com/nodejs/corepack) provides it. Node no longer comes with corepack, so install it with npm, which comes with Node:

```powershell
npm install -g corepack@latest
corepack enable
corepack --version
```

Don't install pnpm another way as well. Once you've cloned Lanewise in the next step, `pnpm --version` inside the clone prints the version in `packageManager`; corepack downloads it the first time, and may ask first.

![PowerShell running npm install -g corepack@latest, corepack enable and corepack --version, which prints 0.36.0, then pnpm --version inside the clone printing 12.18.0.](pictures/windows-corepack.png)

### 14. Clone Lanewise and install its packages

```powershell
cd $HOME
git clone https://github.com/adrianeyre/lanewise.git
cd lanewise
pnpm install --frozen-lockfile
```

![PowerShell cloning github.com/adrianeyre/lanewise.git into the home folder, changing into lanewise, and running pnpm install --frozen-lockfile, which says the lockfile is up to date and Done using pnpm v12.18.0.](pictures/windows-clone.png)

### 15. Run Lanewise from source

```powershell
pnpm desktop:dev
```

The first build compiles every crate and takes several minutes. Then Lanewise's window opens, on the Welcome screen, or on Set up Git for Lanewise if Git isn't ready. A change to the UI reloads at once, and a change to the Rust code rebuilds and restarts it. Press Ctrl+C in the terminal to stop it.

![PowerShell running pnpm desktop:dev: Vite ready on localhost:5150, the crates compiling, the dev profile finished in 4 minutes, and target/debug/lanewise-desktop running, with a note that the first build takes several minutes.](pictures/windows-dev.png)

### 16. Run the checks

These three must pass before a commit, as [CONTRIBUTING.md](../../CONTRIBUTING.md) says:

```powershell
pnpm lint
pnpm typecheck
pnpm test
```

![PowerShell running pnpm lint, which finds 0 warnings and 0 errors, pnpm typecheck, Done for app, bench and website, and pnpm test, with the Rust and UI tests passing.](pictures/windows-checks.png)

### 17. Build the installer

```powershell
pnpm desktop:build
```

It writes `target\release\bundle\nsis\Lanewise_<version>_x64-setup.exe`, unsigned. Install it as in [step 7](#7-install-lanewise). A copy you build yourself doesn't update itself.

![PowerShell running pnpm desktop:build, which finishes the release profile, runs makensis, and names the installer at target\release\bundle\nsis\Lanewise_1.5.0_x64-setup.exe.](pictures/windows-build.png)

## If something goes wrong

- **`winget` isn't recognised.** Install **App Installer** from the Microsoft Store, or download each tool from its link in [What you need](#what-you-need).
- **`git` isn't recognised after installing it.** Open a new terminal, or sign out and in again, so it reads the new `PATH`.
- **`link.exe` not found, or a `msvc` linker error.** The C++ Build Tools are missing, or Rust uses the GNU toolchain: do [step 9](#9-install-the-microsoft-c-build-tools) and run `rustup default stable-msvc`.
- **SmartScreen has no Run anyway.** Your organisation may have turned it off. Ask its IT, or [build Lanewise yourself](#part-2-build-lanewise-from-source).
- **Anything else.** [Common setup problems](../development.md#common-setup-problems), or [open an issue](https://github.com/adrianeyre/lanewise/issues/new/choose); Settings' **Copy diagnostics** fills its form in.
