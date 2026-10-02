/**
 * Measures Suggestion quality on the conflict evaluation corpus (PRD §14,
 * ADR 0027): asks one Model Provider, with the owner's own API key, for a
 * Suggestion for each Conflict Hunk in `eval/corpus/`, and reports how many
 * matched its ground truth exactly, how many nearly, whitespace
 * aside, how many didn't, and how well a low Confidence flagged those.
 *
 *   LANEWISE_ANTHROPIC_API_KEY=sk-ant-… pnpm eval:suggestions anthropic \
 *     --input-price <dollars> --output-price <dollars> \
 *     [--model <id>] [--effort <level>] [--context <lines>] [--only <repository>] [--limit <count>]
 *   pnpm eval:suggestions local [--base-url http://localhost:11434/v1] [--model <id>] …
 *
 * It's run by hand, never in CI: it refuses to run where `CI` is set, or
 * without a terminal to ask in, and it isn't a test file. It reads the key
 * only from the Model Provider's `LANEWISE_…_API_KEY` variable
 * (`providers.ts`), never from one an SDK knows. It lists the Model
 * Provider's models, which costs nothing, then prints what it would ask and
 * an estimated cost from the prices given, per million tokens, and sends
 * nothing more until the owner types `yes`. The requests go one at a time,
 * as the AI Suggestion Widget sends them. Ctrl-C stops the run and reports
 * what came back. The report, and every Suggestion, are written to
 * `eval/results/`, which isn't committed.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import { localBaseUrl, selectionFor } from "../../src/ai/aiSettings";
import { EFFORT_WORDS, aiFailureWords } from "../../src/ai/aiWords";
import { BUNDLED_CATALOG, describeModels } from "../../src/ai/modelCatalog";
import { type Connection, EFFORTS, type Effort } from "../../src/ai/modelProvider";
import { CONTEXT_LINES, MOST_CONTEXT_LINES } from "../../src/ai/suggestionRequest";
import { SCRIPT_MODEL_PROVIDERS } from "../providers";
import { corpusCases, readCorpus } from "./corpus";
import { costOf, estimateTokens } from "./cost";
import { caseRequest, evaluate, inTurn } from "./evaluation";
import { report, summarize } from "./scoring";

const evalDir = join(import.meta.dirname, "..", "..", "..", "eval");

function dollars(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function refuse(why: string): never {
  console.error(why);
  process.exit(1);
}

if (process.env.CI !== undefined || process.env.GITHUB_ACTIONS !== undefined) {
  refuse("The Suggestion evaluation is run by hand with your own API key, never in CI.");
}
if (!process.stdin.isTTY) refuse("Run the Suggestion evaluation in a terminal: it asks before it sends anything.");

const { values, positionals } = parseArgs({
  options: {
    model: { type: "string" },
    effort: { type: "string" },
    context: { type: "string" },
    only: { type: "string" },
    limit: { type: "string" },
    "input-price": { type: "string" },
    "output-price": { type: "string" },
    "base-url": { type: "string" },
  },
  allowPositionals: true,
});

const chosen = SCRIPT_MODEL_PROVIDERS[positionals[0] ?? ""];
if (chosen === undefined || positionals.length !== 1) {
  refuse(`Name one Model Provider to ask: ${Object.keys(SCRIPT_MODEL_PROVIDERS).join(" or ")}.`);
}
const { provider, key, pricing } = chosen;
const apiKey = process.env[key] ?? "";
if (apiKey === "" && provider.key === "required") refuse(`Set ${key} to your own ${provider.name} API key.`);
const baseUrl = values["base-url"] === undefined ? undefined : localBaseUrl(values["base-url"]);
if (baseUrl === null || (baseUrl !== undefined && provider.defaultBaseUrl === null)) {
  refuse("--base-url is only for a local server, and is on this computer, with its port, such as http://localhost:11434/v1.");
}
const effort = values.effort ?? null;
if (effort !== null && !(EFFORTS as readonly string[]).includes(effort)) refuse(`--effort is one of ${EFFORTS.join(", ")}.`);

/** A whole number from `least` to `most` given as `name`, or `fallback` where it isn't given. */
function wholeNumber(name: string, given: string | undefined, least: number, most: number, fallback: number): number {
  if (given === undefined) return fallback;
  const number = Number(given);
  if (!Number.isInteger(number) || number < least || number > most) refuse(`--${name} is a whole number from ${least} to ${most}.`);
  return number;
}

