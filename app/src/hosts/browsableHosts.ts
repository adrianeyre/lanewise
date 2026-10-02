/**
 * The Hosts that Browse repositories always offers, one for each Tier 2 Host
 * Integration (PRD §9.1, ADR 0037), and how each Host is named in words.
 * The GitHub Enterprise Servers added in Settings come after them.
 */
import type { IntegrationKind } from "../commands/api";
import { GITHUB_COM } from "./enterpriseHosts";

/** A Tier 2 Host Integration. */
export type TierTwoIntegration = Exclude<IntegrationKind, "generic">;

/** A Host that's always there to browse. */
export interface BrowsableHost {
  /** The Host, as `detectHost` names it, such as `gitlab.com`. */
  host: string;
  /** Its name in words, such as "GitLab.com". */
  name: string;
  integration: TierTwoIntegration;
}

export const BROWSABLE_HOSTS: readonly BrowsableHost[] = [
  { host: GITHUB_COM, name: "GitHub.com", integration: "github" },
  { host: "gitlab.com", name: "GitLab.com", integration: "gitLab" },
  { host: "bitbucket.org", name: "Bitbucket", integration: "bitbucket" },
  { host: "dev.azure.com", name: "Azure DevOps", integration: "azureDevOps" },
];

/** An Azure DevOps organization's older Host, such as `fabrikam.visualstudio.com`. */
const VISUAL_STUDIO = /^[a-z0-9-]+\.visualstudio\.com$/;

/**
 * The Tier 2 Host Integration that serves `host`, a Host that can be signed in to: one of
 * {@link BROWSABLE_HOSTS}, an Azure DevOps organization's older Host, or else a GitHub Enterprise Server.
 */
export function integrationFor(host: string): TierTwoIntegration {
  const browsable = BROWSABLE_HOSTS.find((each) => each.host === host);
  if (browsable !== undefined) return browsable.integration;
  return VISUAL_STUDIO.test(host) ? "azureDevOps" : "github";
}

/** `host` named in words, with its address, such as "GitLab.com (gitlab.com)". */
export function hostLabel(host: string): string {
  const browsable = BROWSABLE_HOSTS.find((each) => each.host === host);
  if (browsable !== undefined) return `${browsable.name} (${host})`;
  return integrationFor(host) === "azureDevOps"
    ? `Azure DevOps (${host})`
    : `GitHub Enterprise Server (${host})`;
}
