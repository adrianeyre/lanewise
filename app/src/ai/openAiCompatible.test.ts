import { APIUserAbortError } from "openai";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { fakeKeyStore, fakePlatform } from "../test/fakePlatform";
import { DEFAULT_AI_SETTINGS, type AiSettings } from "./aiSettings";
import { aiFailureWords } from "./aiWords";
import { BUNDLED_CATALOG } from "./modelCatalog";
import { MODEL_PROVIDERS } from "./modelProviders";
import type { Connection, ModelProviderFailure, ModelSelection, Suggestion, SuggestionRequest } from "./modelProvider";
import { ModelProviderError } from "./modelProvider";
import { LOCAL_API, OPENAI_PRESETS, type OpenAiPreset } from "./modelProviderDetails";
import { OPENAI_HEADERS, openAiCompatibleModelProvider } from "./openAiCompatible";
import { jsonIn } from "./suggestionRequest";
import { listModels, requestSuggestion } from "./requests";
import { SUGGESTION_INSTRUCTIONS, SUGGESTION_SCHEMA, suggestionPrompt } from "./suggestionRequest";

// Every test answers through a fake `fetch`: nothing here reaches a Model Provider's API, or a server on this computer.

/** A request the SDK made through the connection's `fetch`, its body parsed. */
interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A connection, with the API key `key`, whose `fetch` answers each request with `respond`, logging it. */
function fakeApi(respond: (sent: Sent, index: number) => Response | Promise<Response>, key: string | null = "sk-user") {
  const sent: Sent[] = [];
  const fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
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

/** `GET /models`, as OpenAI answers it: a list of models, each with when it was made, never paged. */
function modelList(ids: string[]): Response {
  return Response.json({
    object: "list",
    data: ids.map((id, index) => ({ id, object: "model", created: 1_750_000_000 + index, owned_by: "system" })),
  });
}

const SUGGESTION: Suggestion = {
  explanation: "Ours changed the value and Theirs renamed it: keep both.",
  resolution: "let b = 2;",
  confidence: "medium",
};

/** {@link SUGGESTION}, as the adapter gives it, with the tokens the fake answer says it took. */
const ANSWERED: Suggestion = { ...SUGGESTION, usage: { inputTokens: 120, outputTokens: 80 } };

/** A Chat Completions answer with `content`, stopped for `finishReason`, and the model's `refusal`, if any. */
function answer(content: string | null, finishReason = "stop", refusal: string | null = null): Response {
  return Response.json({
    id: "chatcmpl-01",
    object: "chat.completion",
    created: 1_780_000_000,
    model: "gpt-5.5",
    choices: [{ index: 0, message: { role: "assistant", content, refusal }, finish_reason: finishReason, logprobs: null }],
    usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
  });
}

/** An error as OpenAI's API answers one, with `status`. */
function apiError(status: number, message: string, param: string | null = null, headers: Record<string, string> = {}): Response {
  return Response.json(
    { error: { message, type: "invalid_request_error", param, code: null } },
    { status, headers: { "x-should-retry": "false", ...headers } },
  );
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

const selection: ModelSelection = { model: "gpt", version: "gpt-5.5", effort: "extraHigh", budget: null };

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

/** A fresh adapter for `preset`, remembering nothing, that never tries a request again. */
function adapter(preset: OpenAiPreset = OPENAI_PRESETS.openai) {
  return openAiCompatibleModelProvider(preset, { maxRetries: 0 });
}

/** The `response_format` each request asked for, or `none` where it asked for none. */
function formats(sent: Sent[]): string[] {
  return sent.map(({ body }) => (body as { response_format?: { type: string } }).response_format?.type ?? "none");
}

beforeEach(() => {
  // What an environment may hold for the SDK, none of which it may use.
  vi.stubEnv("OPENAI_API_KEY", "sk-environment");
  vi.stubEnv("OPENAI_ADMIN_KEY", "sk-admin-environment");
  vi.stubEnv("OPENAI_BASE_URL", "https://gateway.invalid/v1");
  vi.stubEnv("OPENAI_ORG_ID", "org-environment");
  vi.stubEnv("OPENAI_PROJECT_ID", "proj-environment");
  vi.stubEnv("OPENAI_WEBHOOK_SECRET", "whsec-environment");
  vi.stubEnv("OPENAI_CUSTOM_HEADERS", "x-from-the-environment: yes\nuser-agent: codex-cli/1.0");
  vi.stubEnv("OPENAI_LOG", "debug");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the OpenAI-compatible Model Providers", () => {
  test.each([
    ["openai", "OpenAI (ChatGPT models)", "https://platform.openai.com/api-keys", "api.openai.com"],
    ["xai", "xAI (Grok)", "https://console.x.ai/team/default/api-keys", "api.x.ai"],
    ["meta", "Meta (Muse Spark), preview, US only", "https://dev.meta.ai/", "api.meta.ai"],
  ])("%s is offered in Settings, needing a key, with its API-key page, host and the catalog's section", (id, name, apiKeyPage, host) => {
    expect(MODEL_PROVIDERS.find((provider) => provider.id === id)).toMatchObject({
      id,
      name,
      key: "required",
      apiKeyPage,
      host,
      defaultBaseUrl: null,
      catalog: id,
    });
    expect(BUNDLED_CATALOG.sections[id]).toBeDefined();
  });

  test("a local server is offered, on this computer, at Ollama's base URL until one is set, with a key only if it asks for one", () => {
    expect(MODEL_PROVIDERS.find((provider) => provider.id === "local")).toMatchObject({
      id: "local",
      name: "Local server (Ollama, LM Studio or llama.cpp)",
      key: "optional",
      apiKeyPage: null,
      host: "this computer",
      defaultBaseUrl: "http://localhost:11434/v1",
      catalog: "local",
    });
    expect(BUNDLED_CATALOG.sections.local).toBeDefined();
  });

  test.each([
    [OPENAI_PRESETS.openai, "https://api.openai.com/v1/models"],
    [OPENAI_PRESETS.xai, "https://api.x.ai/v1/models"],
    [OPENAI_PRESETS.meta, "https://api.meta.ai/v1/models"],
    [OPENAI_PRESETS.local, "http://localhost:11434/v1/models"],
  ])("%o sends only the user's API key and the headers it needs, to %s, whatever the environment says", async (preset, url) => {
    const debug = vi.spyOn(console, "debug");
    const { connection, sent } = fakeApi(() => modelList(["gpt-5.5"]));

    // A base URL set for a cloud Model Provider is never used: its API is always in one place.
    await adapter(preset).listModels({ ...connection, baseUrl: preset.api === null ? undefined : "http://localhost:1234/v1" });

    expect(sent.map((each) => [each.url, each.method])).toEqual([[url, "GET"]]);
    expect(Object.keys(sent[0]?.headers ?? {}).toSorted()).toEqual(
      ["accept", "authorization"].filter((name) => OPENAI_HEADERS.includes(name)),
    );
    expect(sent[0]?.headers.authorization).toBe("Bearer sk-user");
    expect(JSON.stringify(sent)).not.toMatch(/environment|codex-cli|stainless|gateway|organization|project/i);
    expect(debug).not.toHaveBeenCalled();
  });

  test("a cloud Model Provider without an API key asks nothing and says the key is missing, never looking for credentials of its own", async () => {
    const { fetch, sent } = fakeApi(() => modelList([]));

    for (const preset of [OPENAI_PRESETS.openai, OPENAI_PRESETS.xai, OPENAI_PRESETS.meta]) {
      await expect(failureOf(adapter(preset).listModels({ fetch, apiKey: null }))).resolves.toEqual({ kind: "keyRefused" });
    }
    expect(sent).toEqual([]);
  });

  test("a local server is asked without a key where none is kept, sending no authorization at all", async () => {
    const { connection, sent } = fakeApi(() => modelList(["llama3.3:70b"]), null);

    await adapter(OPENAI_PRESETS.local).listModels(connection);

    expect(sent[0]?.headers).not.toHaveProperty("authorization");
    expect(JSON.stringify(sent)).not.toMatch(/no-key|environment/);
  });

  test("a local server is asked at the base URL set for it, and with the key kept for it where it asks for one", async () => {
    const { connection, sent } = fakeApi(() => answer(JSON.stringify(SUGGESTION)), "lm-studio-key");

    await adapter(OPENAI_PRESETS.local).suggest(request, { ...selection, version: "openai/gpt-oss-20b" }, {
      ...connection,
      baseUrl: "http://127.0.0.1:1234/v1",
    });

    expect(sent.map(({ url }) => url)).toEqual(["http://127.0.0.1:1234/v1/chat/completions"]);
    expect(sent[0]?.headers.authorization).toBe("Bearer lm-studio-key");
  });

  test("a local server's base URL is only ever on this computer, so a kept key can't be sent anywhere else", async () => {
    const { connection, sent } = fakeApi(() => modelList([]));

    await expect(
      failureOf(adapter(OPENAI_PRESETS.local).listModels({ ...connection, baseUrl: "https://example.com/v1" })),
    ).resolves.toEqual({ kind: "rejected", message: "Its base URL isn't on this computer. Set it again in Settings." });
    expect(sent).toEqual([]);
  });
});

describe("listModels", () => {
  test("reads GET /models, with each model's ID and when it was made", async () => {
    const { connection } = fakeApi(() => modelList(["gpt-5.5", "gpt-5.4"]));

    await expect(adapter().listModels(connection)).resolves.toEqual([
      { id: "gpt-5.5", name: null, version: null, created: "2025-06-15T15:06:40.000Z", efforts: null },
      { id: "gpt-5.4", name: null, version: null, created: "2025-06-15T15:06:41.000Z", efforts: null },
    ]);
  });

  test.each<[OpenAiPreset, string[], [string, [string, string[], string | null][]][]]>([
    [
      OPENAI_PRESETS.openai,
      ["gpt-5.5", "gpt-5.4", "gpt-image-2", "text-embedding-3-large"],
      [["GPT", [["GPT-5.5", ["off", "low", "medium", "high", "extraHigh"], "medium"], ["GPT-5.4", ["off", "low", "medium", "high", "extraHigh"], "off"]]]],
    ],
    [
      OPENAI_PRESETS.xai,
      ["grok-4.7", "grok-4.3", "grok-imagine-video"],
      [["Grok", [["Grok 4.7", ["low", "medium", "high", "extraHigh"], "high"], ["Grok 4.3", [], null]]]],
    ],
    [
      OPENAI_PRESETS.meta,
      ["muse-spark-1.3", "muse-image-1"],
      [["Muse Spark", [["Muse Spark 1.3", ["minimal", "low", "medium", "high", "extraHigh", "maximum"], null]]]],
    ],
    [
      OPENAI_PRESETS.local,
      ["gpt-oss:20b", "llama3.3:70b", "nomic-embed-text:latest"],
      [
        ["gpt-oss", [["gpt-oss 20b", ["low", "medium", "high"], "medium"]]],
        ["Llama", [["Llama 3.3", [], null]]],
      ],
    ],
  ])("with the catalog, %o's models are grouped under their own names, with their own efforts and defaults", async (preset, ids, grouped) => {
    const { platform } = fakePlatform({
      commands: fakeKeyStore({ [preset.id]: "sk-kept" }).commands,
      fetch: () => modelList(ids),
    });
    const settings: AiSettings = { ...DEFAULT_AI_SETTINGS, enabled: true, disclosed: [preset.id] };

    const models = await listModels(platform, adapter(preset), settings, BUNDLED_CATALOG);

    expect(models.map(({ name, versions }) => [name, versions.map((each) => [each.name, each.efforts, each.defaultEffort])])).toEqual(grouped);
  });
});

describe("suggest", () => {
  test("asks Chat Completions for the Suggestion's JSON Schema, with the effort chosen, and reads the Suggestion", async () => {
    const { connection, sent } = fakeApi(() => answer(JSON.stringify(SUGGESTION)));

    const suggestion = await adapter().suggest(request, selection, connection);

    expect(suggestion).toEqual(ANSWERED);
    expect(sent.map(({ url, method }) => [url, method])).toEqual([["https://api.openai.com/v1/chat/completions", "POST"]]);
    expect(sent[0]?.body).toEqual({
      model: "gpt-5.5",
      messages: [
        { role: "system", content: SUGGESTION_INSTRUCTIONS },
        { role: "user", content: suggestionPrompt(request) },
      ],
      response_format: { type: "json_schema", json_schema: { name: "suggestion", strict: true, schema: SUGGESTION_SCHEMA } },
      reasoning_effort: "xhigh",
    });
    expect(sent[0]?.headers["content-type"]).toBe("application/json");
  });

  test.each<[ModelSelection["effort"], string | undefined]>([
    ["off", "none"],
    ["minimal", "minimal"],
    ["low", "low"],
    ["medium", "medium"],
    ["high", "high"],
    ["extraHigh", "xhigh"],
    ["maximum", "max"],
    [null, undefined],
  ])("sends the effort %s as reasoning_effort %s", async (effort, sentAs) => {
    const { connection, sent } = fakeApi(() => answer(JSON.stringify(SUGGESTION)));

    await adapter().suggest(request, { ...selection, effort }, connection);

    const body = sent[0]?.body as Record<string, unknown>;
    expect(body.reasoning_effort).toBe(sentAs);
    expect("reasoning_effort" in body).toBe(sentAs !== undefined);
  });

  test.each([
    ["isn't JSON", "Here's the resolution: let b = 2;", "Its answer wasn't JSON."],
    ["isn't a Suggestion", JSON.stringify({ ...SUGGESTION, confidence: "certain" }), "The Model Provider's answer wasn't a Suggestion."],
  ])("fails when every answer %s", async (_, text, message) => {
    const { connection } = fakeApi(() => answer(text));

    await expect(failureOf(adapter().suggest(request, selection, connection))).resolves.toEqual({ kind: "unexpectedResponse", message });
  });

  test("says the model declined, with its refusal, and without one when its answer was filtered", async () => {
    const { connection } = fakeApi(() => answer(null, "stop", "I can't help with that."));

    const failure = await failureOf(adapter().suggest(request, selection, connection));
    expect(failure).toEqual({ kind: "declined", explanation: "I can't help with that." });
    expect(aiFailureWords(new ModelProviderError(failure), () => "OpenAI (ChatGPT models)")).toBe(
      "The model declined to make a Suggestion for this Conflict Hunk. I can't help with that. " +
        "Resolve it by hand, or choose another model in Settings.",
    );
    const filtered = fakeApi(() => answer("", "content_filter")).connection;
    await expect(failureOf(adapter().suggest(request, selection, filtered))).resolves.toEqual({ kind: "declined", explanation: null });
  });

  test("says so when it stops for length, with half an answer, without asking again", async () => {
    const { connection, sent } = fakeApi(() => answer('{"explanation": "Ours chan', "length"));

    await expect(failureOf(adapter().suggest(request, selection, connection))).resolves.toEqual({
      kind: "unexpectedResponse",
      message: "It stopped before the Suggestion was finished. A lower Effort may leave it room.",
    });
    expect(sent).toHaveLength(1);
  });

  test("says so when there's no answer at all", async () => {
    const { connection } = fakeApi(() => Response.json({ id: "chatcmpl-01", object: "chat.completion", choices: [] }));

    await expect(failureOf(adapter().suggest(request, selection, connection))).resolves.toEqual({
      kind: "unexpectedResponse",
      message: "It gave no answer.",
    });
  });
});

describe("structured output", () => {
  test("a model that won't take a JSON Schema is asked for a JSON object, with the schema in its instructions, and that's remembered", async () => {
    const { connection, sent } = fakeApi(({ body }) =>
      (body as { response_format?: { type: string } }).response_format?.type === "json_schema"
        ? apiError(400, "Invalid parameter: 'response_format' of type 'json_schema' is not supported with this model.", "response_format")
        : answer(JSON.stringify(SUGGESTION)),
    );
    const openai = adapter();

    await expect(openai.suggest(request, selection, connection)).resolves.toEqual(ANSWERED);
    await expect(openai.suggest(request, selection, connection)).resolves.toEqual(ANSWERED);

    expect(formats(sent)).toEqual(["json_schema", "json_object", "json_object"]);
    expect(sent[1]?.body).toMatchObject({
      messages: [{ role: "system", content: SUGGESTION_INSTRUCTIONS }, { role: "user" }],
      response_format: { type: "json_object" },
      reasoning_effort: "xhigh",
    });
    expect(SUGGESTION_INSTRUCTIONS).toContain(JSON.stringify(SUGGESTION_SCHEMA));
    // Another model is asked for its JSON Schema all the same.
    await openai.suggest(request, { ...selection, version: "gpt-5.4" }, connection);
    expect(formats(sent).at(-2)).toBe("json_schema");
  });

  test("a local server that offers neither is asked with instructions alone, and its answer is checked", async () => {
    // As LM Studio answers a JSON object it won't take, and an older server a JSON Schema.
    const { connection, sent } = fakeApi(({ body }) => {
      const format = (body as { response_format?: { type: string } }).response_format?.type;
      if (format === "json_schema") return apiError(400, "json_schema is not supported by this server");
      if (format === "json_object") return Response.json({ error: "'response_format.type' must be 'json_schema' or 'text'" }, { status: 400 });
      return answer(`<think>Both sides can be kept.</think>\n\`\`\`json\n${JSON.stringify(SUGGESTION)}\n\`\`\``);
    }, null);
    const local = adapter(OPENAI_PRESETS.local);
    const llama = { ...selection, version: "llama3.3:70b", effort: null };

    await expect(local.suggest(request, llama, connection)).resolves.toEqual(ANSWERED);
    await expect(local.suggest(request, llama, connection)).resolves.toEqual(ANSWERED);

    expect(formats(sent)).toEqual(["json_schema", "json_object", "none", "none"]);
    expect(sent[2]?.body).toEqual({
      model: "llama3.3:70b",
      messages: [
        { role: "system", content: SUGGESTION_INSTRUCTIONS },
        { role: "user", content: suggestionPrompt(request) },
      ],
    });
  });

  test("a server that ignores response_format and answers with something that isn't JSON is asked the next way", async () => {
    const { connection, sent } = fakeApi((_, index) =>
      index < 2 ? answer("Keep both sides: fn main() { let b = 2; }") : answer(`Here it is: ${JSON.stringify(SUGGESTION)}`),
    );

    await expect(adapter(OPENAI_PRESETS.local).suggest(request, selection, connection)).resolves.toEqual(ANSWERED);
    expect(formats(sent)).toEqual(["json_schema", "json_object", "none"]);
  });

  test("a request turned down for anything else isn't asked again another way", async () => {
    const { connection, sent } = fakeApi(() => apiError(400, "Unsupported value: 'reasoning_effort' does not support 'max' with this model.", "reasoning_effort"));

    await expect(failureOf(adapter().suggest(request, selection, connection))).resolves.toEqual({
      kind: "rejected",
      message: "Unsupported value: 'reasoning_effort' does not support 'max' with this model.",
    });
    expect(sent).toHaveLength(1);
  });

  test("the JSON in an answer is found round the thinking and Markdown a local model may add", () => {
    expect(jsonIn('{"a": 1}', false)).toEqual({ a: 1 });
    expect(jsonIn('<think>{"not": "this"}</think>\n{"a": 1}', false)).toEqual({ a: 1 });
    expect(jsonIn('```json\n{"a": {"b": 2}}\n```', false)).toEqual({ a: { b: 2 } });
    expect(jsonIn('Here it is: {"a": 1}', false)).toBeUndefined();
    expect(jsonIn('Here it is: {"a": 1}. Anything else?', true)).toEqual({ a: 1 });
    expect(jsonIn("Keep both sides.", true)).toBeUndefined();
    expect(jsonIn("", true)).toBeUndefined();
    // Braces in the words round it, and line breaks a model left raw in its strings.
    expect(jsonIn('The `{` stays. {"a": "x {y}"} Done.', true)).toEqual({ a: "x {y}" });
    expect(jsonIn('{"a": "one\ntwo\tthree"}', true)).toEqual({ a: "one\ntwo\tthree" });
    expect(jsonIn('{"a": 1} and {"b": 2}', true)).toEqual({ a: 1 });
    expect(jsonIn('{"a": "one\ntwo"}', false)).toBeUndefined();
  });

  test("every model is told to answer with the JSON its Suggestion is read from", () => {
    expect(SUGGESTION_INSTRUCTIONS).toContain("Answer with a JSON object alone");
    expect(SUGGESTION_INSTRUCTIONS).toContain(JSON.stringify(SUGGESTION_SCHEMA));
  });
});

describe("failures", () => {
  test.each<[string, Response, ModelProviderFailure]>([
    ["an API key it refuses", apiError(401, "Incorrect API key provided: sk-user."), { kind: "keyRefused" }],
    ["too many requests", apiError(429, "Rate limit reached for gpt-5.5"), { kind: "rateLimited" }],
    [
      "a model the account can't use",
      apiError(403, "You are not allowed to use this model."),
      { kind: "rejected", message: "You are not allowed to use this model." },
    ],
    [
      "a model that isn't there",
      apiError(404, "The model `gpt-gone` does not exist or you do not have access to it."),
      { kind: "rejected", message: "The model `gpt-gone` does not exist or you do not have access to it." },
    ],
    [
      "a country Meta's preview isn't offered in",
      apiError(403, "The Muse Spark API preview is only available in the US."),
      { kind: "rejected", message: "The Muse Spark API preview is only available in the US." },
    ],
    [
      "an error that's only a string, as LM Studio gives",
      Response.json({ error: "model 'llama9' not found" }, { status: 404 }),
      { kind: "rejected", message: "model 'llama9' not found" },
    ],
    ["failing on its side", apiError(500, "The server had an error"), { kind: "unavailable", message: "The server had an error" }],
    [
      "an error with no body",
      new Response(null, { status: 503, headers: { "x-should-retry": "false" } }),
      { kind: "unavailable", message: "503 status code (no body)" },
    ],
  ])("tells %s by the SDK's error class", async (_, response, failure) => {
    const { connection } = fakeApi(() => response.clone());

    await expect(failureOf(adapter().suggest(request, selection, connection))).resolves.toEqual(failure);
    await expect(failureOf(adapter().listModels(fakeApi(() => response.clone()).connection))).resolves.toEqual(failure);
    expect(aiFailureWords(new ModelProviderError(failure), () => "OpenAI (ChatGPT models)")).not.toMatch(/undefined|\[object/);
  });

  test("says a cloud Model Provider couldn't be reached when the request can't be made", async () => {
    const { connection } = fakeApi(() => {
      throw new TypeError("error sending request: dns error");
    });

    await expect(failureOf(adapter(OPENAI_PRESETS.xai).listModels(connection))).resolves.toEqual({
      kind: "unreachable",
      message: "error sending request: dns error",
    });
  });

  test("says where a local server was looked for, and that it may not be running, when nothing answers there", async () => {
    const { connection } = fakeApi(() => {
      throw new TypeError("error sending request: connection refused");
    }, null);

    await expect(failureOf(adapter(OPENAI_PRESETS.local).listModels(connection))).resolves.toEqual({
      kind: "unreachable",
      message: `Nothing answered at ${LOCAL_API}: check the server is running. error sending request: connection refused`,
    });
  });

  test("says so when a request isn't answered in time", async () => {
    const { connection } = fakeApi(() => {
      throw new TypeError("error sending request: operation timed out");
    });

    await expect(failureOf(adapter().suggest(request, selection, connection))).resolves.toEqual({
      kind: "unreachable",
      message: "It didn't answer in time.",
    });
  });

  test("says so when a successful answer isn't JSON", async () => {
    const { connection } = fakeApi(() => new Response("<html>Gateway</html>", { headers: { "content-type": "application/json" } }));

    await expect(failureOf(adapter().listModels(connection))).resolves.toEqual({
      kind: "unexpectedResponse",
      message: "Its answer wasn't JSON.",
    });
  });

  test("tries again after an answer that may pass, as long as the Model Provider says to wait", async () => {
    const { connection, sent } = fakeApi((_, index) =>
      index === 0
        ? apiError(503, "Service unavailable", null, { "x-should-retry": "true", "retry-after-ms": "1" })
        : answer(JSON.stringify(SUGGESTION)),
    );

    await expect(openAiCompatibleModelProvider(OPENAI_PRESETS.openai).suggest(request, selection, connection)).resolves.toEqual(ANSWERED);
    expect(sent).toHaveLength(2);
  });

  test("an aborted request is thrown on as the SDK's abort, not as a failure", async () => {
    const { connection } = fakeApi(() => answer(JSON.stringify(SUGGESTION)));
    const controller = new AbortController();
    controller.abort();

    await expect(adapter().suggest(request, selection, { ...connection, signal: controller.signal })).rejects.toBeInstanceOf(
      APIUserAbortError,
    );
  });
});

/** `version` of `model` chosen from `provider`, at `effort`. */
function chosen(provider: string, model: string, version: string, effort: ModelSelection["effort"]): AiSettings {
  return {
    ...DEFAULT_AI_SETTINGS,
    enabled: true,
    disclosed: [provider],
    global: { provider, model, version, effort },
  };
}

/** A platform with `kept` API keys, whose `fetch` answers as the OpenAI-compatible API does, listing `ids`. */
function setUp(ids: string[], kept: Record<string, string>) {
  const api = fakeApi((sent) => (new URL(sent.url).pathname.endsWith("/models") ? modelList(ids) : answer(JSON.stringify(SUGGESTION))));
  const { platform } = fakePlatform({ commands: fakeKeyStore(kept).commands, fetch: api.fetch });
  return { api, platform };
}

describe("requestSuggestion", () => {
  test.each<[OpenAiPreset, string, string, ModelSelection["effort"], string | undefined]>([
    [OPENAI_PRESETS.openai, "gpt", "gpt-5.5", "extraHigh", "xhigh"],
    // GPT-5.4 takes no Maximum, so its default is left to OpenAI.
    [OPENAI_PRESETS.openai, "gpt", "gpt-5.4", "maximum", undefined],
    [OPENAI_PRESETS.xai, "grok", "grok-4.7", "low", "low"],
    // Grok 4.3 takes no effort at all.
    [OPENAI_PRESETS.xai, "grok", "grok-4.3", "high", undefined],
    [OPENAI_PRESETS.meta, "muse-spark", "muse-spark-1.3", "maximum", "max"],
    [OPENAI_PRESETS.meta, "muse-spark", "muse-spark-1.2", "maximum", undefined],
  ])("asks %o with the API key kept for it, only at an effort the model takes: %s, %s at %s", async (preset, model, version, effort, sentAs) => {
    const { api, platform } = setUp([version], { [preset.id]: "sk-kept" });

    const suggestion = await requestSuggestion({
      platform,
      providers: [adapter(preset)],
      settings: chosen(preset.id, model, version, effort),
      catalog: BUNDLED_CATALOG,
      repository: null,
      request,
    });

    expect(suggestion).toEqual(ANSWERED);
    expect(api.sent.map(({ url, headers }) => [url, headers.authorization])).toEqual([
      [`${preset.api}/models`, "Bearer sk-kept"],
      [`${preset.api}/chat/completions`, "Bearer sk-kept"],
    ]);
    expect(api.sent[1]?.body).toMatchObject({ model: version, response_format: { type: "json_schema" } });
    const body = api.sent[1]?.body as Record<string, unknown> | undefined;
    expect(body?.reasoning_effort).toBe(sentAs);
  });

  test("asks a local server at the base URL set in Settings, with no key where none is kept", async () => {
    const { api, platform } = setUp(["gpt-oss:20b"], {});

    await requestSuggestion({
      platform,
      providers: [adapter(OPENAI_PRESETS.local)],
      settings: { ...chosen("local", "gpt-oss", "gpt-oss:20b", "high"), baseUrls: { local: "http://localhost:8080/v1" } },
      catalog: BUNDLED_CATALOG,
      repository: null,
      request,
    });

    expect(api.sent.map(({ url, headers }) => [url, headers.authorization])).toEqual([
      ["http://localhost:8080/v1/models", undefined],
      ["http://localhost:8080/v1/chat/completions", undefined],
    ]);
    expect(api.sent[1]?.body).toMatchObject({ model: "gpt-oss:20b", reasoning_effort: "high" });
  });

  test("asks a local server with the key kept for it, where one is", async () => {
    const { api, platform } = setUp(["llama3.3:70b"], { local: "sk-local" });

    await requestSuggestion({
      platform,
      providers: [adapter(OPENAI_PRESETS.local)],
      settings: chosen("local", "llama", "llama3.3:70b", null),
      catalog: BUNDLED_CATALOG,
      repository: null,
      request,
    });

    expect(api.sent.map(({ url, headers }) => [url, headers.authorization])).toEqual([
      [`${LOCAL_API}/models`, "Bearer sk-local"],
      [`${LOCAL_API}/chat/completions`, "Bearer sk-local"],
    ]);
  });
});
