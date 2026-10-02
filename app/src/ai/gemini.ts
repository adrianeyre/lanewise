import {
  ApiError,
  BlockedReason,
  FinishReason,
  type GenerateContentResponse,
  GoogleGenAI,
  type ThinkingConfig,
  ThinkingLevel,
} from "@google/genai";

import { geminiModels } from "./modelLists";
import { GEMINI_API, GEMINI_DETAILS } from "./modelProviderDetails";
import {
  type Connection,
  type Effort,
  type ModelProvider,
  ModelProviderError,
  type ModelSelection,
  type Suggestion,
} from "./modelProvider";
import { SUGGESTION_INSTRUCTIONS, SUGGESTION_SCHEMA, jsonIn, readSuggestion, suggestionPrompt } from "./suggestionRequest";

/**
 * The Gemini Model Provider: Google's Gemini models, through the official
 * `@google/genai` SDK and the Gemini API's own endpoints, never Google's
 * OpenAI-compatible layer, which is a beta and silently ignores settings it
 * doesn't take (PRD §8.3, ADR 0023). The SDK makes each request through the
 * connection's `fetch`, with the user's own API key and nothing else of this
 * computer's: no key, project, base URL or Vertex AI switch from the
 * environment, and none of the headers the SDK would add about itself.
 */

/**
 * The Gemini API's version the adapter speaks: the SDK's own default, set
 * here so nothing else can change it. It's the one that takes
 * `responseJsonSchema` and `thinkingLevel`.
 */
export const GEMINI_API_VERSION = "v1beta";

/**
 * The only headers a request to Gemini carries. The SDK adds others, about
 * itself and its runtime (`user-agent` and `x-goog-api-client`); those
 * aren't sent.
 */
export const GEMINI_HEADERS: readonly string[] = ["content-type", "x-goog-api-key"];

/** Each effort the Gemini API takes as a `thinkingLevel`, by the words the picker shows. */
const THINKING_LEVELS: ReadonlyMap<Effort, ThinkingLevel> = new Map([
  ["minimal", ThinkingLevel.MINIMAL],
  ["low", ThinkingLevel.LOW],
  ["medium", ThinkingLevel.MEDIUM],
  ["high", ThinkingLevel.HIGH],
]);

/**
 * Why Gemini stops, or blocks a prompt, that means it declined to answer,
 * rather than that something failed, each with what it means. The Gemini
 * API says no more than the reason: the SDK's `finishMessage` and
 * `blockReasonMessage` are Vertex AI's alone.
 */
const DECLINED: ReadonlyMap<string, string> = new Map([
  ["SAFETY", "Gemini's safety filters stopped it."],
  ["RECITATION", "Its answer was too close to text it learned from."],
  ["BLOCKLIST", "It had a term Gemini blocks."],
  ["PROHIBITED_CONTENT", "Gemini found content it prohibits."],
  ["SPII", "Its answer may have held sensitive personal information."],
]);

/**
 * The connection's `fetch`, handed the SDK's request with only
 * {@link GEMINI_HEADERS}. A request that can't be made, but for an abort,
 * is Gemini being unreachable.
 */
function connectionFetch(connection: Connection): (url: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (url, init = {}) => {
    const given = new Headers(init.headers);
    const headers = new Headers();
    for (const name of GEMINI_HEADERS) {
      const value = given.get(name);
      if (value !== null) headers.set(name, value);
    }
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    try {
      return await connection.fetch(href, { method: init.method, headers, body: init.body, signal: init.signal });
    } catch (error) {
      if (connection.signal?.aborted === true) throw error;
      throw new ModelProviderError({ kind: "unreachable", message: error instanceof Error ? error.message : String(error) });
    }
  };
}

/** The SDK's client for one request through `connection`. */
function client(connection: Connection, { maxRetries, retryDelay }: Retries): GoogleGenAI {
  // Without a key the SDK would look for credentials of its own; there's always one here.
  if (connection.apiKey === null) throw new ModelProviderError({ kind: "keyRefused" });
  return new GoogleGenAI({
    apiKey: connection.apiKey,
    // Said outright, so `GOOGLE_GENAI_USE_VERTEXAI` can't send the key to Vertex AI.
    vertexai: false,
    apiVersion: GEMINI_API_VERSION,
    httpOptions: {
      baseUrl: GEMINI_API,
      fetch: connectionFetch(connection),
      retryOptions: { attempts: maxRetries + 1, initialDelay: retryDelay },
    },
  });
}

type Fields = Record<string, unknown>;

function fields(value: unknown): Fields | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : null;
}

/** The `error` in the Gemini API's answer, which the SDK hands on as its error's message, as JSON. */
function apiBody(error: ApiError): Fields | null {
  try {
    return fields(fields(JSON.parse(error.message))?.error);
  } catch {
    return null;
  }
}

/** What the Gemini API said was wrong, or else the SDK's own message. */
function apiMessage(body: Fields | null, error: ApiError): string {
  const said = body?.message;
  return typeof said === "string" && said !== "" ? said : error.message;
}

/** Whether the Gemini API said the key isn't one: it answers 400, `API_KEY_INVALID`, rather than 401. */
function keyInvalid(body: Fields | null): boolean {
  const details = Array.isArray(body?.details) ? body.details : [];
  return details.some((detail) => fields(detail)?.reason === "API_KEY_INVALID");
}

/**
 * What `error`, thrown by the SDK, means, by the status its `ApiError`
 * carries. An abort is thrown on as it is, since nothing failed.
 */
