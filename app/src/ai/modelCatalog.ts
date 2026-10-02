import bundled from "../../../catalog/models.json";
import { withActivity } from "../ui/activity";
import type { Platform } from "../platform/platform";
import { type Effort, EFFORTS, type ListedModel, type Model, type ModelVersion } from "./modelProvider";

/**
 * The model catalog (PRD §8.3, ADR 0021): for each Model Provider, which
 * model and version each model ID its live list returns is, and the Effort
 * levels it takes. The live lists decide which models exist; the catalog
 * only describes them. Its source is `catalog/models.json`, with its schema
 * beside it, and this checks a copy just as strictly.
 */
export interface ModelCatalog {
  /** Each Model Provider's section, by the name its adapter gives as `catalog`. */
  sections: Readonly<Record<string, CatalogSection>>;
}

/** One Model Provider's models. */
export interface CatalogSection {
  /** Model IDs that can't be chatted with, such as image and speech models, which aren't offered. */
  exclude: readonly RegExp[];
  /** The models offered, in the order they're offered. */
  families: readonly CatalogFamily[];
}

/** A model, such as Claude Opus, and its versions, newest first. */
export interface CatalogFamily {
  id: string;
  name: string;
  versions: readonly CatalogVersion[];
}

/** One version of a model, and the model IDs that are it. */
export interface CatalogVersion {
  /** Matches the whole of each model ID this version is. */
  match: RegExp;
  /** Model IDs this version is, which the catalog's tests check. */
  examples: readonly string[];
  /** Its name, where the Model Provider's list gives none. */
  name: string | null;
  efforts: readonly Effort[];
  defaultEffort: Effort | null;
  budgets: Readonly<Partial<Record<Effort, number>>> | null;
}

/** Where the repository's own copy of the model catalog is, fetched afresh for each run of Lanewise. */
export const CATALOG_URL = "https://raw.githubusercontent.com/adrianeyre/lanewise/main/catalog/models.json";

/** The one format of the catalog this Lanewise reads. A copy in any other is ignored for the bundled one. */
export const CATALOG_FORMAT = 1;

/** The model ID the models the catalog doesn't describe are listed under. */
export const OTHER_VERSIONS = "other-versions";

/** How long a refresh of the catalog may take before the bundled copy is used instead. */
const CATALOG_TIMEOUT = 10_000;

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

type Fields = Record<string, unknown>;

function fields(value: unknown): Fields | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** `source` as a pattern matching a whole model ID, or `null` if it isn't a regular expression. */
function pattern(source: unknown): RegExp | null {
  if (text(source) === null) return null;
  try {
    return new RegExp(`^(?:${source as string})$`);
  } catch {
    return null;
  }
}

function patterns(value: unknown): RegExp[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const read = value.map(pattern);
  return read.every((each) => each !== null) ? (read as RegExp[]) : null;
}

/** `value` as Effort levels, least first and each once, or `null` if it isn't that. */
function efforts(value: unknown): Effort[] | null {
  if (!Array.isArray(value)) return null;
  const order = value.map((each) => EFFORTS.indexOf(each as Effort));
  const ascending = order.every((each, index) => each >= 0 && (index === 0 || each > (order[index - 1] as number)));
  return ascending ? (value as Effort[]) : null;
}

/** `value` as the budget for each of `levels` and no other, or `null` if it isn't that. */
function budgets(value: unknown, levels: readonly Effort[]): Partial<Record<Effort, number>> | null {
  const read = fields(value);
  if (read === null) return null;
  const keys = Object.keys(read);
  const exact = keys.length === levels.length && levels.every((level) => level in read);
  const counts = Object.values(read).every((each) => Number.isInteger(each) && (each as number) >= 0);
  return exact && counts && keys.length > 0 ? (read as Partial<Record<Effort, number>>) : null;
}

