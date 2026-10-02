import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";

import { ContextMenu, type MenuItem } from "./Menu";

/** How far a key moves an edge: an arrow key, and Shift with an arrow key or Page Up and Down. */
export const STEP = 16;
export const BIG_STEP = 64;

interface Props {
  /** What it resizes, to a screen reader, such as "Resize the branches column". */
  label: string;
  /** The id of what it resizes, if it has one. */
  controls?: string;
  /** How wide what it resizes is now, in CSS pixels. */
  width: number;
  min: number;
  max: number;
  /** 1 if moving the edge right widens what it resizes, as for a column at its left; -1 if it narrows it. */
  rightward: 1 | -1;
  /** Called with the width wanted, kept between `min` and `max`. */
  onResize: (width: number) => void;
  onReset: () => void;
  /** The menu's words for `onReset`, such as "Reset to 256 pixels". */
  resetLabel: string;
  className?: string;
}

/**
 * The edge between two columns, as the WAI-ARIA APG's window splitter:
 * dragging it resizes a column, and so does the keyboard once it's tabbed
 * to, the arrow keys moving it by a little, Shift or Page Up and Down by
 * more, Home and End to either end, and Enter or a double click putting it
 * back. A right click, Shift+F10 or the Menu key opens the same as a menu,
 * so no width needs dragging (WCAG 2.5.7).
 */
export function Splitter({
  label,
  controls,
  width,
  min,
  max,
  rightward,
  onResize,
  onReset,
  resetLabel,
  className = "column-resizer",
}: Props) {
  const dragging = useRef<{ x: number; width: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const element = useRef<HTMLDivElement>(null);
  const widest = Math.max(min, max);
  const set = (wanted: number) => onResize(Math.round(Math.min(widest, Math.max(min, wanted))));

  const items: MenuItem[] = [
    { kind: "action", id: "wider", label: "Make wider", onSelect: () => set(width + BIG_STEP) },
    { kind: "action", id: "narrower", label: "Make narrower", onSelect: () => set(width - BIG_STEP) },
    { kind: "action", id: "reset", label: resetLabel, onSelect: onReset },
  ];

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const moves: Record<string, () => number> = {
      ArrowRight: () => width + rightward * step,
      ArrowLeft: () => width - rightward * step,
      PageUp: () => width + rightward * BIG_STEP,
      PageDown: () => width - rightward * BIG_STEP,
      Home: () => (rightward === 1 ? min : widest),
      End: () => (rightward === 1 ? widest : min),
    };
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      event.stopPropagation();
      const box = element.current?.getBoundingClientRect();
      setMenu({ x: box?.right ?? 0, y: box?.top ?? 0 });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      onReset();
      return;
    }
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    event.stopPropagation();
    set(move());
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    element.current?.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragging.current = { x: event.clientX, width };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const from = dragging.current;
    if (from === null) return;
    set(from.width + rightward * (event.clientX - from.x));
  }

  function stop(event: PointerEvent<HTMLDivElement>) {
    dragging.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <>
      <div
        ref={element}
        role="separator"
        tabIndex={0}
        className={className}
        aria-orientation="vertical"
        aria-label={label}
        aria-controls={controls}
        aria-valuenow={width}
        aria-valuemin={min}
        aria-valuemax={widest}
        aria-valuetext={`${width} pixels wide`}
        title={`${label}: drag, or use the arrow keys. Double-click to ${resetLabel.toLowerCase()}.`}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stop}
        onPointerCancel={stop}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onReset();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
      />
      {menu !== null && (
        <ContextMenu
          ariaLabel={label}
          items={items}
          at={menu}
          onClose={(returnFocus) => {
            setMenu(null);
            if (returnFocus) element.current?.focus();
          }}
        />
      )}
    </>
  );
}
