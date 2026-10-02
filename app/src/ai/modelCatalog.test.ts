import { readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, test } from "vitest";

import {
  BUNDLED_CATALOG,
  CATALOG_URL,
  type CatalogSection,
  OTHER_VERSIONS,
  catalogSource,
  describeModels,
  fetchCatalog,
  parseCatalog,
} from "./modelCatalog";
import type { ListedModel } from "./modelProvider";

const repository = join(import.meta.dirname, "../../..");

function read(path: string): unknown {
  return JSON.parse(readFileSync(join(repository, path), "utf8"));
}

const catalogJson = read("catalog/models.json") as Record<string, unknown>;
const schema = read("catalog/models.schema.json") as Record<string, unknown>;

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

/** A copy of the catalog's JSON, changed by `change`. */
function changed(change: (catalog: any) => void): unknown {
  const copy = structuredClone(catalogJson);
  change(copy);
  return copy;
}

function listed(id: string, more: Partial<ListedModel> = {}): ListedModel {
  return { id, name: null, version: null, created: null, efforts: null, ...more };
}

/** The model IDs `section` offers of `ids`. */
function offered(section: CatalogSection | undefined, ids: string[]): string[] {
  return describeModels(
    ids.map((id) => listed(id)),
    section,
  ).flatMap(({ versions }) => versions.map(({ id }) => id));
}

describe("the catalog in the repository", () => {
  test("is as its schema says, and is the copy Lanewise is built with", () => {
    validate(catalogJson);
    expect(validate.errors).toBeNull();
    expect(parseCatalog(catalogJson)).toEqual(BUNDLED_CATALOG);
    expect(catalogJson.$schema).toBe("./models.schema.json");
  });

  test("is refreshed from the repository's own copy, which the Desktop App may fetch", () => {
    expect(CATALOG_URL).toBe("https://raw.githubusercontent.com/adrianeyre/lanewise/main/catalog/models.json");
    expect(schema.$id).toBe(CATALOG_URL.replace("models.json", "models.schema.json"));
    const capability = read("desktop/capabilities/default.json") as {
      permissions: (string | { identifier: string; allow: { url: string }[] })[];
    };
    const http = capability.permissions.find((each) => typeof each === "object" && each.identifier === "http:default");
    expect(typeof http === "object" && http.allow.map(({ url }) => url)).toContain(CATALOG_URL);
  });

  test("describes the Model Providers Lanewise will have adapters for", () => {
    expect(Object.keys(BUNDLED_CATALOG.sections)).toEqual(["anthropic", "gemini", "openai", "xai", "meta", "local"]);
  });

  test.each(Object.entries(BUNDLED_CATALOG.sections))(
    "each of %s's examples is the version that gives it, not one before it, nor excluded",
    (_, section) => {
      for (const family of section.families) {
        for (const version of family.versions) {
          for (const id of version.examples) {
            const models = describeModels([listed(id, { name: `Listed ${id}` })], section);
            expect(models).toMatchObject([
              {
                id: family.id,
                versions: [
                  { id, efforts: version.efforts, defaultEffort: version.defaultEffort, budgets: version.budgets },
                ],
              },
            ]);
          }
        }
      }
    },
  );

  test("every version the catalog names is named, and each model's names are its own", () => {
    for (const section of Object.values(BUNDLED_CATALOG.sections)) {
      for (const family of section.families) {
        const names = family.versions.map(({ name }) => name);
        expect(names).not.toContain(null);
        expect([...new Set(names)]).toEqual(names);
      }
    }
  });

  test("leaves out models that can't be chatted with", () => {
    const { anthropic, gemini, openai, xai, meta } = BUNDLED_CATALOG.sections as Record<string, CatalogSection>;

    expect(offered(anthropic, ["claude-opus-5-5"])).toEqual(["claude-opus-5-5"]);
    expect(
      offered(gemini, [
        "gemini-3.5-flash",
        "gemini-3.1-flash-image-preview",
        "gemini-2.5-flash-preview-tts",
        "gemini-3.5-flash-live",
        "gemini-embedding-001",
        "imagen-4.0-generate-001",
        "veo-3.1-generate-preview",
      ]),
    ).toEqual(["gemini-3.5-flash"]);
    expect(offered(openai, ["gpt-5.5", "gpt-image-2", "gpt-realtime", "text-embedding-3-large", "whisper-1", "sora-2"])).toEqual([
      "gpt-5.5",
    ]);
    expect(offered(xai, ["grok-4.7", "grok-imagine-image", "grok-voice-1"])).toEqual(["grok-4.7"]);
    expect(offered(meta, ["muse-spark-1.3", "muse-image-1", "sam-3"])).toEqual(["muse-spark-1.3"]);
  });
});

