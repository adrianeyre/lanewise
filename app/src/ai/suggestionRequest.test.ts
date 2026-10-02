import { describe, expect, test } from "vitest";

import { conflictHunks } from "../conflicts/conflictHunks";
import { ModelProviderError } from "./modelProvider";
import { CONTEXT_LINES, readSuggestion, suggestionPrompt, suggestionRequest } from "./suggestionRequest";

/** Line `n` of a file with a Conflict Hunk after its 30th line and 30 lines after it. */
const file = [
  ...Array.from({ length: 30 }, (_, n) => `above ${n + 1}`),
  "<<<<<<< HEAD",
  "ours",
  "||||||| base",
  "base",
  "=======",
  "theirs",
  ">>>>>>> feature",
  ...Array.from({ length: 30 }, (_, n) => `below ${n + 1}`),
  "",
].join("\n");

const [hunk] = conflictHunks(file);
if (hunk === undefined) throw new Error("the file has a Conflict Hunk");

describe("suggestionRequest", () => {
  test("sends the Conflict Hunk's three versions, 20 lines each side, the path and both commit subjects", () => {
    const request = suggestionRequest(file, hunk, {
      path: "src/lanes.rs",
      oursSubject: "Count lanes from 1",
      theirsSubject: "Count lanes from 0",
    });

    expect(CONTEXT_LINES).toBe(20);
    expect(request).toEqual({
      path: "src/lanes.rs",
      base: ["base"],
      ours: ["ours"],
      theirs: ["theirs"],
      before: Array.from({ length: 20 }, (_, n) => `above ${n + 11}`),
      after: Array.from({ length: 20 }, (_, n) => `below ${n + 1}`),
      oursSubject: "Count lanes from 1",
      theirsSubject: "Count lanes from 0",
    });
  });

  test("sends as many lines of context as Settings says, and no more than the file has", () => {
    const options = { path: "a", oursSubject: null, theirsSubject: null };

    expect(suggestionRequest(file, hunk, { ...options, contextLines: 2 })).toMatchObject({
      before: ["above 29", "above 30"],
      after: ["below 1", "below 2"],
    });
    expect(suggestionRequest(file, hunk, { ...options, contextLines: 0 })).toMatchObject({ before: [], after: [] });
    const all = suggestionRequest(file, hunk, { ...options, contextLines: 100 });
    expect(all.before).toHaveLength(30);
    expect(all.after).toHaveLength(30);
  });
});

describe("suggestionPrompt", () => {
  test("carries what the request has, and nothing of the file beyond it", () => {
    const prompt = suggestionPrompt(
      suggestionRequest(file, hunk, { path: "src/lanes.rs", oursSubject: "Ours", theirsSubject: "Theirs", contextLines: 1 }),
    );

    expect(prompt).toBe(
      [
        "<path>src/lanes.rs</path>",
        "<ours-commit>Ours</ours-commit>",
        "<theirs-commit>Theirs</theirs-commit>",
        "<before>\nabove 30\n</before>",
        "<base>\nbase\n</base>",
        "<ours>\nours\n</ours>",
        "<theirs>\ntheirs\n</theirs>",
        "<after>\nbelow 1\n</after>",
      ].join("\n"),
    );
    expect(prompt).not.toContain("above 29");
    expect(prompt).not.toContain("below 2");
  });

  test("says when there's no Base, as for a file added on both sides", () => {
    const prompt = suggestionPrompt({
      path: "new.txt",
      base: null,
      ours: ["a"],
      theirs: ["b"],
      before: [],
      after: [],
      oursSubject: null,
      theirsSubject: null,
    });

    expect(prompt).toContain('<base missing="true" />');
  });
});

describe("readSuggestion", () => {
  test("reads a Suggestion's explanation, Resolution text and Confidence", () => {
    expect(readSuggestion({ explanation: "Keep both.", resolution: "a\nb", confidence: "medium" })).toEqual({
      explanation: "Keep both.",
      resolution: "a\nb",
      confidence: "medium",
    });
  });

  test.each([
    null,
    "a Suggestion",
    { explanation: "Keep both.", resolution: "a" },
    { explanation: "Keep both.", resolution: "a", confidence: "certain" },
    { explanation: 1, resolution: "a", confidence: "high" },
  ])("anything else is an unexpected response: %j", (output) => {
    expect(() => readSuggestion(output)).toThrow(ModelProviderError);
  });
});
