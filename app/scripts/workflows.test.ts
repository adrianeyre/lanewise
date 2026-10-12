/**
 * The GitHub Actions workflows (`.github/workflows/`). Every action they use
 * is pinned to a commit, so a tag moved on the action's repository changes
 * nothing here until Dependabot proposes it, and code scanning reads the
 * tree's Rust and TypeScript on every pull request, every push to main and
 * every week (ADR 0049). The release workflow gives the Update key to one
 * step that runs only Node and Lanewise's own scripts, and each job's token
 * only what it needs (ADR 0053).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";
import { parse } from "yaml";

const root = join(import.meta.dirname, "..", "..");
const WORKFLOWS_DIR = ".github/workflows";
const WORKFLOWS = readdirSync(join(root, WORKFLOWS_DIR)).filter((file) => file.endsWith(".yml"));

interface Step {
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}

interface Job {
  /** A workflow this job calls in place of steps of its own. */
  uses?: string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  environment?: string | { name: string };
  env?: Record<string, string>;
  strategy?: { matrix?: Record<string, unknown> };
  steps?: Step[];
}

interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
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

// A run saves its caches for its own ref, and restores them from that ref or
// the default branch's. A pull request's run saves for its merge ref, so only
// runs on main save what the release jobs, which run on main, restore.
test("no workflow runs on main for anything but a push to it, a schedule or someone who can write to the repository", () => {
  const started = WORKFLOWS.map((file) => [file, Object.keys(workflow(file).on).toSorted()]);
  expect(started).toEqual([
    ["ci.yml", ["pull_request", "workflow_call", "workflow_dispatch"]],
    ["codeql.yml", ["pull_request", "push", "schedule", "workflow_dispatch"]],
    ["release.yml", ["push", "workflow_dispatch"]],
  ]);
  const pushes = WORKFLOWS.flatMap((file) => ("push" in workflow(file).on ? [[file, workflow(file).on.push]] : []));
  expect(pushes).toEqual([
    ["codeql.yml", { branches: ["main"] }],
    ["release.yml", { branches: ["main"] }],
  ]);
  // The only workflow that calls another is the release workflow, on main.
  const calling = WORKFLOWS.flatMap((file) =>
    Object.entries(workflow(file).jobs).flatMap(([name, job]) => (job.uses === undefined ? [] : [`${file} ${name}: ${job.uses}`])),
  );
  expect(calling).toEqual(["release.yml verify: ./.github/workflows/ci.yml"]);
});

test("the jobs that sign and publish a Release restore no cache another job saved", () => {
  const { jobs } = workflow("release.yml");
  for (const name of ["sign", "publish"]) {
    const steps = jobs[name]?.steps ?? [];
    expect(steps.map(actionOf).filter((action) => action !== undefined && /cache|rust-cache|action-setup/.test(action))).toEqual([]);
    // setup-node restores pnpm's store only when asked, and npm's only when package.json names npm.
    expect(steps.find((step) => actionOf(step) === "actions/setup-node")?.with).toEqual({ "node-version": 26 });
    expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).packageManager).toMatch(/^pnpm@/);
  }
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

/** The action a step uses, without its commit. */
function actionOf(step: Step): string | undefined {
  return step.uses?.split("@")[0];
}

