import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";
import addFormats from "ajv-formats";
import { expect, test } from "vitest";

/** A file of the repository's, as JSON. */
function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf8"));
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
