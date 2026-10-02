/**
 * Sends one real Suggestion request to a Model Provider through its adapter,
 * with the owner's own API key, to check what the mocked tests can't
 * (ADR 0022, ADR 0023, ADR 0024). It is run by hand, never in CI, and costs a
 * few cents a run with a cloud Model Provider:
 *
 *   LANEWISE_ANTHROPIC_API_KEY=sk-ant-… pnpm try:anthropic [--model <id>] [--effort <level>]
 *   LANEWISE_GEMINI_API_KEY=AIza… pnpm try:gemini [--model <id>] [--effort <level>]
 *   LANEWISE_OPENAI_API_KEY=sk-… pnpm try:openai [--model <id>] [--effort <level>]
 *   LANEWISE_XAI_API_KEY=xai-… pnpm try:xai [--model <id>] [--effort <level>]
 *   LANEWISE_META_API_KEY=… pnpm try:meta [--model <id>] [--effort <level>]
 *   pnpm try:local [--base-url http://localhost:11434/v1] [--model <id>] [--effort <level>]
 *
 * The key is read only from its `LANEWISE_…_API_KEY` variable (`providers.ts`),
 * never from `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`,
 * `OPENAI_API_KEY`, `XAI_API_KEY` or any other variable an SDK knows, so a key
 * or gateway that happens to be about can't be used by mistake. A local server is asked with
 * `LANEWISE_LOCAL_API_KEY` only where it's set, since most take none. The
 * models listed are described by the bundled model catalog, as Settings
 * describes them, so an effort goes as the catalog says: as a token budget
 * for Gemini 2.5, and as `reasoning_effort` only at a level the model takes.
 * Each request is logged, without its key, with the `response_format` it
 * asked for, to show how an OpenAI-compatible server was held to the schema.
 */

import { parseArgs } from "node:util";

import { aiFailureWords } from "../src/ai/aiWords";
import { localBaseUrl, selectionFor } from "../src/ai/aiSettings";
import { BUNDLED_CATALOG, describeModels } from "../src/ai/modelCatalog";
import { type Connection, EFFORTS, type Effort, type SuggestionRequest } from "../src/ai/modelProvider";
import { SCRIPT_MODEL_PROVIDERS } from "./providers";

const { values, positionals } = parseArgs({
  options: { model: { type: "string" }, effort: { type: "string" }, "base-url": { type: "string" } },
  allowPositionals: true,
});

const chosen = SCRIPT_MODEL_PROVIDERS[positionals[0] ?? ""];
if (chosen === undefined || positionals.length !== 1) {
  console.error(`Name one Model Provider to ask: ${Object.keys(SCRIPT_MODEL_PROVIDERS).join(" or ")}.`);
  process.exit(1);
}
const { provider, key } = chosen;
const apiKey = process.env[key] ?? "";
if (apiKey === "" && provider.key === "required") {
  console.error(`Set ${key} to your own ${provider.name} API key to send one real request.`);
  process.exit(1);
}
const baseUrl = values["base-url"] === undefined ? undefined : localBaseUrl(values["base-url"]);
if (baseUrl === null || (baseUrl !== undefined && provider.defaultBaseUrl === null)) {
  console.error("--base-url is only for a local server, and is on this computer, with its port, such as http://localhost:11434/v1.");
  process.exit(1);
}
const effort = values.effort ?? null;
if (effort !== null && !(EFFORTS as readonly string[]).includes(effort)) {
  console.error(`--effort is one of ${EFFORTS.join(", ")}.`);
  process.exit(1);
}

/** A small Conflict Hunk: both sides changed one line. */
const request: SuggestionRequest = {
  path: "src/greeting.ts",
  base: ['export const greeting = "Hello";'],
  ours: ['export const greeting = "Hello, world";'],
  theirs: ['export const greeting: string = "Hello";'],
  before: ["// The greeting shown on the start page."],
  after: ["", "export function greet(name: string) {", "  return `${greeting}, ${name}`;", "}"],
  oursSubject: "Greet the world",
  theirsSubject: "Type the greeting",
};

/** Each request, logged without its headers, and with the `response_format` it asked for, if any. */
function logged(url: string, init?: RequestInit): Promise<Response> {
  let format = "";
  if (typeof init?.body === "string") {
    try {
      const type = (JSON.parse(init.body) as { response_format?: { type?: unknown } }).response_format?.type;
      format = typeof type === "string" ? ` (response_format: ${type})` : " (no response_format)";
    } catch {
      // Not JSON: nothing more to say about it.
    }
  }
  console.log(`${init?.method ?? "GET"} ${url}${format}`);
  return globalThis.fetch(url, init);
}

const connection: Connection = { fetch: logged, apiKey: apiKey === "" ? null : apiKey, baseUrl };

try {
  const models = describeModels(await provider.listModels(connection), BUNDLED_CATALOG.sections[provider.catalog]);
  for (const { name, versions } of models) {
    console.log(`${name}: ${versions.map(({ id, efforts }) => `${id} [${efforts?.join(", ") ?? ""}]`).join("; ")}`);
  }
  // The newest version of the first model the catalog knows, or the version `--model` names.
  const model = models.find(({ versions }) => values.model === undefined || versions.some(({ id }) => id === values.model));
  if (model === undefined) throw new Error(`${provider.name} lists no model ${values.model ?? ""}.`);
  // As Settings does: an effort the version doesn't take isn't sent.
  const selection = selectionFor(
    { provider: provider.id, model: model.id, version: values.model ?? null, effort: effort as Effort | null },
    models,
  );
  if (selection === null) throw new Error(`${provider.name} lists no version of ${model.name}.`);
  const budget = selection.budget === null ? "" : `, a budget of ${selection.budget} tokens`;
  console.log(`Asking ${selection.version} at effort ${selection.effort ?? "the model's default"}${budget}.`);
  const suggestion = await provider.suggest(request, selection, connection);
  console.log(JSON.stringify(suggestion, null, 2));
} catch (error) {
  console.error(aiFailureWords(error, () => provider.name));
  process.exit(1);
}
