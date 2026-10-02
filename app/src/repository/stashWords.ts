import type { Stash } from "../commands/api";

/** What a stash is called: its message, or as Git names one made without. */
export function titleOf(stash: Stash): string {
  return stash.message ?? `WIP on ${stash.base.shortId}: ${stash.base.summary}`;
}
