import type { Platform } from "../platform/platform";
import { type ActivityHandle, withActivity } from "../ui/activity";
import { gatewayFetch } from "./gateway";

/**
 * Jev, TypeSafe AI's decision model (ADR 0036, `docs/research/jev-ai.md`):
 * it answers typed questions about a block of state, a yes-or-no's
 * probability, a choice among options with its probabilities, or a score
 * on a scale, rather than writing text. Lanewise asks it three things, each
 * only while it's turned on in Settings, with the user's own TypeSafe key,
 * and never acts on an answer without the user: how far to trust a
 * Suggestion, which side a Conflict Hunk likely takes, and whether staged
 * changes hold a secret or a leftover, and what type of commit they are.
 */

/** Where Jev is asked: TypeSafe's own API, or a gateway kept for it (ADR 0035). */
export const JEV_API = "https://api.typesafe.ai";

/** Its ID, which its API key and any gateway are kept under, as a Model Provider's are. */
export const JEV_ID = "typesafe-jev";

/** The model asked: TypeSafe's alias for its latest Jev. */
export const JEV_MODEL = "jev-latest";

/** Where the user makes a TypeSafe API key. */
export const JEV_KEY_PAGE = "https://console.typesafe.ai/keys";

/** The most of a state sent, in characters: well inside Jev's 32k tokens for the state and its longest question. */
export const MAX_STATE = 60_000;

export type JevQuestion =
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; probabilities: Record<string, number>; confidence: number };

export interface JevAnswers {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number } | null;
}

/** Why Jev couldn't answer: said in words, never with the key or what was sent. */
export class JevError extends Error {
  constructor(
    readonly kind: "noKey" | "keyRefused" | "rateLimited" | "unavailable" | "rejected" | "unreachable" | "unexpected",
    message: string,
  ) {
    super(message);
    this.name = "JevError";
  }
}

const STATUS: Record<number, [JevError["kind"], string]> = {
  401: ["keyRefused", "TypeSafe refused your API key. Check it in Settings, under Jev."],
  403: ["keyRefused", "TypeSafe refused your API key. Check it in Settings, under Jev."],
  422: ["rejected", "TypeSafe couldn't read the question Lanewise asked."],
  429: ["rateLimited", "You've asked Jev too often for now. Try again in a moment."],
  529: ["unavailable", "TypeSafe is overloaded just now. Try again in a moment."],
};

/**
 * Asks Jev `questions` about `state`, through the platform's `fetch` to
 * TypeSafe, or the core to a gateway kept for it, with the user's key, read
 * from the OS credential store for this request alone.
 */
export async function askJev(
  platform: Pick<Platform, "commands" | "fetch">,
  state: string | Record<string, unknown>,
  questions: Record<string, JevQuestion>,
  signal?: AbortSignal,
): Promise<JevAnswers> {
  return withActivity("Reading your TypeSafe API key…", (activity) => ask(platform, state, questions, activity, signal), 2);
}

/** {@link askJev}, saying each step on `activity`. */
async function ask(
  platform: Pick<Platform, "commands" | "fetch">,
  state: string | Record<string, unknown>,
  questions: Record<string, JevQuestion>,
  activity: ActivityHandle,
  signal?: AbortSignal,
): Promise<JevAnswers> {
  const kept = await platform.commands.call("modelProviderKey", { provider: JEV_ID });
  if (!kept.ok || kept.value === null) throw new JevError("noKey", "There's no TypeSafe API key kept for Jev. Add one in Settings.");
  let gateway = null;
  try {
    const found = await platform.commands.call("gatewayOf", { provider: JEV_ID });
    gateway = found.ok ? found.value : null;
  } catch {
    gateway = null;
  }
  const fetch =
    gateway === null
      ? (url: string, init?: RequestInit) => platform.fetch(url, init)
      : gatewayFetch(platform.commands, { id: JEV_ID, host: new URL(JEV_API).host });
  activity.step(2, "Asking Jev…");
  let response: Response;
  try {
    response = await fetch(`${JEV_API}/v1/systemone`, {
      method: "POST",
      headers: { authorization: `Bearer ${kept.value.key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
      signal,
    });
  } catch (failure) {
    if (failure instanceof DOMException && failure.name === "AbortError") throw failure;
    throw new JevError("unreachable", "Lanewise couldn't reach TypeSafe.");
  }
  if (!response.ok) {
    const [kind, message] = STATUS[response.status] ?? ["unexpected", `TypeSafe answered ${response.status}.`];
    throw new JevError(kind, message);
  }
  const answered = (await response.json().catch(() => null)) as Partial<JevAnswers> | null;
  if (answered === null || typeof answered.answers !== "object" || answered.answers === null) {
    throw new JevError("unexpected", "Jev's answer wasn't one Lanewise could read.");
  }
  return { model: String(answered.model ?? JEV_MODEL), answers: answered.answers, usage: answered.usage ?? null };
}

/** `text`, cut to what Jev takes, saying so where it was cut. */
export function fitState(text: string): string {
  return text.length <= MAX_STATE ? text : `${text.slice(0, MAX_STATE)}\n[… cut: the rest wasn't sent]`;
}
