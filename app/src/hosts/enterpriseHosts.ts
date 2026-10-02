/**
 * The GitHub Enterprise Server Hosts the user added in Settings (PRD §9.1),
 * by name, with a port if they gave one, such as `github.example.com`. They
 * are kept in local storage, and sent with each Host command, so the GitHub
 * Host Integration serves them as it does GitHub.com.
 */

/** GitHub.com, which the GitHub Host Integration always serves. */
export const GITHUB_COM = "github.com";

/** A GitHub Enterprise Server's address, read: its Host, or why it isn't one. */
export type ParsedHost = { ok: true; host: string } | { ok: false; problem: string };

const EXAMPLE = "such as https://github.example.com";

/** A Host's name: dot-separated labels of letters, digits and hyphens. */
const NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

/**
 * The Host at the address the user typed, such as `github.example.com` for
 * `https://github.example.com/octo-org`, with a port if it has one other
 * than HTTPS's own. `added` are the Hosts added already.
 */
export function parseEnterpriseHost(address: string, added: readonly string[] = []): ParsedHost {
  const text = address.trim();
  if (text === "") return { ok: false, problem: `Enter the address of the GitHub Enterprise Server, ${EXAMPLE}.` };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, problem: `That isn't an address. Enter one ${EXAMPLE}.` };
  }
  if (url.protocol !== "https:") {
    return { ok: false, problem: "Lanewise signs in to a GitHub Enterprise Server over HTTPS only. Enter its https:// address." };
  }
  if (url.username !== "" || url.password !== "") {
    return {
      ok: false,
      problem: "Leave the user name and password out of the address: your credential helper signs you in.",
    };
  }
  const name = url.hostname.replace(/\.$/, "");
  if (!NAME.test(name)) return { ok: false, problem: `That isn't an address. Enter one ${EXAMPLE}.` };
  if (name === GITHUB_COM || name.endsWith(`.${GITHUB_COM}`)) {
    return { ok: false, problem: "GitHub.com is always there. Add a GitHub Enterprise Server's own address instead." };
  }
  const host = url.port === "" ? name : `${name}:${url.port}`;
  if (added.includes(host)) return { ok: false, problem: `${host} has been added already.` };
  return { ok: true, host };
}

/** The Hosts kept in local storage, or none if what was kept can't be read. */
export function parseEnterpriseHosts(saved: string | null): string[] {
  if (saved === null) return [];
  try {
    const hosts: unknown = JSON.parse(saved);
    if (!Array.isArray(hosts)) return [];
    const parsed = hosts.flatMap((host) => {
      if (typeof host !== "string") return [];
      const read = parseEnterpriseHost(host);
      return read.ok && read.host === host ? [host] : [];
    });
    return [...new Set(parsed)];
  } catch {
    return [];
  }
}
