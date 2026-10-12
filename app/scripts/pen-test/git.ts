/**
 * The small `git` plumbing the Hostile repository fixtures are built from
 * (pen-testing PRD §6, E1). Everything here is synthetic: a fixture's
 * hostile refs, trees, configuration and conflicts are made from nothing
 * with the system `git`, never from a real project's history.
 *
 * Most of the hostile content is written straight into the object database
 * with `hash-object`, `mktree` and `commit-tree`, so a path like `..`, an
 * absolute symlink target or a case collision exists as an object without
 * ever being written to the tester's own working tree. That is deliberate:
 * the fixture is the bait, and it must not fire on the machine that builds
 * it. Only the tester opening it in Lanewise should ever check it out.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** A fixed identity and clock, so every fixture reproduces byte for byte. */
const AUTHOR_DATE = "1700000000 +0000";
const IDENTITY = {
  GIT_AUTHOR_NAME: "Lanewise fixtures",
  GIT_AUTHOR_EMAIL: "fixtures@lanewise.invalid",
  GIT_AUTHOR_DATE: AUTHOR_DATE,
  GIT_COMMITTER_NAME: "Lanewise fixtures",
  GIT_COMMITTER_EMAIL: "fixtures@lanewise.invalid",
  GIT_COMMITTER_DATE: AUTHOR_DATE,
} as const;

/** One entry of a Git tree, as `git mktree` reads it. */
export interface TreeEntry {
  readonly mode: "100644" | "100755" | "120000" | "040000" | "160000";
  readonly type: "blob" | "tree" | "commit";
  readonly oid: string;
  /** A single path component. It may be hostile (`..`, a leading dash, control characters). */
  readonly name: string;
}

/** How a commit names itself, including the hostile parts a fixture crafts. */
export interface CommitInfo {
  readonly tree: string;
  readonly message: string;
  readonly parents?: readonly string[];
  readonly authorName?: string;
  readonly authorEmail?: string;
}

/** `git` in `dir` with `args`, its stdout as text. Throws unless Git's exit code is in `allow`. */
export function git(dir: string, args: readonly string[], allow: readonly number[] = [0]): string {
  try {
    return execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      maxBuffer: 1 << 28,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...IDENTITY },
    });
  } catch (failure) {
    const { status, stdout } = failure as { status: number | null; stdout?: string };
    if (status !== null && allow.includes(status) && stdout !== undefined) return stdout;
    throw failure;
  }
}

/** `git` in `dir` with `data` on stdin, its stdout trimmed. Used for `hash-object`, `mktree`, `commit-tree`. */
function gitWithInput(dir: string, args: readonly string[], data: string | Buffer): string {
  return execFileSync("git", ["-C", dir, ...args], {
    input: data,
    maxBuffer: 1 << 28,
    env: { ...process.env, ...IDENTITY },
  })
    .toString("utf8")
    .trim();
}

/** A new repository at `dir`. Bare when `bare`, so a fixture can be a crafted remote. */
export function init(dir: string, bare = false): void {
  const args = ["init", "--quiet", "-b", "main", ...(bare ? ["--bare"] : []), dir];
  execFileSync("git", args, { stdio: "ignore" });
}

/** Writes `data` as a loose blob and returns its object id. Never touches the working tree. */
export function hashBlob(dir: string, data: string | Buffer): string {
  return gitWithInput(dir, ["hash-object", "-w", "--stdin"], data);
}

/** Writes a tree from `entries` and returns its object id. A single component may be any name `mktree` accepts, `..` included. */
export function mkTree(dir: string, entries: readonly TreeEntry[]): string {
  const lines = entries.map((entry) => `${entry.mode} ${entry.type} ${entry.oid}\t${entry.name}`).join("\n");
  // An empty tree takes empty input; a blank line is an error outside batch mode.
  return gitWithInput(dir, ["mktree", "--missing"], entries.length === 0 ? "" : `${lines}\n`);
}

/** Writes a commit for `info` and returns its object id. The message and author are passed verbatim, hostile bytes and all. */
export function commit(dir: string, info: CommitInfo): string {
  const parents = (info.parents ?? []).flatMap((parent) => ["-p", parent]);
  const env = {
    ...process.env,
    ...IDENTITY,
    GIT_AUTHOR_NAME: info.authorName ?? IDENTITY.GIT_AUTHOR_NAME,
    GIT_AUTHOR_EMAIL: info.authorEmail ?? IDENTITY.GIT_AUTHOR_EMAIL,
  };
  return execFileSync("git", ["-C", dir, "commit-tree", info.tree, ...parents], {
    input: info.message,
    env,
  })
    .toString("utf8")
    .trim();
}

/**
 * `git commit` of the current index in `dir`, returning the new commit.
 * `author`, when given, overrides the committed author through the
 * environment, so a fixture can carry a hostile author name (control bytes
 * and markup included) that the default identity would otherwise mask.
 */
export function commitIndex(dir: string, message: string, author?: { name: string; email?: string }): string {
  const env: NodeJS.ProcessEnv = { ...process.env, ...IDENTITY };
  if (author) {
    env.GIT_AUTHOR_NAME = author.name;
    env.GIT_AUTHOR_EMAIL = author.email ?? "hostile@lanewise.invalid";
  }
  execFileSync("git", ["-C", dir, "commit", "-q", "--no-gpg-sign", "-m", message], { env, stdio: "ignore" });
  return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { env, encoding: "utf8" }).trim();
}

/** Points `ref` (a full name such as `refs/heads/main`) at `oid`. */
export function updateRef(dir: string, ref: string, oid: string): void {
  git(dir, ["update-ref", ref, oid]);
}

/**
 * Appends `refs` straight into `.git/packed-refs`, each `[name, oid]`.
 * This is how a fixture carries a ref whose name begins with `-`, or holds
 * other odd-but-valid bytes, the way a crafted `packed-refs` shared on a
 * network drive would.
 */
export function appendPackedRefs(gitDir: string, refs: ReadonlyArray<readonly [string, string]>): void {
  const header = "# pack-refs with: peeled fully-peeled sorted \n";
  const body = refs.map(([name, oid]) => `${oid} ${name}`).join("\n");
  writeFileSync(join(gitDir, "packed-refs"), `${header}${body}\n`);
}
