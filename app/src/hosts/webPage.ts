import type { IntegrationKind } from "../commands/api";

/** A repository's page on its Host, to open in the user's browser. */
export interface WebPage {
  url: string;
  /** Which Host Integration serves the Host, for its logo and name. */
  integration: IntegrationKind;
}

/** The Hosts known from their names alone, as `detectHost` has them. */
const KNOWN: Record<string, IntegrationKind> = {
  "github.com": "github",
  "gitlab.com": "gitLab",
  "bitbucket.org": "bitbucket",
  "dev.azure.com": "azureDevOps",
};

/**
 * The web page of the repository a remote at `remote` is, on its Host: an
 * HTTPS, SSH or `git@host:path` URL as `https://host/path`, with no
 * credentials or `.git`, and Azure DevOps' SSH form as its `_git` page.
 * `null` for a local path, or anything else that has no page. As
 * `openRepository`'s `web` does for a repository opened, for a remote or a
 * repository listed on a Host.
 */
export function webPageOf(remote: string | null): WebPage | null {
  if (remote === null) return null;
  const text = remote.trim();
  let host: string;
  let path: string;
  const scp = /^[^@/\s]+@([^:/\s]+):(?!\/\/)(.+)$/.exec(text);
  if (scp !== null) {
    host = scp[1] ?? "";
    path = scp[2] ?? "";
  } else {
    let parsed: URL;
    try {
      parsed = new URL(text);
    } catch {
      return null;
    }
    if (!["https:", "http:", "ssh:", "git:"].includes(parsed.protocol)) return null;
    host = parsed.hostname;
    path = parsed.pathname;
  }
  host = host.toLowerCase();
  path = path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/, "");
  if (host === "" || path === "") return null;
  if (host === "ssh.github.com") host = "github.com";
  if (host === "ssh.dev.azure.com" || host === "vs-ssh.visualstudio.com") {
    // `v3/org/project/repo`, which the web has as `org/project/_git/repo`.
    const [, org, project, repository] = path.split("/");
    if (org === undefined || project === undefined || repository === undefined) return null;
    host = "dev.azure.com";
    path = `${org}/${project}/_git/${repository}`;
  }
  return { url: `https://${host}/${path}`, integration: KNOWN[host] ?? "generic" };
}

/**
 * Whether `url` is a page on a Host, to show in a Tab of Lanewise's own
 * (ADR 0042): an `https` page on GitHub.com, GitLab.com, Bitbucket Cloud,
 * Azure DevOps, or one of `enterpriseHosts`. Anything else, such as a Host's
 * documentation, opens in the browser.
 */
export function isHostPage(url: string, enterpriseHosts: readonly string[] = []): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.host.toLowerCase();
  const name = host.startsWith("www.") ? host.slice(4) : host;
  return (
    name in KNOWN ||
    name === "gist.github.com" ||
    name.endsWith(".visualstudio.com") ||
    enterpriseHosts.some((enterprise) => enterprise.toLowerCase() === host)
  );
}
