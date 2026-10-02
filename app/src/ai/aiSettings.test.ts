import { describe, expect, test } from "vitest";

import { FAKE_MODELS } from "../test/fakeModelProvider";
import {
  type AiSettings,
  DEFAULT_AI_SETTINGS,
  localBaseUrl,
  modelChoiceFor,
  modelProvidersInUse,
  parseAiSettings,
  selectionFor,
  undisclosed,
} from "./aiSettings";

const choice = { provider: "fake", model: "fake-opus", version: null, effort: null };

describe("parseAiSettings", () => {
  test("AI is off, with nothing chosen, until the user changes it", () => {
    expect(parseAiSettings(null)).toEqual(DEFAULT_AI_SETTINGS);
    expect(DEFAULT_AI_SETTINGS).toMatchObject({ enabled: false, disclosed: [], contextLines: 20, global: null });
  });

  test("reads back what was kept", () => {
    const kept: AiSettings = {
      enabled: true,
      disclosed: ["fake"],
      contextLines: 5,
      global: choice,
      repositories: { "/work/lanewise": { provider: "other", model: null, version: "v2", effort: "high" } },
      baseUrls: { local: "http://127.0.0.1:1234/v1" },
    };

    expect(parseAiSettings(JSON.stringify(kept))).toEqual(kept);
  });

  test("whatever can't be read is left at its default, never turning AI on", () => {
    expect(parseAiSettings("not JSON")).toEqual(DEFAULT_AI_SETTINGS);
    expect(parseAiSettings("[1]")).toEqual(DEFAULT_AI_SETTINGS);
    expect(
      parseAiSettings(
        JSON.stringify({
          enabled: "yes",
          disclosed: ["fake", 3, ""],
          contextLines: -1,
          global: { provider: "fake", effort: "a lot" },
          repositories: { "/a": { model: "no provider" }, "/b": choice },
          baseUrls: { local: "https://example.com/v1", other: 8080, lm: "http://localhost:1234/v1/" },
        }),
      ),
    ).toEqual({
      enabled: false,
      disclosed: ["fake"],
      contextLines: 20,
      global: { provider: "fake", model: null, version: null, effort: null },
      repositories: { "/b": choice },
      baseUrls: { lm: "http://localhost:1234/v1" },
    });
  });
});

describe("localBaseUrl", () => {
  test("a local server's base URL, on this computer, without a trailing slash", () => {
    expect(localBaseUrl(" http://localhost:11434/v1/ ")).toBe("http://localhost:11434/v1");
    expect(localBaseUrl("http://127.0.0.1:8080/v1")).toBe("http://127.0.0.1:8080/v1");
    expect(localBaseUrl("http://LOCALHOST:1234")).toBe("http://localhost:1234");
  });

  test("nothing a key could be sent away from this computer to, or the HTTP scope wouldn't allow", () => {
    for (const text of [
      "",
      "localhost:11434",
      "https://localhost:11434/v1",
      "http://localhost/v1",
      "http://192.168.1.2:11434/v1",
      "http://localhost.example.com:11434/v1",
      "http://user:secret@localhost:11434/v1",
      "http://localhost:11434/v1?key=1",
      "http://localhost:11434/v1#models",
      "file:///v1",
    ]) {
      expect({ text, url: localBaseUrl(text) }).toEqual({ text, url: null });
    }
  });
});

describe("modelChoiceFor", () => {
  const settings: AiSettings = {
    ...DEFAULT_AI_SETTINGS,
    global: choice,
    repositories: { "/work/apart": { ...choice, provider: "other" } },
  };

  test("a repository set apart has its own choice, and every other one the global choice", () => {
    expect(modelChoiceFor(settings, "/work/apart")?.provider).toBe("other");
    expect(modelChoiceFor(settings, "/work/lanewise")).toBe(choice);
    expect(modelChoiceFor(settings, null)).toBe(choice);
  });
});

describe("undisclosed", () => {
  test("names each Model Provider in use whose disclosure wasn't accepted, but none while AI is off", () => {
    const settings: AiSettings = {
      ...DEFAULT_AI_SETTINGS,
      disclosed: ["fake"],
      global: choice,
      repositories: { "/a": { ...choice, provider: "other" }, "/b": { ...choice, provider: "other" } },
    };

    expect(modelProvidersInUse(settings)).toEqual(["fake", "other"]);
    expect(undisclosed(settings)).toEqual([]);
    expect(undisclosed({ ...settings, enabled: true })).toEqual(["other"]);
  });
});

describe("selectionFor", () => {
  test("the newest version by default, with the Model Provider's default effort", () => {
    expect(selectionFor(choice, FAKE_MODELS)).toEqual({
      model: "fake-opus",
      version: "fake-opus-5",
      effort: null,
      budget: null,
    });
  });

  test("the version and effort chosen, while the version still takes it, with its token budget", () => {
    expect(selectionFor({ ...choice, version: "fake-opus-4", effort: "low" }, FAKE_MODELS)).toEqual({
      model: "fake-opus",
      version: "fake-opus-4",
      effort: "low",
      budget: 1024,
    });
    expect(selectionFor({ ...choice, version: "fake-opus-5", effort: "low" }, FAKE_MODELS)?.budget).toBeNull();
    expect(selectionFor({ ...choice, version: "fake-opus-4", effort: "maximum" }, FAKE_MODELS)).toMatchObject({
      effort: null,
      budget: null,
    });
  });

  test("a model the catalog doesn't describe is only ever asked with the Model Provider's default effort", () => {
    expect(selectionFor({ provider: "fake", model: "other-versions", version: "fake-lab-1", effort: "high" }, FAKE_MODELS)).toEqual({
      model: "other-versions",
      version: "fake-lab-1",
      effort: null,
      budget: null,
    });
  });

  test("a version no longer listed gives way to the newest, and a model no longer listed to none", () => {
    expect(selectionFor({ ...choice, version: "fake-opus-1" }, FAKE_MODELS)?.version).toBe("fake-opus-5");
    expect(selectionFor({ ...choice, model: "gone" }, FAKE_MODELS)).toBeNull();
    expect(selectionFor({ ...choice, model: null }, FAKE_MODELS)).toBeNull();
  });
});
