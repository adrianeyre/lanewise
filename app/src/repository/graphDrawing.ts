import type { GraphRow } from "../commands/api";

/**
 * Drawing the Commit graph's canvas, as ADR 0005 chose: only the rows on
 * screen, from the windows read so far, with lines batched by colour. The
 * scene is worked out apart from the painting so it can be tested without a
 * canvas, which jsdom doesn't have.
 */

/** How many lane colours the Theme has: `--lane-0` to `--lane-7`. */
export const LANE_COLOURS = 8;

/** A line down the graph, as `graphWindow` sends it (see `GraphWindowed.segments`). */
export interface Segment {
  id: number;
  start: number;
  length: number;
  from: number;
  column: number;
  to: number;
  colour: number;
}

/** The segments in a window's flat numbers, seven to each. */
export function segmentsOf(flat: number[]): Segment[] {
  const segments: Segment[] = [];
  for (let at = 0; at + 7 <= flat.length; at += 7) {
    const [id, start, length, from, column, to, colour] = flat.slice(at, at + 7) as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    segments.push({ id, start, length, from, column, to, colour });
  }
  return segments;
}

/** A line from one point to another: straight, or an S-curve if it changes column. */
export interface Stroke {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A commit's dot: its author's avatar, or a small plain dot for a merge. */
export interface Dot {
  x: number;
  y: number;
  colour: number;
  /** `HEAD` points at it, detached or through the current branch. */
  head: boolean;
  selected: boolean;
  /** The author's initials, drawn on the avatar, or `null` for a merge's plain dot. */
  initials: string | null;
  /** The avatar's own colour, the same for every commit by the same author. */
  avatar: number;
  /** The author's email, for their picture where it's shown. */
  email: string;
}

/** A stash, drawn as a dotted square beside the commit it was made on, joined to it by a dotted line. */
export interface StashMark {
  /** The stash's own commit's ID. */
  id: string;
  /** The square's middle. */
  x: number;
  y: number;
  /** Where the dotted line to it starts: the commit's dot. */
  fromX: number;
  colour: number;
  selected: boolean;
}

/** A cut edge's short arrow, pointing down to a far parent or up to a far child. */
export interface Arrow {
  x: number;
  y: number;
  direction: 1 | -1;
  colour: number;
}

export interface Scene {
  /** The lines, by colour. */
  lines: Map<number, Stroke[]>;
  dots: Dot[];
  arrows: Arrow[];
  stashes: StashMark[];
  /** How many columns the rows on screen take, with their stashes. */
  columns: number;
}

export interface SceneInput {
  /** Row `index`, if its window has been read. */
  row: (index: number) => GraphRow | undefined;
  segments: Iterable<Segment>;
  /** The rows on screen: `first` up to, not including, `last`. */
  first: number;
  last: number;
  /** In pixels, as is everything else here. */
  rowHeight: number;
  /** The distance between two columns. */
  lane: number;
  /** How far the history is scrolled. */
  scrollTop: number;
  /** The selected commit's ID. */
  selected: string | null;
  /** The stashes made on each commit, by the commit's ID, newest first, by their own commits' IDs. */
  stashes?: ReadonlyMap<string, readonly string[]>;
  /** The selected stash's ID. */
  selectedStash?: string | null;
}

/**
 * An author's initials: the first letters of their name's first and last
 * words, or the first of a one-word name, in capitals.
 */
export function initialsOf(author: string): string {
  const words = author.trim().split(/\s+/).filter(Boolean);
  const first = Array.from(words[0] ?? "?")[0] ?? "?";
  const last = words.length > 1 ? (Array.from(words.at(-1)!)[0] ?? "") : "";
  return (first + last).toLocaleUpperCase();
}

/** An author's avatar colour, one of the Theme's lane colours, the same each time for the same name. */
export function avatarOf(author: string): number {
  let hash = 0;
  for (const unit of author) hash = (hash * 31 + unit.codePointAt(0)!) >>> 0;
  return hash % LANE_COLOURS;
}

/** Where column `column` is drawn: one lane in from the left edge, and a lane apart. */
export const columnX = (column: number, lane: number) => (column + 1) * lane;

/** How wide the graph is for `columns` columns: a lane's margin each side. */
export const graphWidth = (columns: number, lane: number) => (columns + 1) * lane;

/** What to draw for the rows on screen, where the canvas's top is the top of what shows. */
export function buildScene({
  row,
  segments,
  first,
  last,
  rowHeight,
  lane,
  scrollTop,
  selected,
  stashes: stashesOn = new Map(),
  selectedStash = null,
}: SceneInput): Scene {
  const x = (column: number) => columnX(column, lane);
  const y = (index: number) => index * rowHeight + rowHeight / 2 - scrollTop;
  const lines = new Map<number, Stroke[]>();
  let columns = 0;
  const draw = (colour: number, from: number, top: number, to: number, bottom: number) => {
    columns = Math.max(columns, from + 1, to + 1);
    let strokes = lines.get(colour);
    if (!strokes) lines.set(colour, (strokes = []));
    strokes.push({ x0: x(from), y0: y(top), x1: x(to), y1: y(bottom) });
  };

  // The bands between one row and the next that show: from the one into
  // the first row on screen to the one out of the last.
  const low = first - 1;
  const high = last - 1;
  for (const segment of segments) {
    const end = segment.start + segment.length;
    if (end - 1 < low || segment.start > high) continue;
    const shows = (band: number) => band >= low && band <= high;
    if (segment.length === 1) {
      draw(segment.colour, segment.from, segment.start, segment.to, end);
      continue;
    }
    // Curves in and out where it changes column, and one straight line
    // down the column between them, as far as it shows.
    const curvesIn = segment.from !== segment.column;
    const curvesOut = segment.to !== segment.column;
    if (curvesIn && shows(segment.start)) {
      draw(segment.colour, segment.from, segment.start, segment.column, segment.start + 1);
    }
    const top = Math.max(curvesIn ? segment.start + 1 : segment.start, low);
    const bottom = Math.min(curvesOut ? end - 1 : end, high + 1);
    if (top < bottom) draw(segment.colour, segment.column, top, segment.column, bottom);
    if (curvesOut && shows(end - 1)) draw(segment.colour, segment.column, end - 1, segment.to, end);
  }

  const dots: Dot[] = [];
  const arrows: Arrow[] = [];
  for (let index = first; index < last; index++) {
    const commit = row(index);
    if (!commit) continue;
    columns = Math.max(columns, commit.node + 1);
    const at = { x: x(commit.node), y: y(index), colour: commit.colour };
    dots.push({
      ...at,
      head: commit.labels.some((label) => label.kind === "head" || label.kind === "currentBranch"),
      selected: commit.id === selected,
      initials: commit.merged.length > 0 ? null : initialsOf(commit.author),
      avatar: avatarOf(commit.author),
      email: commit.email,
    });
    if (commit.farParents.length > 0) arrows.push({ ...at, direction: 1 });
    if (commit.farChildren.length > 0) arrows.push({ ...at, direction: -1 });
  }

  // Each stash in a column of its own, right of every lane on screen, so it never sits on one.
  const stashes: StashMark[] = [];
  let widest = columns;
  for (let index = first; index < last; index++) {
    const commit = row(index);
    const made = commit && stashesOn.get(commit.id);
    if (!commit || !made) continue;
    made.forEach((id, n) => {
      stashes.push({
        id,
        x: x(columns + n),
        y: y(index),
        fromX: x(commit.node),
        colour: commit.colour,
        selected: id === selectedStash,
      });
      widest = Math.max(widest, columns + n + 1);
    });
  }
  return { lines, dots, arrows, stashes, columns: widest };
}

/** The Theme's colours the graph is drawn in, as the canvas takes them. */
export interface GraphColours {
  /** `--lane-0` to `--lane-7`. */
  lanes: string[];
  /** What a dot is outlined in, so it stands clear of the lines through it. */
  surface: string;
  /** `HEAD`'s ring. */
  text: string;
  /** The selected commit's ring. */
  focus: string;
}

/** A `#rrggbb` colour's relative luminance, as WCAG 2.2 has it, or `null` if it isn't one. */
function luminanceOf(colour: string): number | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour.trim())?.[1];
  if (hex === undefined) return null;
  const channel = (at: number) => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/**
 * Whichever of the Theme's text and surface colours stands out more on an
 * avatar's `background`, for its initials: at least 4.5:1 on every lane
 * colour, in both Themes (`graphDrawing.test.ts`).
 */