function readVersion(value: unknown): CatalogVersion | null {
  const read = fields(value);
  if (read === null) return null;
  const match = pattern(read.match);
  const examples = Array.isArray(read.examples) ? read.examples.map(text) : [];
  const levels = efforts(read.efforts);
  const { defaultEffort } = read;
  if (match === null || examples.length === 0 || examples.includes(null) || levels === null) return null;
  if (read.name !== undefined && text(read.name) === null) return null;
  if (defaultEffort !== null && !levels.includes(defaultEffort as Effort)) return null;
  const budget = read.budgets === undefined ? null : budgets(read.budgets, levels);
  if (read.budgets !== undefined && budget === null) return null;
  return {
    match,
    examples: examples as string[],
    name: text(read.name),
    efforts: levels,
    defaultEffort: defaultEffort as Effort | null,
    budgets: budget,
  };
}

function readFamily(value: unknown): CatalogFamily | null {
  const read = fields(value);
  const id = text(read?.id);
  const name = text(read?.name);
  if (id === null || !ID.test(id) || id === OTHER_VERSIONS || name === null) return null;
  if (!Array.isArray(read?.versions) || read.versions.length === 0) return null;
  const versions = read.versions.map(readVersion);
  return versions.every((each) => each !== null) ? { id, name, versions: versions as CatalogVersion[] } : null;
}

function readSection(value: unknown): CatalogSection | null {
  const read = fields(value);
  const exclude = patterns(read?.exclude);
  if (read === null || exclude === null || !Array.isArray(read.families)) return null;
  const families = read.families.map(readFamily);
  if (!families.every((each) => each !== null)) return null;
  const ids = families.map((each) => (each as CatalogFamily).id);
  return new Set(ids).size === ids.length ? { exclude, families: families as CatalogFamily[] } : null;
}

/**
 * `value`, a copy of the model catalog, if it's entirely as its schema
 * (`catalog/models.schema.json`) says, and in this Lanewise's format, and
 * with each version's efforts least first, its default among them and a
 * budget for each of them where it has budgets; else `null`. A copy that's
 * wrong anywhere is never used in part.
 */
export function parseCatalog(value: unknown): ModelCatalog | null {
  const read = fields(value);
  const providers = fields(read?.providers);
  if (read?.format !== CATALOG_FORMAT || providers === null) return null;
  const sections: Record<string, CatalogSection> = {};
  for (const [name, each] of Object.entries(providers)) {
    const parsed = readSection(each);
    if (!ID.test(name) || parsed === null) return null;
    sections[name] = parsed;
  }
  return { sections };
}

function bundledCatalog(): ModelCatalog {
  const catalog = parseCatalog(bundled);
  if (catalog === null) throw new Error("The bundled model catalog, catalog/models.json, isn't as its schema says.");
  return catalog;
}

/** The copy of the model catalog Lanewise was built with, for when the repository's can't be had. */
export const BUNDLED_CATALOG: ModelCatalog = bundledCatalog();

/** The model catalog a run of Lanewise uses. */
export interface LoadedCatalog {
  catalog: ModelCatalog;
  /** Whether it's the repository's copy, just fetched, rather than the bundled one. */
  refreshed: boolean;
}

/**
 * The repository's copy of the model catalog, fetched through `fetch`, or
 * the bundled copy if it can't be fetched, such as offline, or isn't one
 * this Lanewise can read. Nothing is sent with it: no API key, and nothing
 * about the user's repositories.
 */
export async function fetchCatalog(fetch: Platform["fetch"]): Promise<LoadedCatalog> {
  try {
    const response = await fetch(CATALOG_URL, { method: "GET", signal: AbortSignal.timeout(CATALOG_TIMEOUT) });
    const catalog = response.ok ? parseCatalog(await response.json()) : null;
    if (catalog !== null) return { catalog, refreshed: true };
  } catch {
    // Offline, or not JSON: the bundled copy will do.
  }
  return { catalog: BUNDLED_CATALOG, refreshed: false };
}

/** Where a run of Lanewise gets its model catalog: fetched once, and again on Refresh models. */
export interface CatalogSource {
  /** The catalog for this run, fetched the first time it's asked for. */
  current(): Promise<LoadedCatalog>;
  /** The catalog fetched afresh, which `current` gives from then on. */
  refresh(): Promise<LoadedCatalog>;
}

