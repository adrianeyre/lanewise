import { describe, expect, test } from "vitest";

import type { GraphRow } from "../commands/api";
import { canvasRecorder } from "../test/canvas";
import { graphRow } from "../test/fakePlatform";
import {
  avatarOf,
  buildScene,
  type GraphColours,
  initialsColour,
  initialsOf,
  paint,
  type SceneInput,
  type Segment,
  segmentsOf,
} from "./graphDrawing";

const LANE = 16;
const ROW = 50;

/** A segment, as `[start, length, from, column, to, colour]`. */
const segment = (
  id: number,
  [start, length, from, column, to, colour]: [number, number, number, number, number, number],
): Segment => ({ id, start, length, from, column, to, colour });

function scene(rows: GraphRow[], segments: Segment[], input: Partial<SceneInput> = {}) {
  return buildScene({
    row: (index) => rows[index],
    segments,
    first: 0,
    last: rows.length,
    rowHeight: ROW,
    lane: LANE,
    scrollTop: 0,
    selected: null,
    ...input,
  });
}

/** Column `n`'s x, and row `n`'s middle's y, at the test's sizes. */
const x = (column: number) => (column + 1) * LANE;
const y = (row: number) => row * ROW + ROW / 2;

test("a window's flat numbers are seven to a segment", () => {
  expect(segmentsOf([4, 10, 3, 0, 1, 1, 5, 5, 11, 1, 1, 1, 0, 2])).toEqual([
    { id: 4, start: 10, length: 3, from: 0, column: 1, to: 1, colour: 5 },
    { id: 5, start: 11, length: 1, from: 1, column: 1, to: 0, colour: 2 },
  ]);
});

describe("the scene", () => {
  // A merge at 0 of a branch, 1 and 2, forked from 3 on main.
  const rows = [
    graphRow(0, { labels: [{ kind: "currentBranch", name: "main" }] }),
    graphRow(1, { node: 1, colour: 1 }),
    graphRow(2, { node: 1, colour: 1 }),
    graphRow(3),
  ];
  const segments = [
    segment(0, [0, 3, 0, 0, 0, 0]),
    segment(1, [0, 1, 0, 1, 1, 1]),
    segment(2, [1, 1, 1, 1, 1, 1]),
    segment(3, [2, 1, 1, 1, 0, 1]),
  ];

  test("draws a lane straight down its column, curving in from the merge and out to the fork point", () => {
    const drawn = scene(rows, segments);

    expect(drawn.lines.get(0)).toEqual([{ x0: x(0), y0: y(0), x1: x(0), y1: y(3) }]);
    expect(drawn.lines.get(1)).toEqual([
      { x0: x(0), y0: y(0), x1: x(1), y1: y(1) },
      { x0: x(1), y0: y(1), x1: x(1), y1: y(2) },
      { x0: x(1), y0: y(2), x1: x(0), y1: y(3) },
    ]);
    expect(drawn.columns).toBe(2);
  });

  test("draws each commit's dot in its lane's colour, with its author's avatar, marking HEAD and the selected commit", () => {
    const drawn = scene(rows, segments, { selected: rows[2]!.id });
    const ada = { initials: "AL", avatar: avatarOf("Ada Lovelace"), email: "ada@example.com" };

    expect(drawn.dots).toEqual([
      { x: x(0), y: y(0), colour: 0, head: true, selected: false, ...ada },
      { x: x(1), y: y(1), colour: 1, head: false, selected: false, ...ada },
      { x: x(1), y: y(2), colour: 1, head: false, selected: true, ...ada },
      { x: x(0), y: y(3), colour: 0, head: false, selected: false, ...ada },
    ]);
  });

  test("draws a merge as a small plain dot, with no avatar", () => {
    const merge = graphRow(0, { merged: ["feature"] });

    expect(scene([merge], []).dots[0]).toMatchObject({ initials: null });
  });

  test("draws each stash as a square in a column of its own, right of every lane, beside the commit it was made on", () => {
    const stashes = new Map([[rows[3]!.id, ["stash-a", "stash-b"]]]);

    const drawn = scene(rows, segments, { stashes, selectedStash: "stash-b" });

    expect(drawn.stashes).toEqual([
      { id: "stash-a", x: x(2), y: y(3), fromX: x(0), colour: 0, selected: false },
      { id: "stash-b", x: x(3), y: y(3), fromX: x(0), colour: 0, selected: true },
    ]);
    // The graph is wide enough for them.
    expect(drawn.columns).toBe(4);
  });

  test("draws only the rows on screen, and the part of a long lane between them", () => {
    const long = [segment(0, [0, 1000, 0, 2, 0, 3])];
    const many = Array.from({ length: 1001 }, (_, n) => graphRow(n));

    const drawn = scene(many, long, { first: 400, last: 410, scrollTop: 400 * ROW });

    expect(drawn.dots).toHaveLength(10);
    expect(drawn.dots[0]!.y).toBe(ROW / 2);
    expect(drawn.lines.get(3)).toEqual([{ x0: x(2), y0: y(-1), x1: x(2), y1: y(10) }]);
    expect(drawn.columns).toBe(3);
  });

  test("leaves out lines that don't reach the rows on screen, and rows not read yet", () => {
    const drawn = scene([], segments, { row: () => undefined, first: 10, last: 20 });

    expect(drawn.lines.size).toBe(0);
    expect(drawn.dots).toEqual([]);
    expect(drawn.columns).toBe(0);
  });

  test("gives a cut edge a short arrow at each end", () => {
    const cut = [graphRow(0, { farParents: [300] }), graphRow(1, { farChildren: [0], node: 2, colour: 4 })];

    expect(scene(cut, []).arrows).toEqual([
      { x: x(0), y: y(0), direction: 1, colour: 0 },
      { x: x(2), y: y(1), direction: -1, colour: 4 },
    ]);
  });
});

