import { existsSync, readFileSync } from "node:fs";

import { JSDOM } from "jsdom";
import { describe, expect, test } from "vitest";

import { THEMES } from "../../app/src/test/styles";
import config from "../vite.config";
import { SCREENSHOTS } from "./screenshots";

// The page's head, and the files it names: what search engines, link
// previews, browsers and devices read of the website (PRD §12.1).

/** Where GitHub Pages serves the website: this repository's custom domain, at its root. */
const SITE = "https://lanewise.adrianeyre.co.uk/";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const head = new JSDOM(HTML).window.document;

const publicFile = (path: string) => new URL(`../public/${path}`, import.meta.url);
const read = (path: string) => readFileSync(publicFile(path));

/** What a site-root path such as `/favicon.ico`, which the build puts under the base, names in `public/`. */
const local = (href: string) => href.replace(/^\//, "").replace(SITE, "");

function meta(key: string): string | null {
  const element = head.querySelector(`meta[name="${key}"], meta[property="${key}"]`);
  return element?.getAttribute("content") ?? null;
}

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(bytes: Buffer): [number, number] {
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

/** A lossless WebP's width and height, from its VP8L header. */
function webpSize(bytes: Buffer): [number, number] {
  expect(bytes.subarray(8, 16).toString("latin1")).toBe("WEBPVP8L");
  const bits = bytes.readUInt32LE(21);
  return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
}

/** The sizes an ICO holds, from its directory. */
function icoSizes(bytes: Buffer): string[] {
  expect(bytes.readUInt16LE(2)).toBe(1);
  return Array.from({ length: bytes.readUInt16LE(4) }, (_, n) => {
    const [width, height] = [bytes[6 + n * 16]!, bytes[7 + n * 16]!];
    return `${width || 256}x${height || 256}`;
  });
}

test("the page has a title, a description, keywords and its author", () => {
  expect(head.title).toBe("Lanewise: a free Git client with a visual commit graph");
  expect(head.documentElement.lang).toBe("en-GB");
  // Search engines show about 160 characters of a description.
  expect(meta("description")?.length).toBeGreaterThan(70);
  expect(meta("description")!.length).toBeLessThanOrEqual(200);
  expect(meta("keywords")).toMatch(/^Lanewise, Git client/);
  expect(meta("author")).toBe(JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).author);
  expect(meta("viewport")).toBe("width=device-width, initial-scale=1");
});

test("search engines may index it, at its one canonical URL", () => {
  expect(head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(SITE);
  expect(meta("robots")).toMatch(/^index, follow\b/);
});

test("its assets are built for the path GitHub Pages serves it at", () => {
  // Built anywhere else, the stylesheet and script aren't found there, and the page is only its text.
  expect(config.base).toBe(new URL(SITE).pathname);
});

test("a shared link previews with Open Graph and a Twitter card, and a 1200 by 630 image described in words", () => {
  expect(meta("og:type")).toBe("website");
  expect(meta("og:url")).toBe(SITE);
  expect(meta("og:site_name")).toBe("Lanewise");
  expect(meta("og:title")).toBe(head.title);
  expect(meta("og:image")).toBe(`${SITE}og-image.png`);
  expect([meta("og:image:width"), meta("og:image:height")]).toEqual(["1200", "630"]);
  expect(pngSize(read(local(meta("og:image")!)))).toEqual([1200, 630]);
  expect(meta("og:image:alt")).toMatch(/^The Lanewise logo and name/);

  expect(meta("twitter:card")).toBe("summary_large_image");
  expect(meta("twitter:title")).toBe(meta("og:title"));
  expect(meta("twitter:description")).toBe(meta("og:description"));
  expect(meta("twitter:image")).toBe(meta("og:image"));
  expect(meta("twitter:image:alt")).toBe(meta("og:image:alt"));
});

/** The sizes of the icon in `public/` at `path`, as a `sizes` attribute writes them: `any` for an SVG. */
function iconSizes(path: string): string {
  const bytes = read(path);
  if (path.endsWith(".png")) return pngSize(bytes).join("x");
  if (path.endsWith(".ico")) return icoSizes(bytes).join(" ");
  expect(bytes.toString("utf8")).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  return "any";
}

test("every icon the head names is in public/, at the size it says", () => {
  const icons = [...head.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')].map((link) => ({
    href: link.getAttribute("href")!,
    sizes: link.getAttribute("sizes") ?? "any",
  }));
  expect(icons).toEqual([
    { href: "/favicon.ico", sizes: "48x48" },
    { href: "/favicon.svg", sizes: "any" },
    { href: "/favicon-32.png", sizes: "32x32" },
    { href: "/favicon-16.png", sizes: "16x16" },
    { href: "/apple-touch-icon.png", sizes: "180x180" },
  ]);
  expect(icons.map(({ href }) => iconSizes(local(href)))).toEqual([
    "16x16 32x32 48x48",
    "any",
    "32x32",
    "16x16",
    "180x180",
  ]);
});