describe("parseCatalog", () => {
  // Each is wrong, so neither the schema nor Lanewise accepts it.
  test.each<[string, (catalog: any) => void]>([
    ["in another format", (catalog) => (catalog.format = 2)],
    ["without its Model Providers", (catalog) => delete catalog.providers],
    ["with a Model Provider not named as an ID", (catalog) => (catalog.providers.Anthropic = catalog.providers.anthropic)],
    ["with a model without versions", (catalog) => (catalog.providers.anthropic.families[0].versions = [])],
    ["with a model named Other versions", (catalog) => (catalog.providers.anthropic.families[0].id = OTHER_VERSIONS)],
    ["with a pattern that isn't one", (catalog) => (catalog.providers.anthropic.families[0].versions[0].match = "claude-(")],
    ["with an exclusion that isn't a pattern", (catalog) => (catalog.providers.gemini.exclude = ["(veo"])],
    ["with a version without examples", (catalog) => (catalog.providers.anthropic.families[0].versions[0].examples = [])],
    ["with an effort Lanewise doesn't name", (catalog) => (catalog.providers.anthropic.families[0].versions[0].efforts = ["xhigh"])],
    ["with an effort twice", (catalog) => (catalog.providers.anthropic.families[0].versions[0].efforts = ["low", "low"])],
    ["without a default effort", (catalog) => delete catalog.providers.anthropic.families[0].versions[0].defaultEffort],
    ["with a negative budget", (catalog) => (catalog.providers.gemini.families[0].versions[1].budgets.low = -1)],
    ["with a budget that isn't whole", (catalog) => (catalog.providers.gemini.families[0].versions[1].budgets.low = 1.5)],
  ])("refuses a catalog %s", (_, change) => {
    const catalog = changed(change);

    expect(validate(catalog)).toBe(false);
    expect(parseCatalog(catalog)).toBeNull();
  });

  // What the schema can't say, Lanewise checks itself.
  test.each<[string, (catalog: any) => void]>([
    ["with efforts out of order", (catalog) => (catalog.providers.anthropic.families[0].versions[0].efforts = ["high", "low"])],
    ["with a default among none of its efforts", (catalog) => (catalog.providers.anthropic.families[2].versions[6].defaultEffort = "high")],
    ["with a budget for an effort it doesn't take", (catalog) => (catalog.providers.gemini.families[0].versions[1].budgets.off = 0)],
    ["without a budget for each effort", (catalog) => delete catalog.providers.gemini.families[0].versions[1].budgets.low],
    ["with a model twice", (catalog) => catalog.providers.xai.families.push(catalog.providers.xai.families[0])],
  ])("refuses a catalog %s", (_, change) => {
    expect(parseCatalog(changed(change))).toBeNull();
  });

  test("refuses what isn't a catalog at all", () => {
    for (const value of [null, "catalog", [], 1, { format: 1, providers: [] }]) expect(parseCatalog(value)).toBeNull();
  });

  test("matches a pattern against the whole model ID", () => {
    const opus = BUNDLED_CATALOG.sections.anthropic?.families.find(({ id }) => id === "claude-opus");

    expect(opus?.versions[0]?.match.test("claude-opus-5-5")).toBe(true);
    expect(opus?.versions[0]?.match.test("claude-opus-5-5-20260901")).toBe(true);
    expect(opus?.versions[0]?.match.test("claude-opus-5-5-preview")).toBe(false);
    expect(opus?.versions[0]?.match.test("my-claude-opus-5-5")).toBe(false);
  });
});

