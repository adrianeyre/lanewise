/** What a run of the graph benchmark found, how it measures up to PRD §11, and how to say so. */

import { type Frames, LONG_TASK } from "./stats.ts";

export interface Results {
  /** Where it ran: the platform, and what it ran. */
  system: {
    platform: string;
    arch: string;
    webview: string;
    screen: string;
    cpus: number;
    date: string;
    /** Whether an unmeasured launch opened the repository first, to fill a fresh machine's caches (`--warm-up`). */
    warmUp: boolean;
  };
  /** The repository it opened, how many rows its history has, and whether it has a commit-graph file. */
  repository: { root: string; rows: number; commitGraph: boolean };
  /** Each launch of the app, opening the repository from the Welcome screen. */
  opens: Open[];
  scrolls: Scroll[];
  /** The app's memory while scrolling, or `null` where the benchmark can't measure it. */
  memory: Memory | null;
}

export interface Open {
  /** Milliseconds from the click until the first window came, read and laid out. */
  laidOut: number;
  /** Milliseconds from the click until the first screen of the Commit graph was painted. */
  firstScreen: number;
  /** How long the first `graphWindow`, which reads and lays out the history, took to answer. */
  firstWindow: number;
  /** The frames opening the Tab, until the repository's page, with its Commit graph, was first painted. */
  openingFrames: Frames;
  /** The frames after that while the history was read and laid out, off the UI thread, when only the UI thread's own work could hold one up. */
  layingOutFrames: Frames;
  /** The frames after the first window came, until the first screen. */
  drawingFrames: Frames;
  /** Every frame's interval from the click to the first screen, in milliseconds. */
  intervals: number[];
  /** How long each command took to answer, by name, in milliseconds. */
  commands: Record<string, number[]>;
}

export interface Scroll {
  name: string;
  description: string;
  frames: Frames;
  /** Every frame's interval, in milliseconds. */
  intervals: number[];
  /** How many of the dropped frames had a window come while they were drawn. */
  droppedAsWindowsCame: number;
  /** How many frames showed a place in view with no row drawn at all. */
  blankFrames: number;
  /** How many frames showed a row still "Reading…", its window not read yet. */
  readingFrames: number;
  /** The most rows the history had in the DOM at once. */
  mostRowsInDom: number;
  rows: number;
  /** How long each `graphWindow` took to answer while it scrolled, in milliseconds. */
  graphWindow: number[];
}

export interface Memory {
  /** Before scrolling the whole history, in bytes. */
  atStart: number;
  /** The most while scrolling it the first time, and the last. */
  firstPass: number;
  lastPass: number;
  /** The most at any sample. */
  peak: number;
}

export interface Target {
  name: string;
  /** Whether the run met it, or `null` if the target is only reported. */
  met: boolean | null;
  measured: string;
}

/** The first screen is under this in every launch (PRD §11). */
export const FIRST_SCREEN = 2000;

/** Scrolling holds 60 fps: at least this many frames a second in every scroll... */
export const SCROLL_FPS = 58;

/** ...and no more than this share of its frames dropped. */
export const DROPPED_SHARE = 0.01;

/**
 * Memory is bounded when scrolling the whole history again takes it no more
 * than this share above the first time: a leak grows with every row it
 * passes, where memory that's given back comes down again.
 */
export const MEMORY_GROWTH = 0.1;

/** How the run measures up to each of PRD §11's targets for the Commit graph. */
export function assess(results: Results): Target[] {
  const slowest = Math.max(...results.opens.map((open) => open.firstScreen));
  const longest = Math.max(...results.opens.map((open) => open.layingOutFrames.longest));
  const blocked = results.opens.reduce((sum, open) => sum + open.layingOutFrames.long, 0);
  const targets: Target[] = [
    {
      name: `First screen in under ${FIRST_SCREEN / 1000} s`,
      met: slowest < FIRST_SCREEN,
      measured: `slowest of ${results.opens.length}: ${Math.round(slowest)} ms`,
    },
    {
      name: "Layout never blocks the UI thread",
      met: blocked === 0,
      measured: `longest frame while the history was read and laid out: ${longest} ms; ${blocked} over ${LONG_TASK} ms`,
    },
  ];
  for (const scroll of results.scrolls) {
    const share = scroll.frames.count === 0 ? 1 : scroll.frames.dropped / scroll.frames.count;
    targets.push({
      name: `Scrolling holds 60 fps: ${scroll.name}`,
      met: scroll.frames.fps >= SCROLL_FPS && share <= DROPPED_SHARE,
      measured: `${scroll.frames.fps} fps, ${scroll.frames.dropped} of ${scroll.frames.count} frames dropped, longest ${scroll.frames.longest} ms`,
    });
  }
  const memory = results.memory;
  targets.push(
    memory === null
      ? { name: "Memory stays bounded", met: null, measured: "not measured on this platform; see the hand checks" }
      : {
          name: "Memory stays bounded",
          met: memory.lastPass <= memory.firstPass * (1 + MEMORY_GROWTH),
          measured: `peak ${mebibytes(memory.peak)}; ${mebibytes(memory.atStart)} before scrolling the whole history, at most ${mebibytes(memory.firstPass)} the first time and ${mebibytes(memory.lastPass)} the last`,
        },
  );
  return targets;
}

