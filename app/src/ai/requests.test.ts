import { describe, expect, test } from "vitest";

import { FAKE_CATALOG, FAKE_LOCAL_API, fakeModelProvider } from "../test/fakeModelProvider";
import { fakeKeyStore, fakePlatform } from "../test/fakePlatform";
import { type AiSettings, DEFAULT_AI_SETTINGS } from "./aiSettings";
import { aiFailureWords } from "./aiWords";
import { OTHER_VERSIONS } from "./modelCatalog";
import { MODEL_PROVIDERS } from "./modelProviders";
import { ModelProviderError, type SuggestionRequest } from "./modelProvider";
import { AiRefusedError, connect, failsOnlyThisRequest, listModels, requestSuggestion } from "./requests";
import { suggestionPrompt } from "./suggestionRequest";

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

const on: AiSettings = {
  ...DEFAULT_AI_SETTINGS,
  enabled: true,
  disclosed: ["fake"],
  global: { provider: "fake", model: "fake-opus", version: null, effort: null },
};

const catalog = FAKE_CATALOG;

function setUp(kept: Record<string, string> = { fake: "sk-fake" }) {
  const fake = fakeModelProvider();
  const keys = fakeKeyStore(kept);
  const platform = fakePlatform({ commands: keys.commands, fetch: fake.answer });
  return { fake, platform, providers: [fake.provider] };
}

describe("requestSuggestion", () => {
  test("asks the Model Provider chosen, with the user's API key, for a Suggestion it only returns", async () => {
    const { fake, platform, providers } = setUp();

    const suggestion = await requestSuggestion({
      platform: platform.platform,
      providers,
      settings: on,
      catalog,
      repository: "/work/lanewise",
      request,
    });

    expect(suggestion).toEqual({
      explanation: "Both sides renamed it; keep Theirs.",
      resolution: "const b = 2;",
      confidence: "high",
    });
    expect(fake.requests.map(({ url, authorization }) => [url, authorization])).toEqual([
      ["https://api.fake-model-provider.test/fake/models", "Bearer sk-fake"],
      ["https://api.fake-model-provider.test/fake/suggest", "Bearer sk-fake"],
    ]);
    expect(fake.requests[1]?.body).toMatchObject({
      model: "fake-opus",
      version: "fake-opus-5",
      effort: null,
      budget: null,
      prompt: suggestionPrompt(request),
    });
    // Nothing but the platform's fetch made a request, and nothing was written.
    expect(platform.fetches).toHaveLength(2);
    // Whether a gateway is kept for it, then its key; with none, the request goes to its own API.
    expect(platform.calls.map(({ name }) => name)).toEqual(["gatewayOf", "modelProviderKey"]);
  });

  test("a repository set apart is asked with its own choice", async () => {
    const other = fakeModelProvider({ id: "other", key: "sk-other" });
    const keys = fakeKeyStore({ other: "sk-other" });
    const platform = fakePlatform({ commands: keys.commands, fetch: other.answer });

    await requestSuggestion({
      platform: platform.platform,
      providers: [fakeModelProvider().provider, other.provider],
      settings: {
        ...on,
        disclosed: ["fake", "other"],
        repositories: { "/work/apart": { provider: "other", model: "fake-opus", version: "fake-opus-4", effort: "low" } },
      },
      catalog,
      repository: "/work/apart",
      request,
    });

    expect(other.requests[1]?.body).toMatchObject({ version: "fake-opus-4", effort: "low", budget: 1024 });
  });

  test.each<[string, AiSettings, string]>([
    ["AI is off", { ...on, enabled: false }, "off"],
    ["the Model Provider's disclosure wasn't accepted", { ...on, disclosed: [] }, "notDisclosed"],
    ["no Model Provider is chosen", { ...on, global: null }, "noModelProvider"],
    ["the Model Provider chosen has no adapter", { ...on, global: { provider: "gone", model: null, version: null, effort: null } }, "noModelProvider"],
  ])("sends nothing, and reads no API key, while %s", async (_, settings, kind) => {
    const { platform, providers } = setUp();

    const asked = requestSuggestion({ platform: platform.platform, providers, settings, catalog, repository: null, request });

    await expect(asked).rejects.toBeInstanceOf(AiRefusedError);
    await expect(asked).rejects.toMatchObject({ refusal: { kind } });
    expect(platform.fetches).toEqual([]);
    expect(platform.calls).toEqual([]);
  });

  test("sends nothing without an API key kept", async () => {
    const { platform, providers } = setUp({});

    const asked = requestSuggestion({ platform: platform.platform, providers, settings: on, catalog, repository: null, request });

    await expect(asked).rejects.toMatchObject({ refusal: { kind: "noKey", provider: "fake" } });
    expect(platform.fetches).toEqual([]);
    expect(aiFailureWords(await asked.catch((failure: unknown) => failure), () => "Fake")).toBe(
      "Save your API key for Fake in Settings.",
    );
  });

  test("an API key the Model Provider refuses fails, saying so", async () => {
    const { platform, providers } = setUp({ fake: "sk-wrong" });

    const asked = requestSuggestion({ platform: platform.platform, providers, settings: on, catalog, repository: null, request });

    await expect(asked).rejects.toBeInstanceOf(ModelProviderError);
    await expect(asked).rejects.toMatchObject({ failure: { kind: "keyRefused" } });
  });

  test("a Suggestion that fails is logged by its kind alone, never its prompt or message", async () => {
    const fake = fakeModelProvider();
    const keys = fakeKeyStore({ fake: "sk-fake" });
    const platform = fakePlatform({
      commands: keys.commands,
      fetch: (url, init) =>
        url.endsWith("/suggest") ? new Response(`Can't: ${String(init?.body)}`, { status: 500 }) : fake.answer(url, init),
    });

    const asked = requestSuggestion({ platform: platform.platform, providers: [fake.provider], settings: on, catalog, repository: null, request });

    await expect(asked).rejects.toMatchObject({ failure: { kind: "unexpectedResponse" } });
    expect(platform.logs).toEqual([{ level: "warn", message: "A Suggestion from fake failed: unexpectedResponse" }]);
  });

  test("a Suggestion AI refused to ask for isn't logged", async () => {
    const { platform, providers } = setUp({});

    await expect(
      requestSuggestion({ platform: platform.platform, providers, settings: on, catalog, repository: null, request }),
    ).rejects.toBeInstanceOf(AiRefusedError);
    expect(platform.logs).toEqual([]);
  });
});

