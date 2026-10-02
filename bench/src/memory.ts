/**
 * The Desktop App's memory, as Linux counts it: the proportional set size
 * (PSS) of the app and every process under it, which is where WebKitGTK draws
 * the page. PSS shares each shared page among the processes that map it, so
 * the processes' sizes add up without counting a library twice.
 */

import { readdir, readFile, readlink } from "node:fs/promises";

/** Samples the memory of the app at `application` every `interval` milliseconds until stopped. */
export interface Sampler {
  /** Stops sampling, and says the most it saw, in bytes, and when, in milliseconds after `start`. */
  stop(): Promise<{ peak: number; samples: { at: number; bytes: number }[] }>;
}

/** Whether this system can say, which today only Linux can. */
export const canMeasureMemory = process.platform === "linux";

/**
 * Starts sampling. On macOS and Windows it samples nothing: those numbers
 * come from the hand checks, which read them from Activity Monitor or Task
 * Manager.
 */
export function startSampling(application: string, interval: number): Sampler {
  const samples: { at: number; bytes: number }[] = [];
  const started = performance.now();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sampling = Promise.resolve();
  const sample = () => {
    sampling = memoryOf(application).then((bytes) => {
      if (bytes !== null) samples.push({ at: Math.round(performance.now() - started), bytes });
      if (!stopped) timer = setTimeout(sample, interval);
    });
  };
  if (canMeasureMemory) sample();
  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await sampling;
      return { peak: Math.max(0, ...samples.map((each) => each.bytes)), samples };
    },
  };
}

/** The PSS of the running app at `application` and its processes, in bytes, or `null` if it isn't running. */
export async function memoryOf(application: string): Promise<number | null> {
  const processes = await listProcesses();
  const roots = processes.filter((each) => each.exe === application).map((each) => each.pid);
  if (roots.length === 0) return null;
  const tree = new Set(roots);
  // A child's pid isn't always higher than its parent's, so go round until nothing joins.
  for (let grew = true; grew; ) {
    grew = false;
    for (const each of processes) {
      if (!tree.has(each.pid) && tree.has(each.parent)) {
        tree.add(each.pid);
        grew = true;
      }
    }
  }
  let bytes = 0;
  for (const pid of tree) bytes += (await pssOf(pid)) ?? 0;
  return bytes;
}

interface Process {
  pid: number;
  parent: number;
  exe: string | null;
}

async function listProcesses(): Promise<Process[]> {
  const found: Process[] = [];
  for (const name of await readdir("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    try {
      const status = await readFile(`/proc/${pid}/status`, "utf8");
      const parent = Number(/^PPid:\s+(\d+)/m.exec(status)?.[1] ?? 0);
      const exe = await readlink(`/proc/${pid}/exe`).catch(() => null);
      found.push({ pid, parent, exe });
    } catch {
      // It ended while we looked.
    }
  }
  return found;
}

/** A process's PSS in bytes, from `smaps_rollup`, which gives it in kB. */
async function pssOf(pid: number): Promise<number | null> {
  try {
    const rollup = await readFile(`/proc/${pid}/smaps_rollup`, "utf8");
    return parsePss(rollup);
  } catch {
    return null;
  }
}

/** The `Pss:` line of an `smaps_rollup`, in bytes. */
export function parsePss(rollup: string): number | null {
  const kilobytes = /^Pss:\s+(\d+) kB$/m.exec(rollup)?.[1];
  return kilobytes === undefined ? null : Number(kilobytes) * 1024;
}
