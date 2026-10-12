import { describe, expect, test } from "vitest";

import type { CommandName } from "../commands/api";
import { fakeKeyStore, fakePlatform } from "../test/fakePlatform";
import { type AiSettings, DEFAULT_AI_SETTINGS } from "./aiSettings";
import { BUNDLED_CATALOG, OTHER_VERSIONS } from "./modelCatalog";
import { MODEL_PROVIDERS } from "./modelProviders";
import type { SuggestionRequest } from "./modelProvider";
import { requestSuggestion } from "./requests";

/*
 * Pen-test round 1, M2 (#26, `docs/pen-test/M2.md`): whichever Model
 * Provider is asked, as Lanewise ships it, on this computer or through a
 * Gateway, its answer comes back as a Suggestion and nothing more. An answer
 * that also asks for a tool, or carries fields of its own, makes Lanewise do
 * nothing it says: the only commands sent are those that read the key and
 * the Gateway, and the Suggestion is only returned, for the user to Accept,
 * Edit or Reject. Every answer here is the fake platform's: nothing reaches a
 * Model Provider.
 */

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

/** The model each fake API lists, which no catalog describes, so it's offered under Other versions. */
const MODEL = "m2-model";

/**
 * A Suggestion that passes every check at high Confidence, with fields no
 * Suggestion has, which name a command, a path outside the working tree and
 * an Accept, as a hostile answer might.
 */
const ANSWER = JSON.stringify({
  explanation: "Keep both sides' changes.",
  resolution: "let b = 2;",
  confidence: "high",
  accept: true,
  apply: "resolveConflict",
  path: "../../outside.txt",
  content: "written without the user",
});

/** A tool call in each API's own shape, asking for the Resolution to be written. */
const TOOL_INPUT = { repository: "/work/lanewise", path: "src/lanes.rs", content: "written without the user" };

/** Each API's answer to its model list and to a request for a Suggestion, with a tool call beside the text. */
const APIS: Record<string, { models: () => Response; answer: () => Response }> = {
  anthropic: {
    models: () => Response.json({ data: [{ type: "model", id: MODEL, display_name: "M2", created_at: "2026-10-12T00:00:00Z" }], has_more: false }),
    answer: () =>
      Response.json({
        id: "msg_01",
        type: "message",
        role: "assistant",
        model: MODEL,
        content: [
          { type: "tool_use", id: "toolu_01", name: "resolveConflict", input: TOOL_INPUT },
          { type: "text", text: ANSWER },
        ],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
  },
  gemini: {
    models: () =>
      Response.json({ models: [{ name: `models/${MODEL}`, version: "1", displayName: "M2", supportedGenerationMethods: ["generateContent"] }] }),
    answer: () =>
      Response.json({
        candidates: [
          {
            content: { role: "model", parts: [{ functionCall: { name: "resolveConflict", args: TOOL_INPUT } }, { text: ANSWER }] },
            finishReason: "STOP",
            index: 0,
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
      }),
  },
  openAiCompatible: {
    models: () => Response.json({ object: "list", data: [{ id: MODEL, object: "model", created: 1_760_227_200, owned_by: "m2" }] }),
    answer: () =>
      Response.json({
        id: "chatcmpl-01",
        object: "chat.completion",
        created: 1_760_227_200,
        model: MODEL,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: ANSWER,
              refusal: null,
              tool_calls: [
                { id: "call_01", type: "function", function: { name: "resolveConflict", arguments: JSON.stringify(TOOL_INPUT) } },
              ],
            },
            finish_reason: "tool_calls",
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
  },
};

function apiOf(provider: string) {
  return APIS[provider === "anthropic" || provider === "gemini" ? provider : "openAiCompatible"]!;
}

/** What `url`'s API answers: its model list, or the Suggestion. */
function answerFor(provider: string, url: string): Response {
  const api = apiOf(provider);
  return /\/models(\?|$)/.test(new URL(url).pathname + new URL(url).search) ? api.models() : api.answer();
}

function settingsFor(provider: string): AiSettings {
  return {
    ...DEFAULT_AI_SETTINGS,
    enabled: true,
    disclosed: [provider],
    global: { provider, model: OTHER_VERSIONS, version: MODEL, effort: null },
  };
}

/** The commands a request for a Suggestion may send: those that read the key and the Gateway, and none that writes. */
const READS: readonly CommandName[] = ["gatewayOf", "modelProviderKey", "gatewayRequest"];

describe.each(MODEL_PROVIDERS.map((provider) => [provider.id, provider] as const))("%s", (id, provider) => {
  test("an answer with a tool call and fields of its own comes back as a Suggestion alone, and nothing is done with it", async () => {
    const fake = fakePlatform({
      commands: fakeKeyStore({ [id]: `key-${id}` }).commands,
      fetch: (url) => answerFor(id, url),
    });

    const suggestion = await requestSuggestion({
      platform: fake.platform,
      providers: [provider],
      settings: settingsFor(id),
      catalog: BUNDLED_CATALOG,
      repository: "/work/lanewise",
      request,
    });

    expect(suggestion).toEqual({
      explanation: "Keep both sides' changes.",
      resolution: "let b = 2;",
      confidence: "high",
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    expect(fake.calls.map(({ name }) => name).filter((name) => !READS.includes(name))).toEqual([]);
    // Its model list and one request for the Suggestion: nothing the answer named was asked for after it.
    expect(fake.fetches).toHaveLength(2);
    expect(fake.logs).toEqual([]);
  });
});

test.each(MODEL_PROVIDERS.filter((provider) => provider.defaultBaseUrl === null).map((provider) => [provider.id, provider] as const))(
  "%s through a Gateway: the answer comes back as a Suggestion alone, and the core is asked only to send the request",
  async (id, provider) => {
    const fake = fakePlatform({
      commands: {
        ...fakeKeyStore({ [id]: `key-${id}` }).commands,
        gatewayOf: () => ({ ok: true, value: { baseUrl: `https://gateway.example.com/${id}`, headerNames: ["X-Gateway-Key"] } }),
        gatewayRequest: ({ path }) => {
          const answer = answerFor(id, `https://${provider.host}${path}`);
          return answer.text().then((body) => ({ ok: true, value: { status: answer.status, headers: [{ name: "content-type", value: "application/json" }], body } }));
        },
      },
    });

    const suggestion = await requestSuggestion({
      platform: fake.platform,
      providers: [provider],
      settings: settingsFor(id),
      catalog: BUNDLED_CATALOG,
      repository: "/work/lanewise",
      request,
    });

    expect(suggestion).toMatchObject({ resolution: "let b = 2;", confidence: "high" });
    expect(Object.keys(suggestion).toSorted()).toEqual(["confidence", "explanation", "resolution", "usage"]);
    expect(fake.calls.map(({ name }) => name)).toEqual(["gatewayOf", "modelProviderKey", "gatewayRequest", "gatewayRequest"]);
    expect(fake.fetches).toEqual([]);
  },
);
