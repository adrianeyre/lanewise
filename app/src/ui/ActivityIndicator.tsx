import { LoaderCircle } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { type Activity, useActivities } from "./activity";

/** Whole seconds from `started` to `now`, as the indicator counts them. */
function seconds(started: number, now: number): number {
  return Math.max(0, Math.floor((now - started) / 1000));
}

/**
 * The Activity indicator: whatever Lanewise is doing that takes time, in its
 * fixed place at the bottom of the window, above the footer. It shows the
 * newest Activity running, with a spinner, what it's doing now, in words
 * that change as it moves on, and a bar of how far it has got: filled to
 * its percentage where that's known, and moving where it isn't, with how
 * long it has been running, so nobody takes it for stuck. Only an Activity
 * that has run a moment shows, so one quickly done doesn't flash. A screen
 * reader hears each change of words; the percentage is the bar's value.
 * The spinner and the moving bar keep still where reduced motion is asked
 * for.
 */
export function ActivityIndicator() {
  const all = useActivities();
  const [now, setNow] = useState(() => Date.now());
  const labelId = useId();
  const running = all.length > 0;
  // Ticks while anything runs, for the seconds, and for an Activity to show once it's run a moment.
  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, [running]);
  const shown = all.filter((activity) => activity.shownFrom <= now);
  const newest: Activity | undefined = shown.at(-1);
  const others = shown.length - 1;

  return (
    <div className="activity-layer">
      {/* Always there, so a screen reader hears what it says as it changes. */}
      <p aria-live="polite" className="visually-hidden">
        {newest?.words ?? ""}
      </p>
      {newest !== undefined && (
        <div className="activity" data-testid="activity">
          <LoaderCircle aria-hidden="true" className="activity-spinner" />
          <div className="activity-body">
            <p id={labelId} className="activity-words">
              {newest.words}
            </p>
            <div className="activity-meta">
              {newest.step !== null && (
                <span>
                  Step {newest.step.at} of {newest.step.of}
                </span>
              )}
              {newest.percent !== null && <span className="activity-percent">{newest.percent}%</span>}
              <span className="activity-seconds">{seconds(newest.started, now)}s</span>
              {others > 0 && <span>{others === 1 ? "and 1 more" : `and ${others} more`}</span>}
            </div>
            <div
              role="progressbar"
              className="activity-bar"
              aria-labelledby={labelId}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={newest.percent ?? undefined}
              data-indeterminate={newest.percent === null || undefined}
            >
              <div
                className="activity-bar-done"
                style={newest.percent === null ? undefined : { inlineSize: `${newest.percent}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