test("the web app manifest names the site, and icons that are there, at their sizes, one of them maskable", () => {
  const href = head.querySelector('link[rel="manifest"]')?.getAttribute("href");
  expect(href).toBe("/site.webmanifest");
  const manifest = JSON.parse(read(local(href!)).toString("utf8")) as {
    name: string;
    start_url: string;
    scope: string;
    theme_color: string;
    background_color: string;
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
  };
  expect(manifest).toMatchObject({ name: "Lanewise", start_url: "./", scope: "./" });
  expect([manifest.theme_color, manifest.background_color]).toEqual([
    THEMES.get("light")!.get("--background"),
    THEMES.get("light")!.get("--background"),
  ]);
  expect(manifest.icons.filter(({ src }) => !existsSync(publicFile(src)))).toEqual([]);
  expect(manifest.icons.map(({ src }) => iconSizes(src))).toEqual(manifest.icons.map(({ sizes }) => sizes));
  expect(manifest.icons.map(({ sizes }) => sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  expect(manifest.icons.filter(({ purpose }) => purpose === "maskable")).toHaveLength(1);
});

test("the browser's own colours follow the theme: theme-color is each theme's background", () => {
  expect(meta("color-scheme")).toBe("light dark");
  const colours = [...head.querySelectorAll('meta[name="theme-color"]')].map((element) => [
    element.getAttribute("media"),
    element.getAttribute("content"),
  ]);
  expect(colours).toEqual([
    ["(prefers-color-scheme: light)", THEMES.get("light")!.get("--background")],
    ["(prefers-color-scheme: dark)", THEMES.get("dark")!.get("--background")],
  ]);
});

test("the JSON-LD says Lanewise is a free SoftwareApplication, under the MIT licence, for Windows and macOS", () => {
  const scripts = head.querySelectorAll('script[type="application/ld+json"]');
  expect(scripts).toHaveLength(1);
  const data = JSON.parse(scripts[0]!.textContent!) as Record<string, unknown>;
  expect(data).toMatchObject({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Lanewise",
    applicationCategory: "DeveloperApplication",
    url: SITE,
    downloadUrl: "https://github.com/adrianeyre/lanewise/releases/latest",
    license: "https://opensource.org/license/mit",
    isAccessibleForFree: true,
    codeRepository: "https://github.com/adrianeyre/lanewise",
    image: meta("og:image"),
    offers: { "@type": "Offer", price: "0" },
  });
  expect(data.operatingSystem).toMatch(/Windows.*macOS/);
  expect(SCREENSHOTS.map(({ src }) => `${SITE}${src}`)).toContain(data.screenshot);
});

test("robots.txt lets every crawler in and names the sitemap, which lists the page", () => {
  expect(read("robots.txt").toString("utf8")).toBe(`User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`);
  const sitemap = new JSDOM(read("sitemap.xml"), { contentType: "application/xml" }).window.document;
  expect(sitemap.documentElement.namespaceURI).toBe("http://www.sitemaps.org/schemas/sitemap/0.9");
  expect([...sitemap.querySelectorAll("url > loc")].map((loc) => loc.textContent)).toEqual([SITE]);
});

test("each screenshot is in public/ at the size the page draws it", () => {
  for (const screenshot of SCREENSHOTS) {
    expect(webpSize(read(screenshot.src))).toEqual([screenshot.width, screenshot.height]);
  }
});

test("every link to Lanewise is to this repository or its Pages", () => {
  const files = [HTML, read("site.webmanifest").toString("utf8"), read("robots.txt").toString("utf8")];
  const urls = files.flatMap((text) => text.match(/https:\/\/[^\s"'<>)]*(github|lanewise)[^\s"'<>)]*/gi) ?? []);
  expect(urls.length).toBeGreaterThan(0);
  expect(urls.filter((url) => !/^https:\/\/(github\.com\/adrianeyre\/lanewise|lanewise\.adrianeyre\.co\.uk\/)/.test(url))).toEqual(
    [],
  );
});

describe("the theme", () => {
  const script = [...head.querySelectorAll("script:not([type]):not([src])")];

  test("follows the OS's light or dark setting before first paint, and as it changes", () => {
    expect(script).toHaveLength(1);
    // The OS's setting, which jsdom has no `matchMedia` for, dark to begin with.
    let dark = true;
    const listeners: (() => void)[] = [];
    const page = new JSDOM(HTML, {
      runScripts: "dangerously",
      beforeParse(window) {
        window.matchMedia = (media: string) =>
          ({
            get matches() {
              return media === "(prefers-color-scheme: dark)" && dark;
            },
            addEventListener: (_: string, listener: () => void) => listeners.push(listener),
          }) as unknown as MediaQueryList;
      },
    });
    const root = page.window.document.documentElement;
    expect([root.dataset.theme, root.style.colorScheme]).toEqual(["dark", "dark"]);
    dark = false;
    for (const listener of listeners) listener();
    expect([root.dataset.theme, root.style.colorScheme]).toEqual(["light", "light"]);
  });

  // The Cookie Policy says the website stores nothing on your device at all.
  test("is stored nowhere, as nothing on the website is", () => {
    const sources = [HTML, ...Object.values(import.meta.glob(["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}"], { query: "?raw", import: "default", eager: true }))];
    expect(sources.filter((text) => /localStorage|sessionStorage|document\.cookie|indexedDB/.test(String(text)))).toEqual(
      [],
    );
  });
});
