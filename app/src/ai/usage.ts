import { useSyncExternalStore } from "react";

import type { TokenUsage } from "./modelProvider";

/** The tokens Suggestions have taken in this run of Lanewise, as their Model Providers counted them. */
export interface TokenTotals {
  /** The Suggestions whose Model Provider said how many tokens they took. */
  counted: number;
  inputTokens: number;
  outputTokens: number;
}

let totals: TokenTotals = { counted: 0, inputTokens: 0, outputTokens: 0 };
const listeners = new Set<() => void>();

/** Adds a Suggestion's tokens to the run's totals, where its Model Provider said. Nothing is kept past the run, or sent. */
export function recordUsage(usage: TokenUsage | null | undefined): void {
  if (!usage) return;
  totals = {
    counted: totals.counted + 1,
    inputTokens: totals.inputTokens + usage.inputTokens,
    outputTokens: totals.outputTokens + usage.outputTokens,
  };
  for (const listener of listeners) listener();
}

export function useTokenTotals(): TokenTotals {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => totals,
    () => totals,
  );
}

/** About how many tokens `text` is: a quarter of its characters, as most Model Providers' tokenizers come to for code. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Starts the run's totals again, for a test. */
export function resetTokenTotals(): void {
  totals = { counted: 0, inputTokens: 0, outputTokens: 0 };
}
