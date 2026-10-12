/**
 * Whether a Release's tag is what was merged and nothing more (ADR 0053):
 *
 *   node app/scripts/release/versionCommit.ts <merged commit> <tag> <version>
 *
 * semantic-release runs with a token that can push, among some three hundred
 * npm packages. What it should push is one commit, `chore(release)`, on top
 * of the commit merged to `main`, changing only `CHANGELOG.md` and the
 * version in `package.json`, and a tag on it. The build jobs build that tag,
 * and the `sign` job signs what they built with the Update key. So before it
 * signs, the `sign` job runs this from the merged commit, not from the tag,
 * and it fails unless the tag's commit has the merged commit as its one
 * parent, changes nothing but those two files, both plain files, and changes
 * nothing in `package.json` but the version, which is `<version>`.
 *
 * Node runs it as it is, stripping the types, so it imports only Node's own modules.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

/** The files semantic-release's version commit changes (`.releaserc.json`'s `@semantic-release/git` assets). */
export const VERSION_FILES = ["CHANGELOG.md", "package.json"];

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const COMMIT = /^[0-9a-f]{40}$/;

/** `git` with `args` in `cwd`, its output, or `undefined` if it failed. */
function git(cwd: string, args: string[]): string | undefined {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout : undefined;
}

/** `package.json` at `commit`, parsed, or `undefined` if it isn't there or isn't JSON. */
function packageJson(cwd: string, commit: string): Record<string, unknown> | undefined {
  const text = git(cwd, ["show", `${commit}:package.json`]);
  try {
    return text === undefined ? undefined : (JSON.parse(text) as Record<string, unknown>);
  } catch {
    return undefined;
  }
}

/** Whether `tag`, in the repository at `cwd`, is `merged` and the version commit for `version`; what is wrong if not. */
export function checkVersionCommit(cwd: string, merged: string, tag: string, version: string): { ok: boolean; said: string } {
  if (!COMMIT.test(merged)) return { ok: false, said: `${JSON.stringify(merged)} isn't a commit.` };
  if (!VERSION.test(version) || tag !== `v${version}`) return { ok: false, said: `${JSON.stringify(tag)} isn't the tag for ${JSON.stringify(version)}.` };

  const tagged = git(cwd, ["rev-parse", "--verify", "--quiet", "--end-of-options", `refs/tags/${tag}^{commit}`])?.trim();
  if (!tagged) return { ok: false, said: `There is no tag ${tag}.` };
  const parents = git(cwd, ["rev-list", "--parents", "-n", "1", tagged])?.trim().split(" ").slice(1) ?? [];
  if (!isDeepStrictEqual(parents, [merged])) {
    return { ok: false, said: `${tag} isn't one commit on top of ${merged}: its parents are ${parents.join(", ") || "none"}.` };
  }

  const changed = (git(cwd, ["diff", "--name-only", "-z", "--no-renames", merged, tagged]) ?? "").split("\0").filter(Boolean);
  const others = changed.filter((file) => !VERSION_FILES.includes(file));
  if (others.length > 0) return { ok: false, said: `${tag} changes more than ${VERSION_FILES.join(" and ")}: ${others.join(", ")}.` };
  const modes = (git(cwd, ["ls-tree", "-z", tagged, "--", ...VERSION_FILES]) ?? "").split("\0").filter(Boolean);
  if (modes.length !== VERSION_FILES.length || modes.some((entry) => !entry.startsWith("100644 blob "))) {
    return { ok: false, said: `${tag}'s ${VERSION_FILES.join(" and ")} aren't both plain files.` };
  }

  const before = packageJson(cwd, merged);
  const after = packageJson(cwd, tagged);
  if (!before || !after) return { ok: false, said: `package.json isn't JSON at ${merged} or at ${tag}.` };
  if (after.version !== version) return { ok: false, said: `${tag}'s package.json says ${JSON.stringify(after.version)}, not ${version}.` };
  const { version: _before, ...restBefore } = before;
  const { version: _after, ...restAfter } = after;
  if (!isDeepStrictEqual(restBefore, restAfter)) return { ok: false, said: `${tag} changes more of package.json than its version.` };
  return { ok: true, said: `${tag} is ${merged} and its version commit for ${version}, and nothing more.` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 3) {
    const { ok, said } = checkVersionCommit(process.cwd(), args[0] as string, args[1] as string, args[2] as string);
    (ok ? console.log : console.error)(said);
    process.exitCode = ok ? 0 : 1;
  } else {
    console.error("usage: node app/scripts/release/versionCommit.ts <merged commit> <tag> <version>");
    process.exitCode = 2;
  }
}
