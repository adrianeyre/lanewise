import type { GitProgress } from "../commands/api";
import { describeProgress, percentOf } from "./gitProgressWords";

/**
 * How far the phase Git is in has got, filled in, still: nothing moves while
 * Git doesn't know. Its text alternative is the progress in words.
 */
export function GitProgressBar({ progress, labelledBy }: { progress: GitProgress | null; labelledBy: string }) {
  const percent = progress === null ? null : percentOf(progress);
  return (
    <div
      role="progressbar"
      className="git-progress-bar"
      aria-labelledby={labelledBy}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      aria-valuetext={percent === null ? undefined : describeProgress(progress, "")}
    >
      <div className="git-progress-bar-done" style={{ inlineSize: `${percent ?? 0}%` }} />
    </div>
  );
}
