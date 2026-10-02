/**
 * How much of the Update has downloaded, drawn as Git's progress is. Its
 * text alternative is the share in words.
 */
export function UpdateProgress({ fraction, labelledBy }: { fraction: number; labelledBy: string }) {
  const percent = Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
  return (
    <div
      role="progressbar"
      className="git-progress-bar update-progress"
      aria-labelledby={labelledBy}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${percent}% downloaded`}
    >
      <div className="git-progress-bar-done" style={{ inlineSize: `${percent}%` }} />
    </div>
  );
}
