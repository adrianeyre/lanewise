import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  ExternalLink,
  type LucideIcon,
  RefreshCw,
} from "lucide-react";
import { type ReactNode, useId } from "react";

import type { CheckedGitSetup, CredentialManagerFound, GitFound } from "../commands/api";

interface Props {
  /** What the last check found: something is missing. */
  setup: CheckedGitSetup;
  /** "Check again" is running. */
  rechecking: boolean;
  /** `setup` is the answer to a "Check again", rather than the check on start. */
  rechecked: boolean;
  onCheckAgain(): void;
  onContinue(): void;
  /** Opens a link in the user's browser. */
  onOpenLink(url: string): void;
}

const links = {
  gitForWindows: "https://git-scm.com/install/windows",
  gitForLinux: "https://git-scm.com/install/linux",
  gitDownloads: "https://git-scm.com/downloads",
  homebrew: "https://brew.sh/",
  credentialManager:
    "https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/install.md",
};

const list = new Intl.ListFormat("en", { type: "conjunction" });
const quote = (text: string) => `“${text}”`;

/**
 * The first-run screen, shown instead of the rest of the app while the Git
 * Setup is missing something (PRD §9.3): what the check found, what to do
 * about it on this platform, "Check again", and a way to carry on without it.
 */
export function GitSetupScreen({
  setup,
  rechecking,
  rechecked,
  onCheckAgain,
  onContinue,
  onOpenLink,
}: Props) {
  const headingId = useId();
  const foundId = useId();
  const gitReady = setup.git.kind === "supported";
  const needs = [
    ...(gitReady ? [] : [`Git ${setup.minimumVersion} or later`]),
    ...(setup.credentialManager.kind === "configured" ? [] : ["Git Credential Manager"]),
  ];

  return (
    <section className="setup" aria-labelledby={headingId}>
      <h2 id={headingId} className="setup-heading">
        Set up Git for Lanewise
      </h2>
      <p className="setup-intro">
        Lanewise runs the Git installed on this computer, and signs in to Hosts through Git
        Credential Manager. It needs {list.format(needs)}.
      </p>

      <h3 id={foundId} className="setup-subheading">
        What Lanewise found
      </h3>
      <ul className="setup-findings" aria-labelledby={foundId}>
        <GitFinding git={setup.git} minimumVersion={setup.minimumVersion} />
        <CredentialManagerFinding found={setup.credentialManager} />
      </ul>

      <Guidance setup={setup} onOpenLink={onOpenLink} />

      <div className="setup-actions">
        <button
          type="button"
          className="button"
          aria-disabled={rechecking}
          onClick={() => {
            if (!rechecking) onCheckAgain();
          }}
        >
          <RefreshCw aria-hidden="true" className="button-icon" />
          Check again
        </button>
        <p role="status" className="setup-status">
          {rechecking
            ? "Checking again…"
            : rechecked
              ? `Checked again. Lanewise still needs ${list.format(needs)}.`
              : ""}
        </p>
      </div>

      {/* TODO: remember "Continue for now" with the other settings, so the
          screen only comes back when the Git Setup changes (PRD §7.9, M1). */}
      <div className="setup-continue">
        <p className="setup-consequence">
          {gitReady
            ? "Without Git Credential Manager, Lanewise still works with the repositories on this computer, SSH remotes and other credential helpers, but can't sign in to Hosts for you."
            : "Until Git is set up, Lanewise can open repositories and show their changes, but nothing that runs Git, such as committing or fetching, will work."}
        </p>
        <button type="button" className="button" onClick={onContinue}>
          Continue for now
        </button>
      </div>
    </section>
  );
}

type Standing = "ready" | "missing" | "unknown";

const standings: Record<Standing, LucideIcon> = {
  ready: CircleCheck,
  missing: CircleX,
  unknown: CircleDashed,
};

