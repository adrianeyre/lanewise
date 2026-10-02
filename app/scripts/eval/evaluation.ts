/**
 * Runs the Suggestion pipeline over the corpus, as the AI Suggestion Widget
 * does for each Conflict Hunk (ADR 0025, ADR 0026): the request is made by
 * `suggestionRequest` from the conflicted text, the Model Provider's adapter
 * asks for the Suggestion, and `checkSuggestion` checks its Confidence. Each
 * is then compared with that Conflict Hunk's ground truth.
 */

import { aiFailureWords } from "../../src/ai/aiWords";
import { checkSuggestion } from "../../src/ai/confidence";
import type { Connection, ModelProvider, ModelSelection, SuggestionRequest } from "../../src/ai/modelProvider";
import { failsOnlyThisRequest } from "../../src/ai/requests";
import { suggestionRequest } from "../../src/ai/suggestionRequest";
import type { CorpusCase } from "./corpus";
import { type CaseResult, type Outcome, matchOf } from "./scoring";

/** The request for a Suggestion for `each`, with `contextLines` lines round it, as the Widget makes it. */
export function caseRequest(each: CorpusCase, contextLines: number): SuggestionRequest {
  const { file } = each;
  return suggestionRequest(each.text, each.conflict, {
    path: file.path,
    oursSubject: file.oursSubject,
    theirsSubject: file.theirsSubject,
    contextLines,
  });
}

function resultOf(each: CorpusCase, outcome: Outcome): CaseResult {
  const { file, hunk } = each;
  return {
    source: each.source,
    merge: file.merge,
    path: file.path,
    number: hunk.number,
    of: hunk.of,
    resolvedAs: hunk.resolvedAs,
    truth: hunk.resolution,
    outcome,
  };
}

/**
 * What asking `provider` about each of `cases` came to, in order, one
 * request at a time, never in parallel, with `selection` through
 * `connection`. A failure that's only that Conflict Hunk's own, such as the
 * model declining, is recorded and the rest are still asked about. Any
 * other, such as the key refused or too many requests, would fail the rest
 * too, so none after it is asked, as when `connection`'s signal aborts.
 * `onResult` hears each as it comes.
 */
export async function evaluate({
  cases,
  provider,
  selection,
  connection,
  contextLines,
  onResult = () => {},
}: {
  cases: readonly CorpusCase[];
  provider: ModelProvider;
  selection: ModelSelection;
  connection: Connection;
  contextLines: number;
  onResult?: (result: CaseResult, index: number) => void;
}): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  const aborted = () => connection.signal?.aborted === true;
  let stopped = false;
  for (const [index, each] of cases.entries()) {
    let outcome: Outcome;
    if (stopped || aborted()) {
      outcome = { kind: "notAsked" };
    } else {
      const request = caseRequest(each, contextLines);
      try {
        const suggestion = checkSuggestion(await provider.suggest(request, selection, connection), request);
        outcome = { kind: "suggested", match: matchOf(suggestion.resolution, each.hunk.resolution), suggestion };
      } catch (failure) {
        if (aborted()) {
          outcome = { kind: "notAsked" };
        } else {
          outcome = { kind: "failed", reason: aiFailureWords(failure, () => provider.name) };
          stopped = !failsOnlyThisRequest(failure);
        }
      }
    }
    const result = resultOf(each, outcome);
    results.push(result);
    onResult(result, index);
  }
  return results;
}

/**
 * `lists` taken in turn, one from each while any is left, so the first few
 * of the result come from each list alike.
 */
export function inTurn<T>(lists: readonly (readonly T[])[]): T[] {
  const most = Math.max(0, ...lists.map((list) => list.length));
  const taken: T[] = [];
  for (let index = 0; index < most; index++) {
    for (const list of lists) {
      const each = list[index];
      if (each !== undefined) taken.push(each);
    }
  }
  return taken;
}