export function initialsColour(background: string, { text, surface }: Pick<GraphColours, "text" | "surface">): string {
  const on = luminanceOf(background);
  const [a, b] = [luminanceOf(text), luminanceOf(surface)];
  if (on === null || a === null || b === null) return text;
  const contrast = (other: number) => (Math.max(on, other) + 0.05) / (Math.min(on, other) + 0.05);
  return contrast(a) >= contrast(b) ? text : surface;
}

/** What `paint` needs of a canvas's 2D context. */
export type Painter = Pick<
  CanvasRenderingContext2D,
  | "clearRect"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "bezierCurveTo"
  | "arc"
  | "stroke"
  | "fill"
  | "lineWidth"
  | "lineCap"
  | "strokeStyle"
  | "fillStyle"
  | "fillText"
  | "font"
  | "textAlign"
  | "textBaseline"
  | "setLineDash"
  | "strokeRect"
  | "save"
  | "restore"
  | "clip"
  | "drawImage"
>;

/**
 * Paints `scene` on a canvas `width` by `height`, in its CSS pixels, `lane`
 * apart: each colour's lines in one path, then the arrows, then the stashes,
 * then the dots: each author's avatar, ringed in its lane's colour, with
 * their initials on it, and a merge's small plain dot.
 */
export function paint(
  context: Painter,
  scene: Scene,
  colours: GraphColours,
  {
    width,
    height,
    lane,
    picture,
  }: {
    width: number;
    height: number;
    lane: number;
    /** An author's picture, by email, to draw in place of their initials, if it's shown and has loaded. */
    picture?: (email: string) => CanvasImageSource | null;
  },
): void {
  const colour = (n: number) => colours.lanes[n % LANE_COLOURS] ?? colours.text;
  context.clearRect(0, 0, width, height);
  context.lineCap = "round";
  context.lineWidth = Math.max(1.5, lane / 8);

  for (const [n, strokes] of scene.lines) {
    context.beginPath();
    for (const { x0, y0, x1, y1 } of strokes) {
      context.moveTo(x0, y0);
      if (x0 === x1) {
        context.lineTo(x1, y1);
      } else {
        const middle = (y0 + y1) / 2;
        context.bezierCurveTo(x0, middle, x1, middle, x1, y1);
      }
    }
    context.strokeStyle = colour(n);
    context.stroke();
  }

  const radius = lane / 4;
  for (const { x, y, direction, colour: n } of scene.arrows) {
    const tip = y + direction * lane * 1.25;
    const head = radius * 1.25;
    context.beginPath();
    context.moveTo(x, y + direction * radius);
    context.lineTo(x, tip);
    context.moveTo(x - head, tip - direction * head);
    context.lineTo(x, tip);
    context.lineTo(x + head, tip - direction * head);
    context.strokeStyle = colour(n);
    context.stroke();
  }

  // Dotted, and joined to the commit they were made on by a dotted line.
  const side = lane * 0.7;
  for (const { x, y, fromX, colour: n, selected } of scene.stashes) {
    context.setLineDash([3, 2]);
    context.beginPath();
    context.moveTo(fromX, y);
    context.lineTo(x - side / 2, y);
    context.strokeStyle = colour(n);
    context.stroke();
    context.strokeRect(x - side / 2, y - side / 2, side, side);
    context.setLineDash([]);
    if (selected) ring(context, x, y, side * 0.75 + lane / 8, colours.focus);
  }

  const avatar = lane * 0.4;
  const merge = lane / 5;
  context.font = `600 ${Math.round(lane * 0.36)}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const { x, y, colour: n, head, selected, initials, avatar: face, email } of scene.dots) {
    const size = initials === null ? merge : avatar;
    if (selected) ring(context, x, y, size + lane / 5, colours.focus);
    if (head) ring(context, x, y, size + lane / 10, colours.text);
    context.beginPath();
    context.arc(x, y, size, 0, Math.PI * 2);
    const fill = initials === null ? colour(n) : colour(face);
    context.fillStyle = fill;
    context.fill();
    // The lane's colour rings an avatar; the surface outlines a merge's dot, clear of the lines through it.
    context.lineWidth = initials === null ? Math.max(1, lane / 16) : Math.max(1.5, lane / 10);
    context.strokeStyle = initials === null ? colours.surface : colour(n);
    context.stroke();
    context.lineWidth = Math.max(1.5, lane / 8);
    const photo = initials === null ? null : (picture?.(email) ?? null);
    if (photo !== null) {
      // The picture, clipped to the avatar, inside its lane's ring.
      context.save();
      context.beginPath();
      context.arc(x, y, size - context.lineWidth / 2, 0, Math.PI * 2);
      context.clip();
      context.drawImage(photo, x - size, y - size, size * 2, size * 2);
      context.restore();
    } else if (initials !== null) {
      context.fillStyle = initialsColour(fill, colours);
      context.fillText(initials, x, y + 0.5);
    }
  }
}

function ring(context: Painter, x: number, y: number, radius: number, colour: string) {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.strokeStyle = colour;
  context.stroke();
}
