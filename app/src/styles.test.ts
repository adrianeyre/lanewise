import { expect, test } from "vitest";

import { declarations, uiSources } from "./test/styles";

// Reduced motion (WCAG 2.2 2.3.3, and PRD §11).

test("with reduced motion asked for, every animation, transition and smooth scroll is switched off", () => {
  const reduced = declarations().filter(({ within }) =>
    within.some((rule) => /^@media \(prefers-reduced-motion: reduce\)$/.test(rule)),
  );
  expect(reduced.every(({ within }) => within.at(-1) === "*,\n  *::before,\n  *::after")).toBe(true);
  expect(Object.fromEntries(reduced.map(({ property, value }) => [property, value]))).toEqual({
    "animation-duration": "0.01ms !important",
    "animation-iteration-count": "1 !important",
    "transition-duration": "0.01ms !important",
    "scroll-behavior": "auto !important",
  });
});

// A drag's edge scrolling, frame by frame, follows the pointer, so it isn't counted.
test("nothing animates from script, where the stylesheet couldn't stop it", () => {
  const moving = uiSources().filter(({ text }) => /behavior:\s*["']smooth["']|\.animate\(/.test(text));
  expect(moving.map(({ path }) => path)).toEqual([]);
});

// Text size (WCAG 2.2 1.4.4, and PRD §11): the UI scales with the OS's text size.

test("no text is sized in pixels or points, so it all scales with the root", () => {
  const fixed = declarations()
    .filter(({ property }) => /^(font|font-size|line-height)$/.test(property))
    .filter(({ value }) => /\d(px|pt)\b/.test(value))
    .map(({ within, property, value }) => `${within.join(" ")} { ${property}: ${value} }`);
  expect(fixed).toEqual([]);
});

test("the root keeps the font size the OS and the webview give it", () => {
  const root = declarations().filter(({ within }) =>
    within.some((rule) => rule.split(/,\s*/).some((selector) => /^(:root|html|body)(\[[^\]]*\])?$/.test(selector))),
  );
  expect(root.length).toBeGreaterThan(0);
  expect(root.filter(({ property }) => /^font(-size)?$/.test(property))).toEqual([]);
});

test("no inline style sets a text size of its own", () => {
  const sized = uiSources().filter(({ text }) => /fontSize\s*:/.test(text));
  expect(sized.map(({ path }) => path)).toEqual([]);
});

// The Conflicts page's middle (ADR 0032): Base, Ours and Theirs over the Resolution, scrolling on its own.

test("nothing in the Conflicts page's middle shrinks below what's in it, so the Three-way view can't spill under the Resolution", () => {
  const middle = declarations().filter(({ within }) =>
    /\.conflicts-three-way,|\.three-way-sides\b/.test(within.at(-1) ?? ""),
  );
  expect(middle.length).toBeGreaterThan(0);
  const shrinking = middle
    .filter(({ property, value }) => (property === "flex" && !/^\d+ 0 auto$/.test(value)) || (property === "min-height" && value === "0"))
    .map(({ within, property, value }) => `${within.at(-1)} { ${property}: ${value} }`);
  expect(shrinking).toEqual([]);
});
