/**
 * The Model Providers the hand-run scripts can ask (`trySuggestion.ts` and
 * `eval/evaluate.ts`), each with the one environment variable its API key is
 * read from. It's never `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
 * `GOOGLE_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY` or any other variable an
 * SDK knows, so a key or gateway that happens to be about can't be used by
 * mistake.
 */

import { anthropicModelProvider } from "../src/ai/anthropic";
import { geminiModelProvider } from "../src/ai/gemini";
import type { ModelProvider } from "../src/ai/modelProvider";
import { localModelProvider, metaModelProvider, openAiModelProvider, xaiModelProvider } from "../src/ai/openAiCompatible";

/** A Model Provider a script can ask, with where its key comes from and where its prices are. */
export interface ScriptModelProvider {
  provider: ModelProvider;
  /** The environment variable its API key is read from. */
  key: string;
  /** Where its prices per million tokens are published, or `null` for a server on this computer, which costs nothing. */
  pricing: string | null;
}

/** Each Model Provider a script can ask, by the name it's given on the command line. */
export const SCRIPT_MODEL_PROVIDERS: Record<string, ScriptModelProvider> = {
  anthropic: { provider: anthropicModelProvider(), key: "LANEWISE_ANTHROPIC_API_KEY", pricing: "https://claude.com/pricing#api" },
  gemini: { provider: geminiModelProvider(), key: "LANEWISE_GEMINI_API_KEY", pricing: "https://ai.google.dev/gemini-api/docs/pricing" },
  openai: { provider: openAiModelProvider(), key: "LANEWISE_OPENAI_API_KEY", pricing: "https://openai.com/api/pricing/" },
  xai: { provider: xaiModelProvider(), key: "LANEWISE_XAI_API_KEY", pricing: "https://docs.x.ai/docs/models" },
  meta: { provider: metaModelProvider(), key: "LANEWISE_META_API_KEY", pricing: "https://dev.meta.ai/" },
  local: { provider: localModelProvider(), key: "LANEWISE_LOCAL_API_KEY", pricing: null },
};
