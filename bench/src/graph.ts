/**
 * The Commit graph benchmark (PRD §11): launches the built Desktop App
 * through `tauri-driver`, opens a repository from the Welcome screen as a user
 * does, and times the first screen of its Commit graph and every frame while
 * it scrolls. See `bench/README.md` for how to run it.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { canMeasureMemory, memoryOf, startSampling } from "./memory.ts";
import {
  continueSetup,
  describePage,
  listOnlyRecent,
  nextFrame,
  openRecent,
  recordCommands,
  rowsInView,
  type Scenario,
  scroll,
  type Sent,
  takeCommands,
  waitForScreen,
} from "./page.ts";
import { assess, formatReport, type Memory, type Open, type Results, type Scroll } from "./report.ts";
import { droppedWhileAnswered, intervalsOf, phasesOf, summariseFrames } from "./stats.ts";
import { type Session, startSession, waitForDriver } from "./webdriver.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const { values: options } = parseArgs({
  options: {
    repository: { type: "string" },
    application: {
      type: "string",
      default: join(repositoryRoot, "target/release", process.platform === "win32" ? "lanewise-desktop.exe" : "lanewise-desktop"),
    },
    "tauri-driver": { type: "string", default: "tauri-driver" },
    "native-driver": { type: "string" },
    port: { type: "string", default: "4444" },
    launches: { type: "string", default: "3" },
    scrolls: { type: "string" },
    out: { type: "string", default: join(repositoryRoot, "bench/results") },
    check: { type: "boolean", default: false },
    "warm-up": { type: "boolean", default: false },
  },
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
});

if (options.repository === undefined) {
  console.error("Say which repository to open: --repository <a clone of git/git>. bench/README.md says how.");
  process.exit(2);
}

/**
 * The ways the benchmark scrolls, each from a drawn screen. The whole history
 * comes last, twice, since it measures memory: a leak grows from one time to
 * the next.
 */
const SCENARIOS: (Scenario & { description: string })[] = [
  { name: "wheel", description: "3 rows a frame for 10 s, as a mouse wheel", rowsPerFrame: 3, frames: 600, jumpEvery: null, start: 0 },
  { name: "fling", description: "40 rows a frame for 10 s, as a fast fling", rowsPerFrame: 40, frames: 600, jumpEvery: null, start: 0 },
  {
    name: "scrollbar",
    description: "10 rows a frame, jumping to a random row every half second, as dragging the scrollbar",
    rowsPerFrame: 10,
    frames: 600,
    jumpEvery: 30,
    start: 0,
  },
  { name: "whole", description: "the whole history, 60 rows a frame", rowsPerFrame: 60, frames: null, jumpEvery: null, start: 0 },
  {
    name: "whole again",
    description: "the whole history again, for memory that isn't given back",
    rowsPerFrame: 60,
    frames: null,
    jumpEvery: null,
    start: 0,
  },
];

/**
 * How long one script in the page may take. Scrolling the whole of git/git
 * is 1,431 frames: 24 s at 60 fps, but minutes on a CI runner drawing in
 * software under Xvfb, where it has run at 9 fps. The job's own limit still
 * stops a hang.
 */
const SCRIPT_TIMEOUT = 600_000;

const scenarios =
  options.scrolls === undefined
    ? SCENARIOS
    : options.scrolls.split(",").map((name) => {
        const scenario = SCENARIOS.find((each) => each.name === name);
        if (!scenario) throw new Error(`No scroll called ${name}: there's ${SCENARIOS.map((each) => each.name).join(", ")}`);
        return scenario;
      });

// Paths are from where it was run: `pnpm bench:graph` runs it in `bench/`, and says where it was run from.
const from = process.env.INIT_CWD ?? process.cwd();
const application = await realpath(resolve(from, options.application));
const root = await realpath(resolve(from, options.repository));
const out = resolve(from, options.out);
const base = `http://127.0.0.1:${options.port}`;
const launches = Number(options.launches);

const driver = spawn(
  options["tauri-driver"],
  ["--port", options.port, ...(options["native-driver"] ? ["--native-driver", options["native-driver"]] : [])],
  { stdio: ["ignore", "inherit", "inherit"] },
);
const driverEnded = new Promise((_, reject) => driver.on("exit", (code) => reject(new Error(`tauri-driver ended with ${code}`))));
driverEnded.catch(() => {});

