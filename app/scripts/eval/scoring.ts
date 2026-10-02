/**
 * How a Suggestion compares with its Conflict Hunk's ground truth, and the
 * report of a whole evaluation (PRD §14): how many matched exactly, how many
 * nearly, whitespace aside, how many didn't, and how well a low Confidence
 * flagged the ones that didn't.
 */

import { CONFIDENCE_WORDS } from "../../src/ai/aiWords";
import type { CheckedSuggestion } from "../../src/ai/confidence";
import type { Confidence } from "../../src/ai/modelProvider";
import { type ResolvedAs, linesOf } from "./corpus";
import { RESOLVED_AS_WORDS } from "./corpusReadme";

/** How a Suggestion's Resolution text compares with the committed one. */
export type Match = "exact" | "near" | "mismatch";

/** Lines with whitespace set aside: each trimmed, each run of spaces and tabs made one space, and blank lines left out. */
export function normalized(lines: readonly string[]): string[] {
  return lines.map((line) => line.trim().replace(/\s+/g, " ")).filter((line) => line !== "");
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

/**
 * How `resolution`, a Suggestion's Resolution text, compares with `truth`,
 * the committed lines: the same lines, as the Resolution would have them
 * once it's put in, or the same with whitespace set aside, or neither.
 */
export function matchOf(resolution: string, truth: readonly string[]): Match {
  const lines = linesOf(resolution);
  if (same(lines, truth)) return "exact";
  if (same(normalized(lines), normalized(truth))) return "near";
  return "mismatch";
}

/** What asking about one Conflict Hunk came to. */
export type Outcome =
  | { kind: "suggested"; match: Match; suggestion: CheckedSuggestion }
  /** No Suggestion came back, for `reason`, in the words Settings uses. */
  | { kind: "failed"; reason: string }
  /** It wasn't asked about, because an earlier failure or Cancel stopped the run. */
  | { kind: "notAsked" };

/** One Conflict Hunk of the corpus and what asking about it came to. */
export interface CaseResult {
  source: string;
  merge: string;
  path: string;
  /** Which Conflict Hunk it is in its file, from 1, of how many. */
  number: number;
  of: number;
  resolvedAs: ResolvedAs;
  /** The committed lines, its ground truth. */
  truth: string[];
  outcome: Outcome;
}

const CONFIDENCES: readonly Confidence[] = ["high", "medium", "low"];
const MATCHES: readonly Match[] = ["exact", "near", "mismatch"];

/** How many of each Match there were at each Confidence. */
export type ConfidenceTable = Record<Confidence, Record<Match, number>>;

/** An evaluation's results, counted. */
export interface Summary {
  cases: number;
  matches: Record<Match, number>;
  failed: number;
  notAsked: number;
  /** By the Confidence shown, after the checks. */
  confidence: ConfidenceTable;
  /** By the Confidence the model reported, before them. */
  reported: ConfidenceTable;
  /** How many Suggestions the checks made low that the model hadn't said were. */
  madeLow: number;
  /** By how the merge resolved each Conflict Hunk: how many were asked about, and how many matched, exactly or nearly. */
  resolvedAs: Record<ResolvedAs, { suggested: number; matched: number }>;
  /** The same by repository. */
  sources: Record<string, { cases: number; suggested: number; matched: number }>;
}

function table(): ConfidenceTable {
  return { high: { exact: 0, near: 0, mismatch: 0 }, medium: { exact: 0, near: 0, mismatch: 0 }, low: { exact: 0, near: 0, mismatch: 0 } };
}

export function summarize(results: readonly CaseResult[]): Summary {
  const summary: Summary = {
    cases: results.length,
    matches: { exact: 0, near: 0, mismatch: 0 },
    failed: 0,
    notAsked: 0,
    confidence: table(),
    reported: table(),
    madeLow: 0,
    resolvedAs: {
      ours: { suggested: 0, matched: 0 },
      theirs: { suggested: 0, matched: 0 },
      oursThenTheirs: { suggested: 0, matched: 0 },
      theirsThenOurs: { suggested: 0, matched: 0 },
      written: { suggested: 0, matched: 0 },
    },
    sources: {},
  };
  for (const { source, resolvedAs, outcome } of results) {
    const bySource = (summary.sources[source] ??= { cases: 0, suggested: 0, matched: 0 });
    bySource.cases++;
    if (outcome.kind === "failed") summary.failed++;
    if (outcome.kind === "notAsked") summary.notAsked++;
    if (outcome.kind !== "suggested") continue;
    const { match, suggestion } = outcome;
    const matched = match !== "mismatch" ? 1 : 0;
    summary.matches[match]++;
    summary.confidence[suggestion.confidence][match]++;
    summary.reported[suggestion.reported][match]++;
    if (suggestion.confidence === "low" && suggestion.reported !== "low") summary.madeLow++;
    summary.resolvedAs[resolvedAs].suggested++;
    summary.resolvedAs[resolvedAs].matched += matched;
    bySource.suggested++;
    bySource.matched += matched;
  }
  return summary;
}

function share(count: number, of: number): string {
  return of === 0 ? "–" : `${Math.round((count / of) * 100)}%`;
}

/** How well a low Confidence in `counts` flagged the mismatches, in a sentence. */
function flagging(counts: ConfidenceTable, whose: string): string {
  const mismatches = CONFIDENCES.reduce((sum, level) => sum + counts[level].mismatch, 0);
  const matches = CONFIDENCES.reduce((sum, level) => sum + counts[level].exact + counts[level].near, 0);
  const caught = counts.low.mismatch;
  const falseAlarms = counts.low.exact + counts.low.near;
  const low = caught + falseAlarms;
  return (
    `${whose} flagged ${caught} of ${mismatches} mismatches as low (${share(caught, mismatches)}), ` +
    `and ${falseAlarms} of ${matches} matches (${share(falseAlarms, matches)}). ` +
    `Of the low-Confidence Suggestions, ${caught} of ${low} were mismatches (${share(caught, low)}).`
  );
}

function confidenceRows(counts: ConfidenceTable): string[] {
  return CONFIDENCES.map((level) => `| ${CONFIDENCE_WORDS[level]} | ${MATCHES.map((match) => counts[level][match]).join(" | ")} |`);
}

/**
 * The report of an evaluation, in Markdown: `title` says what was asked, and
 * `summary` is what came of it.
 */
export function report(title: string, summary: Summary): string {
  const { exact, near, mismatch } = summary.matches;
  const suggested = exact + near + mismatch;
  const matched = exact + near;
  const majority = matched * 2 > suggested;
  return [
    `# ${title}`,
    "",
    "| Outcome | Conflict Hunks | Of the Suggestions |",
    "| --- | --- | --- |",
    `| Exact match | ${exact} | ${share(exact, suggested)} |`,
    `| Near match, whitespace aside | ${near} | ${share(near, suggested)} |`,
    `| Mismatch | ${mismatch} | ${share(mismatch, suggested)} |`,
    `| No Suggestion | ${summary.failed} | |`,
    `| Not asked | ${summary.notAsked} | |`,
    "",
    `${matched} of ${suggested} Suggestions matched or nearly matched their ground truth, what the merge commit has (${share(matched, suggested)}). ` +
      `PRD §14 asks for a majority: ${majority ? "met" : "not met"}.`,
    "",
    "## Confidence",
    "",
    "As shown, after the checks:",
    "",
    "| Confidence | Exact | Near | Mismatch |",
    "| --- | --- | --- | --- |",
    ...confidenceRows(summary.confidence),
    "",
    flagging(summary.confidence, "Confidence"),
    "",
    `As the model reported it, before the checks made ${summary.madeLow} of the Suggestions low:`,
    "",
    "| Confidence | Exact | Near | Mismatch |",
    "| --- | --- | --- | --- |",
    ...confidenceRows(summary.reported),
    "",
    flagging(summary.reported, "The model's own Confidence"),
    "",
    "## By how the merge resolved it",
    "",
    "| Resolved as | Suggestions | Matched or nearly |",
    "| --- | --- | --- |",
    ...(Object.keys(RESOLVED_AS_WORDS) as ResolvedAs[]).map((kind) => {
      const { suggested: asked, matched: right } = summary.resolvedAs[kind];
      return `| ${RESOLVED_AS_WORDS[kind]} | ${asked} | ${right} (${share(right, asked)}) |`;
    }),
    "",
    "## By repository",
    "",
    "| Repository | Conflict Hunks | Suggestions | Matched or nearly |",
    "| --- | --- | --- | --- |",
    ...Object.entries(summary.sources).map(
      ([source, counts]) => `| ${source} | ${counts.cases} | ${counts.suggested} | ${counts.matched} (${share(counts.matched, counts.suggested)}) |`,
    ),
    "",
  ].join("\n");
}
