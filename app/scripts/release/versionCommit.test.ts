import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test } from "vitest";

import { checkVersionCommit } from "./versionCommit";

const SCRIPT = fileURLToPath(new URL("./versionCommit.ts", import.meta.url));

const IDENTITY = {
  GIT_AUTHOR_NAME: "Lanewise tests",
  GIT_AUTHOR_EMAIL: "tests@lanewise.invalid",
  GIT_COMMITTER_NAME: "Lanewise tests",
  GIT_COMMITTER_EMAIL: "tests@lanewise.invalid",
};

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function git(args: string[]): string {
  return execFileSync("git", ["-C", dir as string, "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args], {
    encoding: "utf8",
    env: { ...process.env, ...IDENTITY },
  }).trim();
}

const PACKAGE = { name: "lanewise", version: "1.1.1", private: true, scripts: { test: "vitest" } };

function write(file: string, text: string): void {
  writeFileSync(join(dir as string, file), text);
}

/** A repository whose `main` is a merged commit; that commit. */
function merged(): string {
  dir = mkdtempSync(join(tmpdir(), "lanewise-version-commit-"));
  git(["init", "--quiet", "--initial-branch=main"]);
  write("package.json", `${JSON.stringify(PACKAGE, null, 2)}\n`);
  write("CHANGELOG.md", "# Changelog\n");
  write("build.rs", "fn main() {}\n");
  git(["add", "."]);
  git(["commit", "--quiet", "-m", "feat: what was merged"]);
  return git(["rev-parse", "HEAD"]);
}

/** semantic-release's version commit for `version` on top, tagged, after `change` has changed the tree too. */
function released(version: string, change: () => void = () => {}): void {
  write("package.json", `${JSON.stringify({ ...PACKAGE, version }, null, 2)}\n`);
  write("CHANGELOG.md", `# Changelog\n\n## [${version}](https://github.com/adrianeyre/lanewise/compare/v1.1.1...v${version})\n`);
  change();
  git(["add", "."]);
  git(["commit", "--quiet", "-m", `chore(release): ${version} [skip ci]`]);
  git(["tag", `v${version}`]);
}

describe("a Release's tag", () => {
  test("is the merged commit and its version commit, and nothing more", () => {
    const base = merged();
    released("1.2.0");
    expect(checkVersionCommit(dir as string, base, "v1.2.0", "1.2.0")).toEqual({
      ok: true,
      said: `v1.2.0 is ${base} and its version commit for 1.2.0, and nothing more.`,
    });
  });

  test("that changes any other file, such as a build script, is refused", () => {
    const base = merged();
    released("1.2.0", () => write("build.rs", 'fn main() { println!("cargo::warning=hello"); }\n'));
    expect(checkVersionCommit(dir as string, base, "v1.2.0", "1.2.0")).toEqual({
      ok: false,
      said: "v1.2.0 changes more than CHANGELOG.md and package.json: build.rs.",
    });
  });

  test("that changes more of package.json than its version, such as a script, is refused", () => {
    const base = merged();
    released("1.2.0");
    write("package.json", `${JSON.stringify({ ...PACKAGE, version: "1.2.0", scripts: { test: "node evil.js" } }, null, 2)}\n`);
    git(["commit", "--quiet", "--amend", "-a", "--no-edit"]);
    git(["tag", "-f", "v1.2.0"]);
    expect(checkVersionCommit(dir as string, base, "v1.2.0", "1.2.0").said).toBe("v1.2.0 changes more of package.json than its version.");
  });

  test("with another commit between it and the merged one is refused", () => {
    const base = merged();
    write("build.rs", "fn main() { /* pushed by something else */ }\n");
    git(["commit", "--quiet", "-a", "-m", "fix: something else"]);
    released("1.2.0");
    expect(checkVersionCommit(dir as string, base, "v1.2.0", "1.2.0")).toMatchObject({
      ok: false,
      said: expect.stringMatching(/^v1\.2\.0 isn't one commit on top of [0-9a-f]{40}: its parents are [0-9a-f]{40}\.$/),
    });
  });

  test("for another version, or with no tag at all, is refused", () => {
    const base = merged();
    released("1.2.0");
    expect(checkVersionCommit(dir as string, base, "v1.2.0", "1.3.0").said).toBe('"v1.2.0" isn\'t the tag for "1.3.0".');
    expect(checkVersionCommit(dir as string, base, "v1.3.0", "1.3.0").said).toBe("There is no tag v1.3.0.");
    expect(checkVersionCommit(dir as string, "main", "v1.2.0", "1.2.0").said).toBe('"main" isn\'t a commit.');
    expect(checkVersionCommit(dir as string, base, "v1.2.0\n", "1.2.0\n").ok).toBe(false);
  });

  test("that makes one of its two files executable is refused", () => {
    const base = merged();
    released("1.2.0");
    git(["update-index", "--chmod=+x", "CHANGELOG.md"]);
    git(["commit", "--quiet", "--amend", "--no-edit"]);
    git(["tag", "-f", "v1.2.0"]);
    expect(checkVersionCommit(dir as string, base, "v1.2.0", "1.2.0").said).toBe("v1.2.0's CHANGELOG.md and package.json aren't both plain files.");
  });

  test("the script checks it from the repository it runs in, and says what is wrong", () => {
    const base = merged();
    released("1.2.0", () => write("build.rs", "fn main() {}\n// changed\n"));
    const result = spawnSync(process.execPath, [SCRIPT, base, "v1.2.0", "1.2.0"], { cwd: dir, encoding: "utf8" });
    expect({ status: result.status, stderr: result.stderr.trim() }).toEqual({
      status: 1,
      stderr: "v1.2.0 changes more than CHANGELOG.md and package.json: build.rs.",
    });
    expect(spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" }).status).toBe(2);
  });
});