describe("connect", () => {
  const local = fakeModelProvider({ id: "local", local: true, key: null }).provider;

  test("a Model Provider on this computer is asked at the base URL set for it, or else at its default", async () => {
    const { platform } = fakePlatform({ commands: fakeKeyStore().commands });

    await expect(connect(platform, local, DEFAULT_AI_SETTINGS)).resolves.toMatchObject({ apiKey: null, baseUrl: FAKE_LOCAL_API });
    await expect(
      connect(platform, local, { ...DEFAULT_AI_SETTINGS, baseUrls: { local: "http://localhost:1234/v1" } }),
    ).resolves.toMatchObject({ baseUrl: "http://localhost:1234/v1" });
  });

  test("a cloud Model Provider is never given a base URL, whatever the settings say", async () => {
    const { fake, platform } = setUp();

    const connection = await connect(platform.platform, fake.provider, {
      ...DEFAULT_AI_SETTINGS,
      baseUrls: { fake: "http://localhost:1234/v1" },
    });

    expect(connection).toMatchObject({ apiKey: "sk-fake" });
    expect(connection.baseUrl).toBeUndefined();
  });

  test("an optional API key is sent where it's kept, and left out where there's no credential store to keep it in", async () => {
    const { platform } = fakePlatform({ commands: fakeKeyStore({ local: "sk-local" }).commands });
    await expect(connect(platform, local, DEFAULT_AI_SETTINGS)).resolves.toMatchObject({ apiKey: "sk-local" });

    const unavailable = fakePlatform({
      commands: { modelProviderKey: () => ({ ok: false, error: { kind: "storeUnavailable", message: "No keyring." } }) },
    });
    await expect(connect(unavailable.platform, local, DEFAULT_AI_SETTINGS)).resolves.toMatchObject({ apiKey: null });
  });

  test("a credential store that refuses is said to, even for an optional key", async () => {
    const { platform } = fakePlatform({
      commands: { modelProviderKey: () => ({ ok: false, error: { kind: "storeRefused", message: "It's locked." } }) },
    });

    await expect(connect(platform, local, DEFAULT_AI_SETTINGS)).rejects.toMatchObject({
      refusal: { kind: "keyStore", provider: "local" },
    });
  });

  test("with no credential store, a Model Provider that needs a key is said to have none to read", async () => {
    const { platform } = fakePlatform({
      commands: { modelProviderKey: () => ({ ok: false, error: { kind: "storeUnavailable", message: "No keyring." } }) },
    });
    const { fake } = setUp();

    await expect(connect(platform, fake.provider, DEFAULT_AI_SETTINGS)).rejects.toMatchObject({
      refusal: { kind: "keyStore", provider: "fake" },
    });
  });
});