/** One thing the check found, told by its words and an icon, never its colour alone. */
function Finding({
  standing,
  icon,
  children,
}: {
  standing: Standing;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  const Icon = icon ?? standings[standing];
  return (
    <li className={`setup-finding setup-${standing}`}>
      <Icon aria-hidden="true" className="setup-finding-icon" />
      <div className="setup-finding-text">{children}</div>
    </li>
  );
}

function GitFinding({ git, minimumVersion }: { git: GitFound; minimumVersion: string }) {
  switch (git.kind) {
    case "supported":
      return (
        <Finding standing="ready">
          <p>Git {git.version} is installed.</p>
          <p className="setup-detail">{git.path}</p>
        </Finding>
      );
    case "tooOld":
      return (
        <Finding standing="missing">
          <p>
            Git {git.version} is too old. Lanewise needs Git {minimumVersion} or later.
          </p>
          <p className="setup-detail">{git.path}</p>
        </Finding>
      );
    case "unusable":
      return (
        <Finding standing="missing">
          <p>Lanewise found Git, but it didn't run.</p>
          <p className="setup-detail">{git.path}</p>
          <p className="setup-detail">{git.message}</p>
        </Finding>
      );
    case "missing":
      return (
        <Finding standing="missing">
          <p>Git isn't installed, or isn't where Lanewise looks for it.</p>
        </Finding>
      );
  }
}

function CredentialManagerFinding({ found }: { found: CredentialManagerFound }) {
  switch (found.kind) {
    case "configured":
      return (
        <Finding standing="ready">
          <p>Git Credential Manager is Git's credential helper.</p>
        </Finding>
      );
    case "notConfigured":
      return (
        <Finding standing="missing">
          <p>
            Git Credential Manager isn't Git's credential helper.{" "}
            {found.helpers.length === 0
              ? "Git has none."
              : `Git uses ${list.format(found.helpers.map(quote))} instead.`}
          </p>
        </Finding>
      );
    case "unchecked":
      return (
        <Finding standing="unknown">
          <p>Git Credential Manager can be checked once Git is set up.</p>
        </Finding>
      );
    case "unreadable":
      return (
        <Finding standing="missing" icon={CircleAlert}>
          <p>Lanewise couldn't read Git's credential helpers.</p>
          <p className="setup-detail">{found.message}</p>
        </Finding>
      );
  }
}

/** What to do about what's missing, on the machine that runs Git. */
function Guidance({
  setup,
  onOpenLink,
}: {
  setup: CheckedGitSetup;
  onOpenLink(url: string): void;
}) {
  const headingId = useId();
  const git = setup.git.kind === "supported" ? null : setup.git.kind;
  const credentialManager = setup.credentialManager.kind !== "configured";
  const link = (url: string, text: string) => (
    <Link url={url} onOpenLink={onOpenLink}>
      {text}
    </Link>
  );

  let heading = "What to do";
  let intro: ReactNode = null;
  const steps: ReactNode[] = [];
  switch (setup.operatingSystem) {
    case "windows":
      heading = "What to do on Windows";
      if (git !== null) {
        steps.push(
          <>
            Install Git for Windows, which includes Git Credential Manager and sets it up as
            Git's credential helper.{" "}
            {git === "tooOld" && "Installing it again updates the Git you have. "}
            {link(links.gitForWindows, "Download Git for Windows")}, or run this in a terminal:
            <Command>winget install --id Git.Git -e --source winget</Command>
          </>,
        );
      } else if (credentialManager) {
        steps.push(
          <>
            Git for Windows includes Git Credential Manager. Make it Git's credential helper by
            running this in a terminal:
            <Command>git config --global credential.helper manager</Command>
          </>,
          <>
            If Check again still doesn't find it, install the latest Git for Windows, which sets
            it up for you: {link(links.gitForWindows, "Download Git for Windows")}.
          </>,
        );
      }
      break;
    case "macos":
      heading = "What to do on macOS";
      intro = (
        <p>
          On macOS, Git and Git Credential Manager are installed separately. Both come from{" "}
          {link(links.homebrew, "Homebrew")}; install it first if you don't have it.
        </p>
      );
      if (git !== null) {
        steps.push(
          <>
            Install Git by running this in a terminal:
            <Command>brew install git</Command>
            {git !== "missing" &&
              "The Git that comes with Apple's Command Line Tools can be older than Lanewise needs; Homebrew's is kept up to date."}
          </>,
        );
      }
      if (credentialManager) {
        steps.push(
          <>
            Install Git Credential Manager by running this in a terminal:
            <Command>brew install --cask git-credential-manager</Command>
            If Check again still doesn't find it, make it Git's credential helper with:
            <Command>git-credential-manager configure</Command>
          </>,
        );
      }
      break;
    case "linux":
    case "other":
      if (setup.operatingSystem === "linux") heading = "What to do on Linux";
      if (git !== null) {
        steps.push(
          <>
            Install Git {setup.minimumVersion} or later with your package manager:{" "}
            {setup.operatingSystem === "linux"
              ? link(links.gitForLinux, "Git's instructions for Linux")
              : link(links.gitDownloads, "Git's downloads")}
            .
          </>,
        );
      }
      if (credentialManager) {
        steps.push(
          <>
            Install Git Credential Manager, following{" "}
            {link(links.credentialManager, "its install instructions")}, then make it Git's
            credential helper by running this in a terminal:
            <Command>git-credential-manager configure</Command>
          </>,
        );
      }
      break;
  }
  steps.push(<>Then choose Check again.</>);

  return (
    <section className="setup-guidance" aria-labelledby={headingId}>
      <h3 id={headingId} className="setup-subheading">
        {heading}
      </h3>
      {intro}
      <ol className="setup-steps">
        {steps.map((step, index) => (
          // The steps are fixed for a given setup, so their order is their identity.
          <li key={index}>{step}</li>
        ))}
      </ol>
    </section>
  );
}

/** A command to type, shown on its own line so it can be selected and copied. */
function Command({ children }: { children: string }) {
  return (
    <code className="setup-command" translate="no">
      {children}
    </code>
  );
}

/** A link opened in the user's browser, never in Lanewise's own window. */
function Link({
  url,
  onOpenLink,
  children,
}: {
  url: string;
  onOpenLink(url: string): void;
  children: string;
}) {
  return (
    <a
      href={url}
      className="setup-link"
      onClick={(event) => {
        event.preventDefault();
        onOpenLink(url);
      }}
    >
      {children}{" "}
      <ExternalLink aria-hidden="true" className="setup-link-icon" />
      <span className="visually-hidden">(opens in your browser)</span>
    </a>
  );
}
