import { BookOpen } from "lucide-react";
import type { ReactNode } from "react";

import { ExternalLink } from "../../app/src/legal/ExternalLink";
import { REPOSITORY_URL } from "../../app/src/legal/links";
import { RELEASES_URL } from "./downloads";

export const DOCS_INDEX_URL = `${REPOSITORY_URL}/blob/main/docs/README.md`;

export function buildDocUrl(path: string): string {
  return `${REPOSITORY_URL}/blob/main/docs/${path}`;
}

export const GUIDES = [
  { path: "setup/README.md", name: "Setup guides", about: "Every tool Lanewise needs, and where to get it, on each system." },
  { path: "setup/windows.md", name: "Setting up Lanewise on Windows", about: "Installing a Release past SmartScreen, then building from source." },
  {
    path: "setup/macos.md",
    name: "Setting up Lanewise on macOS",
    about: "Installing a Release past Gatekeeper, with every Terminal command, then building from source.",
  },
  { path: "setup/linux.md", name: "Setting up Lanewise on Linux", about: "Building from source, up to an entry in your applications." },
  { path: "setup/first-steps.md", name: "First steps in Lanewise", about: "Opening and cloning a repository, signing in to a Host and turning on AI." },
  { path: "ai-suggestions.md", name: "Suggestions from your own Model Provider", about: "API keys, gateways and Jev decisions." },
  { path: "development.md", name: "Setting Lanewise up locally", about: "Every command, the checks, the benchmark and common setup problems." },
  { path: "releases.md", name: "Releases", about: "How a Release is made and signed, and how Updates work." },
] as const;

interface Step {
  text: ReactNode;
  commands?: string[];
}

function Commands({ commands, label }: { commands: string[]; label: string }) {
  return (
    <pre className="site-commands" tabIndex={0} aria-label={label}>
      <code>{commands.join("\n")}</code>
    </pre>
  );
}

function Steps({ system, steps }: { system: string; steps: Step[] }) {
  return (
    <ol className="site-steps">
      {steps.map((step, index) => (
        <li key={index}>
          <p>{step.text}</p>
          {step.commands && <Commands commands={step.commands} label={`${system}, step ${index + 1}: commands`} />}
        </li>
      ))}
    </ol>
  );
}

function Guide({ path, children }: { path: string; children: ReactNode }) {
  return <ExternalLink href={buildDocUrl(path)}>{children}</ExternalLink>;
}

const WINDOWS_INSTALL: Step[] = [
  {
    text: (
      <>
        Install Git for Windows, which includes Git Credential Manager, in Terminal or PowerShell. Lanewise runs the Git on
        your computer, 2.40 or later.
      </>
    ),
    commands: ["winget install --id Git.Git -e --source winget"],
  },
  {
    text: (
      <>
        Download the installer from <a href="#download">the Download section</a>, or from PowerShell:
      </>
    ),
    commands: [
      "$release = Invoke-RestMethod https://api.github.com/repos/adrianeyre/lanewise/releases/latest",
      "$installer = $release.assets | Where-Object name -like '*_x64-setup.exe'",
      'Invoke-WebRequest $installer.browser_download_url -OutFile "$HOME\\Downloads\\$($installer.name)"',
    ],
  },
  {
    text: (
      <>
        Run it. It installs Lanewise for you alone, with no administrator rights. It isn&apos;t signed yet, so if SmartScreen
        says <strong>Windows protected your PC</strong>, choose <strong>More info</strong>, then <strong>Run anyway</strong>.
        Or remove the downloaded mark first and run it from PowerShell:
      </>
    ),
    commands: [
      'Unblock-File "$HOME\\Downloads\\Lanewise_*_x64-setup.exe"',
      'Start-Process (Get-Item "$HOME\\Downloads\\Lanewise_*_x64-setup.exe")',
    ],
  },
  { text: <>Open Lanewise from Start. It updates itself from then on.</> },
];

