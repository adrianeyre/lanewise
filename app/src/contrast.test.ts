import { describe, expect, test } from "vitest";

import {
  colourIn,
  contrast,
  type Declaration,
  declarations,
  difference,
  PALETTE_NAMES,
  THEME_SELECTORS,
  THEMES,
  uiSources,
} from "./test/styles";

// WCAG 2.2 AA, computed from the Theme's tokens in `styles.css`, in both
// themes: 4.5:1 for text (1.4.3), and 3:1 for borders, icons and the focus
// outline (1.4.11), on each background they are drawn on. A background such
// as `--focus 6% --surface` is the `color-mix` a rule draws. The Diff
// Widget's lines and syntax colours are checked in `diff/contrast.test.ts`.

const TEXT = 4.5;
const NON_TEXT = 3;

/** The backgrounds a hovered, chosen or selected row is drawn in. */
const HIGHLIGHTS = ["--focus 6% --surface", "--focus 14% --surface"];

const CHANGES = ["--added", "--modified", "--deleted", "--renamed", "--untracked", "--conflicted"];

/** The Commit graph's lane colours, `--lane-0` to `--lane-7`. */
const LANES = Array.from({ length: 8 }, (_, n) => `--lane-${n}`);

/** How far apart any two lane colours are, in CIE76 ΔE: plainly different, side by side. */
const LANES_APART = 20;

/** [foreground, background, minimum] */
const PAIRS: [string, string, number][] = [
  // Text, muted text, links and problems, on the page, on a surface, and on the palette's gradient at either end.
  ...["--text", "--muted", "--link", "--problem"].flatMap((text) =>
    ["--background", "--surface", "--chrome-start", "--chrome-end"].map((on): [string, string, number] => [text, on, TEXT]),
  ),
  // An avatar's initials, in the surface colour on their lane colour.
  ...LANES.map((lane): [string, string, number] => ["--surface", lane, TEXT]),
  // Controls' borders and the focus outline on the gradient.
  ...["--border", "--focus"].flatMap((edge) =>
    ["--chrome-start", "--chrome-end"].map((on): [string, string, number] => [edge, on, NON_TEXT]),
  ),
  // A change's label and icon, and a Label's name, which is drawn in its colour on a surface.
  ...CHANGES.map((change): [string, string, number] => [change, "--surface", TEXT]),
  // A row in the Commit graph, the Recent Repositories or Commit details, hovered or selected.
  ...["--text", "--muted", "--problem"].flatMap((text) =>
    HIGHLIGHTS.map((on): [string, string, number] => [text, on, TEXT]),
  ),
  // A Grid menu item and a Tab's close button, hovered.
  ["--text", "--text 8% --surface", TEXT],
  ["--muted", "--text 8% --surface", TEXT],
  ["--text", "--text 10% --background", TEXT],
  ["--text", "--text 10% --surface", TEXT],
  // A Pinned Widget's Pin toggle: its icon and border.
  ["--focus", "--focus 12% --surface", NON_TEXT],
  // The Commit graph's lanes and dots, beside rows that may be hovered or selected.
  ...LANES.flatMap((lane) =>
    ["--surface", ...HIGHLIGHTS].map((on): [string, string, number] => [lane, on, NON_TEXT]),
  ),
  // Borders of controls, Widgets and dialogs.
  ["--border", "--background", NON_TEXT],
  ["--border", "--surface", NON_TEXT],
  ["--problem", "--surface", NON_TEXT],
  ["--added", "--background", NON_TEXT],
  // The focus outline, and the bar that marks a selected row or Tab, wherever it is drawn.
  ...["--background", "--surface", ...HIGHLIGHTS].map((on): [string, string, number] => ["--focus", on, NON_TEXT]),
];

describe.each([...THEMES])("the %s theme", (_, theme) => {
  test.each(PAIRS)("%s on %s meets %s:1", (foreground, background, minimum) => {
    const ratio = contrast(colourIn(theme, foreground), colourIn(theme, background));
    expect(Math.round(ratio * 100) / 100).toBeGreaterThanOrEqual(minimum);
  });
});