describe("describeModels", () => {
  const section = parseCatalog({
    format: 1,
    providers: {
      test: {
        exclude: [".*-image"],
        families: [
          {
            id: "big",
            name: "Big",
            versions: [
              { match: "big-2(-\\d{8})?", examples: ["big-2"], name: "Big 2", efforts: ["low", "high"], defaultEffort: "high" },
              {
                match: "big-1",
                examples: ["big-1"],
                name: "Big 1",
                efforts: ["off", "low", "high"],
                defaultEffort: null,
                budgets: { off: 0, low: 1024, high: 8192 },
              },
            ],
          },
          { id: "small", name: "Small", versions: [{ match: "small-.*", examples: ["small-1"], efforts: [], defaultEffort: null }] },
        ],
      },
    },
  })?.sections.test;

  test("groups the models listed by the catalog's models, in its order, each version newest first", () => {
    const models = describeModels(
      [
        listed("small-1"),
        listed("big-1"),
        listed("big-2-20260101", { created: "2026-01-01T00:00:00.000Z" }),
        listed("big-2-20260601", { created: "2026-06-01T00:00:00.000Z" }),
        listed("big-image"),
      ],
      section,
    );

    expect(models.map(({ id, versions }) => [id, versions.map(({ id: version }) => version)])).toEqual([
      ["big", ["big-2-20260601", "big-2-20260101", "big-1"]],
      ["small", ["small-1"]],
    ]);
  });

  test("tells apart versions the catalog names alike by their IDs, and names others by their ID", () => {
    const models = describeModels([listed("big-2-20260101"), listed("big-2"), listed("small-1")], section);

    expect(models.flatMap(({ versions }) => versions.map(({ name }) => name))).toEqual([
      "Big 2 (big-2-20260101)",
      "Big 2 (big-2)",
      "small-1",
    ]);
  });

  /** The names given Big 2's versions, each listed with the Model Provider's own version from `versions`. */
  const named = (versions: (string | null)[]) =>
    describeModels(
      versions.map((version, at) => listed(`big-2-${at}`, { name: "Big 2", version })),
      section,
    ).flatMap(({ versions: each }) => each.map(({ name }) => name));

  test("tells them apart by the Model Provider's own versions where it gives each a different one", () => {
    expect(named(["001", "002"])).toEqual(["Big 2 (002)", "Big 2 (001)"]);
    // Two alike, or one not given, and only the IDs tell them apart.
    expect(named(["001", "001"])).toEqual(["Big 2 (big-2-1)", "Big 2 (big-2-0)"]);
    expect(named(["001", null])).toEqual(["Big 2 (big-2-1)", "Big 2 (big-2-0)"]);
  });

  test("takes the Model Provider's own name and efforts where its list gives them", () => {
    const [big] = describeModels(
      [listed("big-2", { name: "Big Two", efforts: ["low", "medium"] }), listed("big-1", { efforts: ["low"] })],
      section,
    );

    expect(big?.versions).toEqual([
      { id: "big-2", name: "Big Two", efforts: ["low", "medium"], defaultEffort: null, budgets: null },
      { id: "big-1", name: "Big 1", efforts: ["low"], defaultEffort: null, budgets: { low: 1024 } },
    ]);
  });

  test("takes the catalog's efforts, default and budgets otherwise, and none where the list says it takes none", () => {
    const [big] = describeModels([listed("big-2"), listed("big-1", { efforts: [] })], section);

    expect(big?.versions).toEqual([
      { id: "big-2", name: "Big 2", efforts: ["low", "high"], defaultEffort: "high", budgets: null },
      { id: "big-1", name: "Big 1", efforts: [], defaultEffort: null, budgets: null },
    ]);
  });

  test("offers a model the catalog doesn't describe under Other versions, last, newest first, with only the default effort", () => {
    const models = describeModels(
      [
        listed("new-9", { name: "New 9", efforts: ["low", "high"] }),
        listed("new-10"),
        listed("dated", { created: "2026-01-01T00:00:00.000Z" }),
        listed("small-1"),
        listed("new-9"),
      ],
      section,
    );

    expect(models.map(({ id, name }) => [id, name])).toEqual([
      ["small", "Small"],
      [OTHER_VERSIONS, "Other versions"],
    ]);
    expect(models[1]?.versions).toEqual([
      { id: "dated", name: "dated", efforts: null, defaultEffort: null, budgets: null },
      { id: "new-10", name: "new-10", efforts: null, defaultEffort: null, budgets: null },
      { id: "new-9", name: "new-9", efforts: null, defaultEffort: null, budgets: null },
    ]);
  });

  test("offers every model under Other versions for a Model Provider the catalog has no section for", () => {
    expect(describeModels([listed("big-2"), listed("big-image")], undefined).map(({ id }) => id)).toEqual([
      OTHER_VERSIONS,
    ]);
    expect(describeModels([], section)).toEqual([]);
  });
});

describe("fetchCatalog", () => {
  test("fetches the repository's copy, sending nothing with it", async () => {
    const fetches: [string, RequestInit | undefined][] = [];
    const fetched = changed((catalog) => (catalog.providers.xai.families[0].name = "Grok, refreshed"));

    const { catalog, refreshed } = await fetchCatalog(async (url, init) => {
      fetches.push([url, init]);
      return Response.json(fetched);
    });

    expect(refreshed).toBe(true);
    expect(catalog.sections.xai?.families[0]?.name).toBe("Grok, refreshed");
    expect(fetches).toHaveLength(1);
    expect(fetches[0]?.[0]).toBe(CATALOG_URL);
    expect(fetches[0]?.[1]?.method).toBe("GET");
    expect(fetches[0]?.[1]?.headers).toBeUndefined();
    expect(fetches[0]?.[1]?.body).toBeUndefined();
  });

  test.each<[string, () => Promise<Response>]>([
    ["offline", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["it isn't there", async () => new Response("Not Found", { status: 404 })],
    ["it isn't JSON", async () => new Response("<html>", { status: 200 })],
    ["it's in a format this Lanewise can't read", async () => Response.json(changed((catalog) => (catalog.format = 2)))],
    ["it's wrong anywhere", async () => Response.json(changed((catalog) => (catalog.providers.local.exclude = ["("])))],
  ])("falls back to the bundled copy when %s", async (_, answer) => {
    expect(await fetchCatalog(answer)).toEqual({ catalog: BUNDLED_CATALOG, refreshed: false });
  });
});

describe("catalogSource", () => {
  test("fetches the catalog once, and again when refreshed", async () => {
    let fetches = 0;
    const source = catalogSource({
      fetch: async () => {
        fetches += 1;
        return Response.json(catalogJson);
      },
    });

    await Promise.all([source.current(), source.current()]);
    expect(fetches).toBe(1);

    expect((await source.refresh()).refreshed).toBe(true);
    await source.current();
    expect(fetches).toBe(2);
  });
});
