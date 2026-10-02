import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { fakeKeyStore, fakePlatform } from "../test/fakePlatform";
import { DEFAULT_AI_SETTINGS, type AiSettings } from "./aiSettings";
import { aiFailureWords } from "./aiWords";
import { GEMINI_HEADERS, geminiModelProvider } from "./gemini";
import { BUNDLED_CATALOG } from "./modelCatalog";
import { MODEL_PROVIDERS } from "./modelProviders";
import type { Connection, ModelProviderFailure, ModelSelection, Suggestion, SuggestionRequest } from "./modelProvider";
import { ModelProviderError } from "./modelProvider";
import { listModels, requestSuggestion } from "./requests";
import { SUGGESTION_INSTRUCTIONS, SUGGESTION_SCHEMA, suggestionPrompt } from "./suggestionRequest";

// Every test answers through a fake `fetch`: nothing here reaches the Gemini API.

/** A request the SDK made through the connection's `fetch`, its body parsed. */
interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A connection, with the API key `key`, whose `fetch` answers each request with `respond`, logging it. */
function fakeGemini(respond: (sent: Sent, index: number) => Response | Promise<Response>, key = "AIza-user") {
  const sent: Sent[] = [];
  const fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    init.signal?.throwIfAborted();
    const request: Sent = {
      url,
      method: init.method ?? "GET",
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : null,
    };
    sent.push(request);
    return respond(request, sent.length - 1);
  };
  const connection: Connection = { fetch, apiKey: key };
  return { connection, sent, fetch };
}

/** A model as the Gemini API's models API gives it, taking `methods`. */
function gemini(id: string, name: string, version: string, thinking: boolean, methods = ["generateContent", "countTokens"]) {
  return {
    name: `models/${id}`,
    version,
    displayName: name,
    description: `${name}, from Google.`,
    inputTokenLimit: 1_048_576,
    outputTokenLimit: 65_536,
    supportedGenerationMethods: methods,
    thinking,
  };
}

const FLASH = gemini("gemini-3.5-flash", "Gemini 3.5 Flash", "3.5", true);
const FLASH_2_5 = gemini("gemini-2.5-flash", "Gemini 2.5 Flash", "001", true);
const EMBEDDING = gemini("gemini-embedding-001", "Gemini Embedding 001", "001", false, ["embedContent", "countTokens"]);

/** A page of the models API, with `next` the token for the page after it. */
function page(models: unknown[], next?: string): Response {
  return Response.json(next === undefined ? { models } : { models, nextPageToken: next });
}

const SUGGESTION: Suggestion = {
  explanation: "Ours changed the value and Theirs renamed it: keep both.",
  resolution: "let b = 2;",
  confidence: "medium",
};

/** {@link SUGGESTION}, as the adapter gives it, with the tokens the fake answer says it took. */
const ANSWERED: Suggestion = { ...SUGGESTION, usage: { inputTokens: 120, outputTokens: 120 } };

/** A `generateContent` answer with `text`, after a thought summary, stopped for `finishReason`. */
function answer(text: string, finishReason: string | null = "STOP", extra: Record<string, unknown> = {}): Response {
  return Response.json({
    candidates: [
      {
        content: { role: "model", parts: [{ text: "Weighing Ours against Theirs.", thought: true }, { text }] },
        ...(finishReason === null ? {} : { finishReason }),
        index: 0,
        ...extra,
      },
    ],
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 80, thoughtsTokenCount: 40, totalTokenCount: 240 },
    modelVersion: "gemini-3.5-flash",
    responseId: "resp-01",
  });
}

/** An error as the Gemini API answers one, with `status`. */
function apiError(code: number, status: string, message: string, details: unknown[] = []): Response {
  return Response.json({ error: { code, message, status, details } }, { status: code });
}

const request: SuggestionRequest = {
  path: "src/lanes.rs",
  base: ["let a = 1;"],
  ours: ["let a = 2;"],
  theirs: ["let b = 1;"],
  before: ["fn main() {"],
  after: ["}"],
  oursSubject: "Change a",
  theirsSubject: "Rename a",
};

const selection: ModelSelection = { model: "gemini-flash", version: "gemini-3.5-flash", effort: "high", budget: null };

/** The failure `promise` rejected with. */
async function failureOf(promise: Promise<unknown>): Promise<ModelProviderFailure> {
  const failure = await promise.then(
    () => {
      throw new Error("It didn't fail");
    },
    (error: unknown) => error,
  );
  if (!(failure instanceof ModelProviderError)) throw failure;
  return failure.failure;
}

