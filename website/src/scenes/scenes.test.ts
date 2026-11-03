import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { colourIn, contrast, declarations, THEMES } from "../../../app/src/test/styles";

// The scenes' stylesheet, held as the website's own is (`site.test.ts`):
// every colour one of the Theme's tokens, and WCAG 2.2 AA contrast in both
// themes for each pair it draws words or edges in.

const SCENES_CSS = readFileSync(new URL("scenes.css", import.meta.url), "utf8");

const TEXT = 4.5;
const NON_TEXT = 3;

/** [foreground, background, minimum], each pair `scenes.css` draws words or an edge in. */
const PAIRS: [string, string, number][] = [
  // Words on a window, a card or a menu, and on the lines of a diff or a Conflict Hunk.
  ...[
    "--surface",
    "--diff-added-background",
    "--diff-removed-background",
    "--conflict-marker-background",
    "--conflict-ours-background",
    "--conflict-theirs-background",
  ].flatMap((on): [string, string, number][] => [
    ["--text", on, TEXT],
    ["--muted", on, TEXT],
  ]),
  // A Label, a Confidence and a saved key, in their colours.
  ["--link", "--surface", TEXT],
  ["--added", "--surface", TEXT],
  ["--modified", "--surface", TEXT],
  ["--added", "--diff-added-background", TEXT],
  ["--deleted", "--diff-removed-background", TEXT],
  // A chosen button and menu item, and Accepted.
  ["--surface", "--link", TEXT],
  ["--surface", "--added", TEXT],
  // A window's edge on the scene's ground.
  ["--border", "--background", NON_TEXT],
];

describe.each([...THEMES])("the %s theme", (_, theme) => {
  test.each(PAIRS)("%s on %s meets %s:1", (foreground, background, minimum) => {
    const ratio = contrast(colourIn(theme, foreground), colourIn(theme, background));
    expect(Math.round(ratio * 100) / 100).toBeGreaterThanOrEqual(minimum);
  });
});

const COLOUR_PROPERTY =
  /^(color|background(-color)?|border(-[a-z]+)*-color|border(-(top|right|bottom|left))?|outline(-color)?|box-shadow|fill|stroke)$/;

test("every colour in scenes.css is one of the Theme's tokens, or its own name for one", () => {
  const tokens = THEMES.get("light")!;
  const own = new Map(
    declarations(SCENES_CSS)
      .filter(({ property }) => property.startsWith("--scene-"))
      .map(({ property, value }) => [property, value] as const),
  );
  const known = (name: string) => tokens.has(name) || own.has(name) || name.startsWith("--graph-");
  const stray = declarations(SCENES_CSS)
    .filter(({ property }) => COLOUR_PROPERTY.test(property) || property.startsWith("--scene-"))
    .filter(({ value }) => {
      const used = [...value.matchAll(/var\((--[\w-]+)\)/g)].map(([, name]) => name!);
      const rest = value
        .replaceAll(/var\(--[\w-]+\)/g, " ")
        .replaceAll(/-?\d*\.?\d+(px|rem|em)?\b/g, " ")
        .replaceAll(",", " ");
      return used.some((name) => !known(name)) || !/^\s*(solid\s*|none\s*)*$/.test(rest);
    })
    .map(({ within, property, value }) => `${within.join(" ")} { ${property}: ${value} }`);
  expect(stray).toEqual([]);
});

test("each scene's box is the shape of its design before it's drawn, so the page doesn't move as it is", () => {
  const ratios = declarations(SCENES_CSS)
    .filter(({ property }) => property === "aspect-ratio")
    .map(({ within, value }) => `${within.at(-1)}: ${value}`);
  expect(ratios).toEqual(
    expect.arrayContaining([
      ".scene-hero .scene-frame: 1040 / 470",
      ".scene-hero .scene-frame: 358 / 500",
      ".scene-graph .scene-frame: 660 / 290",
      ".scene-stash .scene-frame,\n.scene-providers .scene-frame: 340 / 280",
      ".scene-diff .scene-frame: 660 / 250",
    ]),
  );
});
