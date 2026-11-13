import type { ReactNode } from "react";

import { AppIcon, Browser, Buttons, Checkbox, Desk, type Line, MacAlert, Terminal, Window } from "./frames";

const VERSION = "1.5.0";
const MAC_DISK_IMAGE = `Lanewise_${VERSION}_universal.dmg`;
const WINDOWS_INSTALLER = `Lanewise_${VERSION}_x64-setup.exe`;
const CLONE = [
  { command: "git clone https://github.com/adrianeyre/lanewise.git" },
  { output: "Cloning into 'lanewise'...\nResolving deltas: 100% (…), done." },
  { command: "cd lanewise" },
  { command: "pnpm install --frozen-lockfile" },
  { output: "Lockfile is up to date, resolution step is skipped\nPackages: +…\nDone in 41s using pnpm v12.16.1" },
];
const CHECKS = [
  { command: "pnpm lint" },
  { output: "Finished `dev` profile [unoptimized + debuginfo] target(s)\nFound 0 warnings and 0 errors." },
  { command: "pnpm typecheck" },
  { output: "app typecheck: Done\nbench typecheck: Done\nwebsite typecheck: Done" },
  { command: "pnpm test" },
  { output: "test result: ok. … passed; 0 failed\n Test Files  … passed (…)\n      Tests  … passed (…)" },
];
const DEV = [
  { command: "pnpm desktop:dev" },
  {
    output:
      "  VITE ready in 612 ms\n  ➜  Local:   http://localhost:5150/\n   Compiling lanewise-core v…\n   Compiling lanewise-desktop v…\n    Finished `dev` profile [unoptimized + debuginfo] target(s) in 4m 12s\n     Running `target/debug/lanewise-desktop`",
  },
  { note: "The first build compiles every crate and takes several minutes. Lanewise's window opens when it's done." },
];
const COREPACK = [
  { command: "npm install -g corepack@latest" },
  { output: "added 1 package in 2s" },
  { command: "corepack enable" },
  { command: "corepack --version" },
  { output: "0.36.0" },
];

function Recorded({ lines, prompt }: { lines: Line[]; prompt?: string }) {
  return (
    <Terminal
      system="linux"
      prompt={prompt}
      lines={lines}
      label="Recorded on Ubuntu 24.04, with long output shortened"
    />
  );
}

function MacPrivacy() {
  return (
    <Desk system="macos">
      <Window system="macos" title="Privacy & Security" width={820}>
        <div className="drawing-settings">
          <ul className="drawing-sidebar">
            {["Wi-Fi", "Bluetooth", "Network", "General", "Appearance", "Accessibility", "Privacy & Security", "Desktop & Dock"].map(
              (item) => (
                <li key={item} className={item === "Privacy & Security" ? "drawing-selected" : undefined}>
                  {item}
                </li>
              ),
            )}
          </ul>
          <div className="drawing-pane">
            <h1>Privacy & Security</h1>
            <p className="drawing-muted">Location Services, Contacts, Calendars, Photos, Files and Folders …</p>
            <h2>Security</h2>
            <p>Allow applications from</p>
            <p className="drawing-field">App Store & Known Developers ⌄</p>
            <div className="drawing-row">
              <p>“Lanewise” was blocked to protect your Mac.</p>
              <Buttons buttons={[{ label: "Open Anyway", chosen: true }]} />
            </div>
          </div>
        </div>
      </Window>
    </Desk>
  );
}

function MacDiskImage() {
  return (
    <Desk system="macos">
      <Window system="macos" title="Lanewise" width={620}>
        <div className="drawing-disk">
          <figure>
            <AppIcon size={96} />
            <figcaption>Lanewise</figcaption>
          </figure>
          <span className="drawing-arrow" aria-hidden="true">
            ➜
          </span>
          <figure className="drawing-chosen">
            <span className="drawing-folder" aria-hidden="true">
              A
            </span>
            <figcaption>Applications</figcaption>
          </figure>
        </div>
        <p className="drawing-hint">Drag Lanewise onto Applications</p>
      </Window>
    </Desk>
  );
}

