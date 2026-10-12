/**
 * Makes the Hostile repository fixtures for Lanewise's first Pen-test round
 * (pen-testing PRD §6, E1), run by hand and never in CI against a real
 * project:
 *
 *   pnpm pen-test:fixtures [--out <folder>] [--force]
 *
 * Every repository is synthetic, built from nothing by `fixtures.ts`, and
 * written under `--out` (by default a new folder in the OS temp directory, so
 * the worktree stays clean and the fixtures sit outside it). Each gets its
 * own README saying what it is for and the marker that shows it worked, and
 * a top-level README indexes them. The script runs nothing a fixture arms:
 * the marker commands only ever write a file under the marker directory, and
 * only if Lanewise runs them.
 */

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { type Fixture, fixtures, type Report } from "./fixtures";
import { init } from "./git";

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    force: { type: "boolean", default: false },
  },
});

// Made afresh, and only this user's, rather than at a fixed path in a temp
// folder another user on the machine could have made first.
const outDir = values.out ?? mkdtempSync(join(tmpdir(), "lanewise-hostile-fixtures-"));
const markerDir = mkdtempSync(join(tmpdir(), "lanewise-pen-test-markers-"));

/** The README written into one fixture's folder. */
function fixtureReadme(fixture: Fixture, report: Report): string {
  const notes = report.notes.length === 0 ? "" : `\n## On this platform\n\n${report.notes.map((note) => `- ${note}`).join("\n")}\n`;
  return `# ${fixture.title}

> **Hostile repository — synthetic.** Made by \`pnpm pen-test:fixtures\` for Lanewise's first Pen-test round (pen-testing PRD §6, E1, \`docs/pen-test/E1.md\`). It is not a real project's history. Open it only in a disposable Release, never in your own account or against your own repositories.

## What it is for

${report.purpose}

## The marker that shows it worked

${report.marker}

Check it with:

\`\`\`sh
${report.check}
\`\`\`
${notes}`;
}

/** The top-level README indexing every fixture. */
function indexReadme(built: ReadonlyArray<{ fixture: Fixture; report: Report }>): string {
  const rows = built
    .map(({ fixture }) => `| [\`${fixture.name}/\`](${fixture.name}/README.md) | ${fixture.title} |`)
    .join("\n");
  return `# Hostile repository fixtures

> **Synthetic and hostile.** These repositories are built from nothing to attack whoever opens, clones, fetches or resolves conflicts in them (pen-testing PRD §6, E1). None is a real project's history. Open them only in a disposable Release, in a throwaway account whose credential store holds only throwaway credentials, never on your own machine account or against your own repositories.

Made by, and remade by, \`pnpm pen-test:fixtures\` (\`app/scripts/pen-test/buildFixtures.ts\`). Each repository has its own README saying what it is for and the marker that shows it worked. The scope issues of the round (G, M and S3) open these and watch for the markers; the public record is in \`docs/pen-test/\`.

## The marker directory

A fixture that arms a command does so so the command only ever writes a marker file, and nothing else. They all write under:

    ${markerDir}

Each build makes a new, empty one. An empty marker directory means nothing a fixture armed has run. A file appearing there after an action in Lanewise is how that probe shows code ran. Empty it between runs to start clean.

## The fixtures

| Repository | What it probes |
| --- | --- |
${rows}

## Building them again

\`\`\`sh
pnpm pen-test:fixtures [--out <folder>] [--force]
\`\`\`

\`--out\` defaults to a new folder under the OS temp directory. \`--force\` rebuilds over an existing one. The build is deterministic: the same \`git\` makes byte-for-byte the same objects each time.
`;
}

function main(): void {
  mkdirSync(outDir, { recursive: true });
  const existing = readdirSync(outDir);
  if (existing.length > 0 && !values.force) {
    console.error(`${outDir} is not empty. Pass --force to rebuild over it, or --out to choose another folder.`);
    process.exit(1);
  }

  const built: Array<{ fixture: Fixture; report: Report }> = [];
  for (const fixture of fixtures) {
    const dir = join(outDir, fixture.name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    init(dir);
    const report = fixture.build({ dir, markerDir });
    writeFileSync(join(dir, "README.md"), fixtureReadme(fixture, report));
    built.push({ fixture, report });
    const platform = report.notes.length === 0 ? "" : ` (${report.notes.length} platform note${report.notes.length === 1 ? "" : "s"})`;
    console.log(`  ${fixture.name.padEnd(22)} ${fixture.title}${platform}`);
  }

  writeFileSync(join(outDir, "README.md"), indexReadme(built));
  console.log(`\n${built.length} Hostile repositories under ${outDir}`);
  console.log(`Markers, if any fire, under ${markerDir}`);
}

main();
