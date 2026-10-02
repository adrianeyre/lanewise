import { useEffect, useState } from "react";

import type { CommandClient, InProgressOperation, Path } from "../commands/api";
import { describeFailure } from "../repository/problems";

export interface InProgressOperationState {
  /** The In-Progress Operation, `null` with none, or `undefined` until it has been read. */
  operation: InProgressOperation | null | undefined;
  /** Why it couldn't be read, if it couldn't. */
  problem: string | null;
  /** Shows `operation` as it is now, as continuing or skipping gave it, until it's read again. */
  show: (operation: InProgressOperation | null) => void;
}

/**
 * The In-Progress Operation in the repository at `root`, read again each
 * time `refreshes` changes, made in Lanewise or not: one started in a
 * terminal before the repository was opened is found as well.
 */
export function useInProgressOperation(
  commands: CommandClient,
  root: Path,
  refreshes: number,
): InProgressOperationState {
  const [operation, setOperation] = useState<InProgressOperation | null | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    const refresh = refreshes > 0;
    commands.call("operationInProgress", { repository: root }).then(
      (outcome) => {
        if (!current) return;
        if (!outcome.ok) {
          // A repository that can't be read is said by each Widget already:
          // the Repository page, and they, are shown.
          setOperation(null);
          setProblem(
            outcome.error.kind === "gitUnavailable"
              ? "Lanewise can't find a Git 2.40 or later to run, so it can't tell whether a merge, rebase or stash apply is in progress. Install one, then open the repository again."
              : null,
          );
          return;
        }
        // Read again after a change and found the same, as after most
        // changes on disk, it's kept as it is, not drawn again.
        const read = outcome.value;
        setOperation((shown) => (refresh && JSON.stringify(shown) === JSON.stringify(read) ? shown : read));
        setProblem(null);
      },
      (failure: unknown) => {
        if (!current) return;
        setOperation(null);
        setProblem(describeFailure(failure));
      },
    );
    return () => {
      current = false;
    };
  }, [commands, root, refreshes]);

  return { operation, problem, show: setOperation };
}