const provider = geminiModelProvider({ maxRetries: 0 });

beforeEach(() => {
  // What an environment may hold for the SDK, none of which it may use.
  vi.stubEnv("GOOGLE_API_KEY", "AIza-environment");
  vi.stubEnv("GOOGLE_GENAI_USE_VERTEXAI", "true");
  vi.stubEnv("GOOGLE_CLOUD_PROJECT", "someone-else");
  vi.stubEnv("GOOGLE_CLOUD_LOCATION", "us-central1");
  vi.stubEnv("GOOGLE_GEMINI_BASE_URL", "https://gateway.invalid");
  vi.stubEnv("GOOGLE_VERTEX_BASE_URL", "https://vertex.invalid");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the Gemini Model Provider", () => {
  test("is offered in Settings, sending to generativelanguage.googleapis.com, with its API-key page and the catalog's section", () => {
    const offered = MODEL_PROVIDERS.find(({ id }) => id === "gemini");

    expect(offered).toMatchObject({
      id: "gemini",
      name: "Google (Gemini)",
      apiKeyPage: "https://aistudio.google.com/apikey",
      host: "generativelanguage.googleapis.com",
      catalog: "gemini",
    });
    expect(BUNDLED_CATALOG.sections.gemini).toBeDefined();
  });

  test("sends only the user's API key and the headers it needs, to the Gemini API, whatever the environment says", async () => {
    // The SDK's Node build warns when it finds both, though it uses neither.
    vi.stubEnv("GEMINI_API_KEY", "AIza-environment-too");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { connection, sent } = fakeGemini(() => page([FLASH]));

    await provider.listModels(connection);
    await provider.suggest(request, selection, fakeGemini(() => answer(JSON.stringify(SUGGESTION))).connection);

    expect(sent).toHaveLength(1);
    expect(new URL(sent[0]?.url ?? "").origin).toBe("https://generativelanguage.googleapis.com");
    expect(Object.keys(sent[0]?.headers ?? {}).toSorted()).toEqual(["content-type", "x-goog-api-key"]);
    expect(GEMINI_HEADERS).toEqual(["content-type", "x-goog-api-key"]);
    expect(sent[0]?.headers["x-goog-api-key"]).toBe("AIza-user");
    expect(sent[0]?.url).not.toMatch(/key=/);
    expect(JSON.stringify(sent)).not.toMatch(/environment|someone-else|vertex|genai-js|gl-node/);
    expect(new Set(warn.mock.calls.flat())).toEqual(new Set(["Both GOOGLE_API_KEY and GEMINI_API_KEY are set. Using GOOGLE_API_KEY."]));
  });

  test("without an API key, asks nothing and says the key is missing, never looking for credentials of its own", async () => {
    const { fetch, sent } = fakeGemini(() => page([]));

    await expect(failureOf(provider.listModels({ fetch, apiKey: null }))).resolves.toEqual({ kind: "keyRefused" });
    await expect(failureOf(provider.suggest(request, selection, { fetch, apiKey: null }))).resolves.toEqual({ kind: "keyRefused" });
    expect(sent).toEqual([]);
  });
});

describe("listModels", () => {
  test("reads every page of the models API, keeping the chat-capable models with their display names and versions", async () => {
    const { connection, sent } = fakeGemini((_, index) => (index === 0 ? page([FLASH, EMBEDDING], "page-2") : page([FLASH_2_5])));

    const models = await provider.listModels(connection);

    expect(models).toEqual([
      { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", version: "3.5", created: null, efforts: null },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", version: "001", created: null, efforts: null },
    ]);
    const urls = sent.map(({ url }) => new URL(url));
    expect(urls.map(({ pathname }) => pathname)).toEqual(["/v1beta/models", "/v1beta/models"]);
    expect(urls.map(({ searchParams }) => [searchParams.get("pageSize"), searchParams.get("pageToken")])).toEqual([
      ["1000", null],
      ["1000", "page-2"],
    ]);
    expect(sent.map(({ method }) => method)).toEqual(["GET", "GET"]);
  });

  test("says a model that doesn't think takes no effort", async () => {
    const { connection } = fakeGemini(() => page([gemini("gemini-2.0-flash", "Gemini 2.0 Flash", "2.0", false)]));

    await expect(provider.listModels(connection)).resolves.toEqual([
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", version: "2.0", created: null, efforts: [] },
    ]);
  });

  test("with the catalog, groups Gemini's models under their own names, with their own efforts and defaults", async () => {
    const { platform } = fakePlatform({
      commands: fakeKeyStore({ gemini: "AIza-user" }).commands,
      fetch: () => page([FLASH, FLASH_2_5, EMBEDDING]),
    });
    const settings: AiSettings = { ...DEFAULT_AI_SETTINGS, enabled: true, disclosed: ["gemini"] };

    const models = await listModels(platform, provider, settings, BUNDLED_CATALOG);

    expect(models.map(({ name, versions }) => [name, versions.map((each) => [each.name, each.efforts, each.defaultEffort])])).toEqual([
      [
        "Gemini Flash",
        [
          ["Gemini 3.5 Flash", ["minimal", "low", "medium", "high"], "medium"],
          ["Gemini 2.5 Flash", ["off", "low", "medium", "high"], null],
        ],
      ],
    ]);
  });
});

