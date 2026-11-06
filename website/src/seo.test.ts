import { existsSync, readFileSync } from "node:fs";

import { JSDOM } from "jsdom";
import { describe, expect, test } from "vitest";

import { SCREENSHOTS } from "./screenshots";
import { FEATURES, OG_IMAGE, SITE, sitemap, structuredData, structuredDataScript } from "./seo";

// The website's JSON-LD and sitemap, which the build draws (`vite.config.ts`):
// what search engines read of it beyond the head's tags (PRD §12.1).

const { author } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { author: string };
const SITE_SOURCE = readFileSync(new URL("Site.tsx", import.meta.url), "utf8");
const NOTES = "https://github.com/adrianeyre/lanewise/releases/tag/v1.4.0";

type Node = Record<string, unknown> & { "@type": string; "@id": string };

function graph(notes: string | null = NOTES): Map<string, Node> {
  const data = structuredData({ version: "1.4.0", author, notes }) as { "@context": string; "@graph": Node[] };
  expect(data["@context"]).toBe("https://schema.org");
  return new Map(data["@graph"].map((node) => [node["@type"], node]));
}

describe("the JSON-LD", () => {
  test("describes the website, its author and Lanewise, linked by their ids", () => {
    const nodes = graph();
    expect([...nodes.keys()]).toEqual(["WebSite", "Person", "SoftwareApplication"]);
    const [website, person, software] = [nodes.get("WebSite")!, nodes.get("Person")!, nodes.get("SoftwareApplication")!];
    expect(website).toMatchObject({ url: SITE, name: "Lanewise", inLanguage: "en-GB", publisher: { "@id": person["@id"] } });
    expect(person.name).toBe(author);
    expect(software).toMatchObject({ author: { "@id": person["@id"] }, mainEntityOfPage: { "@id": website["@id"] } });
    expect(new Set([website, person, software].map((node) => node["@id"])).size).toBe(3);
  });

  test("says Lanewise is a free SoftwareApplication at its version, under the MIT licence, for Windows and macOS", () => {
    const software = graph().get("SoftwareApplication")!;
    expect(software).toMatchObject({
      name: "Lanewise",
      url: SITE,
      applicationCategory: "DeveloperApplication",
      softwareVersion: "1.4.0",
      downloadUrl: "https://github.com/adrianeyre/lanewise/releases/latest",
      releaseNotes: NOTES,
      license: "https://opensource.org/license/mit",
      isAccessibleForFree: true,
      codeRepository: "https://github.com/adrianeyre/lanewise",
      image: `${SITE}${OG_IMAGE}`,
      offers: { "@type": "Offer", price: "0" },
    });
    expect(software.operatingSystem).toMatch(/Windows.*macOS/);
  });

  test("names no Release notes without a Release, and claims no rating or review", () => {
    const software = graph(null).get("SoftwareApplication")!;
    expect(software).not.toHaveProperty("releaseNotes");
    const keys = [...graph().values()].flatMap((node) => Object.keys(node));
    expect(keys.filter((key) => ["aggregateRating", "review"].includes(key))).toEqual([]);
  });

  test("shows each screenshot the page does, at its size, with its caption", () => {
    expect(graph().get("SoftwareApplication")!.screenshot).toEqual(
      SCREENSHOTS.map((screenshot) => ({
        "@type": "ImageObject",
        contentUrl: `${SITE}${screenshot.src}`,
        width: screenshot.width,
        height: screenshot.height,
        caption: screenshot.caption,
      })),
    );
  });

  test("lists features the page itself names", () => {
    expect(graph().get("SoftwareApplication")!.featureList).toEqual([...FEATURES]);
    // Each one's distinctive words are in the page's own copy, so the JSON-LD says nothing the page doesn't.
    for (const words of ["100,000 commits", "single hunks", "Git you already have", "Conflict Hunk", "Git Credential Manager", "no telemetry"]) {
      expect(SITE_SOURCE.toLowerCase()).toContain(words.toLowerCase());
    }
  });

  test("goes into a script no text in it can close", () => {
    const script = structuredDataScript({ name: "</script><script>alert(1)</script>" });
    expect(script.match(/<\/script>/g)).toHaveLength(1);
    const element = new JSDOM(script).window.document.querySelector('script[type="application/ld+json"]')!;
    expect(JSON.parse(element.textContent!)).toEqual({ name: "</script><script>alert(1)</script>" });
  });
});

const parse = (text: string) => new JSDOM(text, { contentType: "application/xml" }).window.document;

describe("the sitemap", () => {
  test("lists the page, dated by the Release it offers, with each picture on it", () => {
    const document = parse(sitemap("2026-11-03T07:45:16Z"));
    expect(document.documentElement.namespaceURI).toBe("http://www.sitemaps.org/schemas/sitemap/0.9");
    expect(document.querySelector("parsererror")).toBeNull();
    const urls = document.getElementsByTagName("url");
    expect(urls).toHaveLength(1);
    expect(document.getElementsByTagName("loc")[0]!.textContent).toBe(SITE);
    expect(document.getElementsByTagName("lastmod")[0]!.textContent).toBe("2026-11-03T07:45:16Z");

    const images = [...document.getElementsByTagNameNS("http://www.google.com/schemas/sitemap-image/1.1", "loc")].map(
      (loc) => loc.textContent!,
    );
    expect(images).toEqual([OG_IMAGE, ...SCREENSHOTS.map(({ src }) => src)].map((src) => `${SITE}${src}`));
    for (const image of images) expect(existsSync(new URL(`../public/${image.replace(SITE, "")}`, import.meta.url))).toBe(true);
  });

  test("says no date, rather than guess one, without a Release", () => {
    const document = parse(sitemap(null));
    expect(document.querySelector("parsererror")).toBeNull();
    expect(document.getElementsByTagName("lastmod")).toHaveLength(0);
  });
});