function failureOf(error: unknown, connection: Connection): unknown {
  if (error instanceof ModelProviderError || connection.signal?.aborted === true) return error;
  if (error instanceof ApiError) {
    const body = apiBody(error);
    if (error.status === 401 || keyInvalid(body)) return new ModelProviderError({ kind: "keyRefused" });
    // 429 is Gemini's RESOURCE_EXHAUSTED: too many requests, or a spend limit reached.
    if (error.status === 429) return new ModelProviderError({ kind: "rateLimited" });
    if (error.status >= 500) return new ModelProviderError({ kind: "unavailable", message: apiMessage(body, error) });
    return new ModelProviderError({ kind: "rejected", message: apiMessage(body, error) });
  }
  // The SDK reads every answer as JSON, whatever came back.
  if (error instanceof SyntaxError) {
    return new ModelProviderError({ kind: "unexpectedResponse", message: "Its answer wasn't JSON." });
  }
  return error;
}

/**
 * How hard `selection` asks the model to think, as the Gemini API takes it:
 * the token budget the model catalog gives, for a model that takes one, such
 * as Gemini 2.5, or else the effort as a `thinkingLevel`. With no effort
 * chosen, or one Gemini has no level for, nothing is said, and the model's
 * own default applies.
 */
export function thinkingConfig(selection: ModelSelection): ThinkingConfig | undefined {
  if (selection.effort === null) return undefined;
  if (selection.budget !== null) return { thinkingBudget: selection.budget };
  const level = THINKING_LEVELS.get(selection.effort);
  return level === undefined ? undefined : { thinkingLevel: level };
}

/** The model declined, for `reason`, saying what that means where it's known. */
function declined(reason: string): ModelProviderError {
  return new ModelProviderError({ kind: "declined", explanation: DECLINED.get(reason) ?? null });
}

/** The Suggestion in Gemini's answer, once it's said why it stopped. */
function suggestionIn(response: GenerateContentResponse): Suggestion {
  // A prompt Gemini blocked has no answer at all.
  const blocked = response.promptFeedback?.blockReason;
  if (blocked !== undefined && blocked !== BlockedReason.BLOCKED_REASON_UNSPECIFIED) throw declined(blocked);
  const [candidate] = response.candidates ?? [];
  if (candidate === undefined) {
    throw new ModelProviderError({ kind: "unexpectedResponse", message: "It gave no answer." });
  }
  const reason = candidate.finishReason;
  if (reason !== undefined && DECLINED.has(reason)) throw declined(reason);
  if (reason === FinishReason.MAX_TOKENS) {
    throw new ModelProviderError({
      kind: "unexpectedResponse",
      message: "It stopped before the Suggestion was finished. A lower Effort may leave it room.",
    });
  }
  if (reason !== undefined && reason !== FinishReason.STOP) {
    throw new ModelProviderError({ kind: "unexpectedResponse", message: `It stopped before it finished, for ${reason}.` });
  }
  // Only the answer's text: never a thought summary, were there one.
  const text = (candidate.content?.parts ?? []).flatMap((part) => (part.thought !== true && typeof part.text === "string" ? [part.text] : [])).join("");
  // As for Claude: the object the model wrote, wherever it is, which `readSuggestion` checks.
  const output = jsonIn(text, true);
  if (output === undefined) {
    throw new ModelProviderError({ kind: "unexpectedResponse", message: "Its answer wasn't JSON." });
  }
  const metadata = response.usageMetadata;
  return {
    ...readSuggestion(output),
    usage: metadata
      ? {
          inputTokens: metadata.promptTokenCount ?? 0,
          outputTokens: (metadata.candidatesTokenCount ?? 0) + (metadata.thoughtsTokenCount ?? 0),
        }
      : null,
  };
}

/** How the SDK tries a request again. */
interface Retries {
  /** How often, after the first try. */
  maxRetries: number;
  /** How long it waits before the first retry, in seconds, twice as long each time after. */
  retryDelay: number;
}

/**
 * The Gemini adapter. `maxRetries` is how often the SDK tries a request
 * again after a failure that may pass, such as a 503 or a connection
 * failing: 2, as the Anthropic adapter's SDK does, unless a test says
 * otherwise, after `retryDelay` seconds and then twice as long.
 */
export function geminiModelProvider({ maxRetries = 2, retryDelay = 1 }: Partial<Retries> = {}): ModelProvider {
  const retries = { maxRetries, retryDelay };
  return {
    ...GEMINI_DETAILS,

    /**
     * Every page of the Gemini API's `models.list`, each chat-capable model
     * with its display name, version and whether it thinks.
     */
    async listModels(connection) {
      const gemini = client(connection, retries);
      const models: unknown[] = [];
      try {
        // The SDK asks for each page after the last, from its `nextPageToken`.
        const pager = await gemini.models.list({ config: { pageSize: 1000, abortSignal: connection.signal } });
        for await (const model of pager) models.push(model);
      } catch (error) {
        throw failureOf(error, connection);
      }
      return geminiModels({ models }).models;
    },

    /**
     * One `generateContent` request, with the Suggestion's JSON Schema as
     * `responseJsonSchema` and the effort chosen, if any, as
     * `thinkingConfig`.
     */
    async suggest(request, selection, connection) {
      const gemini = client(connection, retries);
      const thinking = thinkingConfig(selection);
      let response: GenerateContentResponse;
      try {
        response = await gemini.models.generateContent({
          model: selection.version,
          contents: suggestionPrompt(request),
          config: {
            systemInstruction: SUGGESTION_INSTRUCTIONS,
            responseMimeType: "application/json",
            responseJsonSchema: SUGGESTION_SCHEMA,
            ...(thinking === undefined ? {} : { thinkingConfig: thinking }),
            abortSignal: connection.signal,
          },
        });
      } catch (error) {
        throw failureOf(error, connection);
      }
      return suggestionIn(response);
    },
  };
}
