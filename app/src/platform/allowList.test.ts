import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "vitest";

import { CATALOG_URL } from "../ai/modelCatalog";
import { JEV_API } from "../ai/jev";
import { MODEL_PROVIDERS } from "../ai/modelProviders";
import { LATEST_PACKAGE_URL } from "../updates/latestVersion";

const repository = join(import.meta.dirname, "../../..");

type Permission = string | { identifier: string; allow?: { url: string }[] };

const capability = JSON.parse(readFileSync(join(repository, "desktop/capabilities/default.json"), "utf8")) as {
  permissions: Permission[];
};

/** Each of the Desktop App window's permissions, by identifier. */
const identifiers = capability.permissions.map((each) => (typeof each === "string" ? each : each.identifier));

/** Where the Desktop App window's HTTP requests may go. */
const allowed = capability.permissions.flatMap((each) =>
  typeof each === "object" && each.identifier === "http:default" ? (each.allow ?? []).map(({ url }) => url) : [],
);

/**
 * A Model Provider on this computer, at any port and under any base URL
 * Settings gives it, but only at the two paths the OpenAI-compatible adapter
 * asks there: its models and its chat completions (ADR 0051).
 */
const local = ["localhost", "127.0.0.1"].flatMap((host) =>
  ["models", "chat/completions"].flatMap((path) => [`http://${host}:*/${path}`, `http://${host}:*/*/${path}`]),
);

// PRD §11: no telemetry. The window reaches the network only through the
// HTTP plugin, and it only to these.
test("the Desktop App's HTTP requests go only to the Model Providers, Jev's TypeSafe, the model catalog, the repository's package.json and this computer's Model Provider", () => {
  const cloud = MODEL_PROVIDERS.filter((provider) => provider.defaultBaseUrl === null).map(
    (provider) => `https://${provider.host}`,
  );

  expect(new Set(allowed)).toEqual(new Set([...cloud, JEV_API, CATALOG_URL, LATEST_PACKAGE_URL, ...local]));
  expect(allowed).toHaveLength(new Set(allowed).size);
  expect(cloud).toHaveLength(5);
  expect(local).toHaveLength(8);
});

// ADR 0051: no other port's server on this computer is within the window's reach.
test("this computer is reached only at a Model Provider's API, never at a whole port", () => {
  const loopback = allowed.filter((url) => url.startsWith("http://"));
  expect(loopback).toEqual(local);
  for (const url of loopback) expect(url).toMatch(/\/(models|chat\/completions)$/);
});

test("nothing else in the window may make a request, nor open a socket", () => {
  expect(identifiers.filter((identifier) => identifier.startsWith("http:"))).toEqual(["http:default"]);
  expect(identifiers.filter((identifier) => /^(websocket|upload|updater|log|analytics):/.test(identifier))).toEqual([]);
  // Links open in the user's browser, where they see where they're going.
  expect(identifiers).toContain("opener:allow-open-url");
});

// ADR 0030: the shell, not the window, asks for Updates, and only Lanewise's own Releases.
test("the Desktop App asks for Updates only at the latest Release's latest.json", () => {
  const config = JSON.parse(readFileSync(join(repository, "desktop/tauri.conf.json"), "utf8")) as {
    plugins: { updater: { endpoints: string[]; requireSignedVersion: boolean } };
  };

  expect(config.plugins.updater.endpoints).toEqual([
    "https://github.com/adrianeyre/lanewise/releases/latest/download/latest.json",
  ]);
  expect(config.plugins.updater.requireSignedVersion).toBe(true);
});
