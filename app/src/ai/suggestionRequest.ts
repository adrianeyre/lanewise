import type { ConflictHunk } from "../conflicts/conflictHunks";
import {
  type Confidence,
  ModelProviderError,
  type Suggestion,
  type SuggestionRequest,
} from "./modelProvider";

/** How many lines round a Conflict Hunk are sent on each side, unless Settings says otherwise (PRD §8.1). */
export const CONTEXT_LINES = 20;

/** The most lines of context Settings allows on each side. */
export const MOST_CONTEXT_LINES = 200;

/**
 * The request for a Suggestion for `hunk` in `text`, a conflicted file's
 * working tree text with its conflict markers: the Conflict Hunk's versions,
 * up to `contextLines` lines on each side, and the file's path and the
 * commit subjects.
 */
export function suggestionRequest(
  text: string,
  hunk: ConflictHunk,
  {
    path,
    oursSubject,
    theirsSubject,
    contextLines = CONTEXT_LINES,
  }: { path: string; oursSubject: string | null; theirsSubject: string | null; contextLines?: number },
): SuggestionRequest {
  const lines = text.split("\n");
  // A file that ends with a newline splits into one empty line too many.
  if (text.endsWith("\n")) lines.pop();
  const start = hunk.startLine - 1;
  return {
    path,
    base: hunk.base,
    ours: hunk.ours,
    theirs: hunk.theirs,
    before: lines.slice(Math.max(0, start - contextLines), start),
    after: lines.slice(hunk.endLine, hunk.endLine + contextLines),
    oursSubject,
    theirsSubject,
  };
}

/** The JSON Schema a Model Provider's structured output is held to. */
export const SUGGESTION_SCHEMA = {
  type: "object",
  properties: {
    explanation: { type: "string", description: "A short, plain-English explanation of the reasoning." },
    resolution: { type: "string", description: "The lines that replace the whole hunk, without conflict markers." },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["explanation", "resolution", "confidence"],
  additionalProperties: false,
} as const;

/**
 * What the model's told to answer with, the {@link SUGGESTION_SCHEMA} in
 * words, for a model its Model Provider doesn't hold to the schema: one
 * that answered with the lines alone had nothing to read a Suggestion from.
 */
export const JSON_INSTRUCTIONS = `Answer with a JSON object alone, with nothing before or after it, that this JSON Schema allows: ${JSON.stringify(SUGGESTION_SCHEMA)}`;

/** What every Model Provider is told to do with a {@link SuggestionRequest}. */
export const SUGGESTION_INSTRUCTIONS = [
  "You resolve one Git merge conflict hunk.",
  "You are given the hunk's base, ours and theirs versions, the lines round it, the file's path and the subjects of the commits on each side.",
  "Answer with the lines that should replace the whole hunk, as the file should read, without any conflict markers, keeping what each side meant to change.",
  "Give a short, plain-English explanation of your reasoning, and a confidence: high, medium or low.",
  "Say low when you are unsure, or when the sides' intents can't both be kept.",
  JSON_INSTRUCTIONS,
].join(" ");

function block(name: string, lines: readonly string[] | null): string {
  if (lines === null) return `<${name} missing="true" />`;
  return `<${name}>\n${lines.join("\n")}\n</${name}>`;
}

/** The message a {@link SuggestionRequest} is sent as: exactly what the first-use disclosure names. */
export function suggestionPrompt(request: SuggestionRequest): string {
  return [
    `<path>${request.path}</path>`,
    `<ours-commit>${request.oursSubject ?? ""}</ours-commit>`,
    `<theirs-commit>${request.theirsSubject ?? ""}</theirs-commit>`,
    block("before", request.before),
    block("base", request.base),
    block("ours", request.ours),
    block("theirs", request.theirs),
    block("after", request.after),
  ].join("\n");
}

const CONFIDENCES: readonly Confidence[] = ["high", "medium", "low"];

/**
 * The Suggestion in a Model Provider's structured output, as parsed JSON.
 * Anything else is an unexpected response. Its Confidence is the model's
 * own report, which `checkSuggestion` (`confidence.ts`) checks.
 */
export function readSuggestion(output: unknown): Suggestion {
  if (typeof output === "object" && output !== null) {
    const { explanation, resolution, confidence } = output as Record<string, unknown>;
    if (
      typeof explanation === "string" &&
      typeof resolution === "string" &&
      CONFIDENCES.includes(confidence as Confidence)
    ) {
      return { explanation, resolution, confidence: confidence as Confidence };
    }
  }
  throw new ModelProviderError({
    kind: "unexpectedResponse",
    message: "The Model Provider's answer wasn't a Suggestion.",
  });
}

/**
 * Each `{…}` in `text` whose braces balance, outside strings, from where it
 * starts: the objects a model may have written among other words, braces and
 * all.
 */
function objectsIn(text: string): string[] {
  const found: string[] = [];
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    for (let at = start; at < text.length; at++) {
      const char = text[at];
      if (inString) {
        if (char === "\\") at++;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        found.push(text.slice(start, at + 1));
        break;
      }
    }
  }
  return found;
}

/** `json` with the line breaks and tabs a model left raw inside its strings escaped, as JSON.parse needs them. */
function escapedControls(json: string): string {
  let inString = false;
  let out = "";
  for (let at = 0; at < json.length; at++) {
    const char = json[at]!;
    if (inString && char === "\\") {
      out += char + (json[++at] ?? "");
      continue;
    }
    if (char === '"') inString = !inString;
    if (inString && char < " ") out += `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
    else out += char;
  }
  return out;
}

/**
 * The JSON in `text`, or `undefined` if there's none: all of it, without the
 * thinking a model may show first or a Markdown code block round it.
 * Where `lenient`, as for a model held to nothing but instructions, it's the
 * first object the model wrote, whatever else it wrote round it, even with
 * line breaks left raw in its strings.
 */
export function jsonIn(text: string, lenient: boolean): unknown {
  const answer = text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim()
    .replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1");
  const candidates = lenient ? [answer, ...objectsIn(answer).flatMap((object) => [object, escapedControls(object)])] : [answer];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Not this: try the next object in it, if that's allowed.
    }
  }
  return undefined;
}
