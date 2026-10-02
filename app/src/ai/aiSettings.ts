import { CONTEXT_LINES, MOST_CONTEXT_LINES } from "./suggestionRequest";
import { type Effort, EFFORTS, type Model, type ModelSelection, type ModelVersion } from "./modelProvider";

/** A Model Provider, model, version and effort chosen in Settings. */
export interface ModelChoice {
  /** The Model Provider's ID. */
  provider: string;
  /** The model's ID, or `null` until one is chosen. */
  model: string | null;
  /** The version's ID, or `null` for the newest, whichever that is when a request is made. */
  version: string | null;
  /** `null` for the Model Provider's own default. */
  effort: Effort | null;
}

/** Everything Settings keeps about AI (PRD §8.2), under `MODEL_PROVIDER_KEY`. Never an API key. */
export interface AiSettings {
  /** Whether AI is on. It's off until the user turns it on, after the first-use disclosure. */
  enabled: boolean;
  /** The Model Providers whose first-use disclosure the user accepted, by ID. */
  disclosed: readonly string[];
  /** How many lines round a Conflict Hunk are sent on each side. */
  contextLines: number;
  /** The choice for every repository, or `null` before one is made. */
  global: ModelChoice | null;
  /** The choices for repositories set apart from the global one, by their `root`. */
  repositories: Readonly<Record<string, ModelChoice>>;
  /**
   * The base URL the user set for each Model Provider on this computer, such
   * as a local server's, by its ID. One not set here has its default.
   */
  baseUrls: Readonly<Record<string, string>>;
}

/** AI as it is until the user changes it: off, with nothing chosen. */
export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  disclosed: [],
  contextLines: CONTEXT_LINES,
  global: null,
  repositories: {},
  baseUrls: {},
};

/** The hosts a Model Provider on this computer can be reached at, as the Desktop App's HTTP scope allows. */
const LOOPBACK_HOSTS: readonly string[] = ["localhost", "127.0.0.1"];

/**
 * `given` as the base URL of a Model Provider's API on this computer, such as
 * `http://localhost:11434/v1`, without a trailing slash, or `null` if it
 * isn't one: plain `http` to `localhost` or `127.0.0.1`, on a port it names,
 * as the Desktop App's HTTP scope allows, with a path but no user, query or
 * fragment. Nothing else can be reached, so an
 * API key kept for a local server never leaves this computer.
 */
export function localBaseUrl(given: string): string | null {
  let url: URL;
  try {
    url = new URL(given.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.includes(url.hostname) || url.port === "") return null;
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function parseChoice(value: unknown): ModelChoice | null {
  if (typeof value !== "object" || value === null) return null;
  const { provider, model, version, effort } = value as Record<string, unknown>;
  const id = text(provider);
  if (id === null) return null;
  return {
    provider: id,
    model: text(model),
    version: text(version),
    effort: EFFORTS.includes(effort as Effort) ? (effort as Effort) : null,
  };
}

/** Whether `lines` is a number of context lines Settings allows. */
export function allowedContextLines(lines: number): boolean {
  return Number.isInteger(lines) && lines >= 0 && lines <= MOST_CONTEXT_LINES;
}

/** The AI settings kept as `raw`: whatever of them can be read, and the defaults for the rest. */
export function parseAiSettings(raw: string | null): AiSettings {
  let kept: unknown;
  try {
    kept = raw === null ? null : JSON.parse(raw);
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
  if (typeof kept !== "object" || kept === null) return DEFAULT_AI_SETTINGS;
  const { enabled, disclosed, contextLines, global, repositories, baseUrls } = kept as Record<string, unknown>;
  const set: Record<string, ModelChoice> = {};
  if (typeof repositories === "object" && repositories !== null) {
    for (const [root, choice] of Object.entries(repositories)) {
      const parsed = parseChoice(choice);
      if (parsed !== null) set[root] = parsed;
    }
  }
  const urls: Record<string, string> = {};
  if (typeof baseUrls === "object" && baseUrls !== null) {
    for (const [provider, url] of Object.entries(baseUrls)) {
      const parsed = typeof url === "string" ? localBaseUrl(url) : null;
      if (parsed !== null) urls[provider] = parsed;
    }
  }
  return {
    enabled: enabled === true,
    disclosed: Array.isArray(disclosed) ? disclosed.filter((id): id is string => text(id) !== null) : [],
    contextLines:
      typeof contextLines === "number" && allowedContextLines(contextLines) ? contextLines : CONTEXT_LINES,
    global: parseChoice(global),
    repositories: set,
    baseUrls: urls,
  };
}

/** The choice that holds in `repository`, by its `root`: its own if it's set apart, or the global one. */
export function modelChoiceFor(settings: AiSettings, repository: string | null): ModelChoice | null {
  return (repository === null ? undefined : settings.repositories[repository]) ?? settings.global;
}

/** Every Model Provider chosen, globally or for a repository, once each. */
export function modelProvidersInUse(settings: AiSettings): string[] {
  const chosen = [settings.global, ...Object.values(settings.repositories)].flatMap((choice) =>
    choice === null ? [] : [choice.provider],
  );
  return [...new Set(chosen)];
}

/**
 * The Model Providers that `settings` would send Conflict Hunks to without
 * the user having accepted their first-use disclosure: none while AI is off.
 */
export function undisclosed(settings: AiSettings): string[] {
  if (!settings.enabled) return [];
  return modelProvidersInUse(settings).filter((id) => !settings.disclosed.includes(id));
}

/** The version `choice` holds among `model`'s: the one chosen if it's still listed, else the newest. */
export function versionFor(choice: ModelChoice, model: Model): ModelVersion {
  const [newest] = model.versions;
  return model.versions.find((version) => version.id === choice.version) ?? (newest as ModelVersion);
}

/**
 * The model, version and effort a request is made with for `choice`, from
 * the Model Provider's `models` as listed now, or `null` if its model isn't
 * chosen, or isn't listed any more. An effort the version doesn't take gives
 * way to its default, and one it takes as a token budget carries it.
 */
export function selectionFor(choice: ModelChoice, models: readonly Model[]): ModelSelection | null {
  const model = models.find((each) => each.id === choice.model);
  if (model === undefined || model.versions.length === 0) return null;
  const version = versionFor(choice, model);
  const effort = choice.effort !== null && version.efforts?.includes(choice.effort) === true ? choice.effort : null;
  const budget = effort === null ? null : (version.budgets?.[effort] ?? null);
  return { model: model.id, version: version.id, effort, budget };
}