try {
  await Promise.race([waitForDriver(base, 10_000), driverEnded]);
  const opens: Open[] = [];
  const scrolls: Scroll[] = [];
  const passes: { atStart: number; peak: number }[] = [];
  let rows = 0;
  let page = { userAgent: "", screen: "" };
  let webview = "";

  // Launch 0, with `--warm-up`, opens the repository as the others do, unmeasured, so a fresh machine's caches,
  // such as Mesa's shader cache on a runner drawing in software, are as a user's are after their first launch.
  for (let launch = options["warm-up"] ? 0 : 1; launch <= launches; launch++) {
    let session = await startSession(base, { "tauri:options": { application } }, SCRIPT_TIMEOUT);
    if (!(await reachWelcome(session))) {
      // It opened again the Tabs a user left open, and may be reading their
      // histories, so launch it again without them.
      await session.run([], listOnlyRecent, { root, name: basename(root) });
      await session.end();
      session = await startSession(base, { "tauri:options": { application } }, SCRIPT_TIMEOUT);
      if (!(await reachWelcome(session))) throw new Error("The Welcome screen didn't show");
    }
    try {
      webview = describeWebview(session);
      page = await session.run([], describePage);
      await session.run([], listOnlyRecent, { root, name: basename(root) });
      await session.refresh();
      if (!(await reachWelcome(session))) throw new Error("The Welcome screen didn't show");
      await session.run([], recordCommands);

      const opened = await session.run([rowsInView], openRecent, root, 30_000);
      rows = opened.rows;
      const sent = await session.run([], takeCommands);
      const firstWindow = sent.find((command) => command.name === "graphWindow");
      if (!firstWindow) throw new Error("The Commit graph showed without a graphWindow");
      const phases = phasesOf(opened.frames, { shown: opened.shown, answered: firstWindow.answered });
      const clicked = opened.frames[0]!;
      const open: Open = {
        laidOut: firstWindow.answered - clicked,
        firstScreen: opened.firstScreen - clicked,
        firstWindow: firstWindow.answered - firstWindow.sent,
        openingFrames: summariseFrames(phases.opening),
        layingOutFrames: summariseFrames(phases.layingOut),
        drawingFrames: summariseFrames(phases.drawing),
        intervals: intervalsOf(opened.frames),
        commands: durationsOf(sent),
      };
      if (launch === 0) {
        console.log(`Warm-up launch: first screen in ${Math.round(open.firstScreen)} ms, not measured`);
        continue;
      }
      opens.push(open);
      console.log(
        `Launch ${launch}: first window in ${Math.round(open.laidOut)} ms, first screen in ${Math.round(open.firstScreen)} ms; longest frame opening the Tab ${open.openingFrames.longest} ms, reading and laying out ${open.layingOutFrames.longest} ms`,
      );

      // The scrolls need only one launch.
      if (launch > 1) continue;
      for (const scenario of scenarios) {
        const whole = scenario.frames === null;
        const atStart = whole ? await memoryOf(application) : null;
        const sampler = whole ? startSampling(application, 100) : null;
        const scrolled = await session.run([rowsInView, nextFrame], scroll, scenario);
        const sampled = await sampler?.stop();
        const windows = (await session.run([], takeCommands)).filter((command) => command.name === "graphWindow");
        const intervals = intervalsOf(scrolled.frames);
        const frames = summariseFrames(intervals);
        scrolls.push({
          name: scenario.name,
          description: scenario.description,
          frames,
          intervals,
          droppedAsWindowsCame: droppedWhileAnswered(
            scrolled.frames,
            windows.map((command) => command.answered),
          ),
          blankFrames: scrolled.absent,
          readingFrames: scrolled.reading,
          mostRowsInDom: scrolled.mostRowsInDom,
          rows: scrolled.rows,
          graphWindow: windows.map((command) => command.answered - command.sent),
        });
        console.log(
          `Scroll ${scenario.name}: ${frames.fps} fps, ${frames.dropped} of ${frames.count} frames dropped, longest ${frames.longest} ms, ${scrolled.absent} frames with a blank row, ${scrolled.reading} with a row "Reading…"`,
        );
        if (sampled && sampled.samples.length > 0 && atStart !== null) {
          passes.push({ atStart, peak: sampled.peak });
          console.log(`  Memory: ${inMebibytes(atStart)} before, at most ${inMebibytes(sampled.peak)}`);
        }
      }
    } finally {
      // So the next launch doesn't open it again.
      await session.run([], listOnlyRecent, { root, name: basename(root) });
      await session.end();
    }
  }

  const results: Results = {
    system: {
      platform: process.platform,
      arch: process.arch,
      webview,
      screen: page.screen,
      cpus: availableParallelism(),
      date: new Date().toISOString().slice(0, 10),
      warmUp: options["warm-up"],
    },
    repository: { root, rows, commitGraph: hasCommitGraph(root) },
    opens,
    scrolls,
    memory: canMeasureMemory && passes.length > 0 ? memoryOver(passes) : null,
  };
  const targets = assess(results);
  const report = formatReport(results, targets);
  await mkdir(out, { recursive: true });
  const name = `graph-${process.platform}`;
  await writeFile(join(out, `${name}.json`), `${JSON.stringify({ ...results, targets }, null, 2)}\n`);
  await writeFile(join(out, `${name}.md`), report);
  console.log(`\n${report}`);
  console.log(`Wrote ${join(out, name)}.json and .md`);

  // CI holds the targets it can measure on its runners: the first screen and layout (PRD §11).
  const held = targets.slice(0, 2);
  if (options.check && held.some((target) => target.met === false)) {
    console.error(`Missed: ${held.filter((target) => target.met === false).map((target) => target.name).join("; ")}`);
    process.exitCode = 1;
  }
} finally {
  driver.kill();
}

