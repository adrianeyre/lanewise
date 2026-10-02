/**
 * Makes the conflict evaluation corpus (PRD §14, ADR 0027) by replaying
 * real merges from the open-source repositories `eval/repositories.json`
 * lists, with the system `git`:
 *
 *   pnpm eval:corpus [--only <name>] [--cache <folder>]
 *
 * Each repository is cloned bare into the cache, `eval/.repositories/`
 * unless `--cache` names another, or fetched again if it hasn't the commit
 * the list pins. Its merges are replayed newest first from that commit, and
 * the Conflict Hunks each had are kept with their ground truth, what the
 * merge commit has in their place, at most {@link HUNKS_PER_MERGE} from a merge and
 * {@link HUNKS_PER_SOURCE} from a repository. Each repository's part goes in
 * `eval/corpus/<name>.json`, with its licence beside it, and
 * `eval/corpus/README.md` credits them all. It sends nothing to any Model
 * Provider.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { type CorpusFile, type CorpusPart, type CorpusSource, readCorpus } from "./corpus";
import { corpusReadme } from "./corpusReadme";
import { git, merges, replayMerge } from "./replay";

/** The most Conflict Hunks kept from one merge, so no one merge fills a repository's share. */
const HUNKS_PER_MERGE = 3;

/** The most Conflict Hunks kept from one repository. */
const HUNKS_PER_SOURCE = 20;

const evalDir = join(import.meta.dirname, "..", "..", "..", "eval");
const corpusDir = join(evalDir, "corpus");

const { values } = parseArgs({ options: { only: { type: "string" }, cache: { type: "string" } } });
const cache = values.cache ?? join(evalDir, ".repositories");

const { repositories } = JSON.parse(readFileSync(join(evalDir, "repositories.json"), "utf8")) as {
  repositories: CorpusSource[];
};
const chosen = repositories.filter(({ name }) => values.only === undefined || name === values.only);
if (chosen.length === 0) {
  console.error(`eval/repositories.json lists no ${values.only}: it lists ${repositories.map(({ name }) => name).join(", ")}.`);
  process.exit(1);
}

/** The bare clone of `source` in the cache, with the commit it's pinned at. */
function cloned(source: CorpusSource): string {
  const gitDir = join(cache, `${source.name}.git`);
  if (!existsSync(gitDir)) {
    mkdirSync(cache, { recursive: true });
    console.log(`Cloning ${source.url}…`);
    execFileSync("git", ["clone", "--bare", "--quiet", source.url, gitDir], { stdio: "inherit" });
  }
  try {
    git(gitDir, ["cat-file", "-e", `${source.at}^{commit}`]);
  } catch {
    console.log(`Fetching ${source.url} for ${source.at}…`);
    execFileSync("git", ["--git-dir", gitDir, "fetch", "--quiet", source.url, "+refs/heads/*:refs/heads/*"], { stdio: "inherit" });
  }
  return gitDir;
}

const version = execFileSync("git", ["--version"], { encoding: "utf8" }).trim();
mkdirSync(corpusDir, { recursive: true });

for (const source of chosen) {
  const gitDir = cloned(source);
  const seen = new Set<string>();
  const files: CorpusFile[] = [];
  let kept = 0;
  let replayed = 0;
  for (const merge of merges(gitDir, source.at, source.merges)) {
    if (kept >= HUNKS_PER_SOURCE) break;
    replayed++;
    for (const file of replayMerge(gitDir, merge, seen, Math.min(HUNKS_PER_MERGE, HUNKS_PER_SOURCE - kept))) {
      files.push(file);
      kept += file.hunks.length;
    }
  }
  const part: CorpusPart = { source, git: version, files };
  writeFileSync(join(corpusDir, `${source.name}.json`), `${JSON.stringify(part, null, 2)}\n`);
  writeFileSync(join(corpusDir, `${source.name}.LICENSE`), git(gitDir, ["show", `${source.at}:${source.licenceFile}`]));
  console.log(`${source.name}: ${kept} Conflict Hunks from ${files.length} conflicted files, replaying ${replayed} merges.`);
}

writeFileSync(join(corpusDir, "README.md"), corpusReadme(readCorpus(corpusDir)));
console.log(`Wrote ${corpusDir}.`);
