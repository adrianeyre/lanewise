import { useCallback, useEffect, useRef, useState } from "react";

import type {
  CommandClient,
  GitProgress,
  NewUpstream,
  OpenedRepository,
  Outcome,
  PullMode,
  RemoteError,
  RemoteOperationKind,
  RemoteStarted,
} from "../commands/api";
import { type Announced, announcementOf } from "../ui/gitProgressWords";
import { describeFailure } from "./problems";
import { describePulled, describePushed, describeRemoteError, describeStarting, operationName } from "./remoteWords";

/** How long after one fetch started without being asked for that focusing the window doesn't start another. */
export const FOCUS_FETCH_GAP = 30_000;

/** Where the repository's fetch, pull or push is. */
export type RemoteStatus =
  | { kind: "idle" }
  /** Running, with Git's latest `progress`, if it gave any. */
  | {
      kind: "running";
      operation: RemoteOperationKind;
      /** The Pull Mode picked for a pull, or `null` to follow the Git config. */
      mode: PullMode | null;
      /** Where a push that sets the Upstream goes, or `null` for one to the Upstream the branch has. */
      setUpstream: NewUpstream | null;
      progress: GitProgress | null;
      /** Asked to stop: it is until Git has. */
      cancelling: boolean;
      /** Why it couldn't be asked to stop, if it couldn't. */
      problem: string | null;
    }
  /** It finished, or was cancelled: `said` is what it did. */
  | { kind: "done"; said: string }
  /** It didn't start, or didn't finish: `problem` says why, and `error` is what the core said, if it said. */
  | { kind: "failed"; operation: RemoteOperationKind; problem: string; error: RemoteError | null };

export interface RemoteOperationState {
  status: RemoteStatus;
  /** What to announce politely of it as it runs: its start, each new phase and each quarter of one. */
  announcement: string;
  /**
   * Starts a fetch, pull or push, unless one is running already. A push
   * with `setUpstream` goes there, and sets the branch's Upstream to it.
   */
  start(operation: RemoteOperationKind, mode?: PullMode | null, setUpstream?: NewUpstream | null): void;
  /** Asks the one running to stop. `status` says it was cancelled once Git has stopped. */
  cancel(): void;
}

/** The operation running, once its start command has named it. */
interface Running {
  started: RemoteStarted | null;
  cancelled: boolean;
}

/** What starting an operation, or looking for the one running, gave. */
type Begun = { kind: "started"; started: RemoteStarted } | { kind: "finished"; finished: RemoteStatus };

/**
 * The Toolbar's fetch, pull or push (PRD §7.6), each run by `git` in the
 * core and followed with `remoteProgress`'s long poll. One the page started
 * before it was last drawn, or that is running still after switching Tabs,
 * is found with `remoteOperation` and followed again. With `fetchOnShow`,
 * as Settings has it by default, a fetch starts as the page is drawn, as
 * when its Tab is chosen, and again as the window is focused, unless one of
 * the three is running already or the repository has no remotes. Until
 * `ready`, as the page's Commit graph has its first window, it neither looks
 * for one running nor fetches. `onChanged` is called once one finishes, as it
 * may have moved branches or the working tree.
 */
