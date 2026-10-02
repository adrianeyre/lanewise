import { useCallback, useState } from "react";

import type { OpenedRepository, Path } from "../commands/api";
import { readLocal, RECENT_REPOSITORIES_KEY, writeLocal } from "../settings/localSettings";
import { forgetRecent, parseRecent, type RecentRepository, rememberRecent, serialiseRecent } from "./recent";

export interface RecentRepositoriesState {
  /** Most recent first. */
  recent: readonly RecentRepository[];
  /** Puts `repository` first. */
  remember: (repository: OpenedRepository) => void;
  forget: (root: Path) => void;
}

/** The Recent Repositories, kept in local storage so the next launch lists them too. */
export function useRecentRepositories(): RecentRepositoriesState {
  const [recent, setRecent] = useState(() => parseRecent(readLocal(RECENT_REPOSITORIES_KEY)));
  const update = useCallback((change: (recent: RecentRepository[]) => RecentRepository[]) => {
    setRecent((previous) => {
      const next = change(previous);
      writeLocal(RECENT_REPOSITORIES_KEY, serialiseRecent(next));
      return next;
    });
  }, []);
  const remember = useCallback(
    (repository: OpenedRepository) => update((list) => rememberRecent(list, repository)),
    [update],
  );
  const forget = useCallback((root: Path) => update((list) => forgetRecent(list, root)), [update]);
  return { recent, remember, forget };
}
