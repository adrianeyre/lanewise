import { GripVertical, LoaderCircle } from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { type Activity, useActivities } from "./activity";
import {
  type ActivityPlace,
  clampPlace,
  type Corner,
  cornerPlace,
  DEFAULT_PLACE,
  type Size,
  useActivityPlace,
} from "./activityPlace";
import { ContextMenu, type MenuItem } from "./Menu";
import { BIG_STEP, STEP } from "./Splitter";

/** How far a press moves before it's taken for a drag, not a click, in CSS pixels. */
const DRAG_FROM = 4;

const CORNERS: { corner: Corner; label: string }[] = [
  { corner: "bottomRight", label: "Move to the bottom right" },
  { corner: "bottomLeft", label: "Move to the bottom left" },
  { corner: "topLeft", label: "Move to the top left" },
  { corner: "topRight", label: "Move to the top right" },
];

function viewport(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

function sameRoom(a: { size: Size; viewport: Size } | null, b: { size: Size; viewport: Size }): boolean {
  return (
    a !== null &&
    a.size.width === b.size.width &&
    a.size.height === b.size.height &&
    a.viewport.width === b.viewport.width &&
    a.viewport.height === b.viewport.height
  );
}

/** Whole seconds from `started` to `now`, as the indicator counts them. */
function seconds(started: number, now: number): number {
  return Math.max(0, Math.floor((now - started) / 1000));
}

/**
 * The Activity indicator: whatever Lanewise is doing that takes time, at the
 * bottom right of the window, above the footer, until it's moved: dragged
 * anywhere in the window, moved by the arrow keys from its grip, or sent to
 * a corner from the grip's menu, which a click, Shift+F10 or a right click
 * opens, so it never needs dragging (WCAG 2.5.7). Where it's moved is kept,
 * and it stays inside the window as the window is resized. It shows the
 * newest Activity running, with a spinner, what it's doing now, in words
 * that change as it moves on, and a bar of how far it has got: filled to
 * its percentage where that's known, and moving where it isn't, with how
 * long it has been running, so nobody takes it for stuck. Only an Activity
 * that has run a moment shows, so one quickly done doesn't flash. A screen
 * reader hears each change of words; the percentage is the bar's value.
 * The spinner and the moving bar keep still where reduced motion is asked
 * for.
 */
export function ActivityIndicator() {
  const all = useActivities();
  const [now, setNow] = useState(() => Date.now());
  const labelId = useId();
  const hintId = useId();
  const { place, move, keep } = useActivityPlace();
  const card = useRef<HTMLDivElement>(null);
  const grip = useRef<HTMLButtonElement>(null);
  const dragging = useRef<{ x: number; y: number; from: ActivityPlace; moved: boolean } | null>(null);
  // A drag that started on the grip isn't a click on it too.
  const dragged = useRef(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // Its size and the window's, read once it's drawn and as the window is resized, to keep it inside.
  const [room, setRoom] = useState<{ size: Size; viewport: Size } | null>(null);
  const running = all.length > 0;
  // Ticks while anything runs, for the seconds, and for an Activity to show once it's run a moment.
  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, [running]);
  const shown = all.filter((activity) => activity.shownFrom <= now);
  const newest: Activity | undefined = shown.at(-1);
  const others = shown.length - 1;
  const showing = newest !== undefined;

  // Read again after each change, since new words can make it taller.
  useLayoutEffect(() => {
    if (!showing) return;
    const measure = () => {
      const box = card.current?.getBoundingClientRect();
      if (box === undefined) return;
      const next = { size: { width: box.width, height: box.height }, viewport: viewport() };
      setRoom((was) => (sameRoom(was, next) ? was : next));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });

  const at = room === null ? place : clampPlace(place, room.size, room.viewport);
  const sizeNow = (): Size => room?.size ?? { width: 0, height: 0 };
  const within = (wanted: ActivityPlace) => clampPlace(wanted, sizeNow(), viewport());

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    dragged.current = false;
    if (event.button !== 0) return;
    // Keeps a drag from selecting the words it passes over.
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragging.current = { x: event.clientX, y: event.clientY, from: at, moved: false };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragging.current;
    if (drag === null) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_FROM) return;
    drag.moved = true;
    move(within({ right: drag.from.right - dx, bottom: drag.from.bottom - dy }));
  }

  function onPointerEnd(event: PointerEvent<HTMLDivElement>) {
    const drag = dragging.current;
    dragging.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag?.moved) {
      dragged.current = true;
      keep(at);
    }
  }

  function openMenuAtGrip() {
    const box = grip.current?.getBoundingClientRect();
    setMenu({ x: box?.left ?? 0, y: box?.top ?? 0 });
  }

  function onGripKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    dragged.current = false;
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      openMenuAtGrip();
      return;
    }
    const step = event.shiftKey ? BIG_STEP : STEP;
    const moves: Record<string, () => ActivityPlace> = {
      ArrowLeft: () => ({ right: at.right + step, bottom: at.bottom }),
      ArrowRight: () => ({ right: at.right - step, bottom: at.bottom }),
      ArrowUp: () => ({ right: at.right, bottom: at.bottom + step }),
      ArrowDown: () => ({ right: at.right, bottom: at.bottom - step }),
      Home: () => DEFAULT_PLACE,
    };
    const moved = moves[event.key];
    if (!moved) return;
    event.preventDefault();
    keep(within(moved()));
  }

  const items: MenuItem[] = CORNERS.map(({ corner, label }) => ({
    kind: "action",
    id: corner,
    label,
    onSelect: () => keep(cornerPlace(corner, sizeNow(), viewport())),
  }));

  return (
    <div className="activity-layer" style={{ right: at.right, bottom: at.bottom }}>
      {/* Always there, so a screen reader hears what it says as it changes. */}
      <p aria-live="polite" className="visually-hidden">
        {newest?.words ?? ""}
      </p>
      {newest !== undefined && (
        <div
          ref={card}
          className="activity"
          data-testid="activity"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu({ x: event.clientX, y: event.clientY });
          }}
        >
          <LoaderCircle aria-hidden="true" className="activity-spinner" />
          <div className="activity-body">
            <p id={labelId} className="activity-words">
              {newest.words}
            </p>
            <div className="activity-meta">
              {newest.step !== null && (
                <span>
                  Step {newest.step.at} of {newest.step.of}
                </span>
              )}
              {newest.percent !== null && <span className="activity-percent">{newest.percent}%</span>}
              <span className="activity-seconds">{seconds(newest.started, now)}s</span>
              {others > 0 && <span>{others === 1 ? "and 1 more" : `and ${others} more`}</span>}
            </div>
            <div
              role="progressbar"
              className="activity-bar"
              aria-labelledby={labelId}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={newest.percent ?? undefined}
              data-indeterminate={newest.percent === null || undefined}
            >
              <div
                className="activity-bar-done"
                style={newest.percent === null ? undefined : { inlineSize: `${newest.percent}%` }}
              />
            </div>
          </div>
          <button
            ref={grip}
            type="button"
            className="icon-button activity-grip"
            aria-label="Move the progress"
            aria-describedby={hintId}
            aria-haspopup="menu"
            title="Drag to move it, or use the arrow keys. Click for the corners; Home puts it back."
            onKeyDown={onGripKeyDown}
            onClick={() => {
              if (dragged.current) {
                dragged.current = false;
                return;
              }
              openMenuAtGrip();
            }}
          >
            <GripVertical aria-hidden="true" className="button-icon" />
          </button>
          <p id={hintId} className="visually-hidden">
            The arrow keys move it, further with Shift, and Home puts it back at the bottom right. Enter opens a menu of
            the window&apos;s corners.
          </p>
        </div>
      )}
      {menu !== null && showing && (
        <ContextMenu
          ariaLabel="Move the progress"
          items={items}
          at={menu}
          onClose={(returnFocus) => {
            setMenu(null);
            if (returnFocus) grip.current?.focus();
          }}
        />
      )}
    </div>
  );
}
