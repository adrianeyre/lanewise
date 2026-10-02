import { hasConflictMarkers } from "../conflicts/conflictHunks";
import type { Confidence, Suggestion, SuggestionRequest } from "./modelProvider";

/**
 * A check a Suggestion's Resolution text failed, by `kind`, which makes its
 * Confidence low whatever the model reported (PRD §8.1).
 */
export type FailedCheck =
  /** It still has Conflict Markers. */
  | { kind: "conflictMarkers" }
  /** It's empty, or only blank lines. */
  | { kind: "empty" }
  /** It leaves out lines that only one side has, which are `lines`, in order, each trimmed. */
  | { kind: "droppedLines"; side: "ours" | "theirs"; lines: string[] }
  /** Jev judged it unlikely, `keepsBoth` from 0 to 1, to keep what both sides meant (ADR 0036). */
  | { kind: "jevDoubts"; keepsBoth: number };

/** A Suggestion as it's shown: its Confidence after the checks, with what the model reported, and the checks it failed. */
export interface CheckedSuggestion extends Suggestion {
  /** The Confidence the model reported, which `confidence` is unless a check failed. */
  reported: Confidence;
  /** The checks it failed, none if it passed them all. */
  failed: FailedCheck[];
}

/** A `=======` line, which alone may be a Markdown heading's underline, not a Conflict Marker. */
const SEPARATOR = /^={7}$/;

/**
 * Lines compared as their text alone: trimmed, so a line indented again is
 * still the same line, and without blank lines, which a Resolution can drop.
 */
function compared(lines: readonly string[]): string[] {
  return lines.map((line) => line.trim()).filter((line) => line !== "");
}

/**
 * The lines only `side` has, trimmed, in order: in neither the Base nor the
 * other side. With no Base, as for a file added on both sides, a line only
 * one side has is in the other side alone.
 */
function oneSided(side: readonly string[], other: readonly string[], base: readonly string[] | null): string[] {
  const elsewhere = new Set([...compared(other), ...compared(base ?? [])]);
  return [...new Set(compared(side).filter((line) => !elsewhere.has(line)))];
}

/**
 * `suggestion`, for the Conflict Hunk in `request`, checked: its Confidence
 * is what the model reported, unless its Resolution text still has Conflict
 * Markers, is empty, or leaves out a line that only Ours or only Theirs
 * has, when it's low. A `=======` line counts as a Conflict Marker only
 * where neither side nor the Base has one.
 */
export function checkSuggestion(suggestion: Suggestion, request: SuggestionRequest): CheckedSuggestion {
  const lines = suggestion.resolution.split(/\r\n?|\n/);
  const failed: FailedCheck[] = [];
  const separatorKept = [...request.ours, ...request.theirs, ...(request.base ?? [])].some((line) => SEPARATOR.test(line));
  if (hasConflictMarkers(lines.join("\n")) || (!separatorKept && lines.some((line) => SEPARATOR.test(line)))) {
    failed.push({ kind: "conflictMarkers" });
  }
  const kept = new Set(compared(lines));
  if (kept.size === 0) failed.push({ kind: "empty" });
  for (const side of ["ours", "theirs"] as const) {
    const other = side === "ours" ? request.theirs : request.ours;
    const dropped = oneSided(request[side], other, request.base).filter((line) => !kept.has(line));
    if (dropped.length > 0) failed.push({ kind: "droppedLines", side, lines: dropped });
  }
  return {
    ...suggestion,
    confidence: failed.length === 0 ? suggestion.confidence : "low",
    reported: suggestion.confidence,
    failed,
  };
}

/**
 * `checked` with Jev's verdict joined to it: a doubt below `doubtful` is a
 * failed check, which makes its Confidence low, as the other checks do.
 */
export function withJevVerdict(checked: CheckedSuggestion, keepsBoth: number, doubtful: number): CheckedSuggestion {
  if (keepsBoth >= doubtful) return checked;
  return { ...checked, confidence: "low", failed: [...checked.failed, { kind: "jevDoubts", keepsBoth }] };
}
