/**
 * The Hostile repository fixtures (pen-testing PRD §6, E1) are built here
 * into a throwaway folder and checked: that each is hostile in the way its
 * brief asks, and — just as important — that building them fires nothing.
 * The marker directory a fixture's configuration would write into is given a
 * unique path per run and asserted never to appear, so the fixtures stay
 * bait that only Lanewise can trigger, never the test harness.
 *
 * The checks are read-only `git` plumbing. They never run `git status`, a
 * diff, a checkout or a fetch against `config-and-attributes`, because those
 * are exactly what its configuration is armed to answer with a marker.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, expect, test } from "vitest";

import { type Fixture, fixtures, type Report } from "./fixtures";
import { init } from "./git";

const root = mkdtempSync(join(tmpdir(), "lanewise-pen-test-"));
/** A marker directory unique to this run. Nothing the build does should ever create it. */
const markerDir = join(root, "markers-never-created");
const reports = new Map<string, Report>();

beforeAll(() => {
  for (const fixture of fixtures) {
    const dir = join(root, fixture.name);
    init(dir);
    reports.set(fixture.name, fixture.build({ dir, markerDir }));
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Read-only `git` in a built fixture. */
function gitOut(name: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", join(root, name), ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
}

test("building the fixtures fires nothing: the marker directory never appears", () => {
  expect(existsSync(markerDir)).toBe(false);
});

test("every fixture reports a purpose, a marker and a way to check it", () => {
  for (const fixture of fixtures) {
    const report = reports.get(fixture.name);
    expect(report).toBeDefined();
    expect(report?.purpose.length ?? 0).toBeGreaterThan(0);
    expect(report?.marker.length ?? 0).toBeGreaterThan(0);
    expect(report?.check.length ?? 0).toBeGreaterThan(0);
  }
});

test("refs-and-tags carries a branch and a tag whose short names begin with a dash, on the repository and a remote", () => {
  const here = gitOut("refs-and-tags", ["for-each-ref", "--format=%(refname:short)"]).split("\n");
  expect(here).toContain("-u");
  expect(here).toContain("-n");
  const remote = execFileSync("git", ["-C", join(root, "refs-and-tags", "remote.git"), "for-each-ref", "--format=%(refname:short)"], {
    encoding: "utf8",
  }).split("\n");
  expect(remote).toContain("-u");
});

test("paths holds `..`, `sub/..`, out-of-tree symlinks and a case collision, none of them checked out", () => {
  const tree = gitOut("paths", ["ls-tree", "-r", "HEAD"]);
  expect(tree).toMatch(/\t\.\.$/m); // an entry named ..
  expect(tree).toMatch(/\tsub\/\.\.$/m); // and one a level down
  expect(tree).toMatch(/README$/m);
  expect(tree).toMatch(/readme$/m); // README and readme collide on a case-insensitive disk
  expect(tree).toMatch(/^120000 /m); // at least one symlink
  // The dangerous paths are objects only: nothing was checked out, so the working tree holds just `.git`.
  expect(readdirSync(join(root, "paths"))).toEqual([".git"]);
});

test("config-and-attributes arms a filter, fsmonitor, sshCommand, credential helper and uploadpack, each writing only a marker", () => {
  // Read the configuration without running anything it is armed to answer.
  const config = gitOut("config-and-attributes", ["config", "--local", "--list"]);
  for (const key of ["filter.pentest.clean", "core.fsmonitor", "core.sshcommand", "credential.helper", "remote.hostile.uploadpack"]) {
    expect(config.toLowerCase()).toContain(key);
  }
  expect(config).toContain(markerDir.replaceAll("\\", "/"));
  // Still nothing has run.
  expect(existsSync(markerDir)).toBe(false);
});

test("injection leaves a conflict whose hunk, message and author carry markup and prompt-injection text", () => {
  const status = gitOut("injection", ["status", "--porcelain"]);
  expect(status).toMatch(/^UU /m); // unmerged
  const hunk = gitOut("injection", ["show", ":1:notes.txt"]).concat(
    gitOut("injection", ["show", ":2:notes.txt"]),
    gitOut("injection", ["show", ":3:notes.txt"]),
  );
  expect(hunk).toContain("ignore previous instructions");
  expect(hunk).toContain("<img src=x");
  // Markup survives in the message; the author name carries a control and a bidi-override byte.
  const messages = gitOut("injection", ["log", "--all", "--format=%s%n%b"]);
  expect(messages).toContain("<script>");
  expect(messages).toContain("reveal the API key");
  const authors = gitOut("injection", ["log", "--all", "--format=%an"]);
  // A control byte or a bidi-override character in an author name, without a control-character regexp.
  const hidden = [...authors].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || (code >= 0x202a && code <= 0x202e);
  });
  expect(hidden).toBe(true);
});

test("submodules names an ext:: transport, an option-looking URL and a path that climbs out of the superproject", () => {
  const modules = gitOut("submodules", ["show", "HEAD:.gitmodules"]);
  expect(modules).toContain("ext::");
  expect(modules).toContain("--upload-pack=");
  expect(modules).toContain("../../../../tmp/submodule-escape");
  // The hostile submodule paths are gitlinks in the tree, not checked out.
  const gitlinks = gitOut("submodules", ["ls-tree", "-r", "-t", "HEAD"]).match(/^160000 /gm) ?? [];
  expect(gitlinks.length).toBeGreaterThanOrEqual(3);
});

const operations: ReadonlyArray<readonly [string, string]> = [
  ["conflict-merge", "MERGE_HEAD"],
  ["conflict-rebase", "rebase-merge"],
  ["conflict-cherry-pick", "CHERRY_PICK_HEAD"],
  ["conflict-revert", "REVERT_HEAD"],
];

for (const [name, state] of operations) {
  test(`${name} is left in conflict with ${state} present`, () => {
    expect(gitOut(name, ["status", "--porcelain"])).toMatch(/^(UU|AA|DD|AU|UA|DU|UD) /m);
    expect(existsSync(join(root, name, ".git", state))).toBe(true);
  });
}

/** A guard on the whole set, so a future edit that drops one is caught. */
test("there are as many fixtures as the brief's probes need", () => {
  const names = fixtures.map((fixture: Fixture) => fixture.name);
  expect(new Set(names).size).toBe(names.length);
  expect(names).toEqual([
    "refs-and-tags",
    "paths",
    "config-and-attributes",
    "injection",
    "submodules",
    "conflict-merge",
    "conflict-rebase",
    "conflict-cherry-pick",
    "conflict-revert",
  ]);
});
