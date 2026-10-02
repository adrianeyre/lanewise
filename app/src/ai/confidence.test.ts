import { describe, expect, test } from "vitest";

import { checkSuggestion } from "./confidence";
import type { Suggestion, SuggestionRequest } from "./modelProvider";

/** A Conflict Hunk where Ours made it 4 lanes and Theirs 5, and Theirs added a line of its own. */
const request: SuggestionRequest = {
  path: "src/lanes.rs",
  base: ["    let lanes = 3;"],
  ours: ["    let lanes = 4;"],
  theirs: ["    let lanes = 5;", "    let spare = 1;"],
  before: ["fn lanes() -> u32 {"],
  after: ["    lanes", "}"],
  oursSubject: "Use four lanes",
  theirsSubject: "Use five lanes, and a spare",
};

const suggested = (resolution: string, confidence: Suggestion["confidence"] = "high"): Suggestion => ({
  explanation: "Keep both.",
  resolution,
  confidence,
});

describe("checkSuggestion", () => {
  test("keeps the model's Confidence when every line only one side has is kept, and says it passed", () => {
    const checked = checkSuggestion(
      suggested("    let lanes = 4;\n    let lanes = 5;\n    let spare = 1;\n", "medium"),
      request,
    );
    expect(checked).toEqual({
      ...suggested("    let lanes = 4;\n    let lanes = 5;\n    let spare = 1;\n", "medium"),
      reported: "medium",
      failed: [],
    });
  });

  test("compares lines trimmed, so a line indented again, or a blank line left out, isn't dropped", () => {
    const checked = checkSuggestion(suggested("let lanes = 4;\r\nlet lanes = 5;\r\n\tlet spare = 1;"), request);
    expect(checked.confidence).toBe("high");
    expect(checked.failed).toEqual([]);
  });

  test("makes it low when it still has Conflict Markers", () => {
    const checked = checkSuggestion(
      suggested("<<<<<<< HEAD\n    let lanes = 4;\n=======\n    let lanes = 5;\n    let spare = 1;\n>>>>>>> feature\n"),
      request,
    );
    expect(checked.confidence).toBe("low");
    expect(checked.reported).toBe("high");
    expect(checked.failed).toEqual([{ kind: "conflictMarkers" }]);
  });

  test("counts a lone ======= line as a Conflict Marker unless a side or the Base has one", () => {
    const lone = "    let lanes = 4;\n=======\n    let lanes = 5;\n    let spare = 1;\n";
    expect(checkSuggestion(suggested(lone), request).failed).toEqual([{ kind: "conflictMarkers" }]);

    const heading: SuggestionRequest = { ...request, base: ["Lanes", "======="], ours: ["Lanes", "======="] };
    expect(checkSuggestion(suggested(`Lanes\n${lone}`), heading).failed).toEqual([]);
  });

  test("makes it low when it's empty, or only blank lines", () => {
    // Both sides made it `a`, so no line is only one side's.
    const same: SuggestionRequest = { ...request, ours: ["a"], theirs: ["a"], base: ["b"] };
    for (const resolution of ["", "\n", "  \n\t\n"]) {
      const checked = checkSuggestion(suggested(resolution), same);
      expect(checked.confidence).toBe("low");
      expect(checked.failed).toEqual([{ kind: "empty" }]);
    }
  });

  test("makes it low when it drops a line only one side has, saying which side's and which lines", () => {
    const checked = checkSuggestion(suggested("    let lanes = 5;\n", "high"), request);
    expect(checked.confidence).toBe("low");
    expect(checked.failed).toEqual([
      { kind: "droppedLines", side: "ours", lines: ["let lanes = 4;"] },
      { kind: "droppedLines", side: "theirs", lines: ["let spare = 1;"] },
    ]);
  });

  test("doesn't count a line both sides added, or one the Base has, as only one side's", () => {
    const both: SuggestionRequest = {
      ...request,
      base: ["kept", "removed"],
      ours: ["kept", "added by both"],
      theirs: ["added by both", "removed"],
    };
    expect(checkSuggestion(suggested("added by both\n"), both).failed).toEqual([]);
  });

  test("with no Base, a line only one side has is one the other side hasn't", () => {
    const added: SuggestionRequest = { ...request, base: null, ours: ["shared", "ours"], theirs: ["shared"] };
    expect(checkSuggestion(suggested("shared\n"), added).failed).toEqual([
      { kind: "droppedLines", side: "ours", lines: ["ours"] },
    ]);
    expect(checkSuggestion(suggested("shared\nours\n"), added).failed).toEqual([]);
  });

  test("keeps a low Confidence the model reported low, checks passed or not", () => {
    const checked = checkSuggestion(suggested("    let lanes = 4;\n    let lanes = 5;\n    let spare = 1;\n", "low"), request);
    expect(checked.confidence).toBe("low");
    expect(checked.failed).toEqual([]);
  });

  test("fails every check at once where it fails more than one", () => {
    const checked = checkSuggestion(suggested(">>>>>>> feature\n"), request);
    expect(checked.failed.map((check) => check.kind)).toEqual(["conflictMarkers", "droppedLines", "droppedLines"]);
  });
});
