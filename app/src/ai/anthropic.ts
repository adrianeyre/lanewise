import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AnthropicError,
  AuthenticationError,
  InternalServerError,
  RateLimitError,
} from "@anthropic-ai/sdk";

import { ANTHROPIC_EFFORTS, type AnthropicEffort, anthropicModels } from "./modelLists";
import { ANTHROPIC_API, ANTHROPIC_DETAILS } from "./modelProviderDetails";
import {
  type Connection,
  type Effort,
  type ModelProvider,
  ModelProviderError,
  type Suggestion,
} from "./modelProvider";
import { SUGGESTION_INSTRUCTIONS, SUGGESTION_SCHEMA, jsonIn, readSuggestion, suggestionPrompt } from "./suggestionRequest";

/**
 * The Anthropic Model Provider: Claude, through the official
 * `@anthropic-ai/sdk` (PRD §8.3, ADR 0022). The SDK makes each request
 * through the connection's `fetch`, with the user's own API key and nothing
 * else of this computer's: no key, token, base URL, header or log level from
 * the environment, and none of the headers the SDK would add about the OS.
 */

/**
 * The only headers a request to Anthropic carries. The SDK adds others, about
 * the OS, its runtime and its retries, and any `ANTHROPIC_CUSTOM_HEADERS`
 * where there's an environment to read; none of those are sent.
 */
export const ANTHROPIC_HEADERS: readonly string[] = ["accept", "content-type", "anthropic-version", "x-api-key"];

/**
 * The most a Suggestion's answer may take, thinking included. It's as much
 * as the SDK lets a request that isn't streamed ask for comfortably, and far
 * more than one Conflict Hunk needs.
 */
export const MAX_TOKENS = 16_000;

/** Each effort Anthropic's API takes, by the words the picker shows. The rest it doesn't take. */
const API_EFFORTS: ReadonlyMap<Effort, AnthropicEffort> = new Map(ANTHROPIC_EFFORTS.map(([api, level]) => [level, api]));

/** The connection's `fetch`, handed the SDK's request with only {@link ANTHROPIC_HEADERS}. */
function connectionFetch(connection: Connection): (url: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return (url, init = {}) => {
    const given = new Headers(init.headers);
    const headers = new Headers();
    for (const name of ANTHROPIC_HEADERS) {
      const value = given.get(name);
      if (value !== null) headers.set(name, value);
    }
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    return connection.fetch(href, { method: init.method, headers, body: init.body, signal: init.signal });
  };
}

/** The SDK's client for one request through `connection`. */
function client(connection: Connection, maxRetries: number): Anthropic {
  // Without a key the SDK would look for credentials of its own; there's always one here.
  if (connection.apiKey === null) throw new ModelProviderError({ kind: "keyRefused" });
  return new Anthropic({
    apiKey: connection.apiKey,
    authToken: null,
    baseURL: ANTHROPIC_API,
    fetch: connectionFetch(connection),
    maxRetries,
    logLevel: "off",
    // The webview looks like a browser to the SDK, but the request is made
    // from the shell, with the user's own key, which never leaves this computer
    // but for Anthropic.
    dangerouslyAllowBrowser: true,
  });
}

type Fields = Record<string, unknown>;

function fields(value: unknown): Fields | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : null;
}

/** What Anthropic's API said was wrong, from its error's body, or else the SDK's own message. */
function apiMessage(error: APIError): string {
  const said = fields(fields(error.error)?.error)?.message;
  return typeof said === "string" && said !== "" ? said : error.message;
}

/**
 * What `error`, thrown by the SDK, means, by its typed class. An abort is
 * thrown on as it is, since nothing failed.
 */
