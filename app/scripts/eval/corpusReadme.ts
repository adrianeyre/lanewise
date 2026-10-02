import type { CorpusPart, ResolvedAs } from "./corpus";

/** How each way a Conflict Hunk was resolved is said in the corpus's README and the evaluation's report. */
export const RESOLVED_AS_WORDS: Record<ResolvedAs, string> = {
  ours: "Ours",
  theirs: "Theirs",
  oursThenTheirs: "Ours then Theirs",
  theirsThenOurs: "Theirs then Ours",
  written: "Written anew",
};

/**
 * `eval/corpus/README.md`: what the corpus is, and each repository it was
 * replayed from, credited with its licence and the commit it's pinned at.
 */
export function corpusReadme(parts: readonly CorpusPart[]): string {
  const hunks = parts.flatMap(({ files }) => files.flatMap((file) => file.hunks));
  const counts = (Object.keys(RESOLVED_AS_WORDS) as ResolvedAs[]).map(
    (kind) => `${RESOLVED_AS_WORDS[kind]}: ${hunks.filter(({ resolvedAs }) => resolvedAs === kind).length}`,
  );
  const rows = parts.map(({ source, files }) => {
    const kept = files.reduce((sum, file) => sum + file.hunks.length, 0);
    const licence = `[${source.licence}](${source.name}.LICENSE)`;
    const commit = `[\`${source.at.slice(0, 12)}\`](${source.url}/commit/${source.at})`;
    return `| [${source.name}](${source.url}) | ${licence} | ${commit} | ${source.merges} | ${files.length} | ${kept} |`;
  });
  const gits = [...new Set(parts.map(({ git }) => git))].join(", ");
  return [
    "# The conflict evaluation corpus",
    "",
    "Made by `pnpm eval:corpus` (`app/scripts/eval/buildCorpus.ts`) from `eval/repositories.json`; don't edit it by hand. See `eval/README.md` and ADR 0027.",
    "",
    `Each Conflict Hunk comes from a real merge in one of these open-source repositories, replayed with ${gits}, and its ground truth is what the merge commit has in its place. Each file here keeps only enough of a conflicted file for the Suggestion request, and is the work of that repository's authors under its licence, which is kept beside it.`,
    "",
    "| Repository | Licence | Merges read back from | Merges replayed at most | Conflicted files | Conflict Hunks |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    `${hunks.length} Conflict Hunks in all. How their merges resolved them: ${counts.join("; ")}.`,
    "",
  ].join("\n");
}
