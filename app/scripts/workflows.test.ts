/**
 * The GitHub Actions workflows (`.github/workflows/`). Every action they use
 * is pinned to a commit, so a tag moved on the action's repository changes
 * nothing here until Dependabot proposes it, and code scanning reads the
 * tree's Rust and TypeScript on every pull request, every push to main and
 * every week (ADR 0049).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "vitest";
import { parse } from "yaml";

const root = join(import.meta.dirname, "..", "..");
const WORKFLOWS_DIR = ".github/workflows";
const WORKFLOWS = readdirSync(join(root, WORKFLOWS_DIR)).filter((file) => file.endsWith(".yml"));

interface Step {
  uses?: string;
  if?: string;
  with?: Record<string, unknown>;
}

interface Job {
  permissions?: Record<string, string>;
  strategy?: { matrix?: Record<string, unknown> };
  steps?: Step[];
}

interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
}

/** A workflow's text, with CRLF made LF, as Git on Windows may check it out. */
function text(file: string): string {
  return readFileSync(join(root, WORKFLOWS_DIR, file), "utf8").replace(/\r\n/g, "\n");
}

function workflow(file: string): Workflow {
  return parse(text(file)) as Workflow;
}

/** Every `uses:` line of a workflow, with its trailing comment. */
function uses(file: string): string[] {
  return [...text(file).matchAll(/^\s*(?:- )?uses: (.+)$/gm)].map(([, line = ""]) => line.trim());
}

test("every action a workflow uses is pinned to a commit, with the release it is", () => {
  const unpinned = WORKFLOWS.flatMap((file) =>
    uses(file)
      .filter((line) => !line.startsWith("./"))
      .filter((line) => !/^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40} # v\d+\.\d+\.\d+$/.test(line))
      .map((line) => `${file}: ${line}`),
  );
  expect(unpinned).toEqual([]);
});

test("each action is at the same commit in every workflow", () => {
  const commits = new Map<string, Set<string>>();
  for (const line of WORKFLOWS.flatMap(uses).filter((each) => !each.startsWith("./"))) {
    const [action = "", commit = ""] = line.split(" ")[0]?.split("@") ?? [];
    // `github/codeql-action/init` and `/analyze` are one repository, released together.
    const repository = action.split("/").slice(0, 2).join("/");
    commits.set(repository, (commits.get(repository) ?? new Set()).add(commit));
  }
  const differing = [...commits].filter(([, each]) => each.size > 1).map(([repository]) => repository);
  expect(differing).toEqual([]);
});

test("no workflow runs a pull request's code with the base repository's token", () => {
  expect(WORKFLOWS.filter((file) => "pull_request_target" in workflow(file).on)).toEqual([]);
});

test("code scanning reads the Rust, the TypeScript and the workflows on each pull request, each push to main and each week", () => {
  const codeql = workflow("codeql.yml");
  expect(Object.keys(codeql.on).toSorted()).toEqual(["pull_request", "push", "schedule", "workflow_dispatch"]);
  expect(codeql.on.push).toEqual({ branches: ["main"] });
  expect(codeql.on.schedule).toEqual([{ cron: expect.stringMatching(/^\d+ \d+ \* \* \d$/) }]);

  // Its token reads the code and writes only the alerts.
  expect(codeql.permissions).toEqual({ contents: "read" });
  const jobs = Object.values(codeql.jobs);
  expect(jobs).toHaveLength(1);
  const [analyze] = jobs as [Job];
  expect(analyze.permissions).toEqual({ contents: "read", "security-events": "write" });

  expect(analyze.strategy?.matrix?.language).toEqual(["rust", "javascript-typescript", "actions"]);
  const step = (action: string) => analyze.steps?.find((each) => each.uses?.startsWith(`github/codeql-action/${action}@`));
  expect(step("init")?.with).toMatchObject({
    languages: "${{ matrix.language }}",
    "build-mode": "none",
    queries: "security-extended",
  });
  expect(step("analyze")?.with).toEqual({ category: "/language:${{ matrix.language }}" });
});