function failureOf(error: unknown): unknown {
  if (error instanceof ModelProviderError || error instanceof APIUserAbortError) return error;
  if (error instanceof APIConnectionTimeoutError) {
    return new ModelProviderError({ kind: "unreachable", message: "It didn't answer in time." });
  }
  if (error instanceof APIConnectionError) {
    const cause = error.cause instanceof Error ? error.cause.message : error.message;
    return new ModelProviderError({ kind: "unreachable", message: cause });
  }
  if (error instanceof AuthenticationError) return new ModelProviderError({ kind: "keyRefused" });
  if (error instanceof RateLimitError) return new ModelProviderError({ kind: "rateLimited" });
  if (error instanceof InternalServerError) {
    return new ModelProviderError({ kind: "unavailable", message: apiMessage(error) });
  }
  if (error instanceof APIError) {
    // 402 is Anthropic's billing error, which the SDK has no class of its own for.
    if (error.status === 402) return new ModelProviderError({ kind: "rateLimited" });
    return new ModelProviderError({ kind: "rejected", message: apiMessage(error) });
  }
  if (error instanceof AnthropicError) {
    return new ModelProviderError({ kind: "unexpectedResponse", message: error.message });
  }
  return error;
}

/** The Suggestion in Claude's answer, once it's said why it stopped. */
function suggestionIn(message: Anthropic.Message): Suggestion {
  switch (message.stop_reason) {
    case "refusal":
      throw new ModelProviderError({ kind: "declined", explanation: message.stop_details?.explanation ?? null });
    case "max_tokens":
      throw new ModelProviderError({
        kind: "unexpectedResponse",
        message: "It stopped before the Suggestion was finished. A lower Effort may leave it room.",
      });
    case "model_context_window_exceeded":
      throw new ModelProviderError({
        kind: "unexpectedResponse",
        message: "The Conflict Hunk and the lines round it are too long for this model. Send fewer lines of context.",
      });
    default:
      break;
  }
  const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  // The schema holds the answer to JSON on the models that take it. A model
  // that doesn't, such as Claude Opus 4.7 or 4.6, may still write it inside a
  // Markdown code block or after a sentence, so the object it wrote is read
  // wherever it is, and `readSuggestion` checks it's a Suggestion.
  const output = jsonIn(text, true);
  if (output === undefined) {
    throw new ModelProviderError({ kind: "unexpectedResponse", message: "Its answer wasn't JSON." });
  }
  const { usage } = message;
  return { ...readSuggestion(output), usage: usage ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } : null };
}

/**
 * The Anthropic adapter. `maxRetries` is how often the SDK tries a request
 * again after a failure that may pass, such as an overloaded API: its own
 * default of 2 unless a test says otherwise.
 */
export function anthropicModelProvider({ maxRetries = 2 }: { maxRetries?: number } = {}): ModelProvider {
  return {
    ...ANTHROPIC_DETAILS,

    /** Every page of the Models API, each model with its display name and `capabilities.effort` levels. */
    async listModels(connection) {
      const anthropic = client(connection, maxRetries);
      const data: unknown[] = [];
      try {
        // The SDK asks for each page after the last, from its `last_id`, while it `has_more`.
        for await (const model of anthropic.models.list({ limit: 1000 }, { signal: connection.signal })) data.push(model);
      } catch (error) {
        throw failureOf(error);
      }
      return anthropicModels({ data }).models;
    },

    /**
     * One Messages API request, with the Suggestion's JSON Schema as
     * `output_config.format` and the effort chosen, if any, as
     * `output_config.effort`. Thinking is left as the model has it by
     * default: adaptive on the models that take it.
     */
    async suggest(request, selection, connection) {
      const anthropic = client(connection, maxRetries);
      const effort = selection.effort === null ? undefined : API_EFFORTS.get(selection.effort);
      let message: Anthropic.Message;
      try {
        message = await anthropic.messages.create(
          {
            model: selection.version,
            max_tokens: MAX_TOKENS,
            system: SUGGESTION_INSTRUCTIONS,
            messages: [{ role: "user", content: suggestionPrompt(request) }],
            output_config: {
              format: { type: "json_schema", schema: SUGGESTION_SCHEMA },
              ...(effort === undefined ? {} : { effort }),
            },
          },
          { signal: connection.signal },
        );
      } catch (error) {
        throw failureOf(error);
      }
      return suggestionIn(message);
    },
  };
}
