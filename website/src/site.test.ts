import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { colourIn, contrast, declarations, THEMES } from "../../app/src/test/styles";

// The website's own stylesheet, held to what the app's is (`app/src/contrast.test.ts`
// and `styles.test.ts`): WCAG 2.2 AA contrast in both themes, colours from the
// Theme's tokens alone, and text that scales.

const SITE_CSS = readFileSync(new URL("site.css", import.meta.url), "utf8");

const TEXT = 4.5;
const NON_TEXT = 3;

/** [foreground, background, minimum], each pair `site.css` draws. */
const PAIRS: [string, string, number][] = [
  // Text, the tagline, captions and links, on the page and behind a feature.
  ...["--text", "--muted", "--link"].flatMap((text) =>
    ["--background", "--surface"].map((on): [string, string, number] => [text, on, TEXT]),
  ),
  // A download button's text, and its edge against the page.
  ["--surface", "--link", TEXT],
  ["--link", "--background", NON_TEXT],
  // Features', screenshots' and sections' borders, and the focus outline.
  ["--border", "--background", NON_TEXT],
  ["--border", "--surface", NON_TEXT],
  ["--focus", "--background", NON_TEXT],
  ["--focus", "--surface", NON_TEXT],
];

describe.each([...THEMES])("the %s theme", (_, theme) => {
  test.each(PAIRS)("%s on %s meets %s:1", (foreground, background, minimum) => {
    const ratio = contrast(colourIn(theme, foreground), colourIn(theme, background));
    expect(Math.round(ratio * 100) / 100).toBeGreaterThanOrEqual(minimum);
  });
});

const COLOUR_PROPERTY = /^(color|background(-color)?|border(-[a-z]+)*-color|border(-(top|right|bottom|left))?|outline(-color)?|box-shadow|text-decoration(-color)?|fill|stroke)$/;

test("every colour in site.css is one of the Theme's tokens", () => {
  const tokens = THEMES.get("light")!;
  const stray = declarations(SITE_CSS)
    .filter(({ property }) => COLOUR_PROPERTY.test(property))
    .filter(({ value }) => {
      const used = [...value.matchAll(/var\((--[\w-]+)\)/g)].map(([, name]) => name!);
      const rest = value.replaceAll(/var\(--[\w-]+\)/g, " ").replaceAll(/-?\d*\.?\d+(px|rem|em)?\b/g, " ");
      return used.some((name) => !tokens.has(name)) || !/^[\s]*(solid\s*|none\s*|underline\s*)*$/.test(rest);
    })
    .map(({ within, property, value }) => `${within.join(" ")} { ${property}: ${value} }`);
  expect(stray).toEqual([]);
});

test("no text in site.css is sized in pixels or points, so it all scales with the root", () => {
  const fixed = declarations(SITE_CSS)
    .filter(({ property }) => /^(font|font-size|line-height)$/.test(property))
    .filter(({ value }) => /\d(px|pt)\b/.test(value));
  expect(fixed).toEqual([]);
});

// The app's stylesheet switches every animation and transition off when reduced motion is asked for.
test("site.css moves nothing of its own", () => {
  expect(declarations(SITE_CSS).filter(({ property }) => /^(animation|transition|scroll-behavior)/.test(property))).toEqual([]);
});

test("every link and button is at least 24 px high to hit (WCAG 2.5.8)", () => {
  const heights = new Map(
    declarations(SITE_CSS)
      .filter(({ property }) => property === "min-height")
      .flatMap(({ within, value }) => within.at(-1)!.split(/,\s*/).map((selector) => [selector, value] as const)),
  );
  expect(heights.get(".site-brand")).toBe("2.75rem");
  expect(heights.get(".site-nav a")).toBe("1.5rem");
});
