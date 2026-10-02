/** Summaries of frame intervals and timings. */

/**
 * A frame at 60 fps takes 16.7 ms. WebKitGTK rounds `performance.now()` to
 * the millisecond, so an on-time frame reads anywhere up to 17 or 18 ms; one
 * that misses its vsync reads 33 or more. Halfway between is where a frame
 * counts as dropped.
 */
export const DROPPED_FRAME = 25;

/** A frame this long held the UI thread for a long task, as the browser counts one. */
export const LONG_TASK = 50;

export interface Frames {
  count: number;
  /** Frames per second over the whole run: how many frames it drew, over how long it took. */
  fps: number;
  median: number;
  p95: number;
  p99: number;
  longest: number;
  /** How many frames took longer than `DROPPED_FRAME`. */
  dropped: number;
  /** How many frames took longer than `LONG_TASK`. */
  long: number;
}

/** Summarises frame intervals, in milliseconds. */
export function summariseFrames(intervals: readonly number[]): Frames {
  const total = intervals.reduce((sum, interval) => sum + interval, 0);
  return {
    count: intervals.length,
    fps: total === 0 ? 0 : round((intervals.length * 1000) / total),
    median: percentile(intervals, 50),
    p95: percentile(intervals, 95),
    p99: percentile(intervals, 99),
    longest: intervals.length === 0 ? 0 : round(Math.max(...intervals)),
    dropped: intervals.filter((interval) => interval > DROPPED_FRAME).length,
    long: intervals.filter((interval) => interval > LONG_TASK).length,
  };
}

/** The `p`th percentile of `values` by nearest rank, or 0 if there are none. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return round(sorted[rank - 1]!);
}

/** The median of `values`, or 0 if there are none. */
export function median(values: readonly number[]): number {
  return percentile(values, 50);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The interval each frame took, from when each began: one fewer than there are frames. */
export function intervalsOf(frames: readonly number[]): number[] {
  return frames.slice(1).map((began, n) => began - frames[n]!);
}

/** The frames of opening a repository, by what the app was doing in each. */
export interface Phases {
  /** Opening the Tab: drawing the repository's page, up to and including the frame that first painted the Commit graph. */
  opening: number[];
  /** Reading and laying out the history after that, until the first window came: only frames that ended before it did. */
  layingOut: number[];
  /** Drawing the first window, until the first screen. */
  drawing: number[];
}

/**
 * Splits the intervals of `frames`, when each began, by `shown`, when the
 * frame that first painted the Commit graph began, and `answered`, when its
 * first window came. The page's first paint is opening the Tab, however long
 * the history takes to read; a frame still going when the window came is
 * drawing it.
 */
export function phasesOf(frames: readonly number[], { shown, answered }: { shown: number; answered: number }): Phases {
  const phases: Phases = { opening: [], layingOut: [], drawing: [] };
  for (let n = 1; n < frames.length; n++) {
    const began = frames[n - 1]!;
    const ended = frames[n]!;
    const phase = began <= shown ? phases.opening : ended <= answered ? phases.layingOut : phases.drawing;
    phase.push(ended - began);
  }
  return phases;
}

/** How many of the dropped frames of `frames` had an answer come in `answers` while they were drawn. */
export function droppedWhileAnswered(frames: readonly number[], answers: readonly number[]): number {
  let count = 0;
  for (let n = 1; n < frames.length; n++) {
    const began = frames[n - 1]!;
    const ended = frames[n]!;
    if (ended - began > DROPPED_FRAME && answers.some((at) => at >= began && at < ended)) count++;
  }
  return count;
}
