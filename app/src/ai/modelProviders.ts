import type { ModelProvider } from "./modelProvider";
import {
  ANTHROPIC_DETAILS,
  GEMINI_DETAILS,
  type ModelProviderDetails,
  OPENAI_PRESETS,
  openAiCompatibleDetails,
} from "./modelProviderDetails";

/**
 * The Model Provider `details` describe, whose adapter, with its SDK, is
 * only loaded the first time it's asked for its models or a Suggestion. The
 * SDKs are most of the UI's code, and the first screen needs none of them.
 */
function loadedWhenUsed(details: ModelProviderDetails, load: () => Promise<ModelProvider>): ModelProvider {
  let adapter: Promise<ModelProvider> | null = null;
  const loaded = () =>
    (adapter ??= load().catch((failure: unknown) => {
      // Tried again next time.
      adapter = null;
      throw failure;
    }));
  return {
    ...details,
    listModels: async (connection) => (await loaded()).listModels(connection),
    suggest: async (request, selection, connection) => (await loaded()).suggest(request, selection, connection),
  };
}

/** Every Model Provider Lanewise has an adapter for, as Settings offers them. */
export const MODEL_PROVIDERS: readonly ModelProvider[] = [
  loadedWhenUsed(ANTHROPIC_DETAILS, async () => (await import("./anthropic")).anthropicModelProvider()),
  loadedWhenUsed(openAiCompatibleDetails(OPENAI_PRESETS.openai), async () =>
    (await import("./openAiCompatible")).openAiModelProvider(),
  ),
  loadedWhenUsed(openAiCompatibleDetails(OPENAI_PRESETS.xai), async () =>
    (await import("./openAiCompatible")).xaiModelProvider(),
  ),
  loadedWhenUsed(GEMINI_DETAILS, async () => (await import("./gemini")).geminiModelProvider()),
  loadedWhenUsed(openAiCompatibleDetails(OPENAI_PRESETS.meta), async () =>
    (await import("./openAiCompatible")).metaModelProvider(),
  ),
  loadedWhenUsed(openAiCompatibleDetails(OPENAI_PRESETS.local), async () =>
    (await import("./openAiCompatible")).localModelProvider(),
  ),
];

/** A cloud Model Provider, the consumer subscription that can't stand in for its API key, and where to make one. */
export interface CloudModelProvider {
  name: string;
  /** Its consumer subscriptions, which third-party apps can't use. */
  subscriptions: string;
  apiKeyPage: string;
}

/**
 * The cloud Model Providers, for Settings to say plainly that a consumer
 * subscription can't be used, and link to each one's API-key page (PRD §8.2).
 */
export const CLOUD_MODEL_PROVIDERS: readonly CloudModelProvider[] = [
  {
    name: "Anthropic (Claude)",
    subscriptions: "Claude Pro or Max",
    apiKeyPage: "https://platform.claude.com/settings/keys",
  },
  {
    name: "OpenAI (ChatGPT models)",
    subscriptions: "ChatGPT Plus",
    apiKeyPage: "https://platform.openai.com/api-keys",
  },
  {
    name: "xAI (Grok)",
    subscriptions: "SuperGrok",
    apiKeyPage: "https://console.x.ai/team/default/api-keys",
  },
  {
    name: "Google (Gemini)",
    subscriptions: "Gemini Advanced",
    apiKeyPage: "https://aistudio.google.com/apikey",
  },
  {
    name: "Meta (Muse Spark), preview, US only",
    subscriptions: "Meta AI",
    apiKeyPage: "https://dev.meta.ai/",
  },
];