/** A source of the model catalog, fetched through `platform`'s `fetch`. */
export function catalogSource(platform: Pick<Platform, "fetch">): CatalogSource {
  let loaded: Promise<LoadedCatalog> | null = null;
  const refresh = () => {
    loaded = withActivity("Reading the model catalog…", () => fetchCatalog((url, init) => platform.fetch(url, init)));
    return loaded;
  };
  return { current: () => loaded ?? refresh(), refresh };
}

/** Newest first: the later release, and for two alike, or unknown, the later ID, numbers compared as numbers. */
function newestFirst(a: ListedModel, b: ListedModel): number {
  if (a.created !== b.created) {
    if (a.created === null) return 1;
    if (b.created === null) return -1;
    return a.created < b.created ? 1 : -1;
  }
  return b.id.localeCompare(a.id, "en", { numeric: true });
}

/**
 * Each version, described from what was listed, with any name two of them
 * share told apart: by the Model Provider's own versions where it gives each
 * of them a different one, as Gemini's does, or else by their IDs.
 */
function namedApart(versions: { listed: ListedModel; description: ModelVersion }[]): ModelVersion[] {
  const alike = new Map<string, ListedModel[]>();
  for (const { listed, description } of versions) alike.set(description.name, [...(alike.get(description.name) ?? []), listed]);
  return versions.map(({ description }) => {
    const shared = alike.get(description.name) ?? [];
    if (shared.length < 2) return description;
    const given = shared.map(({ version }) => version);
    const byVersion = !given.includes(null) && new Set(given).size === given.length;
    const listed = shared.find(({ id }) => id === description.id);
    return { ...description, name: `${description.name} (${byVersion ? listed?.version : description.id})` };
  });
}

/** `listed` as `known` describes it: its Model Provider's own name and efforts where it gives them. */
function described(listed: ListedModel, known: CatalogVersion): ModelVersion {
  const levels = listed.efforts ?? known.efforts;
  const defaultEffort = known.defaultEffort !== null && levels.includes(known.defaultEffort) ? known.defaultEffort : null;
  const kept = Object.entries(known.budgets ?? {}).filter(([level]) => levels.includes(level as Effort));
  return {
    id: listed.id,
    name: listed.name ?? known.name ?? listed.id,
    efforts: levels,
    defaultEffort,
    budgets: kept.length === 0 ? null : Object.fromEntries(kept),
  };
}

/**
 * The models to choose from, from a Model Provider's live list, `listed`,
 * as its `section` of the model catalog describes them: grouped into its
 * models in the catalog's order, each version newest first. A model ID the
 * section excludes isn't offered. One it doesn't describe, or every one
 * without a section, is offered under Other versions, last, newest first,
 * with only the Model Provider's default Effort.
 */
export function describeModels(listed: readonly ListedModel[], section: CatalogSection | undefined): Model[] {
  const unique = [...new Map(listed.map((each) => [each.id, each])).values()];
  const found = new Map<CatalogFamily, { at: number; listed: ListedModel; version: CatalogVersion }[]>();
  const others: ListedModel[] = [];
  for (const each of unique) {
    if (section?.exclude.some((excluded) => excluded.test(each.id))) continue;
    const match = section?.families.flatMap((known) =>
      known.versions.flatMap((version, at) => (version.match.test(each.id) ? [{ known, at, version }] : [])),
    )[0];
    if (match === undefined) {
      others.push(each);
      continue;
    }
    found.set(match.known, [...(found.get(match.known) ?? []), { at: match.at, listed: each, version: match.version }]);
  }
  const models: Model[] = (section?.families ?? []).flatMap((known) => {
    const versions = (found.get(known) ?? [])
      .toSorted((a, b) => a.at - b.at || newestFirst(a.listed, b.listed))
      .map((each) => ({ listed: each.listed, description: described(each.listed, each.version) }));
    return versions.length === 0 ? [] : [{ id: known.id, name: known.name, versions: namedApart(versions) }];
  });
  if (others.length > 0) {
    const versions = others.toSorted(newestFirst).map((each) => {
      const description: ModelVersion = { id: each.id, name: each.name ?? each.id, efforts: null, defaultEffort: null, budgets: null };
      return { listed: each, description };
    });
    models.push({ id: OTHER_VERSIONS, name: "Other versions", versions: namedApart(versions) });
  }
  return models;
}
