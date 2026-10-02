import { useSyncExternalStore } from "react";

/**
 * Something Lanewise is doing that takes time, such as a Suggestion asked
 * for, repositories listed on a Host or a checkout, as the Activity
 * indicator shows it: what it's doing now, in words that change as it moves
 * on, how far it has got, and when it started, so nobody takes it for stuck.
 */
export interface Activity {
  id: number;
  /** What it's doing now, such as “Asking Anthropic for a Suggestion…”. */
  words: string;
  /** How far it has got, 0 to 100, or `null` if that isn't known. */
  percent: number | null;
  /** Which of its steps it's on, if it has steps, counted from 1. */
  step: { at: number; of: number } | null;
  /** When it started, in milliseconds since 1970. */
  started: number;
  /** When it's shown: a moment after it starts, so one quickly done never shows. */
  shownFrom: number;
}

/** Lets what's running say how it's going, and that it's done. */
export interface ActivityHandle {
  /** What it's doing now, and how far it has got, if that's known. */
  update(words: string, percent?: number | null): void;
  /** Moves on to step `at` of the steps it was started with, as `words` says. */
  step(at: number, words: string): void;
  /** It's done, or has failed: it goes. Calling it again does nothing. */
  end(): void;
}

/** How long something runs before the Activity indicator shows it. */
export const SHOW_AFTER_MS = 400;

let nextId = 1;
let activities: readonly Activity[] = [];
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function publish(next: readonly Activity[]) {
  activities = next;
  for (const listener of listeners) listener();
}

function change(id: number, changed: (activity: Activity) => Activity) {
  if (!activities.some((each) => each.id === id)) return;
  publish(activities.map((each) => (each.id === id ? changed(each) : each)));
}

/** The percentage done at the start of step `at` of `of`. */
function stepPercent(at: number, of: number): number {
  return Math.round(((Math.max(1, Math.min(at, of)) - 1) / of) * 100);
}

/**
 * Starts an Activity, saying `words`, split into `steps` if it has them.
 * Whatever starts one ends it, in a `finally`, however it finishes.
 */
export function startActivity(words: string, { steps }: { steps?: number } = {}): ActivityHandle {
  const id = nextId++;
  const now = Date.now();
  const step = steps === undefined || steps < 1 ? null : { at: 1, of: steps };
  publish([
    ...activities,
    { id, words, percent: step === null ? null : 0, step, started: now, shownFrom: now + SHOW_AFTER_MS },
  ]);
  // Drawn again once it's been running long enough to show.
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      change(id, (activity) => ({ ...activity }));
    }, SHOW_AFTER_MS),
  );
  return {
    update: (next, percent = null) => change(id, (activity) => ({ ...activity, words: next, percent })),
    step: (at, next) =>
      change(id, (activity) =>
        activity.step === null
          ? { ...activity, words: next }
          : {
              ...activity,
              words: next,
              step: { at, of: activity.step.of },
              percent: stepPercent(at, activity.step.of),
            },
      ),
    end: () => {
      clearTimeout(timers.get(id));
      timers.delete(id);
      if (activities.some((each) => each.id === id)) publish(activities.filter((each) => each.id !== id));
    },
  };
}

/** Runs `work` as an Activity saying `words`, ending it however `work` finishes. */
export async function withActivity<T>(words: string, work: (activity: ActivityHandle) => Promise<T>, steps?: number) {
  const activity = startActivity(words, { steps });
  try {
    return await work(activity);
  } finally {
    activity.end();
  }
}

/** Every Activity running now, oldest first, as {@link useActivities} gives them, outside React. */
export function currentActivities(): readonly Activity[] {
  return activities;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Every Activity running, oldest first, drawn again as each starts, moves on and ends. */
export function useActivities(): readonly Activity[] {
  return useSyncExternalStore(subscribe, currentActivities, currentActivities);
}
