import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import credits from "virtual:credits";
import { afterEach, expect, test } from "vitest";

import { licenceTexts } from "./credits";

const appDir = join(import.meta.dirname, "..");
const root = join(appDir, "..");

// Reading the whole dependency tree, twice over, takes Cargo a few seconds on a cold cache.
const SLOW = 120_000;

interface Listed {
  name?: string;
  version: string;
  dependencies?: Record<string, Listed>;
  optionalDependencies?: Record<string, Listed>;
}

/** What pnpm says the UI depends on in production, all the way down, as `name@version`. */
function bundledNpmPackages(): Set<string> {
  // Through a shell, where `pnpm` may be a script, as it is on Windows.
  const projects = JSON.parse(
    execSync("pnpm list --prod --depth Infinity --json", { cwd: appDir, encoding: "utf8", maxBuffer: 256 << 20 }),
  ) as Listed[];
  const app = projects.find((project) => project.name === "@lanewise/app");
  if (!app) throw new Error("pnpm list didn't list @lanewise/app");
  const found = new Set<string>();
  const visit = (listed: Listed) => {
    for (const [name, dependency] of Object.entries({ ...listed.dependencies, ...listed.optionalDependencies })) {
      found.add(`${name}@${dependency.version}`);
      visit(dependency);
    }
  };
  visit(app);
  return found;
}

/** What Cargo says the workspace's crates depend on, not for tests or builds, on any target, as `name@version`. */
function bundledCrates(): Set<string> {
  const tree = execFileSync(
    "cargo",
    ["tree", "--workspace", "--edges", "normal", "--target", "all", "--prefix", "none", "--format", "{p}"],
    { cwd: root, encoding: "utf8", maxBuffer: 256 << 20 },
  );
  const found = new Set<string>();
  for (const line of tree.split("\n")) {
    const match = /^(\S+) v(\S+)(.*)$/.exec(line.trim());
    if (!match) continue;
    const [, name, version, rest] = match;
    // A crate with a path is one of the workspace's own: Lanewise itself.
    if (/\((\/|[A-Za-z]:\\)/.test(rest!)) continue;
    found.add(`${name}@${version}`);
  }
  return found;
}

const credited = (list: typeof credits.npm) => new Set(list.map((credit) => `${credit.name}@${credit.version}`));

test(
  "every npm package the UI bundles is in the Credits",
  () => {
    const bundled = bundledNpmPackages();
    expect(bundled.size).toBeGreaterThan(0);
    expect([...bundled].filter((pkg) => !credited(credits.npm).has(pkg))).toEqual([]);
    expect(credited(credits.npm).has("@lanewise/app@0.1.0")).toBe(false);
  },
  SLOW,
);

test(
  "every crate Lanewise's core, the Desktop App and Web Mode are built with is in the Credits",
  () => {
    const bundled = bundledCrates();
    expect(bundled.has(`tauri@${credits.crates.find((credit) => credit.name === "tauri")?.version}`)).toBe(true);
    expect([...bundled].filter((crate) => !credited(credits.crates).has(crate))).toEqual([]);
    expect(credits.crates.filter((credit) => credit.name.startsWith("lanewise"))).toEqual([]);
  },
  SLOW,
);

test("every credit names its licence and carries at least one licence text, each text kept once", () => {
  for (const credit of [...credits.npm, ...credits.crates]) {
    expect(credit.licence, `${credit.name} ${credit.version}`).not.toBe("");
    expect(credit.texts.length, `${credit.name} ${credit.version}`).toBeGreaterThan(0);
    for (const index of credit.texts) expect(credits.texts[index]?.trim()).toBeTruthy();
  }
  expect(new Set(credits.texts).size).toBe(credits.texts.length);
});

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

function aPackage(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), "lanewise-credits-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

test("a package's own licence files are its texts, in name order, with Windows line endings made plain", () => {
  const at = aPackage({
    "LICENSE-MIT": "MIT, by someone\r\n",
    "LICENSE-APACHE": "Apache, by someone\n",
    "README.md": "Not a licence",
    "license.txt.bak": "",
  });

  expect(licenceTexts(at, "MIT OR Apache-2.0", "a package")).toEqual(["Apache, by someone", "MIT, by someone"]);
});

test("a package that ships no licence file gets the SPDX text of each licence it declares", () => {
  const at = aPackage({ "README.md": "No licence here" });

  const texts = licenceTexts(at, "(MIT OR Apache-2.0 WITH LLVM-exception)", "a package");

  expect(texts).toHaveLength(2);
  expect(texts[0]).toMatch(/^MIT License/);
  expect(texts[1]).toMatch(/Apache License\s+Version 2\.0/);
});

test("a package with neither a licence file nor a licence SPDX knows fails the build, naming it", () => {
  const at = aPackage({});

  expect(() => licenceTexts(at, "LicenseRef-Mine", "The crate mine 1.0.0")).toThrow(/^The crate mine 1\.0\.0 ships no licence file/);
  expect(() => licenceTexts(at, "", "The npm package bare@1.0.0")).toThrow(/bare@1\.0\.0.*\(none\)/);
});
