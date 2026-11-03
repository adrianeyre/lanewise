import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * A scene: Lanewise drawn small, as a still or a short story told with a
 * pointer, made to stageshow's rules (https://github.com/benjitaylor/skills,
 * `stageshow`). It is drawn at its design size and scaled to fit its box,
 * with a second, narrower design below `compact.below` pixels. It is drawn in
 * the browser alone: the built page's Content-Security-Policy allows no
 * `style` attribute in its HTML (ADR 0054), and a scene is positioned and
 * scaled by them. Until it is drawn, as in the prerendered page or without
 * JavaScript, its box keeps its size, from `scenes.css`, and its words.
 */

/** Which of a scene's two designs is drawn. */
export type Layout = "wide" | "compact";

export interface Point {
  x: number;
  y: number;
}

/** What a scene's script can do: change the scene, wait, and move and click the pointer. */
export interface Act<S> {
  layout: Layout;
  set(patch: Partial<S> | ((scene: S) => Partial<S>)): void;
  wait(ms: number): Promise<void>;
  /** Moves the pointer to the middle of the element whose `data-target` is `target`, in a time set by how far it goes. */
  move(target: string): Promise<void>;
  /** Presses and lets go where the pointer is. */
  click(): Promise<void>;
}

interface Design {
  width: number;
  height: number;
}

export interface StageProps<S extends object> {
  /** Its class in `scenes.css`, `scene-<name>`, which sizes its box before it is drawn and styles what's in it. */
  name: string;
  width: number;
  height: number;
  /** A second design, for a box narrower than `below`: a closer crop, not the wide one shrunk. */
  compact?: Design & { below: number };
  initial: S;
  /** What the scene shows once its story has played, and all the while for reduced motion: the result. */
  poster: S;
  script?: (act: Act<S>) => Promise<void>;
  /** Where the pointer rests before the story starts, in design pixels. */
  pointer?: Record<Layout, Point>;
  /** What it shows, in words, for anyone who can't see it. */
  label: string;
  /**
   * Whether a button can stop the story and play it again: needed for one
   * longer than five seconds, beside the rest of the page (WCAG 2.2.2).
   */
  controls?: boolean;
  children: (scene: S, layout: Layout) => ReactNode;
}

/** Thrown into a script that was stopped, so it ends where it is. */
class Stopped extends Error {}

/** The travel curve, for a pointer moving between two things. */
const TRAVEL = "cubic-bezier(0.45, 0, 0.1, 1)";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** Whether this browser can draw a scene: one that can measure it and tell when it's seen. */
function canDraw(): boolean {
  return (
    typeof ResizeObserver !== "undefined" &&
    typeof IntersectionObserver !== "undefined" &&
    typeof matchMedia !== "undefined"
  );
}

const never = () => () => {};

/** Whether scenes are drawn: `false` as the page is prerendered and hydrated, then whether the browser can. */
function useDrawn(): boolean {
  return useSyncExternalStore(never, canDraw, () => false);
}

