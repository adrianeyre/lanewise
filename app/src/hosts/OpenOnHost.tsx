import { Globe } from "lucide-react";
import { siBitbucket, siGithub, siGitlab, type SimpleIcon } from "simple-icons";

import type { IntegrationKind } from "../commands/api";
import type { WebPage } from "./webPage";

/** Each Host Integration's logo, as its Host publishes it; a globe for a Host with none here. */
const LOGOS: Partial<Record<IntegrationKind, SimpleIcon>> = {
  github: siGithub,
  gitLab: siGitlab,
  bitbucket: siBitbucket,
};

/** The Host's name, as a sentence says it: GitHub, or the name in its URL. */
export function hostNameOf(page: WebPage): string {
  switch (page.integration) {
    case "github":
      return "GitHub";
    case "gitLab":
      return "GitLab";
    case "bitbucket":
      return "Bitbucket";
    case "azureDevOps":
      return "Azure DevOps";
    case "generic":
      return new URL(page.url).host;
  }
}

/** A Host's logo, in the text's colour, so it holds its contrast in both Themes. */
export function HostLogo({ integration }: { integration: IntegrationKind }) {
  const logo = LOGOS[integration];
  if (logo === undefined) return <Globe aria-hidden="true" className="host-logo" />;
  return (
    <svg viewBox="0 0 24 24" className="host-logo" fill="currentColor" aria-hidden="true" focusable="false">
      <path d={logo.path} />
    </svg>
  );
}

interface Props {
  /** The repository's page on its Host. */
  page: WebPage;
  /** The repository's name, for screen readers. */
  name: string;
  onOpenLink: (url: string) => void;
  /** Just the logo, where there's no room for the words: they're its tooltip then. */
  compact?: boolean;
}

/**
 * “Open repository”, with its Host's logo: opens the repository's page on
 * its Host, such as GitHub, in a Tab of its own where the shell can show
 * it, or else in the user's browser (ADR 0042).
 * Shown wherever a repository is: the Recent Repositories, Browse
 * repositories, the Toolbar and each remote.
 */
export function OpenOnHost({ page, name, onOpenLink, compact = false }: Props) {
  const host = hostNameOf(page);
  return (
    <button
      type="button"
      className={compact ? "button button-small open-on-host open-on-host-compact" : "button button-small open-on-host"}
      aria-label={`Open repository ${name} on ${host}`}
      title={`Open repository on ${host}: ${page.url}`}
      onClick={(event) => {
        // It's inside what opens the repository here, in places, as a Recent Repository's row.
        event.stopPropagation();
        onOpenLink(page.url);
      }}
    >
      <HostLogo integration={page.integration} />
      {!compact && <span>Open repository</span>}
    </button>
  );
}