const colours: GraphColours = {
  lanes: ["lane0", "lane1", "lane2", "lane3", "lane4", "lane5", "lane6", "lane7"],
  surface: "surface",
  text: "text",
  focus: "focus",
};

test("paints each colour's lines in one path, curving where a line changes column", () => {
  const context = canvasRecorder();
  const drawn = scene(
    [graphRow(0), graphRow(1, { node: 1, colour: 1 }), graphRow(2)],
    [segment(0, [0, 2, 0, 0, 0, 0]), segment(1, [0, 1, 0, 1, 1, 1]), segment(2, [1, 1, 1, 1, 0, 1])],
  );

  paint(context, drawn, colours, { width: 100, height: 150, lane: LANE });

  const lines = context.log.slice(0, context.log.indexOf("stroke lane1") + 1);
  expect(lines).toEqual([
    "clear",
    "begin",
    `move ${x(0)},${y(0)}`,
    `line ${x(0)},${y(2)}`,
    "stroke lane0",
    "begin",
    `move ${x(0)},${y(0)}`,
    `curve ${x(1)},${y(1)}`,
    `move ${x(1)},${y(1)}`,
    `curve ${x(0)},${y(2)}`,
    "stroke lane1",
  ]);
});

const lightColours: GraphColours = {
  ...colours,
  text: "#16181d",
  surface: "#ffffff",
  lanes: ["#0969da", "#cf222e", "#1a7f37", "#8250df", "#bc4c00", "#0e7c86", "#bf3989", "#7d6608"],
};

test("paints an avatar over its lines, ringed in its lane's colour, with its author's initials, and HEAD's and the selection's rings", () => {
  const context = canvasRecorder();
  const head = graphRow(0, { labels: [{ kind: "head", name: "HEAD" }], colour: 9, author: "Grace Hopper" });
  const face = lightColours.lanes[avatarOf("Grace Hopper")]!;

  paint(context, scene([head], [], { selected: head.id }), lightColours, { width: 100, height: 50, lane: LANE });

  expect(context.log).toEqual([
    "clear",
    "begin",
    `arc ${x(0)},${y(0)} r${LANE * 0.4 + LANE / 5}`,
    "stroke focus",
    "begin",
    `arc ${x(0)},${y(0)} r${LANE * 0.4 + LANE / 10}`,
    `stroke ${lightColours.text}`,
    "begin",
    `arc ${x(0)},${y(0)} r${LANE * 0.4}`,
    `fill ${face}`,
    // Colours wrap round the Theme's eight.
    `stroke ${lightColours.lanes[1]}`,
    `text GH ${x(0)},${y(0) + 0.5} ${initialsColour(face, lightColours)}`,
  ]);
});

test("paints a merge's plain dot, outlined in the surface", () => {
  const context = canvasRecorder();

  paint(context, scene([graphRow(0, { merged: ["feature"] })], []), colours, { width: 100, height: 50, lane: LANE });

  expect(context.log).toEqual(["clear", "begin", `arc ${x(0)},${y(0)} r${LANE / 5}`, "fill lane0", "stroke surface"]);
});

test("paints a stash as a dotted square, joined to its commit by a dotted line", () => {
  const context = canvasRecorder();
  const stashes = new Map([[graphRow(0).id, ["stash"]]]);

  paint(context, scene([graphRow(0, { merged: ["x"] })], [], { stashes }), colours, { width: 100, height: 50, lane: LANE });

  const side = LANE * 0.7;
  expect(context.log.slice(1, 8)).toEqual([
    "dash 3,2",
    "begin",
    `move ${x(0)},${y(0)}`,
    `line ${x(1) - side / 2},${y(0)}`,
    "stroke lane0",
    `rect ${x(1) - side / 2},${y(0) - side / 2} ${side}x${side} lane0`,
    "dash ",
  ]);
});

test("an author's initials are their first and last names' first letters, in capitals", () => {
  expect(initialsOf("Ada Lovelace")).toBe("AL");
  expect(initialsOf("grace brewster murray hopper")).toBe("GH");
  expect(initialsOf("linus")).toBe("L");
  expect(initialsOf("  ")).toBe("?");
  expect(initialsOf("Émile Zola")).toBe("ÉZ");
});

test("an author's avatar colour is the same each time, one of the Theme's eight", () => {
  expect(avatarOf("Ada Lovelace")).toBe(avatarOf("Ada Lovelace"));
  expect(avatarOf("Ada Lovelace")).toBeGreaterThanOrEqual(0);
  expect(avatarOf("Ada Lovelace")).toBeLessThan(8);
});

/** A `#rrggbb` colour's relative luminance, as WCAG 2.2 has it. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

test("initials are in the Theme's text or surface colour, whichever stands out more, at least 4.5:1 on every lane colour of both Themes", () => {
  const themes = [
    { text: "#16181d", surface: "#ffffff", lanes: lightColours.lanes },
    {
      text: "#e8eaef",
      surface: "#1b1e24",
      lanes: ["#58a6ff", "#ff7b72", "#56d364", "#bc8cff", "#f0883e", "#39c5cf", "#f778ba", "#d4b33c"],
    },
  ];
  const tooLow = themes.flatMap((theme) =>
    theme.lanes.filter((lane) => {
      const [light, dark] = [luminance(lane), luminance(initialsColour(lane, theme))].toSorted((a, b) => b - a);
      return (light! + 0.05) / (dark! + 0.05) < 4.5;
    }),
  );
  expect(tooLow).toEqual([]);
});
