import type { Cursor, Page } from "../commands/api";
import { describeFailure } from "./problems";

/** What reading one page gave: the page, or what to tell the user instead. */
export type PageRead<T> =
  | { ok: true; page: Page<T>; fromStart: boolean }
  | { ok: false; problem: string };

type PageOutcome<T, E> = { ok: true; value: Page<T> } | { ok: false; error: E };

/**
 * Reads the page at `cursor` with `request`, or says why it couldn't, with
 * `describe` for the command's own errors. A cursor the command no longer
 * reads (one from before the core restarted, say, or whose item has gone)
 * starts again from the first page, and the read says so with `fromStart`.
 */
export async function readPage<T, E extends { kind: string }>(
  request: (cursor: Cursor | null) => Promise<PageOutcome<T, E>>,
  cursor: Cursor | null,
  describe: (error: Exclude<E, { kind: "invalidCursor" }>) => string,
): Promise<PageRead<T>> {
  try {
    let outcome = await request(cursor);
    if (!outcome.ok && outcome.error.kind === "invalidCursor" && cursor !== null) {
      cursor = null;
      outcome = await request(null);
    }
    if (outcome.ok) return { ok: true, page: outcome.value, fromStart: cursor === null };
    if (outcome.error.kind === "invalidCursor") {
      return { ok: false, problem: describeFailure("The core refused the first page.") };
    }
    return { ok: false, problem: describe(outcome.error as Exclude<E, { kind: "invalidCursor" }>) };
  } catch (failure) {
    return { ok: false, problem: describeFailure(failure) };
  }
}