describe("listModels", () => {
  test("lists the Model Provider's models live, once AI is on for it", async () => {
    const { fake, platform, providers } = setUp();
    const [provider] = providers;
    if (provider === undefined) throw new Error("a Model Provider");

    await expect(listModels(platform.platform, provider, { ...on, enabled: false }, catalog)).rejects.toMatchObject({
      refusal: { kind: "off" },
    });
    await expect(listModels(platform.platform, provider, { ...on, disclosed: [] }, catalog)).rejects.toMatchObject({
      refusal: { kind: "notDisclosed" },
    });
    expect(platform.fetches).toEqual([]);

    const models = await listModels(platform.platform, provider, on, catalog);

    expect(models.map(({ name }) => name)).toEqual(["Fake Opus", "Fake Mini", "Other versions"]);
    expect(fake.requests).toHaveLength(1);
  });

  test("describes the models listed by the Model Provider's section of the catalog, and any other under Other versions", async () => {
    const { platform, providers } = setUp();
    const [provider] = providers;
    if (provider === undefined) throw new Error("a Model Provider");

    const models = await listModels(platform.platform, provider, on, { sections: {} });

    expect(models.map(({ id }) => id)).toEqual([OTHER_VERSIONS]);
    expect(models[0]?.versions.every(({ efforts }) => efforts === null)).toBe(true);
  });
});

describe("failsOnlyThisRequest", () => {
  test.each([
    { failure: new ModelProviderError({ kind: "declined", explanation: null }), only: true },
    { failure: new ModelProviderError({ kind: "rejected", message: "Too long." }), only: true },
    { failure: new ModelProviderError({ kind: "unexpectedResponse", message: "Not JSON." }), only: true },
    { failure: new ModelProviderError({ kind: "keyRefused" }), only: false },
    { failure: new ModelProviderError({ kind: "rateLimited" }), only: false },
    { failure: new ModelProviderError({ kind: "unreachable", message: "Offline." }), only: false },
    { failure: new ModelProviderError({ kind: "unavailable", message: "Overloaded." }), only: false },
    { failure: new AiRefusedError({ kind: "noKey", provider: "fake" }), only: false },
    { failure: new Error("Something else."), only: false },
  ])("says whether a $failure.name of “$failure.message” fails only that Conflict Hunk's request: $only", ({ failure, only }) => {
    expect(failsOnlyThisRequest(failure)).toBe(only);
  });
});

test("a Model Provider with a gateway kept is asked through it, by the core", async () => {
  const fake = fakePlatform({
    commands: {
      gatewayOf: () => ({ ok: true, value: { baseUrl: "https://gateway.example.com/anthropic", headerNames: ["X-Key"] } }),
      modelProviderKey: () => ({ ok: true, value: { key: "sk-test" } }),
      gatewayRequest: () => ({ ok: true, value: { status: 200, headers: [], body: "{}" } }),
    },
  });
  const provider = MODEL_PROVIDERS.find((each) => each.id === "anthropic")!;

  const connection = await connect(fake.platform, provider, DEFAULT_AI_SETTINGS);
  await connection.fetch("https://api.anthropic.com/v1/models", { method: "GET" });

  expect(fake.calls.at(-1)).toMatchObject({ name: "gatewayRequest", request: { provider: "anthropic", path: "/v1/models" } });
  expect(fake.fetches).toEqual([]);
});