/** The run, and how it measures up, as Markdown. */
export function formatReport(results: Results, targets: readonly Target[]): string {
  const { system, repository } = results;
  const lines = [
    `# Commit graph benchmark`,
    "",
    `${repository.root}, ${repository.rows.toLocaleString("en")} rows, ${repository.commitGraph ? "with" : "without"} a commit-graph file, in ${system.webview} on ${system.platform} ${system.arch}, ${system.cpus} CPUs, ${system.screen}, ${system.date}${system.warmUp ? ", after a warm-up launch that isn't measured" : ""}.`,
    "",
    "| Target | Met | Measured |",
    "| --- | --- | --- |",
    ...targets.map((target) => `| ${target.name} | ${mark(target.met)} | ${target.measured} |`),
    "",
    "## Opening",
    "",
    "Milliseconds from the click on the Recent Repository. Opening the Tab is drawing the repository's page, up to its first paint; reading and laying out is the rest of the first `graphWindow`, which runs off the UI thread, and drawing is its window's rows and lanes.",
    "",
    "| Launch | First window | First screen | Longest frame opening the Tab | Longest frame reading and laying out | Longest frame drawing |",
    "| --- | --- | --- | --- | --- | --- |",
    ...results.opens.map(
      (open, index) =>
        `| ${index + 1} | ${Math.round(open.laidOut)} (\`graphWindow\` ${Math.round(open.firstWindow)}) | ${Math.round(open.firstScreen)} | ${open.openingFrames.longest} | ${open.layingOutFrames.longest} of ${open.layingOutFrames.count} frames | ${open.drawingFrames.longest} |`,
    ),
    "",
    "## Scrolling",
    "",
    "Frame times in milliseconds. A frame is dropped when it takes over 25 ms.",
    "",
    "| Scroll | Rows | fps | Median | p95 | p99 | Longest | Dropped | Dropped as a window came | Frames with a blank row | Frames with a row \"Reading…\" | Most rows in the DOM | Median `graphWindow` |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...results.scrolls.map(
      (scroll) =>
        `| ${scroll.description} | ${scroll.rows.toLocaleString("en")} | ${scroll.frames.fps} | ${scroll.frames.median} | ${scroll.frames.p95} | ${scroll.frames.p99} | ${scroll.frames.longest} | ${scroll.frames.dropped} of ${scroll.frames.count} | ${scroll.droppedAsWindowsCame} | ${scroll.blankFrames} | ${scroll.readingFrames} | ${scroll.mostRowsInDom} | ${scroll.graphWindow.length === 0 ? "none" : `${Math.round(middle(scroll.graphWindow))} ms of ${scroll.graphWindow.length}`} |`,
    ),
    "",
  ];
  if (results.memory !== null) {
    const { peak, atStart, firstPass, lastPass } = results.memory;
    lines.push(
      "## Memory",
      "",
      "The proportional set size of the app and every process under it, WebKit's among them, sampled every 100 ms while scrolling the whole history.",
      "",
      "| Before scrolling | Most the first time | Most the last time | Peak |",
      "| --- | --- | --- | --- |",
      `| ${mebibytes(atStart)} | ${mebibytes(firstPass)} | ${mebibytes(lastPass)} | ${mebibytes(peak)} |`,
      "",
    );
  }
  return lines.join("\n");
}

function mark(met: boolean | null): string {
  if (met === null) return "reported";
  return met ? "yes" : "**no**";
}

function mebibytes(bytes: number): string {
  return `${Math.round(bytes / 2 ** 20)} MiB`;
}

function middle(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}
