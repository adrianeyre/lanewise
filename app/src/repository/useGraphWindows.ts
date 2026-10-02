import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CommandClient, GraphRow, GraphWindowed, LayoutToken, Path } from "../commands/api";
import { type Segment, segmentsOf } from "./graphDrawing";
import { describeFailure, describeRepositoryError } from "./problems";

/** How many rows a window has: `graphWindow`'s default. */
export const WINDOW = 200;

/** How many windows either side of those on screen are read ahead (ADR 0005). */
const AHEAD = 1;

/** How many windows away from those on screen one is kept before it's forgotten, as another is read (ADR 0005). */
const KEPT = 6;

interface Windows {
  /** The layout they were all read from. */
  layout: LayoutToken | null;
  /** How many rows the history has, once a window has said. */
  total: number | null;
  /** By number: window `n` starts at row `n * WINDOW`. */
  read: ReadonlyMap<number, GraphWindowed>;
  problem: string | null;
}

const NONE: Windows = { layout: null, total: null, read: new Map(), problem: null };

export interface GraphWindows {
  /** How many rows the history has, or `null` until the first window comes. */
  total: number | null;
  /** Row `index`, if its window has been read. */
  row: (index: number) => GraphRow | undefined;
  /** Every segment the windows read have, each once. */
  segments: Segment[];
  /** Why the history couldn't be read, if it couldn't. */
  problem: string | null;
}

/**
 * The Commit graph's windows around rows `first` to `last`, the rows on
 * screen, and the window of row `active`, the one with focus: read as they
 * are wanted, and forgotten when far away. When the history is laid out
 * again, as its refs move, the windows are dropped and read again. Each
 * time `refreshes` changes, as the refs may have moved, in Lanewise or
 * outside it, one window is read again to find out.
 */
export function useGraphWindows(
  commands: CommandClient,
  repository: Path,
  first: number,
  last: number,
  active: number,
  refreshes: number,
): GraphWindows {
  const [windows, setWindows] = useState<Windows>(NONE);
  const reading = useRef(new Set<number>());
  // Replies to requests made before the windows were dropped are ignored.
  const generation = useRef(0);
  const layout = useRef<LayoutToken | null>(null);

  const low = Math.floor(first / WINDOW);
  const high = Math.floor(Math.max(first, last - 1) / WINDOW);
  const count = windows.total === null ? 1 : Math.ceil(windows.total / WINDOW);
  const activeWindow = Math.floor(active / WINDOW);

  // Where the history is, for forgetting windows far from it as others come.
  const view = useRef({ low, high, active: activeWindow });
  useEffect(() => {
    view.current = { low, high, active: activeWindow };
  }, [low, high, activeWindow]);

  const drop = useCallback(() => {
    generation.current++;
    reading.current.clear();
    layout.current = null;
    setWindows((kept) => ({ ...NONE, total: kept.total }));
  }, []);

  const read = useCallback(
    async (n: number) => {
      const asked = generation.current;
      reading.current.add(n);
      const answered = (change: (kept: Windows) => Windows) => {
        if (asked !== generation.current) return;
        reading.current.delete(n);
        setWindows(change);
      };
      try {
        const outcome = await commands.call("graphWindow", {
          repository,
          layout: layout.current,
          start: n * WINDOW,
        });
        if (asked !== generation.current) return;
        if (!outcome.ok) {
          const { error } = outcome;
          if (error.kind === "staleLayout") drop();
          else answered((kept) => ({ ...kept, problem: describeRepositoryError(error) }));
          return;
        }
        const window = outcome.value;
        // Read under no layout, alongside another window that came back from a newer one.
        if (layout.current !== null && window.layout !== layout.current) {
          drop();
          return;
        }
        layout.current = window.layout;
        answered((kept) => ({
          layout: window.layout,
          total: window.total,
          read: forgetFar(new Map(kept.read).set(n, window), view.current),
          problem: null,
        }));
      } catch (failure) {
        answered((kept) => ({ ...kept, problem: describeFailure(failure) }));
      }
    },
    [commands, repository, drop],
  );

  // A window read again under the layout the others have fails as
  // `staleLayout` if the refs moved since, and so drops them all.
  const refreshed = useRef(refreshes);
  useEffect(() => {
    if (refreshed.current === refreshes) return;
    refreshed.current = refreshes;
    const n = view.current.active;
    if (layout.current !== null && !reading.current.has(n)) void read(n);
  }, [refreshes, read]);

  // Read the windows on screen, one either side, and the active row's.
  useEffect(() => {
    if (windows.problem !== null) return;
    const wanted = new Set<number>();
    for (let n = Math.max(0, low - AHEAD); n <= Math.min(count - 1, high + AHEAD); n++) wanted.add(n);
    if (activeWindow < count) wanted.add(activeWindow);
    for (const n of wanted) {
      if (!windows.read.has(n) && !reading.current.has(n)) void read(n);
    }
  }, [windows, low, high, count, activeWindow, read]);

  const row = useCallback(
    (index: number) => windows.read.get(Math.floor(index / WINDOW))?.rows[index % WINDOW],
    [windows.read],
  );

  const segments = useMemo(() => {
    const byId = new Map<number, Segment>();
    for (const window of windows.read.values()) {
      for (const segment of segmentsOf(window.segments)) byId.set(segment.id, segment);
    }
    return [...byId.values()];
  }, [windows.read]);

  return { total: windows.total, row, segments, problem: windows.problem };
}

/** `windows`, less those more than `KEPT` from `low` to `high` that aren't the `active` row's. */
function forgetFar(
  windows: Map<number, GraphWindowed>,
  { low, high, active }: { low: number; high: number; active: number },
): Map<number, GraphWindowed> {
  for (const n of windows.keys()) {
    if (n !== active && (n < low - KEPT || n > high + KEPT)) windows.delete(n);
  }
  return windows;
}