/** A price in dollars per million tokens, which a server on this computer doesn't need. */
function price(name: string): number {
  const given = values[name as "input-price" | "output-price"];
  if (given === undefined && pricing === null) return 0;
  const number = Number(given);
  if (given === undefined || !Number.isFinite(number) || number < 0) {
    refuse(`Give --${name}: ${provider.name}'s price, in US dollars per million tokens, for the model asked, from ${pricing}.`);
  }
  return number;
}

const prices = { input: price("input-price"), output: price("output-price") };
const contextLines = wholeNumber("context", values.context, 0, MOST_CONTEXT_LINES, CONTEXT_LINES);

const parts = readCorpus(join(evalDir, "corpus")).filter(({ source }) => values.only === undefined || source.name === values.only);
if (parts.length === 0) refuse(`The corpus has no repository ${values.only}.`);
const everyCase = inTurn(parts.map(corpusCases));
const cases = everyCase.slice(0, wholeNumber("limit", values.limit, 1, everyCase.length, everyCase.length));

const aborts = new AbortController();
const connection: Connection = { fetch: globalThis.fetch, apiKey: apiKey === "" ? null : apiKey, baseUrl, signal: aborts.signal };

try {
  const models = describeModels(await provider.listModels(connection), BUNDLED_CATALOG.sections[provider.catalog]);
  // The newest version of the first model the catalog knows, or the version `--model` names.
  const model = models.find(({ versions }) => values.model === undefined || versions.some(({ id }) => id === values.model));
  if (model === undefined) refuse(`${provider.name} lists no model ${values.model ?? ""}.`);
  // As Settings does: an effort the version doesn't take isn't sent.
  const selection = selectionFor(
    { provider: provider.id, model: model.id, version: values.model ?? null, effort: effort as Effort | null },
    models,
  );
  if (selection === null) refuse(`${provider.name} lists no version of ${model.name}.`);
  if (effort !== null && selection.effort === null) console.log(`${selection.version} doesn't take effort ${effort}: its default is used.`);
  const effortWords = selection.effort === null ? "its default effort" : `effort ${EFFORT_WORDS[selection.effort]}`;
  const used = estimateTokens(
    cases.map((each) => caseRequest(each, contextLines)),
    selection,
  );
  const cost =
    pricing === null
      ? "which cost nothing from a server on this computer."
      : `about ${dollars(costOf(used, prices))} at ${dollars(prices.input)} in and ${dollars(prices.output)} out per million, charged to your key.`;
  console.log(
    [
      `So far only the model list has been read from ${provider.name}, which costs nothing.`,
      `This asks it for ${cases.length} Suggestions, one at a time, with ${selection.version} at ${effortWords}, and ${contextLines} lines of context.`,
      `Estimated: about ${used.input.toLocaleString("en")} tokens in and up to ${used.output.toLocaleString("en")} out, ${cost}`,
    ].join("\n"),
  );
  const asking = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await asking.question("Send them? Type yes to go on: ");
  asking.close();
  if (answer.trim().toLowerCase() !== "yes") refuse("Nothing was sent.");

  process.on("SIGINT", () => {
    console.log("\nStopping: nothing more is sent.");
    aborts.abort();
  });
  const results = await evaluate({
    cases,
    provider,
    selection,
    connection,
    contextLines,
    onResult({ source, merge, path, number, of, outcome }, index) {
      const said =
        outcome.kind === "suggested"
          ? `${outcome.match}, ${outcome.suggestion.confidence} Confidence`
          : outcome.kind === "failed"
            ? `no Suggestion: ${outcome.reason}`
            : "not asked";
      console.log(`[${index + 1}/${cases.length}] ${source} ${merge.slice(0, 12)} ${path}, Conflict Hunk ${number} of ${of}: ${said}`);
    },
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const title = `Suggestions from ${provider.name}, ${selection.version} at ${effortWords}, with ${contextLines} lines of context`;
  const markdown = report(title, summarize(results));
  const resultsDir = join(evalDir, "results");
  const name = `${stamp}-${provider.id}-${selection.version.replace(/[^\w.-]/g, "_")}`;
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(join(resultsDir, `${name}.md`), markdown);
  writeFileSync(join(resultsDir, `${name}.json`), `${JSON.stringify({ title, selection, contextLines, results }, null, 2)}\n`);
  console.log(`\n${markdown}\nWritten to eval/results/${name}.md and .json.`);
} catch (error) {
  refuse(aiFailureWords(error, () => provider.name));
}
