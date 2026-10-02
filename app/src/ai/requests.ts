import type { ModelProviderKeyError } from "../commands/api";
import { writeLog } from "../diagnostics/log";
import { withActivity } from "../ui/activity";
import { gatewayFetch } from "./gateway";
import type { JevSettings } from "./jevSettings";
import type { Platform } from "../platform/platform";
import { type AiSettings, modelChoiceFor, selectionFor } from "./aiSettings";
import { type CatalogSource, type ModelCatalog, describeModels } from "./modelCatalog";
import { type Connection, type Model, type ModelProvider, ModelProviderError, type Suggestion, type SuggestionRequest } from "./modelProvider";

/** What a Suggestion is asked for through: the platform, the Model Providers there are adapters for, AI's settings and the model catalog. */
export interface AiAccess {
  platform: Pick<Platform, "commands" | "fetch">;
  providers: readonly ModelProvider[];
  settings: AiSettings;
  /** The model catalog for the run, which Settings' Refresh models fetches again. */
  catalogs: CatalogSource;
  /** Which decisions Jev makes, if it's on (ADR 0036). */
  jev?: JevSettings;
}

/** Why AI can't make a request yet, by `kind`: each is something the user puts right in Settings. */
export type AiRefusal =
  /** AI is off. */
  | { kind: "off" }
  /** No Model Provider is chosen, or the one chosen has no adapter here. */
  | { kind: "noModelProvider" }
  /** The user hasn't accepted the Model Provider's first-use disclosure. */
  | { kind: "notDisclosed"; provider: string }
  /** No model is chosen, or the one chosen isn't listed any more. */
  | { kind: "noModel"; provider: string }
  /** No API key is kept for the Model Provider. */
  | { kind: "noKey"; provider: string }
  /** The OS credential store couldn't give the API key. */
  | { kind: "keyStore"; provider: string; error: ModelProviderKeyError };

/** A request AI refused to make. Nothing was sent. */
export class AiRefusedError extends Error {
  constructor(readonly refusal: AiRefusal) {
    super(refusal.kind);
    this.name = "AiRefusedError";
  }
}

/** Whether `provider` has a gateway kept: none where it can't be read, when its requests go to its own API. */
async function keptGateway(platform: Pick<Platform, "commands">, provider: ModelProvider) {
  try {
    return await platform.commands.call("gatewayOf", { provider: provider.id });
  } catch {
    return null;
  }
}

/**
 * A connection to `provider` for one request: the platform's `fetch`, the
 * API key read from the OS credential store just now, which isn't kept, and,
 * for a Model Provider on this computer, the base URL set for it in
 * `settings`. A Model Provider whose key is optional is asked without one
 * where none is kept, or where there's no credential store to keep one in.
 * A Model Provider with a gateway kept is asked through it, by the core (ADR 0035).
 */
export async function connect(
  platform: Pick<Platform, "commands" | "fetch">,
  provider: ModelProvider,
  settings: AiSettings,
  signal?: AbortSignal,
): Promise<Connection> {
  const gateway = provider.defaultBaseUrl === null ? await keptGateway(platform, provider) : null;
  const fetch =
    gateway?.ok && gateway.value !== null
      ? gatewayFetch(platform.commands, provider)
      : (url: string, init?: RequestInit) => platform.fetch(url, init);
  const baseUrl = provider.defaultBaseUrl === null ? undefined : (settings.baseUrls[provider.id] ?? provider.defaultBaseUrl);
  const optional = provider.key === "optional";
  const kept = await platform.commands.call("modelProviderKey", { provider: provider.id });
  if (!kept.ok) {
    if (optional && kept.error.kind === "storeUnavailable") return { fetch, apiKey: null, baseUrl, signal };
    throw new AiRefusedError({ kind: "keyStore", provider: provider.id, error: kept.error });
  }
  if (kept.value === null && !optional) throw new AiRefusedError({ kind: "noKey", provider: provider.id });
  return { fetch, apiKey: kept.value?.key ?? null, baseUrl, signal };
}

