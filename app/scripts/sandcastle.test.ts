/**
 * The Sandcastle harness (`.sandcastle/`, `docs/processes/running-sandcastle.md`):
 * what a run's commits can reach, and what of the host a run's container is
 * given. These pin what the R5 scope of the Pen-test round showed holds.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "vitest";
import { parse } from "yaml";

const root = join(import.meta.dirname, "..", "..");

/** A file's text, with CRLF made LF, as Git on Windows may check it out. */
function text(path: string): string {
  return readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
}

const main = text(".sandcastle/main.ts");

test("a run refuses to start on main, before any sandbox is made", () => {
  const guard = main.indexOf('if (targetBranch === "main")');
  const exit = main.indexOf("process.exit(1);", guard);
  expect(guard).toBeGreaterThan(-1);
  expect(exit).toBeGreaterThan(guard);
  expect(exit).toBeLessThan(main.indexOf("await run("));
});

test("a run's commits come back on a branch of their own, merged to the one it was launched from", () => {
  expect([...main.matchAll(/branchStrategy: (\{[^}]*\})/g)].map(([, strategy]) => strategy)).toEqual([
    '{ type: "merge-to-head" }',
  ]);
});

test("main.ts mounts no file of the host's itself but the CA certificate, and that read-only", () => {
  expect([...main.matchAll(/\{ hostPath: [^}]*\}/g)].map(([mount]) => mount)).toEqual([
    "{ hostPath: hostCaCert, sandboxPath: caCertInSandbox, readonly: true }",
  ]);
  expect(main.match(/mounts[,:]/g)).toEqual(["mounts:", "mounts,"]);
});

test("the agent runs as a user that isn't root", () => {
  const users = [...text(".sandcastle/Dockerfile").matchAll(/^USER (.+)$/gm)].map(([, user]) => user);
  expect(users).toEqual(["${AGENT_UID}:${AGENT_GID}"]);
});

test("dependencies are installed as the lockfile has them", () => {
  expect([...main.matchAll(/command: "([^"]*)"/g)].map(([, command]) => command)).toEqual([
    "corepack pnpm install --frozen-lockfile",
  ]);
});

test("a run's keys, logs, worktrees and own prompts are never committed, and the example fills in no key", () => {
  expect(text(".sandcastle/.gitignore").split("\n").filter(Boolean)).toEqual([
    ".env",
    "logs/",
    "worktrees/",
    "prompt*.md",
    "!prompt.md",
  ]);
  const keys = text(".sandcastle/.env.example")
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"));
  expect(keys.length).toBeGreaterThan(0);
  expect(keys.filter((line) => !/^[A-Z_]+=$/.test(line))).toEqual([]);
});

test("no workflow starts on an issue or a comment, so public text runs nothing in Actions", () => {
  const starts = readdirSync(join(root, ".github/workflows"))
    .filter((file) => file.endsWith(".yml"))
    .flatMap((file) => {
      const on = (parse(text(`.github/workflows/${file}`)) as { on: Record<string, unknown> }).on;
      return Object.keys(on).map((event) => `${file}: ${event}`);
    });
  expect(starts.filter((start) => /: (?:issues|issue_comment|discussion|discussion_comment|pull_request_review_comment)$/.test(start))).toEqual([]);
});
