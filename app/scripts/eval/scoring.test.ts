import { expect, test } from "vitest";

import type { CheckedSuggestion } from "../../src/ai/confidence";
import type { Confidence } from "../../src/ai/modelProvider";
import { type CaseResult, type Match, matchOf, normalized, report, summarize } from "./scoring";

test("matches a Suggestion exactly as the Resolution would have it", () => {
  const truth = ["def greet(name):", "    return name"];
  expect(matchOf("def greet(name):\n    return name", truth)).toBe("exact");
  // Its last newline ends its last line, as `putSuggestion` has it.
  expect(matchOf("def greet(name):\n    return name\n", truth)).toBe("exact");
  expect(matchOf("def greet(name):\r\n    return name\r\n", truth)).toBe("exact");
  expect(matchOf("", [])).toBe("exact");
});

test("matches it nearly with whitespace set aside", () => {
  expect(normalized(["  a  b\t c ", "", "   ", "d"])).toEqual(["a b c", "d"]);
  const truth = ["def greet(name):", "    return name"];
  expect(matchOf("def greet(name):\n\treturn  name", truth)).toBe("near");
  expect(matchOf("def greet(name):\n\n    return name\n\n", truth)).toBe("near");
  expect(matchOf("def greet(name):\n    return who", truth)).toBe("mismatch");
  expect(matchOf("defgreet(name):\n    return name", truth)).toBe("mismatch");
});

function suggested(source: string, match: Match, confidence: Confidence, reported: Confidence = confidence): CaseResult {
  const suggestion: CheckedSuggestion = { explanation: "", resolution: "", confidence, reported, failed: [] };
  return {
    source,
    merge: "m".repeat(40),
    path: "a.py",
    number: 1,
    of: 1,
    resolvedAs: match === "mismatch" ? "written" : "ours",
    truth: [],
    outcome: { kind: "suggested", match, suggestion },
  };
}

const RESULTS: CaseResult[] = [
  suggested("flask", "exact", "high"),
  suggested("flask", "exact", "high"),
  suggested("flask", "near", "medium"),
  suggested("flask", "exact", "low"),
  suggested("tokio", "mismatch", "low"),
  // Made low by a check, where the model said high.
  suggested("tokio", "mismatch", "low", "high"),
  suggested("tokio", "mismatch", "high"),
  { ...suggested("tokio", "exact", "high"), outcome: { kind: "failed", reason: "The model declined." } },
  { ...suggested("tokio", "exact", "high"), outcome: { kind: "notAsked" } },
];

test("counts the matches, and each Confidence against them", () => {
  const summary = summarize(RESULTS);
  expect(summary.cases).toBe(9);
  expect(summary.matches).toEqual({ exact: 3, near: 1, mismatch: 3 });
  expect(summary.failed).toBe(1);
  expect(summary.notAsked).toBe(1);
  expect(summary.confidence).toEqual({
    high: { exact: 2, near: 0, mismatch: 1 },
    medium: { exact: 0, near: 1, mismatch: 0 },
    low: { exact: 1, near: 0, mismatch: 2 },
  });
  expect(summary.reported.high).toEqual({ exact: 2, near: 0, mismatch: 2 });
  expect(summary.reported.low).toEqual({ exact: 1, near: 0, mismatch: 1 });
  expect(summary.madeLow).toBe(1);
  expect(summary.resolvedAs.ours).toEqual({ suggested: 4, matched: 4 });
  expect(summary.resolvedAs.written).toEqual({ suggested: 3, matched: 0 });
  expect(summary.sources).toEqual({
    flask: { cases: 4, suggested: 4, matched: 4 },
    tokio: { cases: 5, suggested: 3, matched: 0 },
  });
});

test("reports the matches, and how well a low Confidence flagged the mismatches", () => {
  const said = report("Suggestions from the Fake Model Provider", summarize(RESULTS));
  expect(said).toContain("# Suggestions from the Fake Model Provider");
  expect(said).toContain("| Exact match | 3 | 43% |");
  expect(said).toContain("| Near match, whitespace aside | 1 | 14% |");
  expect(said).toContain("| Mismatch | 3 | 43% |");
  expect(said).toContain("| No Suggestion | 1 | |");
  expect(said).toContain("| Not asked | 1 | |");
  expect(said).toContain("4 of 7 Suggestions matched or nearly matched their ground truth, what the merge commit has (57%). PRD §14 asks for a majority: met.");
  expect(said).toContain("| Low | 1 | 0 | 2 |");
  expect(said).toContain(
    "Confidence flagged 2 of 3 mismatches as low (67%), and 1 of 4 matches (25%). Of the low-Confidence Suggestions, 2 of 3 were mismatches (67%).",
  );
  expect(said).toContain("before the checks made 1 of the Suggestions low");
  expect(said).toContain("The model's own Confidence flagged 1 of 3 mismatches as low (33%)");
  expect(said).toContain("| Written anew | 3 | 0 (0%) |");
  expect(said).toContain("| tokio | 5 | 3 | 0 (0%) |");
});

test("says where a majority wasn't met, and that there's nothing to share of none", () => {
  expect(report("None", summarize([suggested("a", "mismatch", "high"), suggested("a", "exact", "high")]))).toContain(
    "PRD §14 asks for a majority: not met.",
  );
  expect(report("None", summarize([]))).toContain("| Exact match | 0 | – |");
});