/** `provider`'s models, live from its model-list API through `connection`, as `catalog` describes them. */
async function describedModels(provider: ModelProvider, catalog: ModelCatalog, connection: Connection): Promise<Model[]> {
  return describeModels(await provider.listModels(connection), catalog.sections[provider.catalog]);
}

/**
 * `provider`'s models, live from its model-list API, grouped and described
 * by `catalog`. Only the API key is sent, and only with AI on and the Model
 * Provider's disclosure accepted.
 */
export async function listModels(
  platform: Pick<Platform, "commands" | "fetch">,
  provider: ModelProvider,
  settings: AiSettings,
  catalog: ModelCatalog,
  signal?: AbortSignal,
): Promise<Model[]> {
  if (!settings.enabled) throw new AiRefusedError({ kind: "off" });
  if (!settings.disclosed.includes(provider.id)) {
    throw new AiRefusedError({ kind: "notDisclosed", provider: provider.id });
  }
  return withActivity(`Reading ${provider.name}'s models…`, async (activity) => {
    const connection = await connect(platform, provider, settings, signal);
    activity.step(2, `Reading ${provider.name}'s models…`);
    return describedModels(provider, catalog, connection);
  }, 2);
}

/**
 * A Suggestion for one Conflict Hunk in `repository`, by its `root`, from
 * the Model Provider, model, version and effort chosen for it. It refuses,
 * sending nothing, unless AI is on and the user accepted that Model
 * Provider's first-use disclosure. The Suggestion is only returned: nothing
 * here applies it.
 */
export async function requestSuggestion({
  platform,
  providers,
  settings,
  catalog,
  repository,
  request,
  signal,
}: {
  platform: Pick<Platform, "commands" | "fetch">;
  providers: readonly ModelProvider[];
  settings: AiSettings;
  /** The model catalog, which describes the models listed. */
  catalog: ModelCatalog;
  repository: string | null;
  request: SuggestionRequest;
  signal?: AbortSignal;
}): Promise<Suggestion> {
  if (!settings.enabled) throw new AiRefusedError({ kind: "off" });
  const choice = modelChoiceFor(settings, repository);
  const provider = providers.find((each) => each.id === choice?.provider);
  if (choice === null || provider === undefined) throw new AiRefusedError({ kind: "noModelProvider" });
  if (!settings.disclosed.includes(provider.id)) {
    throw new AiRefusedError({ kind: "notDisclosed", provider: provider.id });
  }
  if (choice.model === null) throw new AiRefusedError({ kind: "noModel", provider: provider.id });
  const model = choice.model;
  // Each step says what it's doing, so a Suggestion that takes a while isn't taken for stuck.
  return withActivity(
    `Reading your ${provider.name} API key…`,
    async (activity) => {
      const connection = await connect(platform, provider, settings, signal);
      activity.step(2, `Reading ${provider.name}'s models…`);
      // The newest version is whichever is newest now, so the list is read afresh.
      const selection = selectionFor(choice, await describedModels(provider, catalog, connection));
      if (selection === null) throw new AiRefusedError({ kind: "noModel", provider: provider.id });
      activity.step(3, `Asking ${provider.name} (${model}) for a Suggestion… This can take a minute.`);
      try {
        return await provider.suggest(request, selection, connection);
      } catch (failure) {
        // Only its kind: a Model Provider's message could quote the prompt.
        if (failure instanceof ModelProviderError) {
          writeLog(platform.commands, "warn", `A Suggestion from ${provider.id} failed: ${failure.failure.kind}`);
        }
        throw failure;
      }
    },
    3,
  );
}

/**
 * Whether `failure`, of a request for a Suggestion, is that Conflict Hunk's
 * own: the model declined it, the Model Provider turned that request down,
 * or its answer couldn't be read. Asking about the next Conflict Hunk could
 * still work. Any other failure, such as AI refusing, the key refused, too
 * many requests or the Model Provider not reached, would fail it too.
 */
export function failsOnlyThisRequest(failure: unknown): boolean {
  if (!(failure instanceof ModelProviderError)) return false;
  const { kind } = failure.failure;
  return kind === "declined" || kind === "rejected" || kind === "unexpectedResponse";
}
