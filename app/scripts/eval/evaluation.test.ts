import { expect, test } from "vitest";

import type { Connection, ModelSelection, Suggestion } from "../../src/ai/modelProvider";
import { suggestionPrompt, suggestionRequest } from "../../src/ai/suggestionRequest";
import { FAKE_API, fakeModelProvider } from "../../src/test/fakeModelProvider";
import { type CorpusPart, corpusCases, linesOf } from "./corpus";
import { caseRequest, evaluate, inTurn } from "./evaluation";

/** A file with three Conflict Hunks, each with its Base, between lines of context. */
const TEXT = [
  "import os",
  "import sys",
  ...[1, 2, 3].flatMap((n) => [
    "<<<<<<< ours",
    `a${n} = "ours"`,
    "||||||| base",
    `a${n} = "base"`,
    "=======",
    `a${n} = "theirs"`,
    ">>>>>>> theirs",
    `print(a${n})`,
  ]),
  "",
].join("\n");

const PART: CorpusPart = {
  source: { name: "demo", url: "https://example.test/demo", licence: "MIT", licenceFile: "LICENSE", at: "a".repeat(40), merges: 1 },
  git: "git version 2.47.3",
  files: [
    {
      merge: "m".repeat(40),
      ours: "o".repeat(40),
      theirs: "t".repeat(40),
      oursSubject: "Say ours",
      theirsSubject: "Say theirs",
      path: "demo.py",
      firstLine: 1,
      lines: linesOf(TEXT),
      hunks: [1, 2, 3].map((n) => ({
        line: 3 + (n - 1) * 8,
        number: n,
        of: 3,
        resolution: [`a${n} = "theirs"`],
        resolvedAs: "theirs" as const,
      })),
    },
  ],
};

const CASES = corpusCases(PART);
const SELECTION: ModelSelection = { model: "fake-opus", version: "fake-opus-5", effort: "high", budget: null };

/**
 * A connection to the fake Model Provider that answers each Suggestion
 * request with the next of `answers`: a Suggestion, or a status it fails
 * with. It counts the requests in flight at once.
 */
function scripted(answers: (Suggestion | number)[], signal?: AbortSignal) {
  const fake = fakeModelProvider();
  const bodies: { prompt: string }[] = [];
  let inFlight = 0;
  let mostInFlight = 0;
  const connection: Connection = {
    apiKey: "sk-fake",
    signal,
    async fetch(url, init) {
      if (!url.endsWith("/suggest")) return fake.answer(url, init);
      bodies.push(JSON.parse(String(init?.body)) as { prompt: string });
      inFlight++;
      mostInFlight = Math.max(mostInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      const answer = answers.shift();
      if (answer === undefined) throw new Error("Asked once too often.");
      return typeof answer === "number" ? new Response("{}", { status: answer }) : Response.json(answer);
    },
  };
  return { provider: fake.provider, connection, bodies, mostInFlight: () => mostInFlight };
}

const theirs = (n: number, confidence: Suggestion["confidence"] = "high"): Suggestion => ({
  explanation: "Theirs is newer.",
  resolution: `a${n} = "theirs"\n`,
  confidence,
});

test("asks about each Conflict Hunk as the AI Suggestion Widget would, one at a time", async () => {
  const { provider, connection, bodies, mostInFlight } = scripted([
    theirs(1),
    { explanation: "", resolution: 'a2 =  "theirs"', confidence: "medium" },
    { explanation: "", resolution: 'a3 = "ours"', confidence: "high" },
  ]);
  const results = await evaluate({ cases: CASES, provider, selection: SELECTION, connection, contextLines: 1 });
  expect(bodies.map(({ prompt }) => prompt)).toEqual(
    CASES.map((each) =>
      suggestionPrompt(
        suggestionRequest(TEXT, each.conflict, {
          path: "demo.py",
          oursSubject: "Say ours",
          theirsSubject: "Say theirs",
          contextLines: 1,
        }),
      ),
    ),
  );
  expect(caseRequest(CASES[1]!, 1)).toMatchObject({ before: ["print(a1)"], after: ["print(a2)"], base: ['a2 = "base"'] });
  expect(mostInFlight()).toBe(1);
  expect(results.map(({ outcome }) => (outcome.kind === "suggested" ? outcome.match : outcome.kind))).toEqual([
    "exact",
    "near",
    "mismatch",
  ]);
  // Theirs' line left out: the check makes it low, whatever the model said.
  const third = results[2]!.outcome;
  expect(third.kind === "suggested" && [third.suggestion.reported, third.suggestion.confidence]).toEqual(["high", "low"]);
  expect(results[0]).toMatchObject({ source: "demo", path: "demo.py", number: 1, of: 3, truth: ['a1 = "theirs"'] });
});

test("goes on past a failure that's that Conflict Hunk's own", async () => {
  // The fake answers 500 as a response it can't read.
  const { provider, connection } = scripted([theirs(1), 500, theirs(3)]);
  const results = await evaluate({ cases: CASES, provider, selection: SELECTION, connection, contextLines: 20 });
  expect(results.map(({ outcome }) => outcome.kind)).toEqual(["suggested", "failed", "suggested"]);
  expect(results[1]!.outcome).toEqual({ kind: "failed", reason: "The Model Provider's answer couldn't be read. It answered 500." });
});

test("asks no more after a failure the rest would have too", async () => {
  const { provider, connection, bodies } = scripted([429]);
  const heard: number[] = [];
  const results = await evaluate({
    cases: CASES,
    provider,
    selection: SELECTION,
    connection,
    contextLines: 20,
    onResult: (_, index) => heard.push(index),
  });
  expect(bodies).toHaveLength(1);
  expect(results.map(({ outcome }) => outcome.kind)).toEqual(["failed", "notAsked", "notAsked"]);
  expect(heard).toEqual([0, 1, 2]);
});

test("asks no more once stopped, and counts the request it stopped as not asked", async () => {
  const aborts = new AbortController();
  const { provider, connection, bodies } = scripted([theirs(1)], aborts.signal);
  const results = await evaluate({
    cases: CASES,
    provider,
    selection: SELECTION,
    connection: {
      ...connection,
      async fetch(url, init) {
        if (url !== `${FAKE_API}/fake/suggest` || bodies.length === 0) return connection.fetch(url, init);
        // Ctrl-C while the second is being asked.
        aborts.abort();
        throw new DOMException("Aborted", "AbortError");
      },
    },
    contextLines: 20,
  });
  expect(bodies).toHaveLength(1);
  expect(results.map(({ outcome }) => outcome.kind)).toEqual(["suggested", "notAsked", "notAsked"]);
});

test("takes cases from each repository in turn", () => {
  expect(inTurn([["a1", "a2", "a3"], ["b1"], ["c1", "c2"]])).toEqual(["a1", "b1", "c1", "a2", "c2", "a3"]);
  expect(inTurn([])).toEqual([]);
});