function MacPassword() {
  return (
    <Desk system="macos">
      <section className="drawing-alert">
        <span className="drawing-lock" aria-hidden="true">
          🔒
        </span>
        <h1>Privacy & Security</h1>
        <p>You are making changes to your Security & Privacy settings. Use Touch ID or enter your password to allow this.</p>
        <p className="drawing-field">Password</p>
        <Buttons buttons={[{ label: "Modify Settings", primary: true, chosen: true }, { label: "Cancel" }]} stacked />
      </section>
    </Desk>
  );
}

function DownloadPage({ system, chosen }: { system: "windows" | "macos"; chosen: "windows" | "macos" }) {
  return (
    <Browser system={system} address="https://lanewise.adrianeyre.co.uk/#download">
      <h1>Download</h1>
      <Buttons
        buttons={[
          { label: "⤓ Download for Windows", primary: chosen === "windows", chosen: chosen === "windows" },
          { label: "⤓ Download for macOS", primary: chosen === "macos", chosen: chosen === "macos" },
        ]}
      />
      <p>Version {VERSION}. What&apos;s new in {VERSION}</p>
      <p className="drawing-muted">Lanewise needs Git 2.40 or later, and says so when it starts if it&apos;s missing.</p>
      <p className="drawing-download">
        {chosen === "windows" ? WINDOWS_INSTALLER : MAC_DISK_IMAGE} — saved to Downloads
      </p>
    </Browser>
  );
}

function SmartScreen({ more }: { more: boolean }) {
  return (
    <Desk system="windows">
      <section className="drawing-smartscreen">
        <h1>Windows protected your PC</h1>
        <p>
          Microsoft Defender SmartScreen prevented an unrecognised app from starting. Running this app might put your PC at
          risk.
        </p>
        {more ? (
          <dl>
            <dt>App:</dt>
            <dd>{WINDOWS_INSTALLER}</dd>
            <dt>Publisher:</dt>
            <dd>Unknown publisher</dd>
          </dl>
        ) : (
          <p className={more ? undefined : "drawing-link drawing-chosen"}>More info</p>
        )}
        <Buttons buttons={more ? [{ label: "Run anyway", chosen: true }, { label: "Don't run" }] : [{ label: "Don't run" }]} />
      </section>
    </Desk>
  );
}

function WindowsInstaller({ page }: { page: "location" | "finish" }) {
  return (
    <Desk system="windows">
      <Window system="windows" title="Lanewise Setup" width={620}>
        <div className="drawing-wizard">
          <AppIcon size={56} />
          {page === "location" ? (
            <div>
              <h1>Choose Install Location</h1>
              <p>Choose the folder in which to install Lanewise.</p>
              <p className="drawing-field">C:\Users\you\AppData\Local\Lanewise</p>
              <p className="drawing-muted">Space required: … MB. No administrator rights are needed.</p>
            </div>
          ) : (
            <div>
              <h1>Completing Lanewise Setup</h1>
              <p>Lanewise has been installed on your computer. Click Finish to close Setup.</p>
              <Checkbox label="Run Lanewise" />
            </div>
          )}
        </div>
        <Buttons
          buttons={
            page === "location"
              ? [{ label: "< Back" }, { label: "Install", primary: true, chosen: true }, { label: "Cancel" }]
              : [{ label: "< Back" }, { label: "Finish", primary: true, chosen: true }, { label: "Cancel" }]
          }
        />
      </Window>
    </Desk>
  );
}

