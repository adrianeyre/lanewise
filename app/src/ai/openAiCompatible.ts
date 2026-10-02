import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  OpenAIError,
  RateLimitError,
  UnprocessableEntityError,
} from "openai";

import { localBaseUrl } from "./aiSettings";
import { openAiModels } from "./modelLists";
import { OPENAI_PRESETS, type OpenAiPreset, openAiCompatibleDetails } from "./modelProviderDetails";
import {
  type Connection,
  type Effort,
  type ModelProvider,
  ModelProviderError,
  type ModelSelection,
  type Suggestion,
  type SuggestionRequest,
} from "./modelProvider";
import { SUGGESTION_INSTRUCTIONS, SUGGESTION_SCHEMA, jsonIn, readSuggestion, suggestionPrompt } from "./suggestionRequest";

/**
 * The OpenAI-compatible Model Providers: OpenAI, xAI's Grok, Meta's Muse
 * Spark and servers the user runs on this computer, such as Ollama, LM
 * Studio and llama.cpp, where Llama runs. One adapter drives them all
 * through the official `openai` SDK's Chat Completions, set up by a preset
 * for each (PRD §8.3, ADR 0024). The SDK makes each request through the
 * connection's `fetch`, with the user's own API key, where there is one, and
 * nothing else of this computer's: no key, organization, project, base URL,
 * header or log level from the environment, and none of the headers the SDK
 * would add about itself.
 */

/**
 * The only headers a request carries: `authorization` only with the user's
 * own API key. The SDK adds others, about the OS, its runtime and its
 * retries, the organization and project from the environment, and any
 * `OPENAI_CUSTOM_HEADERS`; none of those are sent.
 */
export const OPENAI_HEADERS: readonly string[] = ["accept", "content-type", "authorization"];

/**
 * What the SDK is given as the API key for a local server that takes none,
 * since it won't make a request without one. It's never sent: without the
 * user's own key, no `authorization` header is.
 */
const NO_KEY = "no-key";

/** Each effort as Chat Completions' `reasoning_effort` names it, by the words the picker shows. */
const REASONING_EFFORTS: ReadonlyMap<Effort, OpenAI.ReasoningEffort> = new Map<Effort, OpenAI.ReasoningEffort>([
  ["off", "none"],
  ["minimal", "minimal"],
  ["low", "low"],
  ["medium", "medium"],
  ["high", "high"],
  ["extraHigh", "xhigh"],
  ["maximum", "max"],
]);

/**
 * How a Suggestion is asked for, in the order they're tried: held to the
 * Suggestion's JSON Schema with `response_format`, where the model takes it;
 * as a JSON object, with the schema in the instructions; and with only the
 * instructions, for a server that offers neither. Each answer is checked by
 * `readSuggestion` all the same.
 */
export type OutputMode = "jsonSchema" | "jsonObject" | "instructions";

export const OUTPUT_MODES: readonly OutputMode[] = ["jsonSchema", "jsonObject", "instructions"];

/** The `reasoning_effort` `selection` is sent with, or `undefined` for the model's own default. */
export function reasoningEffort(selection: ModelSelection): OpenAI.ReasoningEffort | undefined {
  return selection.effort === null ? undefined : REASONING_EFFORTS.get(selection.effort);
}

/** The Chat Completions request for a Suggestion for `request`, asked for as `mode` says. */
export function completionRequest(
  request: SuggestionRequest,
  selection: ModelSelection,
  mode: OutputMode,
): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
  const effort = reasoningEffort(selection);
  const format: OpenAI.Chat.ChatCompletionCreateParams["response_format"] | undefined =
    mode === "jsonSchema"
      ? { type: "json_schema", json_schema: { name: "suggestion", strict: true, schema: SUGGESTION_SCHEMA } }
      : mode === "jsonObject"
        ? { type: "json_object" }
        : undefined;
  return {
    model: selection.version,
    messages: [
      { role: "system", content: SUGGESTION_INSTRUCTIONS },
      { role: "user", content: suggestionPrompt(request) },
    ],
    ...(format === undefined ? {} : { response_format: format }),
    ...(effort === undefined ? {} : { reasoning_effort: effort }),
  };
}

/**
 * The connection's `fetch`, handed the SDK's request with only
 * {@link OPENAI_HEADERS}, and no `authorization` without the user's key.
 */
