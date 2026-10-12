import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeHeapSnapshot } from "node:v8";

import { expect, test } from "vitest";

import { DEFAULT_AI_SETTINGS, type AiSettings } from "./aiSettings";
import { askJev } from "./jev";
import { BUNDLED_CATALOG } from "./modelCatalog";
import { MODEL_PROVIDERS } from "./modelProviders";
import type { SuggestionRequest } from "./modelProvider";
import { listModels, requestSuggestion } from "./requests";
import type { Platform } from "../platform/platform";

// ADR 0020: a Model Provider's key is read out of the credential store for
// one request and isn't kept in the UI afterwards. This file looks for it in
// the whole of the page's JavaScript heap once each request is answered.
// Every request is answered by a fake `fetch`: nothing reaches a Model
// Provider.

// The key is made afresh from these each time it's read, so no text in this
// file, or in the store standing in for the credential store, holds it.
const KEY_CODES = [115, 107, 45, 108, 105, 102, 101, 116, 105, 109, 101, 81, 90, 88, 55, 52, 57, 50, 87];

function readKey(): string {
  return String.fromCharCode(...KEY_CODES);
}

/** How many strings on the heap hold the key, looked for by its two halves so the search itself makes no copy. */
function keysOnTheHeap(): number {
  const file = writeHeapSnapshot(join(tmpdir(), `lanewise-key-lifetime-${process.pid}.heapsnapshot`));
  const { strings } = JSON.parse(readFileSync(file, "utf8")) as { strings: string[] };
  rmSync(file);
  const start = String.fromCharCode(...KEY_CODES.slice(0, 9));
  const end = String.fromCharCode(...KEY_CODES.slice(9));
  return strings.filter((text) => {
    const at = text.indexOf(start);
    return at !== -1 && text.startsWith(end, at + start.length);
  }).length;
}

const SUGGESTED = JSON.stringify({ explanation: "Keep both.", resolution: "let b = 2;", confidence: "high" });

/** What each API answers, as briefly as its SDK takes it. */
function answer(url: string): Response {
  if (url.startsWith("https://api.anthropic.com/v1/models")) {
    return Response.json({
      data: [{ type: "model", id: "claude-opus-5-5", display_name: "Claude Opus 5.5", created_at: "2026-08-12T00:00:00Z" }],
      has_more: false,
      first_id: "claude-opus-5-5",
      last_id: "claude-opus-5-5",
    });
  }
  if (url.startsWith("https://api.anthropic.com/v1/messages")) {
    return Response.json({
      id: "msg_01",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: [{ type: "text", text: SUGGESTED }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  }
  if (url.includes(":generateContent")) {
    return Response.json({ candidates: [{ content: { parts: [{ text: SUGGESTED }] }, finishReason: "STOP" }] });
  }
  if (url.startsWith("https://generativelanguage.googleapis.com/")) {
    return Response.json({
      models: [{ name: "models/gemini-3.5-pro", displayName: "Gemini 3.5 Pro", version: "3.5", supportedGenerationMethods: ["generateContent"] }],
    });
  }
  if (url.endsWith("/chat/completions")) {
    return Response.json({
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 1,
      model: "gpt-5.5",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: SUGGESTED } }],
    });
  }
  if (url.endsWith("/models")) return Response.json({ object: "list", data: [{ id: "gpt-5.5", object: "model", created: 1, owned_by: "openai" }] });
  if (url.startsWith("https://api.typesafe.ai/")) return Response.json({ model: "jev-latest", answers: { fit: { probability: 0.9 } } });
  return new Response(null, { status: 404 });
}

/** A platform whose credential store hands out the key, and whose `fetch` answers without keeping the request. */
const platform = {
  commands: {
    call: async (name: string) => (name === "modelProviderKey" ? { ok: true, value: { key: readKey() } } : { ok: true, value: null }),
  },
  fetch: async (url: string) => answer(url),
} as unknown as Pick<Platform, "commands" | "fetch">;

const request: SuggestionRequest = {
  path: "src/lanes.rs",
  base: ["let a = 1;"],
  ours: ["let a = 2;"],
  theirs: ["let b = 1;"],
  before: [],
  after: [],
  oursSubject: "Change a",
  theirsSubject: "Rename a",
};

test("no Model Provider's key, or Jev's, is left in the page's memory once its request is answered", async () => {
  // Kept for the whole run, as the AI Suggestion Widget keeps its request's.
  const run = new AbortController();
  for (const id of ["anthropic", "gemini", "openai"]) {
    const provider = MODEL_PROVIDERS.find((each) => each.id === id)!;
    const disclosed: AiSettings = { ...DEFAULT_AI_SETTINGS, enabled: true, disclosed: [id] };
    const [model] = await listModels(platform, provider, disclosed, BUNDLED_CATALOG, run.signal);
    const settings: AiSettings = { ...disclosed, global: { provider: id, model: model!.id, version: null, effort: null } };

    await expect(
      requestSuggestion({ platform, providers: MODEL_PROVIDERS, settings, catalog: BUNDLED_CATALOG, repository: null, request, signal: run.signal }),
    ).resolves.toMatchObject({ resolution: "let b = 2;" });
  }
  await expect(askJev(platform, "state", {}, run.signal)).resolves.toMatchObject({ model: "jev-latest" });

  expect(keysOnTheHeap()).toBe(0);

  // And the search finds one that is kept.
  const kept = { key: readKey() };
  expect(keysOnTheHeap()).toBe(1);
  expect(kept.key).toHaveLength(KEY_CODES.length);
}, 60_000);