function WindowsSearch({ query, results }: { query: string; results: [string, string][] }) {
  return (
    <Desk system="windows">
      <section className="drawing-start">
        <p className="drawing-field">🔍 {query}</p>
        <h2>Best match</h2>
        <ul>
          {results.map(([name, kind], index) => (
            <li key={name} className={index === 0 ? "drawing-chosen" : undefined}>
              {name === "Lanewise" ? <AppIcon size={32} /> : <span className="drawing-tile" aria-hidden="true" />}
              <span>
                <strong>{name}</strong>
                <span className="drawing-muted">{kind}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </Desk>
  );
}

function WindowsApps() {
  return (
    <Desk system="windows">
      <Window system="windows" title="Settings" width={820}>
        <div className="drawing-pane">
          <h1>Apps › Installed apps</h1>
          <p className="drawing-field">🔍 Lanewise</p>
          <div className="drawing-row drawing-app-row">
            <AppIcon size={32} />
            <p>
              <strong>Lanewise</strong>
              <br />
              <span className="drawing-muted">
                {VERSION} | Adrian Eyre
              </span>
            </p>
            <ul className="drawing-menu">
              <li>Modify</li>
              <li className="drawing-chosen">Uninstall</li>
            </ul>
          </div>
        </div>
      </Window>
    </Desk>
  );
}

function BuildTools() {
  return (
    <Desk system="windows">
      <Window system="windows" title="Visual Studio Installer — Build Tools" width={860}>
        <div className="drawing-pane">
          <h1>Workloads</h1>
          <div className="drawing-workloads">
            <div className="drawing-workload drawing-chosen">
              <Checkbox label="Desktop development with C++" />
              <p className="drawing-muted">Build modern C++ apps for Windows using tools of your choice, including MSVC.</p>
            </div>
            <div className="drawing-workload">
              <Checkbox label="Node.js build tools" checked={false} />
              <p className="drawing-muted">Not needed for Lanewise.</p>
            </div>
          </div>
          <p className="drawing-muted">Installation details: MSVC v143 build tools, Windows 11 SDK, C++ CMake tools</p>
        </div>
        <Buttons buttons={[{ label: "Install", primary: true, chosen: true }]} />
      </Window>
    </Desk>
  );
}

function LinuxFiles() {
  return (
    <Desk system="linux">
      <section className="drawing-start drawing-start-linux">
        <p className="drawing-field">🔍 lanewise</p>
        <h2>Applications</h2>
        <ul>
          <li className="drawing-chosen">
            <AppIcon size={48} />
            <span>
              <strong>Lanewise</strong>
              <span className="drawing-muted">A free Git client with a visual commit graph</span>
            </span>
          </li>
        </ul>
      </section>
    </Desk>
  );
}

export const DRAWINGS = {
  "windows-version": () => (
    <Terminal
      system="windows"
      lines={[
        { command: "Get-ComputerInfo -Property OsName, OSDisplayVersion, OsArchitecture" },
        { output: "OsName           : Microsoft Windows 11 Pro\nOSDisplayVersion : 24H2\nOsArchitecture   : 64-bit" },
      ]}
    />
  ),
  "windows-terminal": () => (
    <WindowsSearch query="Terminal" results={[["Terminal", "App"], ["Windows PowerShell", "App"]]} />
  ),
  "windows-git": () => (
    <Terminal
      system="windows"
      lines={[
        { command: "winget install --id Git.Git -e --source winget" },
        {
          output:
            "Found Git [Git.Git] Version 2.56.1\nThis application is licensed to you by its owner.\nDownloading https://github.com/git-for-windows/git/releases/download/…\n  ██████████████████████████████  …MB\nSuccessfully verified installer hash\nStarting package install...\nSuccessfully installed",
        },
      ]}
    />
  ),
  "windows-git-check": () => (
    <Terminal
      system="windows"
      lines={[
        { note: "In a new terminal window, so it finds the Git just installed:" },
        { command: "git --version" },
        { output: "git version 2.56.1.windows.1" },
        { command: "git credential-manager --version" },
        { output: "3.0.2+…" },
        { command: "git config --get-all credential.helper" },
        { output: "manager" },
      ]}
    />
  ),
  "windows-download": () => <DownloadPage system="windows" chosen="windows" />,
  "windows-download-terminal": () => (
    <Terminal
      system="windows"
      lines={[
        { command: "$release = Invoke-RestMethod https://api.github.com/repos/adrianeyre/lanewise/releases/latest" },
        { command: "$installer = $release.assets | Where-Object name -like '*_x64-setup.exe'" },
        { command: "Invoke-WebRequest $installer.browser_download_url -OutFile \"$HOME\\Downloads\\$($installer.name)\"" },
        { command: "Get-ChildItem \"$HOME\\Downloads\\Lanewise_*_x64-setup.exe\"" },
        { output: `Mode   LastWriteTime      Length Name\n-a---  13/11/2026 10:24   …      ${WINDOWS_INSTALLER}` },
      ]}
    />
  ),
  "windows-smartscreen": () => <SmartScreen more={false} />,
  "windows-smartscreen-run": () => <SmartScreen more />,
  "windows-unblock": () => (
    <Terminal
      system="windows"
      lines={[
        { note: "Instead of More info and Run anyway: remove the downloaded mark, then run the installer." },
        { command: "Unblock-File \"$HOME\\Downloads\\Lanewise_*_x64-setup.exe\"" },
        { command: "Start-Process (Get-Item \"$HOME\\Downloads\\Lanewise_*_x64-setup.exe\")" },
      ]}
    />
  ),
  "windows-installer": () => <WindowsInstaller page="location" />,
  "windows-installer-finish": () => <WindowsInstaller page="finish" />,
  "windows-start": () => <WindowsSearch query="Lanewise" results={[["Lanewise", "App"]]} />,
  "windows-uninstall": () => <WindowsApps />,
  "windows-build-tools": () => (
    <Terminal
      system="windows"
      lines={[
        {
          command:
            'winget install --id Microsoft.VisualStudio.2022.BuildTools -e --source winget --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"',
        },
        { output: "Found Visual Studio BuildTools 2022 [Microsoft.VisualStudio.2022.BuildTools]\n…\nSuccessfully installed" },
      ]}
    />
  ),
  "windows-workload": () => <BuildTools />,
  "windows-webview2": () => (
    <Terminal
      system="windows"
      lines={[
        {
          command:
            "Get-ItemProperty 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -Name pv",
        },
        { output: "pv : 1…\n" },
        { note: "A version means WebView2 is installed. An error saying the path doesn't exist means it isn't." },
      ]}
    />
  ),
  "windows-rust": () => (
    <Terminal
      system="windows"
      lines={[
        { command: "winget install --id Rustlang.Rustup -e --source winget" },
        { output: "Successfully installed" },
        { note: "Open a new terminal window, then:" },
        { command: "rustup default stable-msvc" },
        { output: "info: default toolchain set to 'stable-x86_64-pc-windows-msvc'" },
        { command: "rustup component add clippy rustfmt" },
        { command: "rustc --version" },
        { output: "rustc 1.100.0 (…)" },
      ]}
    />
  ),
  "windows-node": () => (
    <Terminal
      system="windows"
      lines={[
        { command: "winget install --id Schniz.fnm -e --source winget" },
        { output: "Successfully installed" },
        { note: "Open a new terminal window, then have every PowerShell window load fnm:" },
        { command: "New-Item -ItemType File -Force $PROFILE | Out-Null" },
        { command: "Add-Content $PROFILE 'fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression'" },
        { command: ". $PROFILE" },
        { command: "fnm install 26" },
        { command: "fnm default 26" },
        { command: "node --version" },
        { output: "v26.13.0" },
      ]}
    />
  ),
  "windows-corepack": () => (
    <Terminal system="windows" lines={[...COREPACK, { command: "cd $HOME\\lanewise; pnpm --version" }, { output: "12.16.1" }]} />
  ),
  "windows-clone": () => <Terminal system="windows" lines={[{ command: "cd $HOME" }, ...CLONE]} />,
  "windows-dev": () => <Terminal system="windows" prompt="PS C:\Users\you\lanewise>" lines={DEV} />,
  "windows-checks": () => <Terminal system="windows" prompt="PS C:\Users\you\lanewise>" lines={CHECKS} />,
  "windows-build": () => (
    <Terminal
      system="windows"
      prompt="PS C:\Users\you\lanewise>"
      lines={[
        { command: "pnpm desktop:build" },
        {
          output: `    Finished \`release\` profile [optimized] target(s)\n    Running makensis to produce …\n    Finished 1 bundle at:\n        C:\\Users\\you\\lanewise\\target\\release\\bundle\\nsis\\${WINDOWS_INSTALLER}`,
        },
      ]}
    />
  ),

  "macos-version": () => (
    <Terminal
      system="macos"
      lines={[
        { command: "sw_vers" },
        { output: "ProductName:\t\tmacOS\nProductVersion:\t\t26.1\nBuildVersion:\t\t…" },
        { command: "uname -m" },
        { output: "arm64" },
        { note: "arm64 is Apple Silicon and x86_64 is Intel. Lanewise's disk image runs on both." },
      ]}
    />
  ),
  "macos-homebrew": () => (
    <Terminal
      system="macos"
      lines={[
        { command: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"' },
        { output: "==> Checking for `sudo` access (which may request your password)...\n…\n==> Installation successful!" },
        { note: "On Apple Silicon, put brew on your PATH, as the installer's Next steps say:" },
        { command: "echo 'eval \"$(/opt/homebrew/bin/brew shellenv)\"' >> ~/.zprofile" },
        { command: 'eval "$(/opt/homebrew/bin/brew shellenv)"' },
        { command: "brew --version" },
        { output: "Homebrew 7.0.12" },
      ]}
    />
  ),
  "macos-git": () => (
    <Terminal
      system="macos"
      lines={[
        { command: "brew install git" },
        { output: "==> Pouring git--2.56.1.arm64_tahoe.bottle.tar.gz\n🍺  /opt/homebrew/Cellar/git/2.56.1: …" },
        { command: "brew install --cask git-credential-manager" },
        { output: "==> Installing Cask git-credential-manager\n🍺  git-credential-manager was successfully installed!" },
      ]}
    />
  ),
  "macos-git-check": () => (
    <Terminal
      system="macos"
      lines={[
        { note: "In a new Terminal window:" },
        { command: "which git" },
        { output: "/opt/homebrew/bin/git" },
        { command: "git --version" },
        { output: "git version 2.56.1" },
        { command: "git credential-manager --version" },
        { output: "3.0.2+…" },
        { command: "git config --get-all credential.helper" },
        { output: "\n/usr/local/share/gcm-core/git-credential-manager" },
      ]}
    />
  ),
  "macos-download": () => <DownloadPage system="macos" chosen="macos" />,
  "macos-download-terminal": () => (
    <Terminal
      system="macos"
      lines={[
        { command: "cd ~/Downloads" },
        {
          command:
            "curl -fsSL https://api.github.com/repos/adrianeyre/lanewise/releases/latest | grep -o 'https://[^\"]*_universal\\.dmg' | head -n 1 | xargs curl -fLO",
        },
        { output: "  % Total    % Received % Xferd  Average Speed   Time\n100  …M  100  …M    0     0  …M      0  0:00:0…" },
        { command: "ls Lanewise_*_universal.dmg" },
        { output: MAC_DISK_IMAGE },
      ]}
    />
  ),
  "macos-disk-image": () => <MacDiskImage />,
  "macos-disk-image-terminal": () => (
    <Terminal
      system="macos"
      lines={[
        { command: "hdiutil attach -nobrowse -mountpoint /tmp/lanewise-dmg ~/Downloads/Lanewise_*_universal.dmg" },
        { output: "/dev/disk4          \tGUID_partition_scheme\n/dev/disk4s1        \tApple_HFS                      \t/private/tmp/lanewise-dmg" },
        { command: "ditto /tmp/lanewise-dmg/Lanewise.app /Applications/Lanewise.app" },
        { command: "hdiutil detach /tmp/lanewise-dmg" },
        { output: '"disk4" ejected.' },
      ]}
    />
  ),
  "macos-blocked": () => (
    <MacAlert
      heading="“Lanewise” Not Opened"
      text={[
        "Apple could not verify “Lanewise” is free of malware that may harm your Mac or compromise your privacy.",
      ]}
      buttons={[{ label: "Done", primary: true, chosen: true }, { label: "Move to Bin" }]}
    />
  ),
  "macos-privacy": () => <MacPrivacy />,
  "macos-open-anyway": () => (
    <MacAlert
      heading="Open “Lanewise”?"
      text={[
        "Apple is not able to verify that it is free from malware that could harm your Mac or compromise your privacy. Don't open this unless you are certain it is from a trustworthy source.",
      ]}
      buttons={[{ label: "Open Anyway", chosen: true }, { label: "Move to Bin" }, { label: "Done", primary: true }]}
    />
  ),
  "macos-password": () => <MacPassword />,
  "macos-quarantine": () => (
    <Terminal
      system="macos"
      lines={[
        { note: "See the quarantine mark macOS put on the downloaded app:" },
        { command: "xattr -l /Applications/Lanewise.app" },
        { output: "com.apple.quarantine: 0083;6734c8f2;Safari;…" },
        { note: "Remove it:" },
        { command: "xattr -d com.apple.quarantine /Applications/Lanewise.app" },
        { note: "Check it has gone (this prints nothing), then open Lanewise:" },
        { command: "xattr -l /Applications/Lanewise.app" },
        { command: "open /Applications/Lanewise.app" },
      ]}
    />
  ),
  "macos-quarantine-more": () => (
    <Terminal
      system="macos"
      lines={[
        { note: "If macOS still stops it, remove the mark from every file inside the app too:" },
        { command: "xattr -dr com.apple.quarantine /Applications/Lanewise.app" },
        { note: "Check the app is the one the Release built, signed ad hoc and for both chips:" },
        { command: "codesign -dv /Applications/Lanewise.app 2>&1 | grep -E 'Identifier|Signature'" },
        { output: "Identifier=com.adrianeyre.lanewise\nSignature=adhoc" },
        { command: "codesign --verify --deep --strict --verbose=2 /Applications/Lanewise.app" },
        { output: "/Applications/Lanewise.app: valid on disk\n/Applications/Lanewise.app: satisfies its Designated Requirement" },
        { command: "lipo -archs /Applications/Lanewise.app/Contents/MacOS/lanewise-desktop" },
        { output: "x86_64 arm64" },
      ]}
    />
  ),
  "macos-damaged": () => (
    <MacAlert
      heading="“Lanewise” is damaged and can’t be opened. You should move it to the Bin."
      text={["This file was downloaded on an unknown date."]}
      buttons={[{ label: "Move to Bin" }, { label: "Cancel", primary: true, chosen: true }]}
    />
  ),
  "macos-damaged-fix": () => (
    <Terminal
      system="macos"
      lines={[
        { note: "Clear every extended attribute from the app, then open it:" },
        { command: "xattr -cr /Applications/Lanewise.app" },
        { command: "open /Applications/Lanewise.app" },
        { note: "Still damaged? Sign it ad hoc again on this Mac, as the Release did, then open it:" },
        { command: "codesign --force --deep --sign - /Applications/Lanewise.app" },
        { output: "/Applications/Lanewise.app: replacing existing signature" },
        { command: "open /Applications/Lanewise.app" },
      ]}
    />
  ),
  "macos-uninstall": () => (
    <Terminal
      system="macos"
      lines={[
        { note: "Quit Lanewise first. To remove the app:" },
        { command: "rm -rf /Applications/Lanewise.app" },
        { note: "To remove its settings, Logs and caches as well:" },
        {
          command:
            'rm -rf ~/Library/Application\\ Support/com.adrianeyre.lanewise ~/Library/Caches/com.adrianeyre.lanewise ~/Library/Logs/com.adrianeyre.lanewise ~/Library/WebKit/com.adrianeyre.lanewise',
        },
      ]}
    />
  ),
  "macos-xcode": () => (
    <MacAlert
      icon={<span className="drawing-lock" aria-hidden="true">⚒</span>}
      heading="The “xcode-select” command requires the command line developer tools. Would you like to install the tools now?"
      text={["Choose Install to download and install the command line developer tools now."]}
      buttons={[{ label: "Install", primary: true, chosen: true }, { label: "Get Xcode" }, { label: "Not Now" }]}
    />
  ),
  "macos-xcode-check": () => (
    <Terminal
      system="macos"
      lines={[
        { command: "xcode-select --install" },
        { output: "xcode-select: note: install requested for command line developer tools" },
        { note: "Once the installer has finished:" },
        { command: "xcode-select -p" },
        { output: "/Library/Developer/CommandLineTools" },
      ]}
    />
  ),
  "macos-node": () => (
    <Terminal
      system="macos"
      lines={[
        { command: "curl -fsSL -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.41.0/install.sh | bash" },
        { output: "=> Downloading nvm from git to '/Users/you/.nvm'\n=> Appending nvm source string to /Users/you/.zshrc\n=> Close and reopen your terminal to start using nvm" },
        { note: "In a new Terminal window:" },
        { command: "nvm install 26" },
        { output: "Now using node v26.13.0 (npm v…)" },
        { command: "nvm alias default 26" },
        { command: "node --version" },
        { output: "v26.13.0" },
      ]}
    />
  ),
  "macos-corepack": () => (
    <Terminal system="macos" lines={[...COREPACK, { command: "cd ~/lanewise && pnpm --version" }, { output: "12.16.1" }]} />
  ),
  "macos-rust": () => (
    <Terminal
      system="macos"
      lines={[
        { command: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh" },
        { output: "1) Proceed with standard installation (default - just press enter)\n…\n  stable-aarch64-apple-darwin installed - rustc 1.100.0 (…)\nRust is installed now. Great!" },
        { command: '. "$HOME/.cargo/env"' },
        { command: "rustup component add clippy rustfmt" },
        { command: "rustup target add aarch64-apple-darwin x86_64-apple-darwin" },
        { command: "rustc --version" },
        { output: "rustc 1.100.0 (…)" },
      ]}
    />
  ),
  "macos-clone": () => <Terminal system="macos" lines={[{ command: "cd ~" }, ...CLONE]} />,
  "macos-dev": () => <Terminal system="macos" prompt="you@mac lanewise %" lines={DEV} />,
  "macos-checks": () => <Terminal system="macos" prompt="you@mac lanewise %" lines={CHECKS} />,
  "macos-build": () => (
    <Terminal
      system="macos"
      prompt="you@mac lanewise %"
      lines={[
        { command: "node app/scripts/release/signMacos.ts -- pnpm desktop:build --target universal-apple-darwin" },
        {
          output: `    Finished \`release\` profile [optimized] target(s)\n    Bundling Lanewise.app (…/universal-apple-darwin/release/bundle/macos/Lanewise.app)\n    Bundling ${MAC_DISK_IMAGE} (…/universal-apple-darwin/release/bundle/dmg/${MAC_DISK_IMAGE})\n    Finished 2 bundles`,
        },
        { note: "Built on your own Mac, it opens without Gatekeeper's warning." },
      ]}
    />
  ),

  "linux-version": () => (
    <Recorded
      lines={[
        { command: "grep -E '^(PRETTY_NAME|VERSION_ID)=' /etc/os-release" },
        { output: 'PRETTY_NAME="Ubuntu 24.04.5 LTS"\nVERSION_ID="24.04"' },
        { command: "uname -m" },
        { output: "aarch64" },
        { note: "x86_64 is a 64-bit Intel or AMD processor and aarch64 is 64-bit Arm." },
      ]}
    />
  ),
  "linux-packages": () => (
    <Recorded
      lines={[
        { command: "sudo apt-get update" },
        {
          command:
            "sudo apt-get install -y --no-install-recommends git curl ca-certificates build-essential pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libssl-dev libxdo-dev file gnome-keyring",
        },
        { output: "…\nSetting up libwebkit2gtk-4.1-dev …" },
        { command: "pkg-config --modversion webkit2gtk-4.1" },
        { output: "2.52.6" },
        { command: "git --version" },
        { output: "git version 2.43.0" },
      ]}
    />
  ),
  "linux-git-ppa": () => (
    <Terminal
      system="linux"
      lines={[
        { note: "Only if git --version is older than 2.40, as on Ubuntu 22.04:" },
        { command: "sudo add-apt-repository ppa:git-core/ppa" },
        { command: "sudo apt-get update && sudo apt-get install -y git" },
        { command: "git --version" },
        { output: "git version 2.5…" },
      ]}
    />
  ),
  "linux-credential-manager": () => (
    <Recorded
      lines={[
        { command: "curl -fsSLO https://github.com/git-ecosystem/git-credential-manager/releases/download/v3.0.2/gcm-linux-x64-3.0.2.deb" },
        { command: "sudo dpkg -i gcm-linux-x64-3.0.2.deb" },
        { command: "git-credential-manager configure" },
        { output: "Configuring component 'Git Credential Manager'...\nConfiguring component 'Azure Repos provider'..." },
        { command: "git config --global credential.credentialStore secretservice" },
        { command: "git credential-manager --version" },
        { output: "3.0.2+0d95999b8fb39bd1045770fe1d69f6a2b07101d7" },
        { command: "git config --get-all credential.helper" },
        { output: "\n/usr/local/bin/git-credential-manager" },
      ]}
    />
  ),
  "linux-node": () => (
    <Recorded
      lines={[
        { command: "curl -fsSL -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.41.0/install.sh | bash" },
        { output: "=> Downloading nvm from git to '/home/you/.nvm'\n=> Close and reopen your terminal to start using nvm" },
        { note: "In a new terminal window:" },
        { command: "nvm install 26" },
        { output: "Downloading https://nodejs.org/dist/v26.13.1/node-v26.13.1-linux-arm64.tar.xz...\nComputing checksum with sha256sum\nChecksums matched!" },
        { command: "nvm alias default 26" },
        { output: "default -> 26 (-> v26.13.1 *)" },
        { command: "node --version" },
        { output: "v26.13.1" },
      ]}
    />
  ),
  "linux-corepack": () => (
    <Recorded
      lines={[
        { command: "npm install -g corepack@latest" },
        { command: "corepack enable" },
        { command: "corepack --version" },
        { output: "0.36.0" },
      ]}
    />
  ),
  "linux-rust": () => (
    <Recorded
      lines={[
        { command: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --component clippy,rustfmt" },
        { command: '. "$HOME/.cargo/env"' },
        { command: "rustc --version" },
        { output: "rustc 1.100.0 (0ef1bc386 2026-11-09)" },
        { command: "cargo clippy --version" },
        { output: "clippy 0.1.100 (0ef1bc3860 2026-11-09)" },
        { command: "cargo fmt --version" },
        { output: "rustfmt 1.11.0-stable (0ef1bc3860 2026-11-09)" },
      ]}
    />
  ),
  "linux-clone": () => (
    <Recorded
      lines={[
        { command: "git clone https://github.com/adrianeyre/lanewise.git" },
        { command: "cd lanewise" },
        { command: "pnpm --version" },
        { output: "Downloading the pnpm 12.16.1 binary for linux-arm64...\n12.16.1" },
        { command: "pnpm install --frozen-lockfile" },
      ]}
    />
  ),
  "linux-dev": () => <Terminal system="linux" prompt="you@ubuntu:~/lanewise$" lines={DEV} />,
  "linux-checks": () => <Terminal system="linux" prompt="you@ubuntu:~/lanewise$" lines={CHECKS} />,
  "linux-build": () => (
    <Recorded
      prompt="you@ubuntu:~/lanewise$"
      lines={[
        { command: "pnpm exec tauri build --no-bundle" },
        {
          output:
            "   Compiling webkit2gtk v2.0.2\n   Compiling tao v0.37.1\n    Finished `release` profile [optimized] target(s) in 43.58s\n       Built application at: /home/you/lanewise/target/release/lanewise-desktop",
        },
        { command: "ls -lh target/release/lanewise-desktop" },
        { output: "-rwxr-xr-x 2 you you 38M Nov 13 10:48 target/release/lanewise-desktop" },
      ]}
    />
  ),
  "linux-launcher": () => (
    <Terminal
      system="linux"
      prompt="you@ubuntu:~/lanewise$"
      lines={[
        { command: "install -Dm755 target/release/lanewise-desktop ~/.local/bin/lanewise" },
        { command: "install -Dm644 desktop/icons/128x128.png ~/.local/share/icons/hicolor/128x128/apps/lanewise.png" },
        {
          command:
            "printf '[Desktop Entry]\\nType=Application\\nName=Lanewise\\nExec=%s\\nIcon=lanewise\\nCategories=Development;\\n' \"$HOME/.local/bin/lanewise\" > ~/.local/share/applications/lanewise.desktop",
        },
        { command: "update-desktop-database ~/.local/share/applications" },
      ]}
    />
  ),
  "linux-desktop-entry": () => <LinuxFiles />,
} satisfies Record<string, () => ReactNode>;

export type DrawingName = keyof typeof DRAWINGS;

export function isDrawing(name: string): name is DrawingName {
  return Object.hasOwn(DRAWINGS, name);
}

export function Drawing({ name }: { name: DrawingName }) {
  return DRAWINGS[name]();
}
