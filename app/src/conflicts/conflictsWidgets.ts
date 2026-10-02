import type { InProgressOperation } from "../commands/api";

/** The Conflicts page's Widgets. */
export type ConflictsWidgetId = "operation" | "conflictedFiles" | "threeWay" | "resolution" | "suggestion";

/**
 * The Conflicts page's Widgets with nothing to show, which it hides:
 * Conflicted files, for an operation Git stopped with no files conflicted,
 * before committing a merge, say, and the Three-way view, the Resolution and
 * the AI Suggestion until a file conflicted still is chosen.
 */
export function conflictsEmpty(operation: InProgressOperation, chosen: string | null): ConflictsWidgetId[] {
  const empty: ConflictsWidgetId[] = [];
  if (operation.conflicts.length === 0 && operation.resolved.length === 0) empty.push("conflictedFiles");
  if (chosen === null || !operation.conflicts.includes(chosen)) empty.push("threeWay", "resolution", "suggestion");
  return empty;
}
