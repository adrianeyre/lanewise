import { describe, expect, test } from "vitest";

import { BUNDLED_CATALOG, OTHER_VERSIONS, describeModels } from "./modelCatalog";
import { anthropicModels, geminiModels, openAiModels } from "./modelLists";
import { ModelProviderError } from "./modelProvider";

/** A model as Anthropic's Models API gives it, taking `efforts` by its own names. */
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
          : {
              supported: true,
              ...Object.fromEntries(levels.map((level) => [level, { supported: efforts.includes(level) }])),
            },
      thinking: { supported: true, types: { adaptive: { supported: true }, enabled: { supported: false } } },
    },
  };
}

describe("anthropicModels", () => {
  const page = {
    data: [
      claude("claude-opus-5-5", "Claude Opus 5.5", "2026-08-12T00:00:00Z", ["low", "medium", "high", "xhigh", "max"]),
      claude("claude-opus-4-6", "Claude Opus 4.6", "2026-02-05T00:00:00Z", ["low", "medium", "high", "max"]),
      claude("claude-haiku-4-5-20251001", "Claude Haiku 4.5", "2025-10-15T00:00:00Z", null),
      claude("claude-opus-9", "Claude Opus 9", "2027-01-01T00:00:00Z", ["low", "high"]),
      { id: "claude-sonnet-4-20250514", display_name: "Claude Sonnet 4", created_at: "2025-05-22T00:00:00Z" },
    ],
    has_more: true,
    first_id: "claude-opus-5-5",
    last_id: "claude-sonnet-4-20250514",
  };

  test("reads each model's ID, name, release date and efforts, and where the next page starts", () => {
    const { models, next } = anthropicModels(page);

    expect(next).toBe("claude-sonnet-4-20250514");
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
      { id: "claude-opus-9", name: "Claude Opus 9", version: null, created: "2027-01-01T00:00:00.000Z", efforts: ["low", "high"] },
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", version: null, created: "2025-05-22T00:00:00.000Z", efforts: null },
    ]);
    expect(anthropicModels({ ...page, has_more: false }).next).toBeNull();
  });

  test("with the catalog, offers Claude's own names and efforts, with each model's own default", () => {
    const models = describeModels(anthropicModels(page).models, BUNDLED_CATALOG.sections.anthropic);

    expect(models.map(({ name, versions }) => [name, versions.map((each) => [each.name, each.defaultEffort])])).toEqual([
      [
        "Claude Opus",
        [
          ["Claude Opus 5.5", "medium"],
          ["Claude Opus 4.6", "high"],
        ],
      ],
      ["Claude Sonnet", [["Claude Sonnet 4", null]]],
      ["Claude Haiku", [["Claude Haiku 4.5", null]]],
      [
        "Other versions",
        [["Claude Opus 9", null]],
      ],
    ]);
    // Claude Opus 9 isn't in the catalog: only Anthropic's default, whatever its API says.
    expect(models.at(-1)?.versions[0]?.efforts).toBeNull();
    expect(models[2]?.versions[0]?.efforts).toEqual([]);
  });
});

