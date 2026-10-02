import { expect, test } from "vitest";

import type { SuggestionRequest } from "../../src/ai/modelProvider";
import { SUGGESTION_INSTRUCTIONS, SUGGESTION_SCHEMA, suggestionPrompt } from "../../src/ai/suggestionRequest";
import { costOf, estimateTokens } from "./cost";

const REQUEST: SuggestionRequest = {
  path: "greet.py",
  base: ["def greet():"],
  ours: ["def greet(name):"],
  theirs: ["def greet(who=None):"],
  before: ["import os"],
  after: ["    pass"],
  oursSubject: "Name the greeting",
  theirsSubject: "Let greet take no one",
};

test("estimates the tokens sent from the text each request sends", () => {
  const sent = SUGGESTION_INSTRUCTIONS.length + JSON.stringify(SUGGESTION_SCHEMA).length + suggestionPrompt(REQUEST).length;
  const { input } = estimateTokens([REQUEST, REQUEST], { model: "m", version: "v", effort: "off", budget: null });
  expect(input).toBe(2 * Math.ceil(sent / 3));
  const more = estimateTokens([{ ...REQUEST, before: Array(20).fill("import os") }], { model: "m", version: "v", effort: "off", budget: null });
  expect(more.input).toBeGreaterThan(input / 2);
});

/** The output tokens allowed for one request at `effort`, or with a token budget. */
function output(effort: "off" | "low" | "high" | null, budget: number | null = null): number {
  return estimateTokens([REQUEST], { model: "m", version: "v", effort, budget }).output;
}

test("allows for thinking as its budget or Effort does, the model's default as High", () => {
  const answer = output("off");
  expect(answer).toBeGreaterThan(0);
  expect(output("low")).toBe(answer + 2_048);
  expect(output("high")).toBe(answer + 8_192);
  expect(output(null)).toBe(output("high"));
  expect(output("low", 24_576)).toBe(answer + 24_576);
});

test("costs the tokens at the prices per million", () => {
  expect(costOf({ input: 2_000_000, output: 500_000 }, { input: 3, output: 15 })).toBe(13.5);
  expect(costOf({ input: 2_000_000, output: 500_000 }, { input: 0, output: 0 })).toBe(0);
});
