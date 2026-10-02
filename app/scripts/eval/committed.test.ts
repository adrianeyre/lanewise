import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "vitest";

import { hasConflictMarkers } from "../../src/conflicts/conflictHunks";
import { type CorpusSource, corpusCases, readCorpus } from "./corpus";
import { corpusReadme } from "./corpusReadme";

const root = join(import.meta.dirname, "..", "..", "..");
const evalDir = join(root, "eval");
const corpusDir = join(evalDir, "corpus");

test("the committed corpus is each listed repository's, found again, and credited", () => {
  const parts = readCorpus(corpusDir);
  const { repositories } = JSON.parse(readFileSync(join(evalDir, "repositories.json"), "utf8")) as {
    repositories: CorpusSource[];
  };
  expect(parts.map(({ source }) => source.name)).toEqual(repositories.map(({ name }) => name).toSorted());
  for (const part of parts) {
    expect(part.source).toEqual(repositories.find(({ name }) => name === part.source.name));
    expect(readFileSync(join(corpusDir, `${part.source.name}.LICENSE`), "utf8")).not.toBe("");
    const cases = corpusCases(part);
    expect(cases.length).toBeGreaterThan(0);
    for (const { hunk } of cases) expect(hasConflictMarkers(hunk.resolution.join("\n"))).toBe(false);
  }
  // As Git on Windows may check it out, with CRLF.
  expect(readFileSync(join(corpusDir, "README.md"), "utf8").replace(/\r\n/g, "\n")).toBe(corpusReadme(parts));
});

/** Runs the evaluation with `env` and no terminal, with no API key or gateway set that any SDK knows. */
function evaluation(env: Record<string, string>) {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !/^(CI|GITHUB_ACTIONS)$|API_KEY|BASE_URL|ANTHROPIC|OPENAI|GEMINI|GOOGLE|XAI/.test(name),
    ),
  );
  const tsx = join(root, "node_modules", "tsx", "dist", "cli.mjs");
  expect(existsSync(tsx)).toBe(true);
  return spawnSync(process.execPath, [tsx, join(import.meta.dirname, "evaluate.ts"), "anthropic"], {
    env: { ...clean, ...env },
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// Starting tsx takes a moment on a cold cache.
const SLOW = 60_000;

test(
  "the evaluation refuses to run in CI, or without a terminal to ask in, before it sends anything",
  () => {
    const inCi = evaluation({ CI: "true", LANEWISE_ANTHROPIC_API_KEY: "sk-ant-never-sent" });
    expect(inCi.status).toBe(1);
    expect(inCi.stderr).toContain("never in CI");
    const unattended = evaluation({ LANEWISE_ANTHROPIC_API_KEY: "sk-ant-never-sent" });
    expect(unattended.status).toBe(1);
    expect(unattended.stderr).toContain("it asks before it sends anything");
  },
  SLOW,
);
