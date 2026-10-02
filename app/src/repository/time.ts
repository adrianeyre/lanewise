import { useEffect, useState } from "react";

/** Units a relative time is given in, largest first, with their length in seconds. */
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const absolute = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * How long ago `seconds` since the epoch was, in the largest unit it's at
 * least one of, in the user's language: "3 days ago", "yesterday", "now".
 */
export function relativeTime(seconds: number, now = Date.now()): string {
  const difference = seconds - now / 1000;
  for (const [unit, length] of UNITS) {
    if (Math.abs(difference) >= length) {
      return relative.format(Math.round(difference / length), unit);
    }
  }
  return relative.format(Math.round(difference), "second");
}

/** When `seconds` since the epoch was, as a date and time in the user's language and time zone. */
export function absoluteTime(seconds: number): string {
  return absolute.format(new Date(seconds * 1000));
}

/** `seconds` since the epoch as a `<time>` element's `dateTime`. */
export function machineTime(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/** The time now, in milliseconds, kept to within a minute, for relative times to stay true. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
