import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";
import addFormats from "ajv-formats";
import { expect, test } from "vitest";

/** A file of the repository's, as JSON. */
function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf8"));
}

/** A file of the repository's, as text. */
function text(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf8");
}

/** `patch` over `target` as RFC 7396 has it, which is how Tauri merges a platform's config into `tauri.conf.json`. */
function merge(target: unknown, patch: unknown): unknown {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return patch;
  const merged: Record<string, unknown> =
    typeof target === "object" && target !== null && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else merged[key] = merge(merged[key], value);
  }
  return merged;
}

// The schema of the Tauri CLI that builds the release, not the one `$schema` names online. One of its
// patterns (a file name, `^[^/\:*?"<>|]+$`) escapes a colon, which only a regular expression without `u` allows.
const ajv = new Ajv({ allErrors: true, strict: false, unicodeRegExp: false });
addFormats(ajv);
const validate = ajv.compile(json("node_modules/@tauri-apps/cli/config.schema.json"));

const base = json("desktop/tauri.conf.json");

for (const platform of ["windows", "macos"]) {
  test(`tauri.conf.json with tauri.${platform}.conf.json over it is a config Tauri accepts`, () => {
    const config = merge(base, json(`desktop/tauri.${platform}.conf.json`));
    // The errors, rather than `false`, so a failure says what Tauri would refuse.
    expect(validate(config) ? [] : validate.errors).toEqual([]);
  });
}

test("tauri.conf.json alone, as Linux builds it for the benchmark, bundles nothing", () => {
  expect(validate(base) ? [] : validate.errors).toEqual([]);
  expect((base.bundle as { active: boolean }).active).toBe(false);
});

test("the Desktop App's version is the repository's, which semantic-release sets and the footer shows", () => {
  expect(base.version).toBe("../package.json");
});

test("the Windows installer is NSIS, for the current user, with no administrator prompt", () => {
  const { bundle } = json("desktop/tauri.windows.conf.json") as { bundle: { targets: string[]; windows: { nsis: { installMode: string } } } };
  expect(bundle.targets).toEqual(["nsis"]);
  expect(bundle.windows.nsis.installMode).toBe("currentUser");
});

// Devtools would let anyone at the keyboard run script in the main webview,
// which reads Model Provider keys through `modelProviderKey` (ADR 0020). Tauri
// and wry turn them on only with debug assertions or the `devtools` feature.
test("a release build can't open devtools: no crate turns them on, and the release keeps debug assertions off", () => {
  interface Metadata {
    packages: { id: string; name: string }[];
    resolve: { nodes: { id: string; features: string[] }[] };
  }
  // Every target's, with every kind of dependency's features unified, so this holds for more than a release links.
  const metadata = JSON.parse(
    execFileSync("cargo", ["metadata", "--format-version", "1", "--manifest-path", fileURLToPath(new URL("../../../Cargo.toml", import.meta.url))], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 1024,
      stdio: ["ignore", "pipe", "inherit"],
    }),
  ) as Metadata;
  const names = new Map(metadata.packages.map((crate) => [crate.id, crate.name]));
  const webview = metadata.resolve.nodes
    .filter((node) => ["tauri", "tauri-runtime", "tauri-runtime-wry", "wry"].includes(names.get(node.id)!))
    .map((node) => ({ crate: names.get(node.id), devtools: node.features.includes("devtools") }))
    .toSorted((a, b) => a.crate!.localeCompare(b.crate!));
  expect(webview).toEqual(["tauri", "tauri-runtime", "tauri-runtime-wry", "wry"].map((crate) => ({ crate, devtools: false })));

  // `tauri build` builds the release profile, which has debug assertions off unless something turns them on.
  const turnedOn = ["Cargo.toml", "desktop/Cargo.toml", ".cargo/config.toml", ".cargo/config", ".github/workflows/release.yml"].filter(
    (path) => existsSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url))) && /debug[-_]assertions/i.test(text(path)),
  );
  expect(turnedOn).toEqual([]);
  const builds = text(".github/workflows/release.yml")
    .split("\n")
    .filter((line) => line.includes("pnpm desktop:build"));
  expect(builds.length).toBeGreaterThan(0);
  for (const line of builds) expect(line).not.toMatch(/--debug|--features|\s-[fF]\b|--profile/);

  for (const platform of [base, merge(base, json("desktop/tauri.windows.conf.json")), merge(base, json("desktop/tauri.macos.conf.json"))]) {
    const { windows } = (platform as { app: { windows: { devtools?: boolean }[] } }).app;
    for (const window of windows) expect(window.devtools).not.toBe(true);
  }
});
