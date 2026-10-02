import { expect, test } from "vitest";

import { assess, formatReport, type Open, type Results, type Scroll } from "./report.ts";
import { summariseFrames } from "./stats.ts";

const steady = (count: number, longest = 16.7) => [...Array.from({ length: count - 1 }, () => 16.7), longest];

function open(firstScreen: number, longestWhileLayingOut = 17): Open {
  return {
    laidOut: firstScreen - 30,
    firstScreen,
    firstWindow: firstScreen - 40,
    // Opening the Tab may hold a frame; only the frames while the history is read and laid out count.
    openingFrames: summariseFrames([20, 71]),
    layingOutFrames: summariseFrames(steady(60, longestWhileLayingOut)),
    drawingFrames: summariseFrames([17, 17]),
    intervals: [],
    commands: {},
  };
}

function scrolled(name: string, intervals: number[]): Scroll {
  return {
    name,
    description: name,
    frames: summariseFrames(intervals),
    intervals,
    droppedAsWindowsCame: 0,
    blankFrames: 0,
    readingFrames: 0,
    mostRowsInDom: 23,
    rows: 1800,
    graphWindow: [30, 34],
  };
}

function results(overrides: Partial<Results> = {}): Results {
  return {
    system: {
      platform: "linux",
      arch: "x64",
      webview: "WebKitGTK 2.52.6",
      screen: "1280×800 at 1x",
      cpus: 4,
      date: "2026-09-29",
      warmUp: false,
    },
    repository: { root: "/work/git", rows: 85_838, commitGraph: false },
    opens: [open(1200), open(1150)],
    scrolls: [scrolled("wheel", steady(600))],
    memory: { atStart: 700 * 2 ** 20, firstPass: 800 * 2 ** 20, lastPass: 780 * 2 ** 20, peak: 800 * 2 ** 20 },
    ...overrides,
  };
}

const met = (outcome: Results) => Object.fromEntries(assess(outcome).map((target) => [target.name, target.met]));

test("a run inside every target meets them all", () => {
  expect(met(results())).toEqual({
    "First screen in under 2 s": true,
    "Layout never blocks the UI thread": true,
    "Scrolling holds 60 fps: wheel": true,
    "Memory stays bounded": true,
  });
});

test("the slowest launch is the one held to the first screen's 2 s", () => {
  expect(met(results({ opens: [open(1200), open(2000)] }))["First screen in under 2 s"]).toBe(false);
});

test("a long task while the history is read and laid out blocks the UI thread", () => {
  expect(met(results({ opens: [open(1200, 51)] }))["Layout never blocks the UI thread"]).toBe(false);
  expect(met(results({ opens: [open(1200, 50)] }))["Layout never blocks the UI thread"]).toBe(true);
});

test("a scroll that drops more than 1% of its frames doesn't hold 60 fps", () => {
  const dropping = [...steady(590), ...Array.from({ length: 10 }, () => 34)];
  const holding = [...steady(594), ...Array.from({ length: 6 }, () => 34)];
  const outcome = met(results({ scrolls: [scrolled("fling", dropping), scrolled("wheel", holding)] }));

  expect(outcome["Scrolling holds 60 fps: fling"]).toBe(false);
  expect(outcome["Scrolling holds 60 fps: wheel"]).toBe(true);
});

test("memory that grows more than 10% scrolling the whole history again isn't bounded", () => {
  const growing = { atStart: 700 * 2 ** 20, firstPass: 800 * 2 ** 20, lastPass: 881 * 2 ** 20, peak: 881 * 2 ** 20 };
  expect(met(results({ memory: growing }))["Memory stays bounded"]).toBe(false);
});

test("memory a platform can't measure is reported, not failed", () => {
  const target = assess(results({ memory: null })).find((each) => each.name === "Memory stays bounded");
  expect(target).toEqual({ name: "Memory stays bounded", met: null, measured: expect.stringContaining("hand checks") });
});

test("the report says where it ran, each target, and each launch and scroll", () => {
  const outcome = results();
  const report = formatReport(outcome, assess(outcome));

  expect(report).toContain("/work/git, 85,838 rows, without a commit-graph file, in WebKitGTK 2.52.6 on linux x64, 4 CPUs, 1280×800 at 1x, 2026-09-29.");
  const warm = results();
  warm.system.warmUp = true;
  expect(formatReport(warm, assess(warm))).toContain("2026-09-29, after a warm-up launch that isn't measured.");
  expect(report).toContain("| First screen in under 2 s | yes | slowest of 2: 1200 ms |");
  expect(report).toContain("| 2 | 1120 (`graphWindow` 1110) | 1150 | 71 | 17 of 60 frames | 17 |");
  expect(report).toContain("| wheel | 1,800 | 59.9 |");
  expect(report).toContain("| 700 MiB | 800 MiB | 780 MiB | 800 MiB |");
});
