import { APIUserAbortError } from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { fakeKeyStore, fakePlatform } from "../test/fakePlatform";
import { DEFAULT_AI_SETTINGS, type AiSettings } from "./aiSettings";
import { ANTHROPIC_HEADERS, MAX_TOKENS, anthropicModelProvider } from "./anthropic";
import { aiFailureWords } from "./aiWords";
import { BUNDLED_CATALOG } from "./modelCatalog";
import { MODEL_PROVIDERS } from "./modelProviders";
import type { Connection, ModelProviderFailure, ModelSelection, Suggestion, SuggestionRequest } from "./modelProvider";
import { ModelProviderError } from "./modelProvider";
import { listModels, requestSuggestion } from "./requests";
import { SUGGESTION_INSTRUCTIONS, SUGGESTION_SCHEMA, suggestionPrompt } from "./suggestionRequest";

// Every test answers through a fake `fetch`: nothing here reaches Anthropic's API.

/** A request the SDK made through the connection's `fetch`, its body parsed. */
interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A connection, with the API key `key`, whose `fetch` answers each request with `respond`, logging it. */
function fakeAnthropic(respond: (sent: Sent, index: number) => Response | Promise<Response>, key = "sk-ant-user") {
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

/** A model as Anthropic's Models API gives it, with `efforts` by the API's own names, or `null` for none. */
function claude(id: string, name: string, created: string, efforts: string[] | null) {
  const levels = ["low", "medium", "high", "xhigh", "max"];
  return {
    type: "model",
    id,
    display_name: name,
    created_at: created,
    max_input_tokens: 1_000_000,
    max_tokens: 128_000,
    capabilities: {
      effort:
        efforts === null
          ? { supported: false }
          : { supported: true, ...Object.fromEntries(levels.map((level) => [level, { supported: efforts.includes(level) }])) },
    },
  };
}

const OPUS = claude("claude-opus-5-5", "Claude Opus 5.5", "2026-08-12T00:00:00Z", ["low", "medium", "high", "xhigh", "max"]);
const OPUS_4_6 = claude("claude-opus-4-6", "Claude Opus 4.6", "2026-02-05T00:00:00Z", ["low", "medium", "high", "max"]);
const HAIKU = claude("claude-haiku-4-5-20251001", "Claude Haiku 4.5", "2025-10-15T00:00:00Z", null);

/** A page of the Models API. */
function page(data: unknown[], hasMore: boolean): Response {
  const ids = data.map((each) => (each as { id: string }).id);
  return Response.json({ data, has_more: hasMore, first_id: ids[0] ?? null, last_id: ids.at(-1) ?? null });
}

const SUGGESTION: Suggestion = {
  explanation: "Ours changed the value and Theirs renamed it: keep both.",
  resolution: "let b = 2;",
  confidence: "medium",
};

/** {@link SUGGESTION}, as the adapter gives it, with the tokens the fake answer says it took. */
const ANSWERED: Suggestion = { ...SUGGESTION, usage: { inputTokens: 120, outputTokens: 80 } };

/** A Messages API answer with `text`, stopped for `stopReason`, after an omitted thinking block. */
function answer(text: string, stopReason = "end_turn", stopDetails: unknown = null): Response {
  return Response.json({
    id: "msg_01",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text },
    ],
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: stopDetails,
    usage: { input_tokens: 120, output_tokens: 80 },
  });
}