describe("suggest", () => {
  test("asks generateContent for the Suggestion's JSON Schema, with the effort chosen, and reads the Suggestion", async () => {
    const { connection, sent } = fakeGemini(() => answer(JSON.stringify(SUGGESTION)));

    const suggestion = await provider.suggest(request, selection, connection);

    expect(suggestion).toEqual(ANSWERED);
    expect(sent.map(({ url, method }) => [url, method])).toEqual([
      ["https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent", "POST"],
    ]);
    expect(sent[0]?.body).toEqual({
      contents: [{ role: "user", parts: [{ text: suggestionPrompt(request) }] }],
      systemInstruction: { role: "user", parts: [{ text: SUGGESTION_INSTRUCTIONS }] },
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: SUGGESTION_SCHEMA,
        thinkingConfig: { thinkingLevel: "HIGH" },
      },
    });
    expect(sent[0]?.headers["content-type"]).toBe("application/json");
  });

  test.each<[ModelSelection["effort"], number | null, unknown]>([
    ["minimal", null, { thinkingLevel: "MINIMAL" }],
    ["low", null, { thinkingLevel: "LOW" }],
    ["medium", null, { thinkingLevel: "MEDIUM" }],
    ["high", null, { thinkingLevel: "HIGH" }],
    ["off", 0, { thinkingBudget: 0 }],
    ["low", 1024, { thinkingBudget: 1024 }],
    ["high", 24576, { thinkingBudget: 24576 }],
    [null, null, undefined],
    ["off", null, undefined],
    ["extraHigh", null, undefined],
    ["maximum", null, undefined],
  ])("sends the effort %s, with the budget %s, as the thinking config %o", async (effort, budget, sentAs) => {
    const { connection, sent } = fakeGemini(() => answer(JSON.stringify(SUGGESTION)));

    await provider.suggest(request, { ...selection, effort, budget }, connection);

    const body = sent[0]?.body as { generationConfig: Record<string, unknown> };
    expect(body.generationConfig.thinkingConfig).toEqual(sentAs);
    expect("thinkingConfig" in body.generationConfig).toBe(sentAs !== undefined);
  });

  test("reads an answer with no finish reason, never its thoughts", async () => {
    const { connection } = fakeGemini(() => answer(JSON.stringify(SUGGESTION), null));

    await expect(provider.suggest(request, selection, connection)).resolves.toEqual(ANSWERED);
  });

  test.each([
    ["isn't JSON", "Here's the resolution: let b = 2;", "Its answer wasn't JSON."],
    ["isn't a Suggestion", JSON.stringify({ ...SUGGESTION, confidence: "certain" }), "The Model Provider's answer wasn't a Suggestion."],
  ])("fails when its answer %s", async (_, text, message) => {
    const { connection } = fakeGemini(() => answer(text));

    await expect(failureOf(provider.suggest(request, selection, connection))).resolves.toEqual({ kind: "unexpectedResponse", message });
  });

  test("fails when it gives no answer at all", async () => {
    const { connection } = fakeGemini(() => Response.json({ candidates: [], modelVersion: "gemini-3.5-flash" }));

    await expect(failureOf(provider.suggest(request, selection, connection))).resolves.toEqual({
      kind: "unexpectedResponse",
      message: "It gave no answer.",
    });
  });

  test.each([
    ["SAFETY", "Gemini's safety filters stopped it."],
    ["RECITATION", "Its answer was too close to text it learned from."],
    ["BLOCKLIST", "It had a term Gemini blocks."],
    ["PROHIBITED_CONTENT", "Gemini found content it prohibits."],
    ["SPII", "Its answer may have held sensitive personal information."],
  ])("says the model declined, saying what it means, when it stops for %s", async (finishReason, explanation) => {
    const { connection } = fakeGemini(() => answer("", finishReason));

    const failure = await failureOf(provider.suggest(request, selection, connection));

    expect(failure).toEqual({ kind: "declined", explanation });
    expect(aiFailureWords(new ModelProviderError(failure), () => "Google (Gemini)")).toBe(
      `The model declined to make a Suggestion for this Conflict Hunk. ${explanation} ` +
        "Resolve it by hand, or choose another model in Settings.",
    );
  });

  test.each([
    ["PROHIBITED_CONTENT", "Gemini found content it prohibits."],
    ["OTHER", null],
  ])("says the model declined when Gemini blocks the prompt itself, for %s", async (blockReason, explanation) => {
    const { connection } = fakeGemini(() => Response.json({ promptFeedback: { blockReason } }));

    await expect(failureOf(provider.suggest(request, selection, connection))).resolves.toEqual({ kind: "declined", explanation });
  });

  test.each([
    ["MAX_TOKENS", "It stopped before the Suggestion was finished. A lower Effort may leave it room."],
    ["MALFORMED_FUNCTION_CALL", "It stopped before it finished, for MALFORMED_FUNCTION_CALL."],
    ["OTHER", "It stopped before it finished, for OTHER."],
  ])("says so when it stops for %s, with half an answer", async (finishReason, message) => {
    const { connection } = fakeGemini(() => answer('{"explanation": "Ours chan', finishReason));

    await expect(failureOf(provider.suggest(request, selection, connection))).resolves.toEqual({ kind: "unexpectedResponse", message });
  });
});