function connectionFetch(connection: Connection): (url: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return (url, init = {}) => {
    const given = new Headers(init.headers);
    const headers = new Headers();
    for (const name of OPENAI_HEADERS) {
      const value = given.get(name);
      if (value !== null && (name !== "authorization" || connection.apiKey !== null)) headers.set(name, value);
    }
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    return connection.fetch(href, { method: init.method, headers, body: init.body, signal: init.signal });
  };
}

/**
 * Where `preset`'s API is for `connection`: always the same for a cloud
 * Model Provider, and for a local server the base URL set for it, or its
 * default, only ever on this computer.
 */
function apiFor(preset: OpenAiPreset, connection: Connection): string {
  if (preset.api !== null) return preset.api;
  const api = localBaseUrl(connection.baseUrl ?? preset.defaultBaseUrl ?? "");
  if (api === null) {
    throw new ModelProviderError({ kind: "rejected", message: "Its base URL isn't on this computer. Set it again in Settings." });
  }
  return api;
}

/** The SDK's client for one request to `api` through `connection`. */
function client(preset: OpenAiPreset, api: string, connection: Connection, maxRetries: number): OpenAI {
  // Without a key the SDK would look for credentials of its own; a cloud Model Provider always has one here.
  if (connection.apiKey === null && preset.key === "required") throw new ModelProviderError({ kind: "keyRefused" });
  return new OpenAI({
    apiKey: connection.apiKey ?? NO_KEY,
    // Each said outright, so nothing in the environment is used instead.
    adminAPIKey: null,
    organization: null,
    project: null,
    webhookSecret: null,
    baseURL: api,
    fetch: connectionFetch(connection),
    maxRetries,
    logLevel: "off",
    // The webview looks like a browser to the SDK, but the request is made
    // from the shell, with the user's own key, which never leaves this
    // computer but for the Model Provider.
    dangerouslyAllowBrowser: true,
  });
}

type Fields = Record<string, unknown>;

function fields(value: unknown): Fields | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : null;
}

/**
 * What the API said was wrong, from its error's body, as OpenAI's and most
 * servers' `error.message`, or LM Studio's `error` alone; or else the SDK's
 * own message.
 */
function apiMessage(error: APIError): string {
  const said = typeof error.error === "string" ? error.error : fields(error.error)?.message;
  return typeof said === "string" && said !== "" ? said : error.message;
}

/**
 * Whether `error` is the Model Provider turning down how the answer was to be
 * held, its `response_format`, as OpenAI does for a model without structured
 * output, and LM Studio does for a JSON object, rather than the request.
 */
function refusesOutputMode(error: unknown): boolean {
  if (!(error instanceof BadRequestError || error instanceof UnprocessableEntityError)) return false;
  return /response_format|json_schema|json_object|schema|structured/i.test(`${error.param ?? ""} ${apiMessage(error)}`);
}

/**
 * What `error`, thrown by the SDK, means, by its typed class. An abort is
 * thrown on as it is, since nothing failed. A local server that can't be
 * reached is said to be at `api`, since it may not be running.
 */
function failureOf(error: unknown, preset: OpenAiPreset, api: string): unknown {
  if (error instanceof ModelProviderError || error instanceof APIUserAbortError) return error;
  if (error instanceof APIConnectionTimeoutError) {
    return new ModelProviderError({ kind: "unreachable", message: "It didn't answer in time." });
  }
  if (error instanceof APIConnectionError) {
    const cause = error.cause instanceof Error ? error.cause.message : error.message;
    const message = preset.api === null ? `Nothing answered at ${api}: check the server is running. ${cause}` : cause;
    return new ModelProviderError({ kind: "unreachable", message });
  }
  if (error instanceof AuthenticationError) return new ModelProviderError({ kind: "keyRefused" });
  if (error instanceof RateLimitError) return new ModelProviderError({ kind: "rateLimited" });
  if (error instanceof InternalServerError) {
    return new ModelProviderError({ kind: "unavailable", message: apiMessage(error) });
  }
  if (error instanceof APIError) return new ModelProviderError({ kind: "rejected", message: apiMessage(error) });
  if (error instanceof OpenAIError) return new ModelProviderError({ kind: "unexpectedResponse", message: error.message });
  // The SDK reads an answer that says it's JSON as JSON, whatever came back.
  if (error instanceof SyntaxError) {
    return new ModelProviderError({ kind: "unexpectedResponse", message: "Its answer wasn't JSON." });
  }
  return error;
}

