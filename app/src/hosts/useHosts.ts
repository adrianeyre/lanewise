import { useCallback, useState } from "react";

import type { SignedIn } from "../commands/api";
import { ENTERPRISE_HOSTS_KEY, readLocal, writeLocal } from "../settings/localSettings";
import { parseEnterpriseHosts } from "./enterpriseHosts";

export interface HostsState {
  /** The GitHub Enterprise Server Hosts added in Settings, in the order they were added. */
  enterpriseHosts: readonly string[];
  /** Adds a GitHub Enterprise Server Host, by the name `parseEnterpriseHost` gave, and keeps it. */
  addEnterpriseHost(host: string): void;
  /** Removes a GitHub Enterprise Server Host, and forgets who was signed in to it. */
  removeEnterpriseHost(host: string): void;
  /** Who each Host signed in, by Host, for this run only: the token itself stays with the credential helper. */
  signedIn: ReadonlyMap<string, SignedIn>;
  /** Notes who `signedIn.host` signed in. */
  rememberSignIn(signedIn: SignedIn): void;
  /** Forgets who `host` signed in, such as once it refuses the token. */
  forgetSignIn(host: string): void;
}

/**
 * The Hosts Lanewise signs in to, kept by the App so Settings and Clone's
 * Browse repositories share them: the GitHub Enterprise Servers the user
 * added, kept for the next launch, and who each Host signed in this run.
 */
export function useHosts(): HostsState {
  const [enterpriseHosts, setEnterpriseHosts] = useState<readonly string[]>(() =>
    parseEnterpriseHosts(readLocal(ENTERPRISE_HOSTS_KEY)),
  );
  const [signedIn, setSignedIn] = useState<ReadonlyMap<string, SignedIn>>(new Map());

  const keep = useCallback((change: (hosts: readonly string[]) => readonly string[]) => {
    setEnterpriseHosts((hosts) => {
      const next = change(hosts);
      writeLocal(ENTERPRISE_HOSTS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const forgetSignIn = useCallback((host: string) => {
    setSignedIn((previous) => {
      if (!previous.has(host)) return previous;
      const next = new Map(previous);
      next.delete(host);
      return next;
    });
  }, []);

  const addEnterpriseHost = useCallback(
    (host: string) => keep((hosts) => (hosts.includes(host) ? hosts : [...hosts, host])),
    [keep],
  );

  const removeEnterpriseHost = useCallback(
    (host: string) => {
      keep((hosts) => hosts.filter((each) => each !== host));
      forgetSignIn(host);
    },
    [keep, forgetSignIn],
  );

  const rememberSignIn = useCallback((signed: SignedIn) => {
    setSignedIn((previous) => new Map(previous).set(signed.host, signed));
  }, []);

  return { enterpriseHosts, addEnterpriseHost, removeEnterpriseHost, signedIn, rememberSignIn, forgetSignIn };
}