/** An error as Anthropic's API answers one, with `status`. */
function apiError(status: number, type: string, message: string, headers: Record<string, string> = {}): Response {
  return Response.json(
    { type: "error", error: { type, message }, request_id: "req_01" },
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

const selection: ModelSelection = { model: "claude-opus", version: "claude-opus-5-5", effort: "extraHigh", budget: null };

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

const anthropic = anthropicModelProvider({ maxRetries: 0 });

beforeEach(() => {
  // What an environment may hold for the SDK, none of which it may use.
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-environment");
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "token-from-the-environment");
  vi.stubEnv("ANTHROPIC_BASE_URL", "https://gateway.invalid");
  vi.stubEnv("ANTHROPIC_CUSTOM_HEADERS", "x-from-the-environment: yes\nuser-agent: claude-cli/1.0");
  vi.stubEnv("ANTHROPIC_PROFILE", "someone-else");
  vi.stubEnv("ANTHROPIC_LOG", "debug");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the Anthropic Model Provider", () => {
  test("is offered in Settings, sending to api.anthropic.com, with its API-key page and the catalog's section", () => {
    const [offered] = MODEL_PROVIDERS;

    expect(offered).toMatchObject({
      id: "anthropic",
      name: "Anthropic (Claude)",
      apiKeyPage: "https://platform.claude.com/settings/keys",
      host: "api.anthropic.com",
      catalog: "anthropic",
    });
    expect(BUNDLED_CATALOG.sections.anthropic).toBeDefined();
  });

  test("sends only the user's API key and the headers it needs, to api.anthropic.com, whatever the environment says", async () => {
    const debug = vi.spyOn(console, "debug");
    const { connection, sent } = fakeAnthropic(() => page([OPUS], false));

    await anthropic.listModels(connection);

    expect(sent).toHaveLength(1);
    expect(new URL(sent[0]?.url ?? "").origin).toBe("https://api.anthropic.com");
    expect(Object.keys(sent[0]?.headers ?? {}).toSorted()).toEqual(
      ["accept", "anthropic-version", "x-api-key"].filter((name) => ANTHROPIC_HEADERS.includes(name)),
    );
    expect(sent[0]?.headers["x-api-key"]).toBe("sk-ant-user");
    expect(JSON.stringify(sent)).not.toMatch(/environment|someone-else|claude-cli|stainless/);
    expect(debug).not.toHaveBeenCalled();
  });

  test("without an API key, asks nothing and says the key is missing, never looking for credentials of its own", async () => {
    const { fetch, sent } = fakeAnthropic(() => page([], false));

    await expect(failureOf(anthropic.listModels({ fetch, apiKey: null }))).resolves.toEqual({ kind: "keyRefused" });
    expect(sent).toEqual([]);
  });
});

describe("listModels", () => {
  test("reads every page of the Models API, with each model's display name and effort levels", async () => {
    const { connection, sent } = fakeAnthropic((_, index) => (index === 0 ? page([OPUS, OPUS_4_6], true) : page([HAIKU], false)));

    const models = await anthropic.listModels(connection);

    expect(models).toEqual([
      {
        id: "claude-opus-5-5",
        name: "Claude Opus 5.5",
        version: null,
        created: "2026-08-12T00:00:00.000Z",
        efforts: ["low", "medium", "high", "extraHigh", "maximum"],
      },
      {
        id: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        version: null,
        created: "2026-02-05T00:00:00.000Z",
        efforts: ["low", "medium", "high", "maximum"],
      },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", version: null, created: "2025-10-15T00:00:00.000Z", efforts: [] },
    ]);
    const urls = sent.map(({ url }) => new URL(url));
    expect(urls.map(({ pathname }) => pathname)).toEqual(["/v1/models", "/v1/models"]);
    expect(urls.map(({ searchParams }) => [searchParams.get("limit"), searchParams.get("after_id")])).toEqual([
      ["1000", null],
      ["1000", "claude-opus-4-6"],
    ]);
    expect(sent.map(({ method }) => method)).toEqual(["GET", "GET"]);
  });

  test("with the catalog, groups Claude's models under their own names, with their own efforts and defaults", async () => {
    const { platform } = fakePlatform({
      commands: fakeKeyStore({ anthropic: "sk-ant-user" }).commands,
      fetch: () => page([OPUS, HAIKU], false),
    });
    const settings: AiSettings = { ...DEFAULT_AI_SETTINGS, enabled: true, disclosed: ["anthropic"] };

    const models = await listModels(platform, anthropic, settings, BUNDLED_CATALOG);

    expect(models.map(({ name, versions }) => [name, versions.map((each) => [each.name, each.efforts, each.defaultEffort])])).toEqual([
      ["Claude Opus", [["Claude Opus 5.5", ["low", "medium", "high", "extraHigh", "maximum"], "medium"]]],
      ["Claude Haiku", [["Claude Haiku 4.5", [], null]]],
    ]);
  });
});

describe("suggest", () => {
  test("asks the Messages API for the Suggestion's JSON Schema, with the effort chosen, and reads the Suggestion", async () => {
    const { connection, sent } = fakeAnthropic(() => answer(JSON.stringify(SUGGESTION)));

    const suggestion = await anthropic.suggest(request, selection, connection);

    expect(suggestion).toEqual(ANSWERED);
    expect(sent.map(({ url, method }) => [url, method])).toEqual([["https://api.anthropic.com/v1/messages", "POST"]]);
    expect(sent[0]?.body).toEqual({
      model: "claude-opus-5-5",
      max_tokens: MAX_TOKENS,
      system: SUGGESTION_INSTRUCTIONS,
      messages: [{ role: "user", content: suggestionPrompt(request) }],
      output_config: { format: { type: "json_schema", schema: SUGGESTION_SCHEMA }, effort: "xhigh" },
    });
    expect(sent[0]?.headers["content-type"]).toBe("application/json");
  });

  test.each<[ModelSelection["effort"], string | undefined]>([
    ["low", "low"],
    ["medium", "medium"],
    ["high", "high"],
    ["extraHigh", "xhigh"],
    ["maximum", "max"],
    [null, undefined],
    ["off", undefined],
    ["minimal", undefined],
  ])("sends the effort %s as %s, leaving thinking as the model has it", async (effort, sentAs) => {
    const { connection, sent } = fakeAnthropic(() => answer(JSON.stringify(SUGGESTION)));

    await anthropic.suggest(request, { ...selection, effort }, connection);

    const body = sent[0]?.body as { output_config: Record<string, unknown> };
    expect(body.output_config.effort).toBe(sentAs);
    expect("effort" in body.output_config).toBe(sentAs !== undefined);
    expect(body).not.toHaveProperty("thinking");
  });

  test.each([
    ["in a Markdown code block", (json: string) => `\`\`\`json\n${json}\n\`\`\``],
    ["after a sentence", (json: string) => `Here's the Suggestion:\n\n${json}`],
    ["followed by a note", (json: string) => `${json}\n\nKeep the rounding from Ours.`],
  ])("reads the Suggestion when a model the schema doesn't hold writes it %s", async (_, around) => {
    const { connection } = fakeAnthropic(() => answer(around(JSON.stringify(SUGGESTION))));

    const suggestion = await anthropic.suggest(request, { ...selection, version: "claude-opus-4-7" }, connection);

    expect(suggestion).toEqual(expect.objectContaining({ resolution: SUGGESTION.resolution }));
  });

  test("reads the Suggestion when a model the schema doesn't hold leaves line breaks raw in its strings", async () => {
    const resolution = "let a = 1;\nlet b = 2;";
    const written = JSON.stringify({ ...SUGGESTION, resolution }).replaceAll("\\n", "\n");
    const { connection } = fakeAnthropic(() => answer(`Here it is:\n${written}`));

    const suggestion = await anthropic.suggest(request, { ...selection, version: "claude-opus-4-7" }, connection);

    expect(suggestion).toEqual(expect.objectContaining({ resolution }));
  });

  test.each([
    ["isn't JSON", "Here's the resolution: let b = 2;", "Its answer wasn't JSON."],
    ["isn't a Suggestion", JSON.stringify({ ...SUGGESTION, confidence: "certain" }), "The Model Provider's answer wasn't a Suggestion."],
  ])("fails when its answer %s", async (_, text, message) => {
    const { connection } = fakeAnthropic(() => answer(text));

    await expect(failureOf(anthropic.suggest(request, selection, connection))).resolves.toEqual({ kind: "unexpectedResponse", message });
  });

  test("says the model declined, with its explanation, when it stops for a refusal", async () => {
    const details = { type: "refusal", category: "cyber", explanation: "This looks like exploit code." };
    const { connection } = fakeAnthropic(() => answer("", "refusal", details));

    const asked = anthropic.suggest(request, selection, connection);

    const failure = await failureOf(asked);
    expect(failure).toEqual({ kind: "declined", explanation: "This looks like exploit code." });
    expect(aiFailureWords(new ModelProviderError(failure), () => "Anthropic (Claude)")).toBe(
      "The model declined to make a Suggestion for this Conflict Hunk. This looks like exploit code. " +
        "Resolve it by hand, or choose another model in Settings.",
    );
    const unexplained = fakeAnthropic(() => answer("", "refusal", null)).connection;
    await expect(failureOf(anthropic.suggest(request, selection, unexplained))).resolves.toEqual({
      kind: "declined",
      explanation: null,
    });
  });

  test.each([
    ["max_tokens", "It stopped before the Suggestion was finished. A lower Effort may leave it room."],
    ["model_context_window_exceeded", "The Conflict Hunk and the lines round it are too long for this model. Send fewer lines of context."],
  ])("says so when it stops for %s, with half an answer", async (stopReason, message) => {
    const { connection } = fakeAnthropic(() => answer('{"explanation": "Ours chan', stopReason));

    await expect(failureOf(anthropic.suggest(request, selection, connection))).resolves.toEqual({ kind: "unexpectedResponse", message });
  });
});

describe("failures", () => {
  test.each<[string, Response, ModelProviderFailure]>([
    ["an API key it refuses", apiError(401, "authentication_error", "invalid x-api-key"), { kind: "keyRefused" }],
    ["too many requests", apiError(429, "rate_limit_error", "Number of requests has exceeded your rate limit"), { kind: "rateLimited" }],
    ["an account out of credit", apiError(402, "billing_error", "Your credit balance is too low"), { kind: "rateLimited" }],
    [
      "a model the account can't use",
      apiError(403, "permission_error", "Your API key does not have permission to use the specified resource."),
      { kind: "rejected", message: "Your API key does not have permission to use the specified resource." },
    ],
    [
      "a model that isn't there",
      apiError(404, "not_found_error", "model: claude-gone"),
      { kind: "rejected", message: "model: claude-gone" },
    ],
    [
      "a request it won't take",
      apiError(400, "invalid_request_error", "output_config.effort: xhigh is not supported"),
      { kind: "rejected", message: "output_config.effort: xhigh is not supported" },
    ],
    ["being overloaded", apiError(529, "overloaded_error", "Overloaded"), { kind: "unavailable", message: "Overloaded" }],
    ["failing on its side", apiError(500, "api_error", "Internal server error"), { kind: "unavailable", message: "Internal server error" }],
    [
      "an error with no body",
      new Response(null, { status: 503, headers: { "x-should-retry": "false" } }),
      { kind: "unavailable", message: "503 status code (no body)" },
    ],
  ])("tells %s by the SDK's error class", async (_, response, failure) => {
    const { connection } = fakeAnthropic(() => response.clone());

    await expect(failureOf(anthropic.suggest(request, selection, connection))).resolves.toEqual(failure);
    await expect(failureOf(anthropic.listModels(fakeAnthropic(() => response.clone()).connection))).resolves.toEqual(failure);
    expect(aiFailureWords(new ModelProviderError(failure), () => "Anthropic (Claude)")).not.toMatch(/sk-ant|undefined|\[object/);
  });

  test("says Anthropic couldn't be reached when the request can't be made", async () => {
    const { connection } = fakeAnthropic(() => {
      throw new TypeError("error sending request: dns error");
    });

    await expect(failureOf(anthropic.listModels(connection))).resolves.toEqual({
      kind: "unreachable",
      message: "error sending request: dns error",
    });
  });

  test("tries again after an overloaded answer, as long as Anthropic says to wait", async () => {
    const { connection, sent } = fakeAnthropic((_, index) =>
      index === 0
        ? apiError(529, "overloaded_error", "Overloaded", { "x-should-retry": "true", "retry-after-ms": "1" })
        : answer(JSON.stringify(SUGGESTION)),
    );

    await expect(anthropicModelProvider().suggest(request, selection, connection)).resolves.toEqual(ANSWERED);
    expect(sent).toHaveLength(2);
  });

  test("an aborted request is thrown on as the SDK's abort, not as a failure", async () => {
    const { connection } = fakeAnthropic(() => answer(JSON.stringify(SUGGESTION)));
    const controller = new AbortController();
    controller.abort();

    await expect(anthropic.suggest(request, selection, { ...connection, signal: controller.signal })).rejects.toBeInstanceOf(
      APIUserAbortError,
    );
  });
});

/** Claude Opus 4.6 chosen at Extra high. */
const claudeOpus: AiSettings = {
  ...DEFAULT_AI_SETTINGS,
  enabled: true,
  disclosed: ["anthropic"],
  global: { provider: "anthropic", model: "claude-opus", version: "claude-opus-4-6", effort: "extraHigh" },
};

/** A platform with a key kept for Anthropic, whose `fetch` answers as its Models API and Messages API do. */
function setUpClaude() {
  const api = fakeAnthropic((sent) =>
    new URL(sent.url).pathname === "/v1/models" ? page([OPUS, OPUS_4_6], false) : answer(JSON.stringify(SUGGESTION)),
  );
  const { platform } = fakePlatform({ commands: fakeKeyStore({ anthropic: "sk-ant-kept" }).commands, fetch: api.fetch });
  return { api, platform };
}

describe("requestSuggestion", () => {
  test("asks Claude with the API key kept for Anthropic, only at an effort the model takes", async () => {
    const { api, platform } = setUpClaude();

    // Claude Opus 4.6 takes no Extra high, so its default is left to Anthropic.
    const suggestion = await requestSuggestion({
      platform,
      providers: [anthropic],
      settings: claudeOpus,
      catalog: BUNDLED_CATALOG,
      repository: null,
      request,
    });

    expect(suggestion).toEqual(ANSWERED);
    expect(api.sent.map(({ url, headers }) => [new URL(url).pathname, headers["x-api-key"]])).toEqual([
      ["/v1/models", "sk-ant-kept"],
      ["/v1/messages", "sk-ant-kept"],
    ]);
    expect(api.sent[1]?.body).toMatchObject({ model: "claude-opus-4-6", output_config: { format: { type: "json_schema" } } });
    expect(api.sent[1]?.body).not.toHaveProperty("output_config.effort");
  });

  test("sends the effort chosen where the model takes it", async () => {
    const { api, platform } = setUpClaude();

    await requestSuggestion({
      platform,
      providers: [anthropic],
      settings: { ...claudeOpus, global: { provider: "anthropic", model: "claude-opus", version: "claude-opus-5-5", effort: "maximum" } },
      catalog: BUNDLED_CATALOG,
      repository: null,
      request,
    });

    expect(api.sent[1]?.body).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "max" } });
  });
});
