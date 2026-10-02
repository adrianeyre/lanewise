import { describe, expect, it } from "vitest";

import { absoluteTime, machineTime, relativeTime } from "./time";

const now = Date.UTC(2026, 8, 28, 12, 0, 0);
const ago = (seconds: number) => now / 1000 - seconds;

describe("relativeTime", () => {
  it("says how long ago in the largest whole unit", () => {
    expect(relativeTime(ago(30), now)).toBe("30 seconds ago");
    expect(relativeTime(ago(5 * 60), now)).toBe("5 minutes ago");
    expect(relativeTime(ago(3 * 60 * 60), now)).toBe("3 hours ago");
    expect(relativeTime(ago(3 * 24 * 60 * 60), now)).toBe("3 days ago");
    expect(relativeTime(ago(2 * 7 * 24 * 60 * 60), now)).toBe("2 weeks ago");
    expect(relativeTime(ago(4 * 30 * 24 * 60 * 60), now)).toBe("4 months ago");
    expect(relativeTime(ago(3 * 365 * 24 * 60 * 60), now)).toBe("3 years ago");
  });

  it("says yesterday and now in words", () => {
    expect(relativeTime(ago(24 * 60 * 60), now)).toBe("yesterday");
    expect(relativeTime(ago(0), now)).toBe("now");
  });

  it("says a time ahead of the clock is ahead", () => {
    expect(relativeTime(ago(-2 * 60 * 60), now)).toBe("in 2 hours");
  });
});

describe("absoluteTime and machineTime", () => {
  it("give the date and time, for people and for machines", () => {
    const seconds = now / 1000;

    expect(absoluteTime(seconds)).toContain("2026");
    expect(machineTime(seconds)).toBe("2026-09-28T12:00:00.000Z");
  });
});