describe("the release workflow's secrets and tokens (ADR 0053)", () => {
  const release = workflow("release.yml");
  const jobs = release.jobs;
  const steps = (job: string) => jobs[job]?.steps ?? [];

  test("the Update key's secrets reach one step of one workflow: the sign job's", () => {
    const holding = WORKFLOWS.flatMap((file) =>
      Object.entries(workflow(file).jobs).flatMap(([name, job]) =>
        (job.steps ?? []).filter((step) => JSON.stringify(step).includes("secrets.TAURI_SIGNING")).map((step) => `${file} ${name}: ${step.name}`),
      ),
    );
    expect(holding).toEqual(["release.yml sign: Update key"]);
    expect(steps("sign").find((step) => step.name === "Update key")?.env).toEqual({
      TAURI_SIGNING_PRIVATE_KEY: "${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}",
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}",
    });
  });

  test("no secret or token is put in a job's or a workflow's environment, where every step would have it", () => {
    const wide = WORKFLOWS.flatMap((file) => {
      const each = workflow(file);
      return [
        ...(/secrets\.|github\.token/.test(JSON.stringify(each.env ?? {})) ? [file] : []),
        ...Object.entries(each.jobs)
          .filter(([, job]) => /secrets\.|github\.token/.test(JSON.stringify(job.env ?? {})))
          .map(([name]) => `${file} ${name}`),
      ];
    });
    expect(wide).toEqual([]);
  });

  test("the sign job installs and builds nothing: only GitHub's own actions, Node and Lanewise's own scripts", () => {
    const sign = jobs.sign as Job;
    expect(sign.environment).toBe("release");
    expect(sign.permissions).toEqual({ contents: "read" });
    expect(sign.needs).toEqual(["release", "windows", "macos"]);
    expect([...new Set(steps("sign").map(actionOf).filter(Boolean))].toSorted()).toEqual([
      "actions/checkout",
      "actions/download-artifact",
      "actions/setup-node",
      "actions/upload-artifact",
    ]);
    // setup-node's cache would restore packages another job saved.
    expect(steps("sign").find((step) => actionOf(step) === "actions/setup-node")?.with).toEqual({ "node-version": 26 });
    const runs = steps("sign").flatMap((step) => (step.run ? [step.run] : []));
    expect(runs.filter((run) => /\b(?:pnpm|npm|npx|yarn|corepack|cargo|rustup|tauri)\b/.test(run))).toEqual([]);
    const scripts = runs.flatMap((run) => [...run.matchAll(/\bnode (\S+)/g)].map(([, script]) => script));
    expect(scripts).toEqual(["app/scripts/release/versionCommit.ts", "app/scripts/release/updater.ts"]);
  });

  test("the scripts the sign job runs import only Node's own modules", () => {
    for (const script of ["release/versionCommit.ts", "release/updater.ts"]) {
      const source = readFileSync(join(root, "app", "scripts", script), "utf8");
      const imported = [...source.matchAll(/^import [^;]*? from "([^"]+)";$/gms)].map(([, from]) => from);
      expect({ script, imports: imported.length > 0 }).toEqual({ script, imports: true });
      expect({ script, others: imported.filter((from) => !from?.startsWith("node:")) }).toEqual({ script, others: [] });
    }
  });

  test("the sign job checks the tag against the commit merged, from that commit, before it signs anything", () => {
    const checkout = steps("sign").find((step) => actionOf(step) === "actions/checkout");
    expect(checkout?.with).toEqual({ "fetch-depth": 0, "persist-credentials": false });
    const order = steps("sign").map((step) => step.name ?? actionOf(step) ?? step.run?.split("\n")[0]);
    expect(order.indexOf("The tag is what was merged")).toBeLessThan(order.indexOf("Update key"));
    expect(steps("sign").find((step) => step.name === "The tag is what was merged")?.run?.trim()).toBe(
      'node app/scripts/release/versionCommit.ts "$GITHUB_SHA" "$TAG" "$VERSION"',
    );
    expect(jobs.publish?.needs).toContain("sign");
  });

  test("every job that checks out the Release's tag names it in full, so a branch of its name is never taken for it", () => {
    const refs = Object.entries(jobs).flatMap(([name, job]) =>
      (job.steps ?? [])
        .filter((step) => actionOf(step) === "actions/checkout" && String(step.with?.ref ?? "").includes("needs.release.outputs.tag"))
        .map((step) => [name, step.with?.ref]),
    );
    expect(refs).toEqual([
      ["windows", "refs/tags/${{ needs.release.outputs.tag }}"],
      ["macos", "refs/tags/${{ needs.release.outputs.tag }}"],
      ["publish", "refs/tags/${{ needs.release.outputs.tag }}"],
      ["website", "${{ needs.release.outputs.tag && format('refs/tags/{0}', needs.release.outputs.tag) || github.sha }}"],
    ]);
  });

  test("the build jobs never have the Update key, and the Mac's only a throwaway one made beside it", () => {
    for (const job of ["windows", "macos"]) {
      expect({ job, key: /secrets\.TAURI/.test(JSON.stringify(jobs[job])) }).toEqual({ job, key: false });
    }
    const build = steps("macos").find((step) => step.run?.includes("pnpm desktop:build"));
    expect(build?.env).toEqual({
      TAURI_SIGNING_PRIVATE_KEY: "${{ steps.throwaway.outputs.key }}",
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "${{ steps.throwaway.outputs.password }}",
    });
  });

  test("each job's token can do what that job needs, and nothing more", () => {
    expect(release.permissions).toEqual({ contents: "read" });
    const permissions = Object.fromEntries(Object.entries(jobs).map(([name, job]) => [name, job.permissions]));
    expect(permissions).toEqual({
      verify: { contents: "read" },
      // semantic-release: the tag, the version commit and the draft Release, and its comments on what it released.
      release: { contents: "write", issues: "write", "pull-requests": "write" },
      windows: undefined,
      macos: undefined,
      sign: { contents: "read" },
      publish: { contents: "write" },
      pages: { pages: "read" },
      website: { contents: "read", pages: "read" },
      deploy: { "id-token": "write", pages: "write" },
    });
  });

  test("a write token reaches only the steps that use it", () => {
    const semanticRelease = steps("release").filter((step) => JSON.stringify(step).includes("secrets.GITHUB_TOKEN"));
    expect(semanticRelease.map((step) => step.run)).toEqual(["pnpm exec semantic-release"]);
    const publish = steps("publish").filter((step) => JSON.stringify(step).includes("github.token"));
    expect(publish).toHaveLength(2);
    for (const step of publish) expect(step.run).toMatch(/^\s*gh release /m);
    expect(steps("publish").filter((step) => step.run?.includes("gh release") && !step.env?.GH_TOKEN)).toEqual([]);
  });

  test("the website is built with a token that can only read, and deployed by a job that runs only deploy-pages", () => {
    expect(JSON.stringify(jobs.website)).not.toMatch(/deploy-pages|id-token/);
    expect(jobs.deploy?.needs).toBe("website");
    expect(steps("deploy").map(actionOf)).toEqual(["actions/deploy-pages"]);
    expect(jobs.deploy?.environment).toEqual({ name: "github-pages", url: "${{ steps.deployment.outputs.page_url }}" });
  });
});