export function useRemoteOperation(
  commands: CommandClient,
  repository: OpenedRepository,
  onChanged: () => void,
  { fetchOnShow = false, ready = true }: { fetchOnShow?: boolean; ready?: boolean } = {},
): RemoteOperationState {
  const [status, setStatus] = useState<RemoteStatus>({ kind: "idle" });
  const [announcement, setAnnouncement] = useState("");
  const announced = useRef<Announced | null>(null);
  const running = useRef<Running | null>(null);
  const mounted = useRef(true);
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  }, [onChanged]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Updates the running operation's status, if it's still running. */
  const whileRunning = useCallback((change: (status: RemoteStatus & { kind: "running" }) => RemoteStatus) => {
    setStatus((previous) => (previous.kind === "running" ? change(previous) : previous));
  }, []);

  /** Follows `operation` until it's no longer running, and gives how it finished. */
  const follow = useCallback(
    async (operation: number, kind: RemoteOperationKind, setUpstream: NewUpstream | null): Promise<RemoteStatus> => {
      let seen: number | null = null;
      // Until it finishes, or the page has gone: it runs on in the core, to be found again.
      while (mounted.current) {
        const outcome: Outcome<"remoteProgress"> = await commands.call("remoteProgress", { operation, seen });
        if (!outcome.ok) return failed(kind, outcome.error);
        const { state } = outcome.value;
        seen = outcome.value.generation;
        switch (state.kind) {
          case "running": {
            if (!mounted.current) continue;
            whileRunning((previous) => ({ ...previous, progress: state.progress }));
            const next = announcementOf(state.progress, announced.current);
            if (next !== null) {
              announced.current = next;
              setAnnouncement(next.text);
            }
            continue;
          }
          case "fetched":
            return { kind: "done", said: "Fetched from every remote." };
          case "pulled":
            return { kind: "done", said: describePulled(state.pulled) };
          case "pushed":
            return { kind: "done", said: describePushed(state.pushed, setUpstream) };
          case "cancelled":
            return { kind: "done", said: `The ${operationName[kind]} was cancelled.` };
          case "failed":
            return failed(kind, state.error);
        }
      }
      return { kind: "idle" };
    },
    [commands, whileRunning],
  );

  const cancelRunning = useCallback(
    (operation: number, kind: RemoteOperationKind) => {
      commands.call("cancelRemote", { operation }).then(
        (outcome) => {
          // One that finished already says how in the long poll.
          if (outcome.ok || outcome.error.kind === "operationNotFound" || !mounted.current) return;
          const problem = describeRemoteError(outcome.error, kind);
          whileRunning((previous) => ({ ...previous, cancelling: false, problem }));
        },
        (failure: unknown) => {
          if (!mounted.current) return;
          whileRunning((previous) => ({ ...previous, cancelling: false, problem: describeFailure(failure) }));
        },
      );
    },
    [commands, whileRunning],
  );

  /**
   * Runs `begin`, which starts an operation or finds the one running, and
   * follows what it gives until it finishes.
   */
  const run = useCallback(
    (
      kind: RemoteOperationKind,
      mode: PullMode | null,
      setUpstream: NewUpstream | null,
      begin: () => Promise<Begun>,
    ): void => {
      if (running.current !== null) return;
      const thisOne: Running = { started: null, cancelled: false };
      running.current = thisOne;
      announced.current = null;
      void (async (): Promise<RemoteStatus> => {
        const begun = await begin();
        if (begun.kind === "finished") return begun.finished;
        const { started } = begun;
        thisOne.started = started;
        if (mounted.current) {
          setStatus((previous) =>
            previous.kind === "running"
              ? { ...previous, operation: started.kind }
              : {
                  kind: "running",
                  operation: started.kind,
                  mode,
                  setUpstream,
                  progress: null,
                  cancelling: false,
                  problem: null,
                },
          );
        }
        // Cancelled while it was starting.
        if (thisOne.cancelled) cancelRunning(started.operation, started.kind);
        return follow(started.operation, started.kind, setUpstream);
      })()
        .catch((failure: unknown): RemoteStatus => ({
          kind: "failed",
          operation: kind,
          problem: describeFailure(failure),
          error: null,
        }))
        .then((finished) => {
          running.current = null;
          if (!mounted.current) return;
          setStatus(finished);
          setAnnouncement("");
          if (finished.kind === "done") changed.current();
        });
    },
    [cancelRunning, follow],
  );

  /** When the last fetch started without being asked for, as the page was drawn or the window was focused. */
  const lastQuietFetch = useRef<number | null>(null);

  /**
   * Follows the one running, if one is, such as one started before the page
   * was last drawn; with none, and `fetch`, starts a fetch that takes no focus.
   */
  const followOrFetch = useCallback(
    (fetch: boolean) => {
      run("fetch", null, null, async () => {
        const outcome = await commands.call("remoteOperation", { repository: repository.root });
        if (outcome.ok && outcome.value !== null) return { kind: "started", started: outcome.value };
        // With none to find, there's nothing to show.
        if (!outcome.ok || !fetch || !mounted.current) return { kind: "finished", finished: { kind: "idle" } };
        lastQuietFetch.current = Date.now();
        const fetched = await commands.call("startFetch", { repository: repository.root });
        if (fetched.ok) {
          if (mounted.current) setAnnouncement(describeStarting("fetch", null, null));
          return { kind: "started", started: fetched.value };
        }
        if (fetched.error.kind === "alreadyRunning") {
          return { kind: "started", started: { operation: fetched.error.operation, kind: fetched.error.running } };
        }
        // A repository with no remotes has nothing to fetch, which is no problem.
        if (fetched.error.kind === "noRemotes") return { kind: "finished", finished: { kind: "idle" } };
        return { kind: "finished", finished: failed("fetch", fetched.error) };
      });
    },
    [commands, repository.root, run],
  );

  // Whether to fetch as the page is drawn: as Settings had it then, not changed while it's shown.
  const [fetchAtFirst] = useState(fetchOnShow);
  // One started before the page was last drawn is followed again. With
  // none, a fetch starts, if Settings says to. Both wait until `ready`, so
  // `git fetch` doesn't take the CPU the page's first screen needs.
  const looked = useRef(false);
  useEffect(() => {
    if (!ready || looked.current) return;
    looked.current = true;
    followOrFetch(fetchAtFirst);
  }, [followOrFetch, fetchAtFirst, ready]);

  // And again each time the window is focused, as when the user comes back
  // to Lanewise from another app, as Settings has it now. Not if one is
  // running, nor within `FOCUS_FETCH_GAP` of the last, so moving in and out
  // of the window doesn't fetch over and over.
  const fetchOnFocus = useRef(fetchOnShow);
  useEffect(() => {
    fetchOnFocus.current = fetchOnShow;
  }, [fetchOnShow]);
  useEffect(() => {
    const focused = () => {
      if (!looked.current || !fetchOnFocus.current || running.current !== null) return;
      const last = lastQuietFetch.current;
      if (last !== null && Date.now() - last < FOCUS_FETCH_GAP) return;
      followOrFetch(true);
    };
    window.addEventListener("focus", focused);
    return () => window.removeEventListener("focus", focused);
  }, [followOrFetch]);

  const start = useCallback(
    (kind: RemoteOperationKind, mode: PullMode | null = null, setUpstream: NewUpstream | null = null) => {
      if (running.current !== null) return;
      setStatus({
        kind: "running",
        operation: kind,
        mode,
        setUpstream,
        progress: null,
        cancelling: false,
        problem: null,
      });
      setAnnouncement(describeStarting(kind, mode, setUpstream));
      run(kind, mode, setUpstream, async () => {
        const outcome = await startCommand(commands, kind, repository.root, mode, setUpstream);
        if (outcome.ok) return { kind: "started", started: outcome.value };
        // One started elsewhere, such as by another Lanewise, is followed instead.
        if (outcome.error.kind === "alreadyRunning") {
          const { operation, running: other } = outcome.error;
          return { kind: "started", started: { operation, kind: other } };
        }
        return { kind: "finished", finished: failed(kind, outcome.error) };
      });
    },
    [commands, repository.root, run],
  );

  const cancel = useCallback(() => {
    const thisOne = running.current;
    if (thisOne === null) return;
    thisOne.cancelled = true;
    whileRunning((previous) => ({ ...previous, cancelling: true, problem: null }));
    setAnnouncement("Cancelling…");
    if (thisOne.started !== null) cancelRunning(thisOne.started.operation, thisOne.started.kind);
  }, [cancelRunning, whileRunning]);

  return { status, announcement, start, cancel };
}

function failed(operation: RemoteOperationKind, error: RemoteError): RemoteStatus {
  return { kind: "failed", operation, problem: describeRemoteError(error, operation), error };
}

function startCommand(
  commands: CommandClient,
  kind: RemoteOperationKind,
  repository: string,
  mode: PullMode | null,
  setUpstream: NewUpstream | null,
): Promise<Outcome<"startFetch" | "startPull" | "startPush">> {
  switch (kind) {
    case "fetch":
      return commands.call("startFetch", { repository });
    case "pull":
      return commands.call("startPull", { repository, mode });
    case "push":
      return commands.call("startPush", { repository, setUpstream });
  }
}