const MACOS_INSTALL: Step[] = [
  {
    text: (
      <>
        Install <ExternalLink href="https://brew.sh">Homebrew</ExternalLink> if you don&apos;t have it, then Git 2.40 or
        later and Git Credential Manager, in Terminal. The Git in Apple&apos;s Command Line Tools can be too old.
      </>
    ),
    commands: [
      '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
      "brew install git",
      "brew install --cask git-credential-manager",
    ],
  },
  {
    text: (
      <>
        Download the disk image from <a href="#download">the Download section</a>, open it and drag Lanewise to Applications.
        Or do it all in Terminal; a file <code>curl</code> downloads has no quarantine mark, so Gatekeeper won&apos;t stop it:
      </>
    ),
    commands: [
      "cd ~/Downloads",
      "curl -fsSL https://api.github.com/repos/adrianeyre/lanewise/releases/latest | grep -o 'https://[^\"]*_universal\\.dmg' | head -n 1 | xargs curl -fLO",
      "hdiutil attach ~/Downloads/Lanewise_*_universal.dmg",
      "ditto /Volumes/Lanewise/Lanewise.app /Applications/Lanewise.app",
      "hdiutil detach /Volumes/Lanewise",
    ],
  },
  {
    text: (
      <>
        Lanewise is signed ad hoc and not notarized by Apple, so the first time you open a downloaded copy, macOS says
        <strong> “Lanewise” Not Opened</strong>. Choose <strong>Done</strong>, then <strong>Open Anyway</strong> in{" "}
        <strong>System Settings → Privacy &amp; Security</strong>, under Security, and give your password. Or allow it from
        Terminal:
      </>
    ),
    commands: [
      "xattr -l /Applications/Lanewise.app",
      "xattr -d com.apple.quarantine /Applications/Lanewise.app",
      "open /Applications/Lanewise.app",
    ],
  },
  {
    text: (
      <>
        If macOS still stops it, remove the mark from every file in the app, and check its ad hoc signature. If it says
        Lanewise <strong>is damaged</strong>, clear its attributes, and if that isn&apos;t enough, sign it ad hoc again on
        your Mac. Never turn Gatekeeper off for the whole Mac.
      </>
    ),
    commands: [
      "xattr -dr com.apple.quarantine /Applications/Lanewise.app",
      "codesign -dv /Applications/Lanewise.app 2>&1 | grep Signature   # Signature=adhoc",
      "xattr -cr /Applications/Lanewise.app",
      "codesign --force --deep --sign - /Applications/Lanewise.app",
      "open /Applications/Lanewise.app",
    ],
  },
];

const LINUX_INSTALL: Step[] = [
  {
    text: (
      <>
        A Release has no Linux installer, so build Lanewise from source. On Ubuntu or Debian, install Git, a C toolchain,
        Tauri&apos;s packages and GNOME Keyring, then Git Credential Manager from{" "}
        <ExternalLink href="https://github.com/git-ecosystem/git-credential-manager/releases/latest">its latest Release</ExternalLink>:
      </>
    ),
    commands: [
      "sudo apt-get update",
      "sudo apt-get install -y --no-install-recommends git curl ca-certificates build-essential pkg-config \\",
      "  libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libssl-dev libxdo-dev file gnome-keyring",
      "curl -fsSLO https://github.com/git-ecosystem/git-credential-manager/releases/download/v3.0.2/gcm-linux-x64-3.0.2.deb",
      "sudo dpkg -i gcm-linux-x64-3.0.2.deb",
      "git-credential-manager configure",
      "git config --global credential.credentialStore secretservice",
    ],
  },
  {
    text: (
      <>
        Then follow <a href="#build">Build from source</a>, and{" "}
        <Guide path="setup/linux.md">the Linux Setup guide</Guide> to add Lanewise to your applications. It has the
        commands for Fedora and Arch too.
      </>
    ),
  },
];

const BUILD_TOOLS: { system: string; steps: Step[] }[] = [
  {
    system: "Windows",
    steps: [
      {
        text: <>The C++ Build Tools, Rust with the MSVC toolchain, and fnm for Node 26. Open a new terminal after each install.</>,
        commands: [
          'winget install --id Microsoft.VisualStudio.2022.BuildTools -e --source winget --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"',
          "winget install --id Rustlang.Rustup -e --source winget",
          "rustup default stable-msvc",
          "rustup component add clippy rustfmt",
          "winget install --id Schniz.fnm -e --source winget",
          "New-Item -ItemType File -Force $PROFILE | Out-Null",
          "Add-Content $PROFILE 'fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression'",
          "fnm install 26",
          "fnm default 26",
        ],
      },
    ],
  },
  {
    system: "macOS",
    steps: [
      {
        text: <>The Xcode Command Line Tools, nvm for Node 26, and Rust with both Mac targets. Open a new window after nvm.</>,
        commands: [
          "xcode-select --install",
          "curl -fsSL -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.41.0/install.sh | bash",
          "nvm install 26",
          "nvm alias default 26",
          "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh",
          'source "$HOME/.cargo/env"',
          "rustup component add clippy rustfmt",
          "rustup target add aarch64-apple-darwin x86_64-apple-darwin",
        ],
      },
    ],
  },
  {
    system: "Linux",
    steps: [
      {
        text: <>The packages under Install, then nvm for Node 26 and Rust. Open a new terminal after nvm.</>,
        commands: [
          "curl -fsSL -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.41.0/install.sh | bash",
          "nvm install 26",
          "nvm alias default 26",
          "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --component clippy,rustfmt",
          'source "$HOME/.cargo/env"',
        ],
      },
    ],
  },
];

const BUILD_STEPS: Step[] = [
  {
    text: (
      <>
        Turn on <ExternalLink href="https://github.com/nodejs/corepack">corepack</ExternalLink>, which provides{" "}
        <ExternalLink href="https://pnpm.io">pnpm</ExternalLink> at the version Lanewise names, then clone Lanewise and
        install its packages:
      </>
    ),
    commands: [
      "npm install -g corepack@latest",
      "corepack enable",
      "git clone https://github.com/adrianeyre/lanewise.git",
      "cd lanewise",
      "pnpm install --frozen-lockfile",
    ],
  },
  {
    text: <>Run it. The first build compiles every crate and takes several minutes.</>,
    commands: ["pnpm desktop:dev"],
  },
  {
    text: <>Run the checks every commit must pass, and build the installer, or on Linux the release binary.</>,
    commands: ["pnpm lint", "pnpm typecheck", "pnpm test", "pnpm desktop:build"],
  },
];

