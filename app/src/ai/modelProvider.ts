/**
 * The Model Provider abstraction (PRD §8.2): what every Model Provider's
 * adapter offers, whatever API it speaks. It lists the models the user can
 * choose from, live, for the model catalog to describe (ADR 0021), and asks
 * for a Suggestion for one Conflict Hunk.
 *
 * An adapter never makes a request itself. It's handed a {@link Connection}:
 * the platform's `fetch`, which the Desktop App makes through Tauri's HTTP
 * plugin and Web Mode through its server, so CORS never applies, and the
 * user's own API key, read from the OS credential store for that request
 * alone (ADR 0020).
 */

/** How hard a model thinks before it answers, in the words the picker shows (PRD §8.3). */
export type Effort = "off" | "minimal" | "low" | "medium" | "high" | "extraHigh" | "maximum";

/** Every Effort, least first. */
export const EFFORTS: readonly Effort[] = ["off", "minimal", "low", "medium", "high", "extraHigh", "maximum"];

/**
 * A model as the Model Provider's model-list API gives it, before the model
 * catalog describes it (ADR 0021). What the API doesn't say is `null`.
 */
export interface ListedModel {
  /** The ID the Model Provider's API takes. */
  id: string;
  /** Its name, where the API gives one, as Anthropic's and Gemini's do. */
  name: string | null;
  /**
   * Its version, as the API names it, where it gives one, as Gemini's does,
   * such as `001` or `2.5-preview-09-2025`.
   */
  version: string | null;
  /** When it was released, as an ISO 8601 date, where the API says. */
  created: string | null;
  /**
   * The efforts it takes, least first, where the API says, as Anthropic's
   * does: empty where it takes none. The model catalog's are used otherwise.
   */
  efforts: readonly Effort[] | null;
}

/** One version of a model, such as Claude Opus 4.8. */
export interface ModelVersion {
  /** The ID the Model Provider's API takes. */
  id: string;
  /** Its name, as the Model Provider gives it, or else as the model catalog does. */
  name: string;
  /**
   * The efforts it takes, least first. Empty where it takes none, and `null`
   * for a model the model catalog doesn't know: only the Model Provider's
   * default is offered for it.
   */
  efforts: readonly Effort[] | null;
  /**
   * The Model Provider's own default among `efforts`, or `null` where it
   * takes none, or its default isn't one of them, or isn't known.
   */
  defaultEffort: Effort | null;
  /**
   * For a model that takes a token budget rather than a level,
   * such as Gemini 2.5, the budget sent for each of `efforts`; else `null`.
   */
  budgets: Readonly<Partial<Record<Effort, number>>> | null;
}

/** A model the user can choose, such as Claude Opus, with its versions newest first. */
export interface Model {
  /** The model catalog's ID for it, or `other-versions` for the models the catalog doesn't know. */
  id: string;
  name: string;
  /** Newest first: the first is the default. Never empty. */
  versions: readonly ModelVersion[];
}

/** How far a Suggestion can be trusted. */
export type Confidence = "high" | "medium" | "low";

/** An AI-proposed resolution for one Conflict Hunk. It's never applied without the user's say. */
export interface Suggestion {
  /** A short, plain-English explanation of the reasoning. */
  explanation: string;
  /** The lines the Suggestion would put in place of the Conflict Hunk, markers and all, as text. */
  resolution: string;
  confidence: Confidence;
  /** The tokens the Model Provider says the request took, where it says. */
  usage?: TokenUsage | null;
}

/** How many tokens a request took, as the Model Provider counts them. */
export interface TokenUsage {
  /** What was sent: the prompt, the Conflict Hunk and its context. */
  inputTokens: number;
  /** What came back, thinking included where the Model Provider counts it. */
  outputTokens: number;
}

/**
 * Everything about one Conflict Hunk that's sent to a Model Provider for a
 * Suggestion, and nothing more: never the whole file (PRD §8.1). The first-use
 * disclosure names each of these (`sentForASuggestion` in `aiWords.ts`).
 */