/** The text of the model's answer, once it's said why it stopped. */
function answerText(completion: OpenAI.Chat.ChatCompletion): string {
  const [choice] = completion.choices ?? [];
  if (choice === undefined) throw new ModelProviderError({ kind: "unexpectedResponse", message: "It gave no answer." });
  const { refusal } = choice.message;
  if (typeof refusal === "string" && refusal !== "") throw new ModelProviderError({ kind: "declined", explanation: refusal });
  if (choice.finish_reason === "content_filter") throw new ModelProviderError({ kind: "declined", explanation: null });
  if (choice.finish_reason === "length") {
    throw new ModelProviderError({
      kind: "unexpectedResponse",
      message: "It stopped before the Suggestion was finished. A lower Effort may leave it room.",
    });
  }
  return choice.message.content ?? "";
}


/**
 * The adapter for one OpenAI-compatible Model Provider, set up by `preset`.
 * `maxRetries` is how often the SDK tries a request again after a failure
 * that may pass, such as a 503 or a connection failing: its own default of
 * 2 unless a test says otherwise.
 */
export function openAiCompatibleModelProvider(preset: OpenAiPreset, { maxRetries = 2 }: { maxRetries?: number } = {}): ModelProvider {
  // How each model, at each API, last gave a Suggestion, so one that can't
  // be held to the schema isn't asked to be again in this run.
  const modes = new Map<string, number>();
  return {
    ...openAiCompatibleDetails(preset),

    /** `GET /models`, which is never paged, each model with its ID and, where given, when it was made. */
    async listModels(connection) {
      const api = apiFor(preset, connection);
      const openai = client(preset, api, connection, maxRetries);
      const data: unknown[] = [];
      try {
        for await (const model of openai.models.list({ signal: connection.signal })) data.push(model);
      } catch (error) {
        throw failureOf(error, preset, api);
      }
      return openAiModels({ data }).models;
    },

    /**
     * One Chat Completions request, held to the Suggestion's JSON Schema
     * with `response_format` where the model takes it, with the effort
     * chosen, if any, as `reasoning_effort`. Where the Model Provider turns
     * that `response_format` down, or answers with something that isn't
     * JSON, as a server that ignores it does, it's asked again the next way
     * in {@link OUTPUT_MODES}.
     */
    async suggest(request, selection, connection) {
      const api = apiFor(preset, connection);
      const openai = client(preset, api, connection, maxRetries);
      const model = `${api} ${selection.version}`;
      for (let at = modes.get(model) ?? 0; at < OUTPUT_MODES.length; at += 1) {
        const mode = OUTPUT_MODES[at] as OutputMode;
        const last = at === OUTPUT_MODES.length - 1;
        let completion: OpenAI.Chat.ChatCompletion;
        try {
          completion = await openai.chat.completions.create(completionRequest(request, selection, mode), {
            signal: connection.signal,
          });
        } catch (error) {
          if (!last && refusesOutputMode(error)) continue;
          throw failureOf(error, preset, api);
        }
        const output = jsonIn(answerText(completion), mode === "instructions");
        if (output === undefined && !last) continue;
        if (output === undefined) {
          throw new ModelProviderError({ kind: "unexpectedResponse", message: "Its answer wasn't JSON." });
        }
        modes.set(model, at);
        const { usage } = completion;
        return {
          ...readSuggestion(output),
          usage: usage ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens } : null,
        } satisfies Suggestion;
      }
      throw new ModelProviderError({ kind: "unexpectedResponse", message: "Its answer wasn't JSON." });
    },
  };
}

/** OpenAI's adapter. */
export function openAiModelProvider(options?: { maxRetries?: number }): ModelProvider {
  return openAiCompatibleModelProvider(OPENAI_PRESETS.openai, options);
}

/** xAI's adapter, for Grok. */
export function xaiModelProvider(options?: { maxRetries?: number }): ModelProvider {
  return openAiCompatibleModelProvider(OPENAI_PRESETS.xai, options);
}

/** Meta's adapter, for Muse Spark: a preview, in the US only. */
export function metaModelProvider(options?: { maxRetries?: number }): ModelProvider {
  return openAiCompatibleModelProvider(OPENAI_PRESETS.meta, options);
}

/** The adapter for a server on this computer, such as Ollama, LM Studio or llama.cpp. */
export function localModelProvider(options?: { maxRetries?: number }): ModelProvider {
  return openAiCompatibleModelProvider(OPENAI_PRESETS.local, options);
}
