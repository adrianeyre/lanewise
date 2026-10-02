import { expect, test } from "vitest";

import { droppedWhileAnswered, intervalsOf, percentile, phasesOf, summariseFrames } from "./stats.ts";

test("frames at 60 fps, with one dropped and one held up by a long task, are summarised as such", () => {
  const intervals = [...Array.from({ length: 98 }, () => 16.7), 33.4, 60];
  const frames = summariseFrames(intervals);

  expect(frames.count).toBe(100);
  expect(frames.median).toBe(16.7);
  expect(frames.p99).toBe(33.4);
  expect(frames.longest).toBe(60);
  expect(frames.dropped).toBe(2);
  expect(frames.long).toBe(1);
  // 100 frames in 1730 ms.
  expect(frames.fps).toBe(57.8);
});

test("no frames summarise as none, not as a division by nothing", () => {
  expect(summariseFrames([])).toEqual({ count: 0, fps: 0, median: 0, p95: 0, p99: 0, longest: 0, dropped: 0, long: 0 });
});

test("a percentile is the value at its nearest rank", () => {
  expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3);
  expect(percentile([5, 1, 4, 2, 3], 95)).toBe(5);
  expect(percentile([7], 1)).toBe(7);
});

test("frames' intervals come from when each began", () => {
  expect(intervalsOf([100, 117, 150])).toEqual([17, 33]);
  expect(intervalsOf([100])).toEqual([]);
});

test("opening's frames are split by the page's first paint and the first window: opening the Tab, reading, and drawing", () => {
  // The Commit graph was first painted by the 71 ms frame, from 20, and its window answered during the frame from 250 to 267.
  const frames = [0, 20, 91, 108, 125, 250, 267, 284];
  const phases = phasesOf(frames, { shown: 20, answered: 255 });

  expect(phases.opening).toEqual([20, 71]);
  // The 125 ms frame began and ended while the window was read, so it's the one that held the UI thread.
  expect(phases.layingOut).toEqual([17, 17, 125]);
  expect(phases.drawing).toEqual([17, 17]);
});

test("a window that comes before the page is painted leaves no frames reading", () => {
  expect(phasesOf([0, 20, 40, 57], { shown: 20, answered: 30 }).layingOut).toEqual([]);
});

test("a dropped frame counts as dropped as a window came only if one was answered while it was drawn", () => {
  const frames = [0, 17, 50, 67, 100];
  expect(droppedWhileAnswered(frames, [30])).toBe(1);
  expect(droppedWhileAnswered(frames, [10, 60])).toBe(0);
  expect(droppedWhileAnswered(frames, [30, 70])).toBe(2);
});