describe("failures", () => {
  const KEY_INVALID = [
    { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID", domain: "googleapis.com" },
    { "@type": "type.googleapis.com/google.rpc.LocalizedMessage", locale: "en-US", message: "API key not valid. Please pass a valid API key." },
  ];

  test.each<[string, Response, ModelProviderFailure]>([
    ["an API key it refuses", apiError(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key.", KEY_INVALID), { kind: "keyRefused" }],
    ["credentials it won't take", apiError(401, "UNAUTHENTICATED", "Request had invalid authentication credentials."), { kind: "keyRefused" }],
    ["too many requests", apiError(429, "RESOURCE_EXHAUSTED", "You exceeded your current quota."), { kind: "rateLimited" }],
    [
      "a key without access",
      apiError(403, "PERMISSION_DENIED", "Method doesn't allow unregistered callers."),
      { kind: "rejected", message: "Method doesn't allow unregistered callers." },
    ],
    [
      "a model that isn't there",
      apiError(404, "NOT_FOUND", "models/gemini-gone is not found for API version v1beta."),
      { kind: "rejected", message: "models/gemini-gone is not found for API version v1beta." },
    ],
    [
      "a request it won't take",
      apiError(400, "INVALID_ARGUMENT", "Thinking level MINIMAL is not supported for this model."),
      { kind: "rejected", message: "Thinking level MINIMAL is not supported for this model." },
    ],
    [
      "being overloaded",
      apiError(503, "UNAVAILABLE", "The model is overloaded. Please try again later."),
      { kind: "unavailable", message: "The model is overloaded. Please try again later." },
    ],
    ["failing on its side", apiError(500, "INTERNAL", "An internal error has occurred."), { kind: "unavailable", message: "An internal error has occurred." }],
  ])("tells %s by the status and reason of the SDK's ApiError", async (_, response, failure) => {
    const { connection } = fakeGemini(() => response.clone());

    await expect(failureOf(provider.suggest(request, selection, connection))).resolves.toEqual(failure);
    await expect(failureOf(provider.listModels(fakeGemini(() => response.clone()).connection))).resolves.toEqual(failure);
    expect(aiFailureWords(new ModelProviderError(failure), () => "Google (Gemini)")).not.toMatch(/AIza|undefined|\[object|\{/);
  });

  test("says Gemini's answer wasn't JSON when it isn't", async () => {
    const { connection } = fakeGemini(() => new Response("<html>Bad gateway</html>", { status: 200 }));

    await expect(failureOf(provider.suggest(request, selection, connection))).resolves.toEqual({
      kind: "unexpectedResponse",
      message: "Its answer wasn't JSON.",
    });
  });

  test("says Gemini couldn't be reached when the request can't be made", async () => {
    const { connection } = fakeGemini(() => {
      throw new TypeError("error sending request: dns error");
    });

    await expect(failureOf(provider.listModels(connection))).resolves.toEqual({
      kind: "unreachable",
      message: "error sending request: dns error",
    });
  });

  test("tries again after an overloaded answer", async () => {
    const { connection, sent } = fakeGemini((_, index) =>
      index === 0 ? apiError(503, "UNAVAILABLE", "The model is overloaded.") : answer(JSON.stringify(SUGGESTION)),
    );

    await expect(geminiModelProvider({ retryDelay: 0.001 }).suggest(request, selection, connection)).resolves.toEqual(ANSWERED);
    expect(sent).toHaveLength(2);
  });

  test("never tries again after an answer that won't change", async () => {
    const { connection, sent } = fakeGemini(() => apiError(400, "INVALID_ARGUMENT", "Bad request."));

    await expect(failureOf(geminiModelProvider({ retryDelay: 0.001 }).suggest(request, selection, connection))).resolves.toEqual({
      kind: "rejected",
      message: "Bad request.",
    });
    expect(sent).toHaveLength(1);
  });

  test("an aborted request is thrown on as the abort, not as a failure", async () => {
    const { connection, sent } = fakeGemini(() => answer(JSON.stringify(SUGGESTION)));
    const controller = new AbortController();
    controller.abort();

    const asked = geminiModelProvider({ retryDelay: 0.001 }).suggest(request, selection, { ...connection, signal: controller.signal });

    await expect(asked).rejects.toMatchObject({ name: "AbortError" });
    expect(sent).toEqual([]);
  });
});

/** Gemini 2.5 Flash chosen with thinking Off. */
const geminiFlash: AiSettings = {
  ...DEFAULT_AI_SETTINGS,
  enabled: true,
  disclosed: ["gemini"],
  global: { provider: "gemini", model: "gemini-flash", version: "gemini-2.5-flash", effort: "off" },
};

/** A platform with a key kept for Gemini, whose `fetch` answers as its models API and `generateContent` do. */
function setUpGemini() {
  const api = fakeGemini((sent) =>
    new URL(sent.url).pathname === "/v1beta/models" ? page([FLASH, FLASH_2_5]) : answer(JSON.stringify(SUGGESTION)),
  );
  const { platform } = fakePlatform({ commands: fakeKeyStore({ gemini: "AIza-kept" }).commands, fetch: api.fetch });
  return { api, platform };
}

describe("requestSuggestion", () => {
  test("asks Gemini with the API key kept for it, sending an older model's effort as the catalog's token budget", async () => {
    const { api, platform } = setUpGemini();

    const suggestion = await requestSuggestion({
      platform,
      providers: [provider],
      settings: geminiFlash,
      catalog: BUNDLED_CATALOG,
      repository: null,
      request,
    });

    expect(suggestion).toEqual(ANSWERED);
    expect(api.sent.map(({ url, headers }) => [new URL(url).pathname, headers["x-goog-api-key"]])).toEqual([
      ["/v1beta/models", "AIza-kept"],
      ["/v1beta/models/gemini-2.5-flash:generateContent", "AIza-kept"],
    ]);
    expect(api.sent[1]?.body).toMatchObject({
      generationConfig: { responseJsonSchema: SUGGESTION_SCHEMA, thinkingConfig: { thinkingBudget: 0 } },
    });
  });

  test("sends a newer model's effort as its thinking level", async () => {
    const { api, platform } = setUpGemini();

    await requestSuggestion({
      platform,
      providers: [provider],
      settings: { ...geminiFlash, global: { provider: "gemini", model: "gemini-flash", version: "gemini-3.5-flash", effort: "minimal" } },
      catalog: BUNDLED_CATALOG,
      repository: null,
      request,
    });

    expect(api.sent[1]?.body).toMatchObject({ generationConfig: { thinkingConfig: { thinkingLevel: "MINIMAL" } } });
    expect(api.sent[1]?.body).not.toHaveProperty("generationConfig.thinkingConfig.thinkingBudget");
  });

  test("sends Gemini 2.5's high effort as the catalog's budget for it", async () => {
    const { api, platform } = setUpGemini();

    await requestSuggestion({
      platform,
      providers: [provider],
      settings: { ...geminiFlash, global: { provider: "gemini", model: "gemini-flash", version: "gemini-2.5-flash", effort: "high" } },
      catalog: BUNDLED_CATALOG,
      repository: null,
      request,
    });

    expect(api.sent[1]?.body).toMatchObject({ generationConfig: { thinkingConfig: { thinkingBudget: 24576 } } });
  });
});
