import { readdirSync, readFileSync } from "node:fs";

/**
 * `styles.css`, for the tests that read it: its declarations, and the
 * Theme's tokens, each theme's colours by name, to compute contrast from.
 */
export const STYLES = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

/** The UI's own code, not its tests, by its path under `src/`: what may style the page besides `styles.css`. */
export function uiSources(): { path: string; text: string }[] {
  const src = new URL("../", import.meta.url);
  // Windows names them with `\`, so they're put in the one form the filter and a URL both take.
  return readdirSync(src, { recursive: true, encoding: "utf8" })
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) && !path.startsWith("test/"))
    .map((path) => ({ path, text: readFileSync(new URL(path, src), "utf8") }));
}

/** A declaration in `styles.css`, with the selectors and at-rules it sits in, outermost first. */
export interface Declaration {
  property: string;
  value: string;
  within: string[];
}

export function declarations(css = STYLES): Declaration[] {
  const found: Declaration[] = [];
  const within: string[] = [];
  let text = "";
  for (const character of css.replaceAll(/\/\*[\s\S]*?\*\//g, "")) {
    if (character === "{") {
      within.push(text.trim());
      text = "";
    } else if (character === ";" || character === "}") {
      const colon = text.indexOf(":");
      if (colon > 0) {
        found.push({ property: text.slice(0, colon).trim(), value: text.slice(colon + 1).trim(), within: [...within] });
      }
      text = "";
      if (character === "}") within.pop();
    } else {
      text += character;
    }
  }
  return found;
}

/** Each theme's block of tokens in `styles.css`, by its selector. */
export const THEME_SELECTORS = {
  light: ':root,\n:root[data-theme="light"]',
  dark: ':root[data-theme="dark"]',
} as const;

export type ThemeName = keyof typeof THEME_SELECTORS;

/** The colour tokens `selector`'s block declares, as `#rrggbb`. */
function tokens(selector: string): Map<string, string> {
  const start = STYLES.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`styles.css has no ${selector} block`);
  const block = STYLES.slice(start, STYLES.indexOf("}", start));
  return new Map([...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6});/gi)].map(([, name, value]) => [name!, value!]));
}

/** Each theme's tokens, by the theme's name. */
const BASE = new Map(
  Object.entries(THEME_SELECTORS).map(([name, selector]) => [name as ThemeName, tokens(selector)]),
);

/** The palettes `styles.css` has, by name, from their blocks. */
export const PALETTE_NAMES: readonly string[] = [
  ...new Set([...STYLES.matchAll(/:root\[data-theme="light"\]\[data-palette="([\w-]+)"\] \{/g)].map(([, name]) => name!)),
];

/**
 * Each theme's tokens, then each theme in each palette, as `light` or
 * `dark ocean`: the palette's tokens over the theme's own, as the page has them.
 */
export const THEMES: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map([
  ...BASE,
  ...PALETTE_NAMES.flatMap((palette) =>
    (["light", "dark"] as const).map((theme): [string, ReadonlyMap<string, string>] => [
      `${theme} ${palette}`,
      new Map([...BASE.get(theme)!, ...tokens(`:root[data-theme="${theme}"][data-palette="${palette}"]`)]),
    ]),
  ),
]);

export type Rgb = [number, number, number];

export function rgb(hex: string): Rgb {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as Rgb;
}

/** `color-mix(in srgb, a share%, b)`. */
export function mix(a: Rgb, share: number, b: Rgb): Rgb {
  return a.map((channel, n) => channel * share + b[n]! * (1 - share)) as Rgb;
}

/** WCAG 2.2's relative luminance. */
function luminance(colour: Rgb): number {
  const [r, g, b] = colour.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** A colour in CIE L*a*b*, under D65. */
function lab(colour: Rgb): Rgb {
  const [r, g, b] = colour.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  const xyz = [
    (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047,
    0.2126 * r + 0.7152 * g + 0.0722 * b,
    (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883,
  ];
  const [x, y, z] = xyz.map((t) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29)) as Rgb;
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** How different two colours look: CIE76 ΔE, the distance between them in L*a*b*. */
export function difference(a: Rgb, b: Rgb): number {
  const [la, lb] = [lab(a), lab(b)];
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

/** WCAG 2.2's contrast ratio between two colours. */
export function contrast(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [luminance(a), luminance(b)].toSorted((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * A colour in `theme`: a token such as `--surface`, or a mix of two as
 * `styles.css` writes them, such as `--focus 6% --surface` for
 * `color-mix(in srgb, var(--focus) 6%, var(--surface))`. A mix with
 * `transparent` is written with the token it is drawn over.
 */
export function colourIn(theme: ReadonlyMap<string, string>, colour: string): Rgb {
  const token = (name: string) => {
    const value = theme.get(name);
    if (value === undefined) throw new Error(`styles.css sets no ${name}`);
    return rgb(value);
  };
  const mixed = /^(--[\w-]+) (\d+)% (--[\w-]+)$/.exec(colour);
  if (mixed) return mix(token(mixed[1]!), Number(mixed[2]) / 100, token(mixed[3]!));
  return token(colour);
}