/** The memory of scrolling the whole history, from the first time and the last. */
function memoryOver(passes: readonly { atStart: number; peak: number }[]): Memory {
  return {
    atStart: passes[0]!.atStart,
    firstPass: passes[0]!.peak,
    lastPass: passes.at(-1)!.peak,
    peak: Math.max(...passes.map((pass) => pass.peak)),
  };
}

function inMebibytes(bytes: number): string {
  return `${Math.round(bytes / 2 ** 20)} MiB`;
}

/** How long each command took to answer, by name. */
function durationsOf(sent: readonly Sent[]): Record<string, number[]> {
  const durations: Record<string, number[]> = {};
  for (const command of sent) (durations[command.name] ??= []).push(command.answered - command.sent);
  return durations;
}

/** Carries on past the Git Setup screen, if it shows, to the Welcome screen, and says whether it got there. */
async function reachWelcome(session: Session): Promise<boolean> {
  let screen = await session.run([], waitForScreen, 20_000);
  if (screen === "gitSetup") {
    await session.run([], continueSetup);
    screen = await session.run([], waitForScreen, 20_000);
  }
  return screen === "welcome";
}

/** Whether the repository at `clone` has a commit-graph file, which makes reading its history faster. */
function hasCommitGraph(clone: string): boolean {
  const info = spawnSync("git", ["-C", clone, "rev-parse", "--path-format=absolute", "--git-path", "objects/info"], {
    encoding: "utf8",
  }).stdout.trim();
  return existsSync(join(info, "commit-graph")) || existsSync(join(info, "commit-graphs"));
}

/**
 * The webview the driver runs the app in. WebKitWebDriver gives wry's version
 * as the browser's, so on Linux WebKitGTK's comes from `pkg-config`.
 */
function describeWebview(session: Session): string {
  const { browserName, browserVersion } = session.capabilities;
  const driven = browserName === undefined ? "" : ` (${String(browserName)} ${String(browserVersion ?? "")})`.replace(" )", ")");
  if (process.platform === "win32") return `WebView2${driven}`;
  if (process.platform === "darwin") return `WKWebView${driven}`;
  const version = spawnSync("pkg-config", ["--modversion", "webkit2gtk-4.1"], { encoding: "utf8" }).stdout?.trim();
  return `WebKitGTK${version ? ` ${version}` : ""}${driven}`;
}