describe.each([...THEMES])("the %s theme's lanes", (_, theme) => {
  test.each(LANES.flatMap((a, n) => LANES.slice(n + 1).map((b) => [a, b])))("%s and %s are apart", (a, b) => {
    expect(difference(colourIn(theme, a), colourIn(theme, b))).toBeGreaterThanOrEqual(LANES_APART);
  });
});

test("each theme sets every colour token the other does", () => {
  const [light, dark] = [THEMES.get("light")!, THEMES.get("dark")!];
  expect(light.size).toBeGreaterThan(0);
  expect([...dark.keys()].toSorted()).toEqual([...light.keys()].toSorted());
});

// Every colour comes from the Theme's tokens.

const COLOUR_PROPERTY =
  /^(color|background(-color|-image)?|border(-(top|right|bottom|left|block|inline))?(-color)?|outline(-color)?|box-shadow|text-shadow|text-decoration(-color)?|fill|stroke|caret-color|accent-color|column-rule(-color)?)$/;

/** Words a colour value may have besides tokens: widths, styles and the parts of a mix or a gradient. */
const WORDS = new Set([
  "solid",
  "dashed",
  "dotted",
  "double",
  "none",
  "inset",
  "transparent",
  "currentcolor",
  "inherit",
  "important",
  "color-mix",
  "in",
  "srgb",
  "linear-gradient",
  "to",
  "top",
  "right",
  "bottom",
  "left",
  "underline",
]);

/** The OS's own colours, which only forced colours may use (CSS Color 4 §6.2). */
const SYSTEM_COLOURS = new Set([
  "accentcolor",
  "accentcolortext",
  "buttonborder",
  "buttonface",
  "buttontext",
  "canvas",
  "canvastext",
  "field",
  "fieldtext",
  "graytext",
  "highlight",
  "highlighttext",
  "linktext",
  "mark",
  "marktext",
  "visitedtext",
]);

/** What in `value` is a colour that isn't a token. */
function strayColours({ value, within }: Declaration): string[] {
  const forced = within.some((rule) => rule.startsWith("@media") && rule.includes("forced-colors: active"));
  const rest = value
    .replaceAll(/var\(--[\w-]+\)/g, " ")
    .replaceAll(/-?\d*\.?\d+(px|rem|em|%|deg|ms|s|dvh|vw|vh)?\b/g, " ")
    .toLowerCase();
  const hex = rest.match(/#[0-9a-f]{3,8}\b/g) ?? [];
  const words = (rest.replaceAll(/#[0-9a-f]{3,8}\b/g, " ").match(/[a-z][\w-]*/g) ?? []).filter(
    (word) => !WORDS.has(word) && !(forced && SYSTEM_COLOURS.has(word)),
  );
  return [...hex, ...words];
}

test("every colour in styles.css outside the Theme's tokens is a token, or the OS's own under forced colours", () => {
  // The Theme's own blocks, and each palette's, in both themes.
  const tokenBlocks = new Set<string>([
    ...Object.values(THEME_SELECTORS),
    ...PALETTE_NAMES.flatMap((palette) =>
      ["light", "dark"].map((theme) => `:root[data-theme="${theme}"][data-palette="${palette}"]`),
    ),
  ]);
  const stray = declarations()
    .filter(({ property, within }) =>
      property.startsWith("--") ? !tokenBlocks.has(within.at(-1) ?? "") : COLOUR_PROPERTY.test(property),
    )
    // A custom property outside them, such as a row's height, is checked only if it holds a colour.
    .filter(({ property, value }) => !property.startsWith("--") || /#|rgb|hsl|color/i.test(value))
    .filter((declaration) => strayColours(declaration).length > 0)
    .map(({ within, property, value }) => `${within.join(" ")} { ${property}: ${value} }`);
  expect(stray).toEqual([]);
});

test("the UI's own code draws no colour of its own", () => {
  const sources = uiSources();
  expect(sources.length).toBeGreaterThan(0);
  const coloured = sources.filter(({ text }) => /["'`]#[0-9a-f]{3,8}["'`]|\b(rgba?|hsla?|oklch|oklab)\(/i.test(text));
  expect(coloured.map(({ path }) => path)).toEqual([]);
});