/** Whether reduced motion is asked for, as it changes. */
function useReducedMotion(drawn: boolean): boolean {
  return useSyncExternalStore(
    (changed) => {
      if (!drawn) return () => {};
      const query = matchMedia(REDUCED_MOTION);
      query.addEventListener("change", changed);
      return () => query.removeEventListener("change", changed);
    },
    () => drawn && matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

interface Hand {
  at: Point;
  travel: number;
  pressed: boolean;
  shown: boolean;
}

export function Stage<S extends object>({
  name,
  width,
  height,
  compact,
  initial,
  poster,
  script,
  pointer,
  label,
  controls = false,
  children,
}: StageProps<S>) {
  const drawn = useDrawn();
  const reduced = useReducedMotion(drawn);
  // Reduced motion, or no story, is the poster alone, with no pointer.
  const still = reduced || script === undefined;

  const frame = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ layout: Layout; scale: number }>({ layout: "wide", scale: 1 });
  const design = fit.layout === "compact" && compact ? compact : { width, height };

  // The layout and scale follow the box's width, as it is first measured and each time it changes.
  useLayoutEffect(() => {
    const box = frame.current;
    if (!drawn || !box) return;
    const observer = new ResizeObserver(() => {
      const across = box.clientWidth;
      const layout: Layout = compact && across < compact.below ? "compact" : "wide";
      const designWidth = layout === "compact" && compact ? compact.width : width;
      setFit({ layout, scale: across / designWidth });
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [drawn, width, compact]);

  // The scene as the story has it, or `null` for its poster, as before it plays and after.
  const [scene, setScene] = useState<S | null>(null);
  const [hand, setHand] = useState<Hand>({ at: { x: 0, y: 0 }, travel: 0, pressed: false, shown: false });
  const [playing, setPlaying] = useState(false);
  // Whether the story has played since the scene was drawn, or was stopped.
  const [played, setPlayed] = useState(false);
  const running = useRef<{ stopped: boolean } | null>(null);

  // What the story reads as it starts, from the last render.
  const latest = useRef({ fit, design, pointer, initial, script });
  useLayoutEffect(() => {
    latest.current = { fit, design, pointer, initial, script };
  });

  /** Plays the story from its start, stopping one that is playing. */
  function play() {
    const { fit: fitted, design: size, pointer: rest, initial: start, script: story } = latest.current;
    if (story === undefined) return;
    if (running.current) running.current.stopped = true;
    const token = { stopped: false };
    running.current = token;
    const scale = fitted.scale || 1;
    let current = start;
    let at = rest?.[fitted.layout] ?? { x: size.width / 2, y: size.height / 2 };
    const wait = (ms: number) =>
      new Promise<void>((done, fail) => {
        setTimeout(() => (token.stopped ? fail(new Stopped()) : done()), ms);
      });
    const act: Act<S> = {
      layout: fitted.layout,
      set(patch) {
        if (token.stopped) throw new Stopped();
        current = { ...current, ...(typeof patch === "function" ? patch(current) : patch) };
        setScene(current);
      },
      wait,
      async move(target) {
        const element = root.current?.querySelector<HTMLElement>(`[data-target="${target}"]`);
        const stage = root.current?.getBoundingClientRect();
        if (!element || !stage) return;
        const box = element.getBoundingClientRect();
        const to = {
          x: (box.left - stage.left + box.width / 2) / scale,
          y: (box.top - stage.top + box.height / 2) / scale,
        };
        const travel = Math.round(Math.min(1100, Math.max(450, 300 + Math.hypot(to.x - at.x, to.y - at.y) * 1.4)));
        at = to;
        setHand((last) => ({ ...last, at: to, travel, shown: true }));
        await wait(travel + 60);
      },
      async click() {
        setHand((last) => ({ ...last, pressed: true }));
        await wait(140);
        setHand((last) => ({ ...last, pressed: false }));
        await wait(80);
      },
    };
    setScene(start);
    setHand({ at, travel: 0, pressed: false, shown: true });
    setPlaying(true);
    setPlayed(true);
    story(act).then(
      () => {
        if (token.stopped) return;
        running.current = null;
        setPlaying(false);
        // The result holds, and the pointer leaves it.
        setHand((last) => ({ ...last, shown: false }));
      },
      (failure: unknown) => {
        if (!(failure instanceof Stopped)) throw failure;
      },
    );
  }

  /** Stops the story, showing its result. */
  function stop() {
    if (running.current) running.current.stopped = true;
    running.current = null;
    setScene(null);
    setPlaying(false);
    setPlayed(true);
    setHand((last) => ({ ...last, shown: false, pressed: false }));
  }

  // The story plays once, as the scene is half in view.
  const latestPlay = useRef(play);
  useLayoutEffect(() => {
    latestPlay.current = play;
  });
  useEffect(() => {
    const box = frame.current;
    if (!drawn || still || played || !box) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        latestPlay.current();
      },
      { threshold: 0.5 },
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, [drawn, still, played]);

  // A story still playing as the scene goes stops there.
  useEffect(
    () => () => {
      if (running.current) running.current.stopped = true;
    },
    [],
  );

  // Until the story starts, and after it, the poster: never a blank box.
  const shown = still || scene === null ? poster : scene;
  const sceneStyle: CSSProperties = {
    width: design.width,
    height: design.height,
    transform: `scale(${fit.scale})`,
  };
  const handStyle: CSSProperties = {
    transform: `translate(${hand.at.x}px, ${hand.at.y}px)`,
    transition: `transform ${hand.travel}ms ${TRAVEL}, opacity 300ms ease`,
  };

  return (
    <div className={`scene scene-${name}`}>
      <div ref={frame} className="scene-frame" role="img" aria-label={label}>
        {drawn && (
          <div ref={root} className="scene-root" data-layout={fit.layout} style={sceneStyle} aria-hidden="true">
            {children(shown, fit.layout)}
            {!still && (
              <div
                className="scene-pointer"
                data-shown={hand.shown && playing}
                data-pressed={hand.pressed}
                style={handStyle}
              >
                <Pointer />
              </div>
            )}
          </div>
        )}
      </div>
      {controls && drawn && !still && (
        <button type="button" className="button scene-control" onClick={playing ? stop : play}>
          {playing ? "Stop the animation" : "Play the animation again"}
        </button>
      )}
    </div>
  );
}

/**
 * The pointer: macOS's arrow, white over black, its point at the scene's
 * point. Its outline is from stageshow's kit (`kit/cursors.tsx`), MIT
 * licensed, Copyright (c) 2026 Benji Taylor.
 */
function Pointer() {
  return (
    <svg className="scene-pointer-arrow" width="24" height="24" viewBox="0 0 32 32" fill="none">
      <g transform="translate(10 7)">
        <path
          d="m6.148 18.473 1.863-1.003 1.615-.839-2.568-4.816h4.332l-11.379-11.408v16.015l3.316-3.221z"
          fill="#fff"
        />
        <path d="m6.431 17 1.765-.941-2.775-5.202h3.604l-8.025-8.043v11.188l2.53-2.442z" fill="#000" />
      </g>
    </svg>
  );
}
