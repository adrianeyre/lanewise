import { useCallback, useEffect, useRef, useState } from "react";

import type { CloneError, GitProgress, CommandClient, OpenedRepository, Outcome, Path } from "../commands/api";
import { describeFailure } from "../repository/problems";
import { describeCloneError } from "./cloneProblems";
import { type Announced, announcementOf } from "../ui/gitProgressWords";

/** Where the clone the user started from the Welcome screen is. */
export type CloneStatus =
  | { kind: "idle" }
  /**
   * Starting, or cloning `url` into `destination`, with Git's latest
   * `progress`, if it gave any.
   */
  | {
      kind: "running";
      url: string;
      destination: Path | null;
      progress: GitProgress | null;
      /** Asked to stop: it is until Git has, and the folder has gone. */
      cancelling: boolean;
      /** Why it couldn't be asked to stop, if it couldn't. */
      problem: string | null;
    }
  | { kind: "cancelled" }
  /**
   * It didn't start, or didn't finish: `problem` says why, from `error`, or
   * `null` if the command itself failed.
   */
  | { kind: "failed"; problem: string; error: CloneError | null };

export interface CloneState {
  status: CloneStatus;
  /**
   * What to announce politely of it: its start, each new phase and each
   * quarter of one, and its stopping. A failure is an alert instead.
   */
  announcement: string;
  /** Starts cloning `url` into `name` in `parent`, unless a clone is running already. */
  start(url: string, parent: Path, name: string): void;
  /** Asks the running clone to stop. `status` is `cancelled` once it has, and its folder has gone. */
  cancel(): void;
}

function failed(error: CloneError): CloneStatus {
  return { kind: "failed", problem: describeCloneError(error), error };
}

/** The clone running, once `startClone` has named it. */
interface Running {
  clone: number | null;
  cancelled: boolean;
}

/**
 * The Welcome screen's clone (PRD §7.1), kept by the App so it carries on,
 * and its repository still opens, while another Tab is shown. It follows the
 * clone with `cloneProgress`'s long poll, and calls `onCloned` with the
 * repository once it's cloned.
 */
export function useClone(commands: CommandClient, onCloned: (repository: OpenedRepository) => void): CloneState {
  const [status, setStatus] = useState<CloneStatus>({ kind: "idle" });
  const [announcement, setAnnouncement] = useState("");
  const announced = useRef<Announced | null>(null);
  const running = useRef<Running | null>(null);
  const mounted = useRef(true);
  const cloned = useRef(onCloned);
  useEffect(() => {
    cloned.current = onCloned;
  }, [onCloned]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Updates the running clone's status, if it's still running. */
  const whileRunning = useCallback((change: (status: CloneStatus & { kind: "running" }) => CloneStatus) => {
    setStatus((previous) => (previous.kind === "running" ? change(previous) : previous));
  }, []);

  /** Follows `clone` until it's no longer running, and gives how it finished. */
  const follow = useCallback(
    async (clone: number): Promise<CloneStatus> => {
      let seen: number | null = null;
      // Until it finishes, or the App has gone.
      while (mounted.current) {
        const outcome: Outcome<"cloneProgress"> = await commands.call("cloneProgress", { clone, seen });
        if (!outcome.ok) return failed(outcome.error);
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
          case "cloned":
            if (mounted.current) cloned.current(state.repository);
            return { kind: "idle" };
          case "cancelled":
            return { kind: "cancelled" };
          case "failed":
            return failed(state.error);
        }
      }
      return { kind: "idle" };
    },
    [commands, whileRunning],
  );

  const cancelRunning = useCallback(
    (clone: number) => {
      commands.call("cancelClone", { clone }).then(
        (outcome) => {
          // One that finished already says how in the long poll.
          if (outcome.ok || outcome.error.kind === "cloneNotFound" || !mounted.current) return;
          const problem = describeCloneError(outcome.error);
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

  const start = useCallback(
    (url: string, parent: Path, name: string) => {
      if (running.current !== null) return;
      const thisClone: Running = { clone: null, cancelled: false };
      running.current = thisClone;
      setStatus({ kind: "running", url, destination: null, progress: null, cancelling: false, problem: null });
      announced.current = null;
      setAnnouncement("Cloning…");
      void (async (): Promise<CloneStatus> => {
        const outcome = await commands.call("startClone", { url, parent, name });
        if (!outcome.ok) return failed(outcome.error);
        const { clone, destination } = outcome.value;
        thisClone.clone = clone;
        if (mounted.current) whileRunning((previous) => ({ ...previous, destination }));
        // Cancelled while it was starting.
        if (thisClone.cancelled) cancelRunning(clone);
        return follow(clone);
      })()
        .catch((failure: unknown): CloneStatus => ({ kind: "failed", problem: describeFailure(failure), error: null }))
        .then((finished) => {
          running.current = null;
          if (!mounted.current) return;
          setStatus(finished);
          setAnnouncement(finished.kind === "cancelled" ? "Clone cancelled." : "");
        });
    },
    [commands, follow, cancelRunning, whileRunning],
  );

  const cancel = useCallback(() => {
    const thisClone = running.current;
    if (thisClone === null) return;
    thisClone.cancelled = true;
    whileRunning((previous) => ({ ...previous, cancelling: true, problem: null }));
    setAnnouncement("Cancelling the clone…");
    if (thisClone.clone !== null) cancelRunning(thisClone.clone);
  }, [cancelRunning, whileRunning]);

  return { status, announcement, start, cancel };
}
