import type { CommandClient, CommandName, CommandRequest, Outcome } from "./api";

/**
 * A client that sends a read once when it's asked for more than once at the
 * same moment, as the Toolbar and the Branches Widget both read the branches
 * as a repository opens, and gives each the same reply. Only calls made
 * together share: a call made after them, as on a refresh, is sent afresh,
 * so no reply is older than the call that asked for it.
 */
export function shareReads(commands: CommandClient, names: readonly CommandName[]): CommandClient {
  const sent = new Map<string, Promise<unknown>>();
  return {
    call<N extends CommandName>(name: N, request: CommandRequest<N>): Promise<Outcome<N>> {
      if (!names.includes(name)) return commands.call(name, request);
      const key = JSON.stringify([name, request]);
      const shared = sent.get(key);
      if (shared) return shared as Promise<Outcome<N>>;
      const call = commands.call(name, request);
      if (sent.size === 0) queueMicrotask(() => sent.clear());
      sent.set(key, call);
      return call;
    },
  };
}

/**
 * `commands`, but each read in `names` waits until `until` settles before it's
 * sent, as the Repository page holds its side Widgets' reads until the Commit
 * graph has its first window. Everything else is sent at once.
 */
export function holdReads(commands: CommandClient, names: readonly CommandName[], until: Promise<void>): CommandClient {
  let settled = false;
  void until.then(() => {
    settled = true;
  });
  return {
    call<N extends CommandName>(name: N, request: CommandRequest<N>): Promise<Outcome<N>> {
      if (settled || !names.includes(name)) return commands.call(name, request);
      return until.then(() => commands.call(name, request));
    },
  };
}

