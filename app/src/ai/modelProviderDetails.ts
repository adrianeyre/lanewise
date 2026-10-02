import type { ModelProvider } from "./modelProvider";

/**
 * What Settings, the first-use disclosure and the HTTP allow-list know of
 * each Model Provider, without its adapter: nothing here imports an SDK, so
 * an adapter and its SDK are only loaded once they're used (`modelProviders.ts`).
 */

/** A Model Provider as it's offered, before its adapter is loaded. */
export type ModelProviderDetails = Omit<ModelProvider, "listModels" | "suggest">;

/** Where Anthropic's API is. Always this: never `ANTHROPIC_BASE_URL`. */
export const ANTHROPIC_API = "https://api.anthropic.com";

/** Where the Gemini API is. Always this: never `GOOGLE_GEMINI_BASE_URL`. */
export const GEMINI_API = "https://generativelanguage.googleapis.com";

/** The Anthropic Model Provider: Claude (ADR 0022). */
export const ANTHROPIC_DETAILS: ModelProviderDetails = {
  id: "anthropic",
  name: "Anthropic (Claude)",
  key: "required",
  apiKeyPage: "https://platform.claude.com/settings/keys",
  host: new URL(ANTHROPIC_API).host,
  defaultBaseUrl: null,
  catalog: "anthropic",
};

/** The Gemini Model Provider: Google's Gemini models (ADR 0023). */
export const GEMINI_DETAILS: ModelProviderDetails = {
  id: "gemini",
  name: "Google (Gemini)",
  key: "required",
  apiKeyPage: "https://aistudio.google.com/apikey",
  host: new URL(GEMINI_API).host,
  defaultBaseUrl: null,
  catalog: "gemini",
};

/** How one OpenAI-compatible Model Provider is reached. */
export interface OpenAiPreset {
  /** Its ID, which is also its section of the model catalog. */
  id: string;
  name: string;
  apiKeyPage: string | null;
  key: "required" | "optional";
  /** Where its API is, always, or `null` for a server on this computer, whose base URL the user sets. */
  api: string | null;
  /** For a server on this computer, the base URL it has until the user sets one: Ollama's. */
  defaultBaseUrl: string | null;
}

/** OpenAI's API. Always this: never `OPENAI_BASE_URL`. */
export const OPENAI_API = "https://api.openai.com/v1";

/** xAI's API, for Grok. */
export const XAI_API = "https://api.x.ai/v1";

/** Meta's API, for Muse Spark: a preview, in the US only. */
export const META_API = "https://api.meta.ai/v1";

/**
 * Where a local server's API is until the user sets its base URL: Ollama's.
 * LM Studio's is `http://localhost:1234/v1` and llama.cpp's `llama-server`'s
 * `http://localhost:8080/v1`.
 */
export const LOCAL_API = "http://localhost:11434/v1";

/** Each OpenAI-compatible Model Provider, as Settings offers them (ADR 0024). */
export const OPENAI_PRESETS = {
  openai: {
    id: "openai",
    name: "OpenAI (ChatGPT models)",
    apiKeyPage: "https://platform.openai.com/api-keys",
    key: "required",
    api: OPENAI_API,
    defaultBaseUrl: null,
  },
  xai: {
    id: "xai",
    name: "xAI (Grok)",
    apiKeyPage: "https://console.x.ai/team/default/api-keys",
    key: "required",
    api: XAI_API,
    defaultBaseUrl: null,
  },
  meta: {
    id: "meta",
    name: "Meta (Muse Spark), preview, US only",
    apiKeyPage: "https://dev.meta.ai/",
    key: "required",
    api: META_API,
    defaultBaseUrl: null,
  },
  local: {
    id: "local",
    name: "Local server (Ollama, LM Studio or llama.cpp)",
    apiKeyPage: null,
    key: "optional",
    api: null,
    defaultBaseUrl: LOCAL_API,
  },
} as const satisfies Record<string, OpenAiPreset>;

/** The OpenAI-compatible Model Provider `preset` sets up. */
export function openAiCompatibleDetails(preset: OpenAiPreset): ModelProviderDetails {
  return {
    id: preset.id,
    name: preset.name,
    key: preset.key,
    apiKeyPage: preset.apiKeyPage,
    host: preset.api === null ? "this computer" : new URL(preset.api).host,
    defaultBaseUrl: preset.defaultBaseUrl,
    catalog: preset.id,
  };
}
