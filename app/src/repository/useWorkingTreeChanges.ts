import { useEffect, useState } from "react";

import type { CommandClient, Outcome, Path, WorkingTreeChangesError } from "../commands/api";
import { describeFailure, describeRepositoryError } from "./problems";

export interface WorkingTreeChanges {
  /** How many times the working tree has changed on disk since the page was drawn. */
  changes: number;
  /** Why the working tree isn't being watched, if it isn't: it then only refreshes after what's done in Lanewise. */
  problem: string | null;
}

/**
 * Watches `root`'s working tree for as long as the page is drawn, with the
 * `workingTreeChanges` long poll (ADR 0007), and counts each change: a file
 * Git doesn't ignore, the index or a ref, whether Lanewise or anything else
 * changed it.
 */
export function useWorkingTreeChanges(commands: CommandClient, root: Path): WorkingTreeChanges {
  const [changes, setChanges] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const stopped = new AbortController();
    async function watch() {
      let seen: number | null = null;
      while (!stopped.signal.aborted) {
        try {
          const outcome: Outcome<"workingTreeChanges"> = await commands.call("workingTreeChanges", { repository: root, seen });
          if (stopped.signal.aborted) return;
          if (!outcome.ok) {
            setProblem(describeWatchError(outcome.error));
            return;
          }
          const generation: number = outcome.value.generation;
          if (seen !== null && generation !== seen) setChanges((counted) => counted + 1);
          seen = generation;
        } catch (failure) {
          if (!stopped.signal.aborted) setProblem(describeFailure(failure));
          return;
        }
      }
    }
    void watch();
    // A long poll still waiting in the core answers into nothing.
    return () => stopped.abort();
  }, [commands, root]);

  return { changes, problem };
}

function describeWatchError(error: WorkingTreeChangesError): string {
  const unwatched = "Lanewise can't watch this working tree for changes, so it only refreshes after what you do here.";
  if (error.kind === "watchFailed") return `${unwatched} ${error.message}`;
  return `${unwatched} ${describeRepositoryError(error)}`;
}
