import type { GitProgress } from "../commands/api";

/** Git's `percent`, or one worked out from what's done, if Git knows the total. */
export function percentOf({ percent, done, total }: GitProgress): number | null {
  if (percent !== null) return percent;
  return total === null || total === 0 ? null : Math.min(100, Math.floor((done / total) * 100));
}

/** What Git is doing, in its own words: `Receiving objects`, or `Counting objects on the Host`. */
function phaseOf({ phase, remote }: GitProgress): string {
  return remote ? `${phase} on the Host` : phase;
}

const count = new Intl.NumberFormat();

/**
 * A progress update, in words: `Receiving objects: 45% (450 of 1,000)`, or
 * `starting`, such as `Starting the clone…`, before Git has given one.
 */
export function describeProgress(progress: GitProgress | null, starting: string): string {
  if (progress === null) return starting;
  const percent = percentOf(progress);
  const done = count.format(progress.done);
  const counted = progress.total === null ? done : `${done} of ${count.format(progress.total)}`;
  return percent === null ? `${phaseOf(progress)}: ${counted}` : `${phaseOf(progress)}: ${percent}% (${counted})`;
}

/** What was last announced of a clone's, fetch's, pull's or push's progress. */
export interface Announced {
  phase: string;
  /** How many quarters of the phase were done: 0 to 4. */
  quarter: number;
}

/**
 * What to announce of `progress`, if anything, having last announced
 * `last`: each new phase, and each quarter of one, so a screen reader hears
 * how it's going without hearing every object. `Receiving objects: 50%`.
 */
export function announcementOf(
  progress: GitProgress | null,
  last: Announced | null,
): (Announced & { text: string }) | null {
  if (progress === null) return null;
  const phase = phaseOf(progress);
  const percent = percentOf(progress);
  const quarter = percent === null ? 0 : Math.floor(percent / 25);
  if (last !== null && last.phase === phase && last.quarter >= quarter) return null;
  const text = quarter === 0 ? `${phase}…` : `${phase}: ${quarter * 25}%`;
  return { phase, quarter, text };
}
