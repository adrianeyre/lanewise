import { MAX_DIFF_LINES } from "../commands/api";
import { DIFF_LIMIT_KEY, type LocalStore, localStore, readLocal, writeLocal } from "../settings/localSettings";

/** How many lines a diff may have before the Diff Widget asks, unless the user changed it. */
export const DEFAULT_DIFF_LIMIT = 5000;

/** Whether `lines` is a limit the Diff Widget takes: a whole number of lines, up to the most any diff sends. */
export function isDiffLimit(lines: number): boolean {
  return Number.isInteger(lines) && lines >= 1 && lines <= MAX_DIFF_LINES;
}

/** How many lines a diff may have before the Diff Widget asks before showing it. */
export function readDiffLimit(store: LocalStore | null = localStore()): number {
  const kept = Number(readLocal(DIFF_LIMIT_KEY, store) ?? Number.NaN);
  return isDiffLimit(kept) ? kept : DEFAULT_DIFF_LIMIT;
}

export function writeDiffLimit(lines: number, store: LocalStore | null = localStore()): void {
  writeLocal(DIFF_LIMIT_KEY, String(lines), store);
}
