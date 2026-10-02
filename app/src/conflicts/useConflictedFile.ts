import { useEffect, useState } from "react";

import type { CommandClient, ConflictedFile, Path } from "../commands/api";
import { describeFailure } from "../repository/problems";
import { describeOperationError } from "./operationWords";

/** A conflicted file's versions as read, or why they weren't. */
export type ConflictRead = { ok: true; file: ConflictedFile } | { ok: false; problem: string };

/**
 * The versions of the conflicted file at `path`, read once each time it's
 * chosen, for the Three-way view and the Resolution, which both show it:
 * `null` while they're read, and with no file chosen. They aren't read
 * again as the working tree changes, which would take the Resolution being
 * edited from under the user.
 */
export function useConflictedFile(commands: CommandClient, root: Path, path: string | null): ConflictRead | null {
  const [read, setRead] = useState<{ path: string; read: ConflictRead } | null>(null);
  // Chosen again, say once it was marked unresolved, it's read afresh, not shown as it was.
  const [chosen, setChosen] = useState(path);
  if (chosen !== path) {
    setChosen(path);
    setRead(null);
  }

  useEffect(() => {
    if (path === null) return;
    let current = true;
    void readConflictedFile(commands, root, path).then((result) => {
      if (current) setRead({ path, read: result });
    });
    return () => {
      current = false;
    };
  }, [commands, root, path]);

  return read !== null && read.path === path ? read.read : null;
}

async function readConflictedFile(commands: CommandClient, root: Path, path: string): Promise<ConflictRead> {
  try {
    const outcome = await commands.call("conflictedFile", { repository: root, path });
    if (outcome.ok) return { ok: true, file: outcome.value };
    return { ok: false, problem: describeOperationError(outcome.error, "read") };
  } catch (failure) {
    return { ok: false, problem: describeFailure(failure) };
  }
}
