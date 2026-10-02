import type { ModelProviderKeyError } from "../commands/api";
import type { FailedCheck } from "./confidence";
import type { Confidence, Effort, ModelProviderFailure } from "./modelProvider";
import { ModelProviderError } from "./modelProvider";
import { AiRefusedError, type AiRefusal } from "./requests";

/** Each effort in the plain words the picker shows (PRD §8.3). */
export const EFFORT_WORDS: Record<Effort, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  extraHigh: "Extra high",
  maximum: "Maximum",
};

/**
 * Exactly what's sent to a Model Provider for each Suggestion, as the
 * first-use disclosure lists it: what `suggestionPrompt` sends.
 */
export function sentForASuggestion(contextLines: number): string[] {
  const lines = contextLines === 1 ? "line" : "lines";
  return [
    "The Conflict Hunk's three versions: Base, Ours and Theirs.",
    `Up to ${contextLines} ${lines} of the file above the Conflict Hunk, and up to ${contextLines} below it.`,
    "The file's path in the repository.",
    "The subjects of the commits on both sides.",
  ];
}

/** Each Confidence as a Suggestion shows it. */
export const CONFIDENCE_WORDS: Record<Confidence, string> = { high: "High", medium: "Medium", low: "Low" };

/** “1 line” or “3 lines”. */
function lineCount(count: number): string {
  return count === 1 ? "1 line" : `${count} lines`;
}

/** What a check a Suggestion's Resolution text failed means, in words. */
export function failedCheckWords(check: FailedCheck): string {
  switch (check.kind) {
    case "conflictMarkers":
      return "It still has Conflict Markers.";
    case "empty":
      return "It's empty.";
    case "droppedLines":
      return `It leaves out ${lineCount(check.lines.length)} only ${check.side === "ours" ? "Ours" : "Theirs"} has:`;
    case "jevDoubts":
      return `Jev judged it only ${Math.round(check.keepsBoth * 100)}% likely to keep what both sides meant.`;
  }
}

/** What a failure of the OS credential store means for the user. */
export function keyStoreWords(error: ModelProviderKeyError): string {
  switch (error.kind) {
    case "emptyKey":
      return "Enter the API key to keep.";
    case "storeUnavailable":
      return `There's no credential store to keep API keys in here. ${error.message}`;
    case "storeRefused":
      return `The credential store wouldn't let Lanewise in: unlock it and try again. ${error.message}`;
    case "storeFailed":
      return `The credential store failed. ${error.message}`;
  }
}

function refusalWords(refusal: AiRefusal, name: (id: string) => string): string {
  switch (refusal.kind) {
    case "off":
      return "AI is off. Turn it on in Settings.";
    case "noModelProvider":
      return "Choose a Model Provider in Settings.";
    case "notDisclosed":
      return `Turn AI on for ${name(refusal.provider)} in Settings first.`;
    case "noModel":
      return `Choose one of ${name(refusal.provider)}'s models in Settings.`;
    case "noKey":
      return `Save your API key for ${name(refusal.provider)} in Settings.`;
    case "keyStore":
      return keyStoreWords(refusal.error);
  }
}

function failureWords(failure: ModelProviderFailure): string {
  switch (failure.kind) {
    case "keyRefused":
      return "The Model Provider refused the API key. Check it on the Model Provider's API-key page and save it again.";
    case "rateLimited":
      return "The Model Provider says there have been too many requests, or the account is out of credit. Try again later.";
    case "unreachable":
      return `The Model Provider couldn't be reached. ${failure.message}`;
    case "unavailable":
      return `The Model Provider is overloaded or having trouble. Try again in a while. ${failure.message}`;
    case "rejected":
      return `The Model Provider turned the request down. ${failure.message}`;
    case "declined": {
      const why = failure.explanation === null ? "" : ` ${failure.explanation}`;
      return `The model declined to make a Suggestion for this Conflict Hunk.${why} Resolve it by hand, or choose another model in Settings.`;
    }
    case "unexpectedResponse":
      return `The Model Provider's answer couldn't be read. ${failure.message}`;
  }
}

/** Why a request to a Model Provider wasn't made, or failed, for the user. `name` names a Model Provider by its ID. */
export function aiFailureWords(failure: unknown, name: (id: string) => string): string {
  if (failure instanceof AiRefusedError) return refusalWords(failure.refusal, name);
  if (failure instanceof ModelProviderError) return failureWords(failure.failure);
  return failure instanceof Error ? failure.message : String(failure);
}
