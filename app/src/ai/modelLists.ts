import { type Effort, type ListedModel, ModelProviderError } from "./modelProvider";

/**
 * Each Model Provider's model-list API, as it answers, read into the models
 * it lists (ADR 0021). The model catalog describes them afterwards. Only
 * Claude's and Gemini's give names, and only Claude's efforts; what an API
 * doesn't say is left `null` for the catalog. The adapters ask for each
 * page in turn, through their SDKs: Anthropic's (ADR 0022) and Gemini's
 * (ADR 0023).
 */

/** One page of a Model Provider's model list, and where the next one starts, if there's one. */
export interface ModelPage {
  models: ListedModel[];
  /** What to ask the API for to get the next page: its cursor, or `null` on the last page. */
  next: string | null;
}

type Fields = Record<string, unknown>;

function fields(value: unknown): Fields | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function unexpected(what: string): ModelProviderError {
  return new ModelProviderError({ kind: "unexpectedResponse", message: `Its model list ${what}.` });
}

/** The entries of `body`'s list under `key`, or a failure if there's no such list. */
function entries(body: unknown, key: string): Fields[] {
  const list = fields(body)?.[key];
  if (!Array.isArray(list)) throw unexpected("wasn't a list of models");
  return list.flatMap((each) => {
    const entry = fields(each);
    return entry === null ? [] : [entry];
  });
}

/** An effort level as Anthropic's API names it. */
export type AnthropicEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Anthropic's effort levels, as its API names them, in the words the picker shows. */
export const ANTHROPIC_EFFORTS: readonly [AnthropicEffort, Effort][] = [
  ["low", "low"],
  ["medium", "medium"],
  ["high", "high"],
  ["xhigh", "extraHigh"],
  ["max", "maximum"],
];

/** The efforts a Claude model's `capabilities` say it takes, or `null` where they don't say. */
function anthropicEfforts(capabilities: unknown): Effort[] | null {
  const effort = fields(fields(capabilities)?.effort);
  if (effort === null || typeof effort.supported !== "boolean") return null;
  if (!effort.supported) return [];
  return ANTHROPIC_EFFORTS.flatMap(([api, level]) => (fields(effort[api])?.supported === true ? [level] : []));
}

/**
 * A page of Anthropic's Models API (`GET /v1/models`): each model's ID,
 * display name, release date and, where it says, the efforts it takes.
 */
export function anthropicModels(body: unknown): ModelPage {
  const models = entries(body, "data").flatMap((entry): ListedModel[] => {
    const id = text(entry.id);
    if (id === null) return [];
    const created = text(entry.created_at);
    return [
      {
        id,
        name: text(entry.display_name),
        version: null,
        created: created === null || Number.isNaN(Date.parse(created)) ? null : new Date(created).toISOString(),
        efforts: anthropicEfforts(entry.capabilities),
      },
    ];
  });
  const { has_more: more, last_id: last } = fields(body) as Fields;
  return { models, next: more === true ? text(last) : null };
}

/**
 * A page of Gemini's `models.list`: each model that can generate content,
 * so can be chatted with, by the ID its API takes, without `models/`, with
 * its display name and version. One that says it doesn't think takes no
 * effort; the catalog says for the rest. The API names the methods a model
 * takes `supportedGenerationMethods`, and `@google/genai` hands them on as
 * `supportedActions`: either is read.
 */
export function geminiModels(body: unknown): ModelPage {
  const models = entries(body, "models").flatMap((entry): ListedModel[] => {
    const id = text(entry.name)?.replace(/^models\//, "") ?? null;
    const given = entry.supportedGenerationMethods ?? entry.supportedActions;
    const methods: unknown[] = Array.isArray(given) ? given : [];
    if (id === null || id === "" || !methods.includes("generateContent")) return [];
    return [
      {
        id,
        name: text(entry.displayName),
        version: text(entry.version),
        created: null,
        efforts: entry.thinking === false ? [] : null,
      },
    ];
  });
  return { models, next: text((fields(body) as Fields).nextPageToken) };
}

/**
 * The OpenAI-compatible `GET /models`, as OpenAI, xAI, Meta and local
 * servers answer it: only each model's ID and, where given, when it was
 * made. It's never paged.
 */
export function openAiModels(body: unknown): ModelPage {
  const models = entries(body, "data").flatMap((entry): ListedModel[] => {
    const id = text(entry.id);
    if (id === null) return [];
    const { created } = entry;
    const made = typeof created === "number" ? new Date(created * 1000) : null;
    const known = made !== null && created !== 0 && !Number.isNaN(made.getTime());
    return [{ id, name: null, version: null, created: known ? made.toISOString() : null, efforts: null }];
  });
  return { models, next: null };
}
