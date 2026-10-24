import { expect, test } from "vitest";

import { clampPlace, cornerPlace, DEFAULT_PLACE, parsePlace } from "./activityPlace";

const SIZE = { width: 352, height: 96 };
const WINDOW = { width: 1280, height: 800 };

test("a place is kept wholly inside the window", () => {
  expect(clampPlace({ right: 200, bottom: 300 }, SIZE, WINDOW)).toEqual({ right: 200, bottom: 300 });
  // Past the left and top edges, it stops at them.
  expect(clampPlace({ right: 5000, bottom: 5000 }, SIZE, WINDOW)).toEqual({ right: 928, bottom: 704 });
  // Past the right and bottom edges too.
  expect(clampPlace({ right: -40, bottom: -10 }, SIZE, WINDOW)).toEqual({ right: 0, bottom: 0 });
  // A window smaller than the indicator puts it against the right and bottom.
  expect(clampPlace({ right: 100, bottom: 100 }, SIZE, { width: 300, height: 80 })).toEqual({ right: 0, bottom: 0 });
});

test("each corner is a margin in from the window's edges, the bottom right where it starts", () => {
  expect(cornerPlace("bottomRight", SIZE, WINDOW)).toEqual(DEFAULT_PLACE);
  expect(cornerPlace("bottomLeft", SIZE, WINDOW)).toEqual({ right: 912, bottom: DEFAULT_PLACE.bottom });
  expect(cornerPlace("topLeft", SIZE, WINDOW)).toEqual({ right: 912, bottom: 688 });
  expect(cornerPlace("topRight", SIZE, WINDOW)).toEqual({ right: DEFAULT_PLACE.right, bottom: 688 });
});

test("only a place that was kept whole is read back", () => {
  expect(parsePlace(JSON.stringify({ right: 40.4, bottom: 120 }))).toEqual({ right: 40, bottom: 120 });
  expect(parsePlace(null)).toBeNull();
  expect(parsePlace("not json")).toBeNull();
  expect(parsePlace(JSON.stringify({ right: 40 }))).toBeNull();
  expect(parsePlace(JSON.stringify({ right: -1, bottom: 10 }))).toBeNull();
  expect(parsePlace(JSON.stringify({ right: "40", bottom: 10 }))).toBeNull();
});