export interface SuggestionRequest {
  /** The file's path, from the working tree's top folder. */
  path: string;
  /** Each version of the Conflict Hunk's lines. `base` is `null` for a file added on both sides. */
  base: readonly string[] | null;
  ours: readonly string[];
  theirs: readonly string[];
  /** The lines round the Conflict Hunk, up to the context chosen in Settings on each side. */
  before: readonly string[];
  after: readonly string[];
  /** The subjects of the commits on each side, where there is one. */
  oursSubject: string | null;
  theirsSubject: string | null;
}

/** The model, version and effort a request is made with. */
export interface ModelSelection {
  model: string;
  version: string;
  /** `null` for the Model Provider's default. */
  effort: Effort | null;
  /** The token budget `effort` is sent as, for a model that takes one, else `null`. */
  budget: number | null;
}

/** How an adapter reaches its Model Provider, for one request. */
export interface Connection {
  /** The platform's `fetch`: never the page's own. */
  fetch(url: string, init?: RequestInit): Promise<Response>;
  /**
   * The user's API key, or `null` where none is kept for a Model Provider
   * whose key is optional, such as a local server.
   */
  apiKey: string | null;
  /**
   * For a Model Provider on this computer, the base URL the user set for its
   * API in Settings, where they set one. Every other adapter ignores it.
   */
  baseUrl?: string;
  signal?: AbortSignal;
}

/** One Model Provider's adapter. */
export interface ModelProvider {
  /** Its ID, such as `anthropic`: lowercase letters, digits and dashes. Its API key is kept under it. */
  id: string;
  /** Its name, as Settings shows it, such as "Anthropic (Claude)". */
  name: string;
  /** Where the user makes an API key, or `null` where there's no such page, as for a local server. */
  apiKeyPage: string | null;
  /**
   * Whether a request needs the user's API key, or takes one only where it's
   * kept, as a local server does when it's set up to ask for one.
   */
  key: "required" | "optional";
  /**
   * Where its requests go, as the first-use disclosure names it, such as
   * `api.anthropic.com`, or `this computer` for a local server.
   */
  host: string;
  /**
   * For a Model Provider on this computer, the base URL of its API until the
   * user sets one in Settings, such as Ollama's; `null` for one whose API is
   * always in one place.
   */
  defaultBaseUrl: string | null;
  /** The model catalog's section that describes its models, such as `anthropic`. */
  catalog: string;
  /** Its models, live from its model-list API, as it gives them. */
  listModels(connection: Connection): Promise<ListedModel[]>;
  /** A Suggestion for one Conflict Hunk. */
  suggest(request: SuggestionRequest, selection: ModelSelection, connection: Connection): Promise<Suggestion>;
}

/** Why a request to a Model Provider failed, by `kind`. */
export type ModelProviderFailure =
  /** The Model Provider refused the API key, or there's none kept for it. */
  | { kind: "keyRefused" }
  /** Too many requests for now, or the account is out of credit. */
  | { kind: "rateLimited" }
  /** It couldn't be reached, such as for want of a network. */
  | { kind: "unreachable"; message: string }
  /** It's overloaded, or failed on its side, for now. */
  | { kind: "unavailable"; message: string }
  /** It turned the request down, saying why, such as a model the account can't use. */
  | { kind: "rejected"; message: string }
  /** The model declined to make a Suggestion, with its explanation where it gave one. */
  | { kind: "declined"; explanation: string | null }
  /** It answered, but not with what was asked for. */
  | { kind: "unexpectedResponse"; message: string };

/** A failed request to a Model Provider. Its message never carries the API key. */
export class ModelProviderError extends Error {
  constructor(readonly failure: ModelProviderFailure) {
    super("message" in failure ? failure.message : failure.kind);
    this.name = "ModelProviderError";
  }
}
