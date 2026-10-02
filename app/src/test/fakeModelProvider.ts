import { CATALOG_URL, type ModelCatalog, describeModels, parseCatalog } from "../ai/modelCatalog";
import type { Connection, ListedModel, Model, ModelProvider, ModelProviderFailure, Suggestion } from "../ai/modelProvider";
import { ModelProviderError } from "../ai/modelProvider";
import { SUGGESTION_INSTRUCTIONS, SUGGESTION_SCHEMA, readSuggestion, suggestionPrompt } from "../ai/suggestionRequest";

/** Where the fake Model Provider's API is. Nothing is there: the fake platform's `fetch` answers. */
export const FAKE_API = "https://api.fake-model-provider.test";

/** A request the fake Model Provider's API was sent, its body parsed. */
export interface FakeModelRequest {
  url: string;
  method: string;
  /** The `Authorization` header sent: `Bearer` and the API key. */
  authorization: string | null;
  body: unknown;
}

/**
 * The model catalog as the fake platform's `fetch` serves it from
 * `CATALOG_URL`, with the `fake` section every fake Model Provider reads:
 * Fake Opus, with two versions, the older taking a token budget, and Fake
 * Mini. It leaves out image models.
 */
export const FAKE_CATALOG_JSON = {
  format: 1,
  providers: {
    fake: {
      exclude: [".*-image-.*"],
      families: [
        {
          id: "fake-opus",
          name: "Fake Opus",
          versions: [
            {
              match: "fake-opus-5(-\\d{8})?",
              examples: ["fake-opus-5"],
              efforts: ["low", "medium", "high", "maximum"],
              defaultEffort: "high",
            },
            {
              match: "fake-opus-4",
              examples: ["fake-opus-4"],
              efforts: ["low", "medium", "high"],
              defaultEffort: "medium",
              budgets: { low: 1024, medium: 8192, high: 24576 },
            },
          ],
        },
        {
          id: "fake-mini",
          name: "Fake Mini",
          versions: [{ match: "fake-mini-1", examples: ["fake-mini-1"], name: "Fake Mini 1", efforts: [], defaultEffort: null }],
        },
      ],
    },
  },
};

/** {@link FAKE_CATALOG_JSON}, read. */
export const FAKE_CATALOG = parseCatalog(FAKE_CATALOG_JSON) as ModelCatalog;

/**
 * The fake Model Provider's model list: Fake Opus 5 and 4, Fake Mini 1,
 * which its API says takes no effort, Fake Lab 1, which the catalog doesn't
 * describe, and an image model, which it excludes.
 */
export const FAKE_LISTED: ListedModel[] = [
  { id: "fake-opus-4", name: "Fake Opus 4", version: null, created: "2025-05-01T00:00:00.000Z", efforts: null },
  { id: "fake-lab-1", name: null, version: null, created: null, efforts: null },
  { id: "fake-opus-5", name: "Fake Opus 5", version: null, created: "2026-05-01T00:00:00.000Z", efforts: null },
  { id: "fake-mini-1", name: null, version: null, created: "2026-01-01T00:00:00.000Z", efforts: [] },
  { id: "fake-mini-image-1", name: "Fake Mini Image 1", version: null, created: null, efforts: null },
];

/** {@link FAKE_LISTED} as {@link FAKE_CATALOG} describes it. */
export const FAKE_MODELS: Model[] = describeModels(FAKE_LISTED, FAKE_CATALOG.sections.fake);

/** Where the fake local Model Provider's API is until Settings says otherwise. */
export const FAKE_LOCAL_API = "http://localhost:11434/v1";

/** The Suggestion the fake API answered, with the tokens it says it took, as a real Model Provider's does. */
function withUsage(answered: unknown): Suggestion {
  const { usage } = (answered ?? {}) as { usage?: Suggestion["usage"] };
  return { ...readSuggestion(answered), ...(usage ? { usage } : {}) };
}

/**
 * A Model Provider for tests, and the API it talks to, answered through the
 * fake platform's `fetch`: it lists `models` and answers each Suggestion
 * with `suggestion`, for the API key `key` alone, and logs every request.
 * It serves {@link FAKE_CATALOG_JSON} from `CATALOG_URL` too, unlogged.
 *
 * A `local` one is a server on this computer, as a local server's adapter
 * is: its API key is optional, and it's asked at the connection's base URL,
 * or else at {@link FAKE_LOCAL_API}. With a `key` of `null` it answers
 * without one.
 */
export function fakeModelProvider({
  id = "fake",
  name = "Fake Model Provider",
  key = "sk-fake",
  local = false,
  models = FAKE_LISTED,
  suggestion = { explanation: "Both sides renamed it; keep Theirs.", resolution: "const b = 2;", confidence: "high" },
}: {
  id?: string;
  name?: string;
  key?: string | null;
  local?: boolean;
  models?: ListedModel[];
  suggestion?: Suggestion;
} = {}): {
  provider: ModelProvider;
  /** Answers a request to the fake API as the Model Provider would. */
  answer(url: string, init?: RequestInit): Response;
  requests: FakeModelRequest[];
} {
  const requests: FakeModelRequest[] = [];
  const api = `${FAKE_API}/${id}`;
  const apiOf = (connection: Connection) => (local ? (connection.baseUrl ?? FAKE_LOCAL_API) : api);

  async function send(connection: Connection, path: string, body?: unknown) {
    let response: Response;
    try {
      response = await connection.fetch(`${apiOf(connection)}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(connection.apiKey === null ? {} : { authorization: `Bearer ${connection.apiKey}` }),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: connection.signal,
      });
    } catch (failure) {
      throw new ModelProviderError({ kind: "unreachable", message: String(failure) });
    }
    const failures: Record<number, ModelProviderFailure> = {
      401: { kind: "keyRefused" },
      429: { kind: "rateLimited" },
    };
    const failure = failures[response.status];
    if (failure !== undefined) throw new ModelProviderError(failure);
    if (!response.ok) {
      throw new ModelProviderError({ kind: "unexpectedResponse", message: `It answered ${response.status}.` });
    }
    return response.json() as Promise<unknown>;
  }

  const provider: ModelProvider = {
    id,
    name,
    key: local ? "optional" : "required",
    apiKeyPage: local ? null : `https://fake-model-provider.test/${id}/api-keys`,
    host: local ? "this computer" : new URL(FAKE_API).host,
    defaultBaseUrl: local ? FAKE_LOCAL_API : null,
    catalog: "fake",
    async listModels(connection) {
      return ((await send(connection, "/models")) as { models: ListedModel[] }).models;
    },
    async suggest(request, selection, connection) {
      return withUsage(
        await send(connection, "/suggest", {
          ...selection,
          instructions: SUGGESTION_INSTRUCTIONS,
          prompt: suggestionPrompt(request),
          schema: SUGGESTION_SCHEMA,
        }),
      );
    },
  };

  function answer(url: string, init: RequestInit = {}): Response {
    if (url === CATALOG_URL) return Response.json(FAKE_CATALOG_JSON);
    const headers = new Headers(init.headers);
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : null;
    requests.push({ url, method: init.method ?? "GET", authorization: headers.get("authorization"), body });
    if (key !== null && headers.get("authorization") !== `Bearer ${key}`) return new Response("{}", { status: 401 });
    if (url.endsWith("/models") && (local || url === `${api}/models`)) return Response.json({ models });
    if (url.endsWith("/suggest") && (local || url === `${api}/suggest`)) return Response.json(suggestion);
    return new Response("{}", { status: 404 });
  }

  return { provider, answer, requests };
}
