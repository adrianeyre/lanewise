import { useCallback, useEffect, useMemo, useState } from "react";

import type { CommandClient, IntegrationKind, OpenedRepository, PullRequest, PullRequestsError } from "../commands/api";
import { describeFailure } from "../repository/problems";

/** A repository's open Pull Requests, as read so far. */
export type PullRequestsState =
  | { kind: "reading" }
  | { kind: "read"; host: string; integration: IntegrationKind; pullRequests: readonly PullRequest[] }
  | { kind: "failed"; error: PullRequestsError }
  /** The command couldn't be sent at all: `problem` says why. */
  | { kind: "broken"; problem: string };

export interface PullRequests {
  state: PullRequestsState;
  /** Each open Pull Request by the full ID of its head's tip, for the Commit graph to mark. */
  byCommit: ReadonlyMap<string, readonly PullRequest[]>;
  /** Reads them again: signing in first, through the credential helpers, with `signIn`. */
  refresh: (signIn?: boolean) => void;
}

const NONE: ReadonlyMap<string, readonly PullRequest[]> = new Map();
const READING: PullRequestsState = { kind: "reading" };

/**
 * The open Pull Requests of `repository` on its Host, read as it opens and
 * again when asked, for the Pull requests Widget and the Commit graph. Only
 * a credential the helpers already have is used, unless the user asks to
 * sign in: nothing opens a browser as a repository opens.
 */
export function usePullRequests(
  commands: CommandClient,
  repository: OpenedRepository,
  enterpriseHosts: readonly string[] = [],
): PullRequests {
  const [reads, setReads] = useState<{ count: number; signIn: boolean }>({ count: 0, signIn: false });
  const hosts = enterpriseHosts.join("\n");
  // What was read, and for which read: one for an earlier read is "reading" until this one answers.
  const key = `${repository.root}\n${hosts}\n${reads.count}`;
  const [answered, setAnswered] = useState<{ key: string; state: PullRequestsState } | null>(null);
  const state: PullRequestsState = answered?.key === key ? answered.state : READING;

  useEffect(() => {
    let live = true;
    const setState = (read: PullRequestsState) => setAnswered({ key, state: read });
    commands
      .call("pullRequests", {
        repository: repository.root,
        enterpriseHosts: hosts === "" ? [] : hosts.split("\n"),
        interactive: reads.signIn,
      })
      .then(
        (outcome) => {
          if (!live) return;
          setState(outcome.ok ? { kind: "read", ...outcome.value } : { kind: "failed", error: outcome.error });
        },
        (failure: unknown) => {
          if (live) setState({ kind: "broken", problem: describeFailure(failure) });
        },
      );
    return () => {
      live = false;
    };
  }, [commands, repository.root, hosts, reads, key]);

  const byCommit = useMemo(() => {
    if (state.kind !== "read") return NONE;
    const by = new Map<string, PullRequest[]>();
    for (const pull of state.pullRequests) by.set(pull.head.commit, [...(by.get(pull.head.commit) ?? []), pull]);
    return by;
  }, [state]);

  const refresh = useCallback(
    (signIn = false) => setReads(({ count }) => ({ count: count + 1, signIn })),
    [],
  );
  return { state, byCommit, refresh };
}
