import { useCallback, useState } from "react";

import { ACTIVITY_PLACE_KEY, readLocal, writeLocal } from "../settings/localSettings";

/**
 * Where the Activity indicator is: how far its right and bottom edges are
 * from the window's, in CSS pixels, so it keeps to its corner as the window
 * is resized.
 */
export interface ActivityPlace {
  right: number;
  bottom: number;
}

/** A width and height, in CSS pixels. */
export interface Size {
  width: number;
  height: number;
}

/** Where it is until it's moved: at the bottom right of the window, above the footer. */
export const DEFAULT_PLACE: ActivityPlace = { right: 16, bottom: 36 };

/** How far it keeps from the window's edges once it's in a corner. */
const CORNER_MARGIN = 16;

/** One of the window's corners, which the indicator's menu moves it to. */
export type Corner = "bottomRight" | "bottomLeft" | "topLeft" | "topRight";

/** `value`, whole, between nought and `most`, or nought if `most` is less. */
function clamp(value: number, most: number): number {
  return Math.round(Math.min(Math.max(0, most), Math.max(0, value)));
}

/** Whether `value` is a distance a place can be. */
function isDistance(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** `place`, kept wholly inside a window `viewport` big, for an indicator `size` big. */
export function clampPlace(place: ActivityPlace, size: Size, viewport: Size): ActivityPlace {
  return {
    right: clamp(place.right, viewport.width - size.width),
    bottom: clamp(place.bottom, viewport.height - size.height),
  };
}

/** Where an indicator `size` big goes in `corner` of a window `viewport` big. */
export function cornerPlace(corner: Corner, size: Size, viewport: Size): ActivityPlace {
  const left = viewport.width - size.width - CORNER_MARGIN;
  const top = viewport.height - size.height - CORNER_MARGIN;
  const places: Record<Corner, ActivityPlace> = {
    bottomRight: DEFAULT_PLACE,
    bottomLeft: { right: left, bottom: DEFAULT_PLACE.bottom },
    topLeft: { right: left, bottom: top },
    topRight: { right: DEFAULT_PLACE.right, bottom: top },
  };
  return clampPlace(places[corner], size, viewport);
}

/** The place kept, or `null` if none was, or what was kept isn't one. */
export function parsePlace(kept: string | null): ActivityPlace | null {
  try {
    const parsed: unknown = kept === null ? null : JSON.parse(kept);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { right, bottom } = parsed as Record<string, unknown>;
    return isDistance(right) && isDistance(bottom) ? { right: Math.round(right), bottom: Math.round(bottom) } : null;
  } catch {
    return null;
  }
}

/**
 * The Activity indicator's place, kept on this machine as it's dragged or
 * moved from the keyboard or its menu. `move` changes it for now, and
 * `keep` keeps it too, so a drag is kept once, as it ends.
 */
export function useActivityPlace(): {
  place: ActivityPlace;
  move(place: ActivityPlace): void;
  keep(place: ActivityPlace): void;
} {
  const [place, setPlace] = useState<ActivityPlace>(() => parsePlace(readLocal(ACTIVITY_PLACE_KEY)) ?? DEFAULT_PLACE);
  const keep = useCallback((next: ActivityPlace) => {
    setPlace(next);
    writeLocal(ACTIVITY_PLACE_KEY, JSON.stringify(next));
  }, []);
  return { place, move: setPlace, keep };
}