describe("geminiModels", () => {
  const page = {
    models: [
      {
        name: "models/gemini-3.5-flash",
        baseModelId: "gemini-3.5-flash",
        version: "3.5",
        displayName: "Gemini 3.5 Flash",
        supportedGenerationMethods: ["generateContent", "countTokens", "createCachedContent"],
        thinking: true,
      },
      {
        name: "models/gemini-2.5-flash-lite",
        version: "001",
        displayName: "Gemini 2.5 Flash-Lite",
        supportedGenerationMethods: ["generateContent"],
        thinking: true,
      },
      {
        name: "models/gemini-2.0-flash",
        displayName: "Gemini 2.0 Flash",
        supportedGenerationMethods: ["generateContent"],
        thinking: false,
      },
      {
        name: "models/gemini-embedding-001",
        displayName: "Gemini Embedding 001",
        supportedGenerationMethods: ["embedContent"],
      },
    ],
    nextPageToken: "page-2",
  };

  test("reads each model that can generate content, by the ID its API takes, and where the next page starts", () => {
    const { models, next } = geminiModels(page);

    expect(next).toBe("page-2");
    expect(models).toEqual([
      { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", version: "3.5", created: null, efforts: null },
      { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash-Lite", version: "001", created: null, efforts: null },
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", version: null, created: null, efforts: [] },
    ]);
    expect(geminiModels({ models: [] }).next).toBeNull();
  });

  test("reads the methods a model takes as @google/genai hands them on, as supportedActions", () => {
    const { models } = geminiModels({
      models: [
        { name: "models/gemini-3.5-flash", version: "3.5", displayName: "Gemini 3.5 Flash", supportedActions: ["generateContent"] },
        { name: "models/gemini-embedding-001", displayName: "Gemini Embedding 001", supportedActions: ["embedContent"] },
      ],
    });

    expect(models.map(({ id }) => id)).toEqual(["gemini-3.5-flash"]);
  });

  test("with the catalog, offers Gemini's own names, its levels and, for 2.5, the token budget for each", () => {
    const models = describeModels(geminiModels(page).models, BUNDLED_CATALOG.sections.gemini);

    expect(models.map(({ id }) => id)).toEqual(["gemini-flash", "gemini-flash-lite", OTHER_VERSIONS]);
    expect(models[0]?.versions).toEqual([
      {
        id: "gemini-3.5-flash",
        name: "Gemini 3.5 Flash",
        efforts: ["minimal", "low", "medium", "high"],
        defaultEffort: "medium",
        budgets: null,
      },
    ]);
    expect(models[1]?.versions[0]).toMatchObject({
      efforts: ["off", "low", "medium", "high"],
      defaultEffort: "off",
      budgets: { off: 0, low: 1024, medium: 8192, high: 24576 },
    });
    expect(models[2]?.versions[0]).toMatchObject({ id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", efforts: null });
  });
});

describe("openAiModels", () => {
  test("reads each model's ID and when it was made, and nothing more", () => {
    const { models, next } = openAiModels({
      object: "list",
      data: [
        { id: "gpt-6-sol", object: "model", created: 1_788_000_000, owned_by: "system" },
        { id: "llama3.3:70b", object: "model", created: 0, owned_by: "library" },
        { id: "grok-4.7", object: "model" },
      ],
    });

    expect(next).toBeNull();
    expect(models).toEqual([
      { id: "gpt-6-sol", name: null, version: null, created: new Date(1_788_000_000_000).toISOString(), efforts: null },
      { id: "llama3.3:70b", name: null, version: null, created: null, efforts: null },
      { id: "grok-4.7", name: null, version: null, created: null, efforts: null },
    ]);
  });

  test("with the catalog, names each model and offers its levels, since the list says neither", () => {
    const { models } = openAiModels({ data: [{ id: "gpt-5.5" }, { id: "gpt-5-2025-08-07" }, { id: "gpt-3.5-turbo" }] });
    const described = describeModels(models, BUNDLED_CATALOG.sections.openai);

    expect(described.map(({ name, versions }) => [name, versions.map((each) => [each.name, each.efforts])])).toEqual([
      [
        "GPT",
        [
          ["GPT-5.5", ["off", "low", "medium", "high", "extraHigh"]],
          ["GPT-5", ["minimal", "low", "medium", "high"]],
        ],
      ],
      ["Other versions", [["gpt-3.5-turbo", null]]],
    ]);
  });
});

describe("a model list that isn't one", () => {
  test.each([null, "models", {}, { data: "gpt-5" }, { models: {} }])("fails as an unexpected response: %j", (body) => {
    for (const read of [anthropicModels, openAiModels]) {
      expect(() => read(body)).toThrow(ModelProviderError);
    }
    expect(() => geminiModels(body)).toThrow(expect.objectContaining({ failure: expect.objectContaining({ kind: "unexpectedResponse" }) }));
  });

  test("skips an entry without an ID", () => {
    expect(openAiModels({ data: [{ object: "model" }, "gpt-5", { id: "gpt-5" }] }).models.map(({ id }) => id)).toEqual([
      "gpt-5",
    ]);
  });
});