const NEEDS: [string, ReactNode, ReactNode][] = [
  ["Windows 10 22H2 or later, or 11, on x64", "Git for Windows 2.40 or later, which includes Git Credential Manager", "The C++ Build Tools, Rust, Node 26, corepack"],
  [
    "macOS 14 or later, on Apple Silicon or Intel",
    "Git 2.40 or later and Git Credential Manager, from Homebrew",
    "The Xcode Command Line Tools, Rust, Node 26, corepack",
  ],
  ["Linux, x86_64 or aarch64", "No installer: build it", "Git 2.40 or later, Git Credential Manager, WebKitGTK 4.1, Rust, Node 26, corepack"],
];

export function SetupSections() {
  return (
    <>
      <section id="needs" className="site-section" aria-labelledby="site-needs">
        <h2 id="site-needs">What you need</h2>
        <p>Everything is free. There&apos;s no account to make, and nothing is sent about how you use Lanewise.</p>
        <div className="site-table" tabIndex={0} role="region" aria-label="What each computer needs">
          <table>
            <thead>
              <tr>
                <th scope="col">Your computer</th>
                <th scope="col">To install a Release</th>
                <th scope="col">To build from source, as well</th>
              </tr>
            </thead>
            <tbody>
              {NEEDS.map(([computer, install, build]) => (
                <tr key={computer}>
                  <th scope="row">{computer}</th>
                  <td>{install}</td>
                  <td>{build}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          <Guide path="setup/README.md#where-to-get-everything">Where to get every tool</Guide>, for each system, with how to
          check each one.
        </p>
      </section>

      <section id="install" className="site-section" aria-labelledby="site-install">
        <h2 id="site-install">Install</h2>
        <p>
          The quick version, for each system. The Setup guides have every step, with a picture of each. Download from{" "}
          <a href="#download">Download</a> above, or from <ExternalLink href={RELEASES_URL}>every Release</ExternalLink>.
        </p>
        <div className="site-systems">
          <section aria-labelledby="site-install-windows">
            <h3 id="site-install-windows">Windows</h3>
            <Steps system="Windows" steps={WINDOWS_INSTALL} />
            <p>
              <Guide path="setup/windows.md">Every step on Windows</Guide>
            </p>
          </section>
          <section aria-labelledby="site-install-macos">
            <h3 id="site-install-macos">macOS</h3>
            <Steps system="macOS" steps={MACOS_INSTALL} />
            <p>
              <Guide path="setup/macos.md">Every step on macOS</Guide>
            </p>
          </section>
          <section aria-labelledby="site-install-linux">
            <h3 id="site-install-linux">Linux</h3>
            <Steps system="Linux" steps={LINUX_INSTALL} />
            <p>
              <Guide path="setup/linux.md">Every step on Linux</Guide>
            </p>
          </section>
        </div>
        <p>
          The first time Lanewise starts, it checks Git and Git Credential Manager, and if either is missing it says what to
          install, with <strong>Check again</strong>. Then <Guide path="setup/first-steps.md">open your first repository</Guide>.
        </p>
      </section>

      <section id="build" className="site-section" aria-labelledby="site-build">
        <h2 id="site-build">Build from source</h2>
        <p>
          To work on Lanewise, or to run it on Linux. First the tools for your system, from{" "}
          <ExternalLink href="https://rustup.rs">rustup</ExternalLink>,{" "}
          <ExternalLink href="https://github.com/nvm-sh/nvm">nvm</ExternalLink> or{" "}
          <ExternalLink href="https://github.com/Schniz/fnm">fnm</ExternalLink>:
        </p>
        <div className="site-systems">
          {BUILD_TOOLS.map(({ system, steps }) => (
            <section key={system} aria-labelledby={`site-build-${system.toLowerCase()}`}>
              <h3 id={`site-build-${system.toLowerCase()}`}>Tools for {system}</h3>
              <Steps system={`Tools for ${system}`} steps={steps} />
            </section>
          ))}
        </div>
        <h3>Then, on every system</h3>
        <Steps system="Build" steps={BUILD_STEPS} />
        <p>
          <Guide path="development.md">Setting Lanewise up locally</Guide> explains every command, and{" "}
          <ExternalLink href={`${REPOSITORY_URL}/blob/main/CONTRIBUTING.md`}>CONTRIBUTING.md</ExternalLink> how to make a
          contribution.
        </p>
      </section>

      <section id="docs" className="site-section" aria-labelledby="site-docs">
        <h2 id="site-docs">Documentation</h2>
        <ul className="site-guides">
          {GUIDES.map((guide) => (
            <li key={guide.path}>
              <Guide path={guide.path}>{guide.name}</Guide>: {guide.about}
            </li>
          ))}
        </ul>
        <p>
          <ExternalLink href={DOCS_INDEX_URL} className="button">
            <BookOpen aria-hidden="true" className="button-icon" />
            Every document
          </ExternalLink>
        </p>
      </section>
    </>
  );
}
