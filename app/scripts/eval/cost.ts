/**
 * What an evaluation is likely to cost, told before anything is sent. It's
 * an estimate on the generous side, from the text sent and an allowance for
 * the model's thinking, not a count from the Model Provider's tokenizer.
 */

import type { Effort, ModelSelection, SuggestionRequest } from "../../src/ai/modelProvider";
import { SUGGESTION_INSTRUCTIONS, SUGGESTION_SCHEMA, suggestionPrompt } from "../../src/ai/suggestionRequest";

/** Characters taken as one token: fewer than the usual four, as code and markup take more tokens than prose. */
const CHARS_PER_TOKEN = 3;

/** The characters an explanation and the answer's JSON take, over and above its Resolution text. */
const ANSWER_CHARS = 800;

/**
 * The thinking allowed for at each Effort, in tokens, where the model takes
 * no token budget. `null`, the Model Provider's own default, is allowed as
 * much as High.
 */
const THINKING: Record<Effort, number> = {
  off: 0,
  minimal: 512,
  low: 2_048,
  medium: 4_096,
  high: 8_192,
  extraHigh: 16_384,
  maximum: 32_768,
};

/** A Model Provider's prices, in US dollars for a million tokens. */
export interface Prices {
  input: number;
  output: number;
}

/** Tokens a run is expected to send and be sent. */
export interface Tokens {
  input: number;
  output: number;
}

function tokens(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * The tokens `requests` are expected to take with `selection`: what each
 * sends, and up to an answer as long as both sides together, with the
 * thinking its token budget or Effort allows.
 */
export function estimateTokens(requests: readonly SuggestionRequest[], selection: ModelSelection): Tokens {
  const fixed = SUGGESTION_INSTRUCTIONS.length + JSON.stringify(SUGGESTION_SCHEMA).length;
  const thinking = selection.budget ?? THINKING[selection.effort ?? "high"];
  let input = 0;
  let output = 0;
  for (const request of requests) {
    input += tokens(fixed + suggestionPrompt(request).length);
    const sides = [...request.ours, ...request.theirs].join("\n").length;
    output += tokens(sides + ANSWER_CHARS) + thinking;
  }
  return { input, output };
}

/** What `used` costs at `prices`, in US dollars. */
export function costOf(used: Tokens, prices: Prices): number {
  return (used.input * prices.input + used.output * prices.output) / 1_000_000;
}
