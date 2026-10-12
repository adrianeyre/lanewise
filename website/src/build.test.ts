import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";
import { createBuilder } from "vite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { CONTENT_SECURITY_POLICY } from "../vite.config";
import { type GitHubRelease, RELEASES_URL } from "./downloads";

// The website as `release.yml` builds it, with the latest Release from
// GitHub's API: what a visitor's browser runs and loads, and what a Release's
// own words can do to it (ADR 0031, ADR 0054).

const WEBSITE = fileURLToPath(new URL("..", import.meta.url));
const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  version: string;
};

/** Words a Release has that the page never shows, each holding markup. */
const RELEASE_WORDS = {
  name: 'Lanewise <img src="https://example.com/name.png">',
  body: '<script src="https://example.com/body.js"></script>',
  author: { login: '"><script>alert(1)</script>' },
};

/** GitHub's `releases/latest` for `tag`, with both installers and its own words. */
function latest(tag: string): GitHubRelease & typeof RELEASE_WORDS {
  const v = tag.replace(/^v/, "");
  const asset = (name: string) => ({ name, browser_download_url: `${RELEASES_URL}/download/${tag}/${name}` });
  return {
    tag_name: tag,
    html_url: `${RELEASES_URL}/tag/${tag}`,
    assets: [asset(`Lanewise_${v}_universal.dmg`), asset(`Lanewise_${v}_x64-setup.exe`), asset("<b>latest.json</b>")],
    ...RELEASE_WORDS,
  };
}

const scratch = mkdtempSync(join(tmpdir(), "lanewise-website-"));
const out = join(scratch, "dist");

/** Builds the website as the deploy job does, with `release` as the latest Release. */
async function build(release: GitHubRelease): Promise<void> {
  const file = join(scratch, "latest-release.json");
  writeFileSync(file, JSON.stringify(release));
  const before = process.env.LANEWISE_LATEST_RELEASE;
  process.env.LANEWISE_LATEST_RELEASE = file;
  try {
    const builder = await createBuilder({
      root: WEBSITE,
      configFile: join(WEBSITE, "vite.config.ts"),
      logLevel: "silent",
      build: { outDir: out, emptyOutDir: true },
    });
    await builder.buildApp();
  } finally {
    if (before === undefined) delete process.env.LANEWISE_LATEST_RELEASE;
    else process.env.LANEWISE_LATEST_RELEASE = before;
  }
}

let html: string;
let page: Document;

beforeAll(async () => {
  await build(latest(`v${version}`));
  html = readFileSync(join(out, "index.html"), "utf8");
  page = new JSDOM(html).window.document;
}, 120_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Each built file's text, by its path under `dist/`. */
function built(extension: string): string[] {
  return readdirSync(out, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(extension))
    .map((path) => readFileSync(join(out, path), "utf8"));
}

describe("the Content-Security-Policy", () => {
  test("comes first in the head, before anything it governs", () => {
    const [charset, policy] = page.head.children;
    expect(charset!.getAttribute("charset")).toBe("UTF-8");
    expect(policy!.getAttribute("http-equiv")).toBe("Content-Security-Policy");
    expect(policy!.getAttribute("content")).toBe(CONTENT_SECURITY_POLICY);
    expect(page.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')).toHaveLength(1);
  });

  test("lets the page's own origin and the theme script run, and nothing inline besides", () => {
    const directives = new Map(
      CONTENT_SECURITY_POLICY.split("; ").map((directive) => {
        const [name, ...sources] = directive.split(" ");
        return [name!, sources];
      }),
    );
    expect(directives.get("default-src")).toEqual(["'self'"]);
    expect(directives.get("style-src")).toEqual(["'self'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("base-uri")).toEqual(["'none'"]);
    expect(directives.get("form-action")).toEqual(["'none'"]);

    // Each inline script the browser would run is hashed, and the theme's is the only one.
    const inline = [...page.querySelectorAll("script:not([src])")].filter(
      (script) => !script.hasAttribute("type") || script.getAttribute("type") === "module",
    );
    expect(inline).toHaveLength(1);
    const hash = createHash("sha256").update(inline[0]!.textContent!).digest("base64");
    expect(directives.get("script-src")).toEqual(["'self'", `'sha256-${hash}'`]);
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/unsafe|data:|blob:|\*|https?:/);
  });

  test("leaves the page's own markup no inline style to refuse", () => {
    expect(page.querySelectorAll("[style], style")).toHaveLength(0);
  });
});

test("everything the built page loads is its own: no third-party script, stylesheet, font or picture", () => {
  const loads = [
    ...[...page.querySelectorAll("script[src], img[src]")].map((element) => element.getAttribute("src")!),
    ...[...page.querySelectorAll("link")]
      .filter((link) => !["canonical"].includes(link.getAttribute("rel")!))
      .map((link) => link.getAttribute("href")!),
  ];
  expect(loads.length).toBeGreaterThan(5);
  // A path on the page's own origin: relative, or from its root, never `//` or a scheme.
  expect(loads.filter((href) => !/^(\/(?!\/)|[\w.-]+(\/|$))/.test(href) || /^[a-z]+:/i.test(href))).toEqual([]);

  const manifest = JSON.parse(readFileSync(join(out, "site.webmanifest"), "utf8")) as { icons: { src: string }[] };
  expect(manifest.icons.filter(({ src }) => /^([a-z]+:|\/\/)/i.test(src))).toEqual([]);

  // The stylesheets load no web font, and nothing from anywhere else.
  for (const css of built(".css")) {
    expect(css).not.toMatch(/@font-face|@import/);
    const urls = [...css.matchAll(/url\(\s*['"]?([^'")]*)/g)].map((match) => match[1]!);
    expect(urls.filter((url) => /^([a-z]+:|\/\/)/i.test(url) && !url.startsWith("data:"))).toEqual([]);
  }
});

test("a Release's own words never reach the built page, and its downloads are exactly its installers", () => {
  for (const text of [html, ...built(".js")]) {
    expect(text).not.toContain("example.com");
    expect(text).not.toContain("alert(1)");
    expect(text).not.toContain("latest.json</b>");
  }
  const notes = `${RELEASES_URL}/tag/v${version}`;
  const hrefs = (name: string) =>
    [...page.querySelectorAll("a")]
      .filter((link) => link.textContent === name)
      .map((link) => link.getAttribute("href"));
  expect(hrefs("Download for Windows")).toEqual(
    Array(2).fill(`${RELEASES_URL}/download/v${version}/Lanewise_${version}_x64-setup.exe`),
  );
  expect(hrefs("Download for macOS")).toEqual(
    Array(2).fill(`${RELEASES_URL}/download/v${version}/Lanewise_${version}_universal.dmg`),
  );
  expect([...page.querySelectorAll(".site-version a")].map((link) => link.getAttribute("href"))).toEqual(
    Array(2).fill(notes),
  );
});

test("the build is refused a Release of any version but the one it is built from", async () => {
  await expect(build(latest("v999.0.0"))).rejects.toThrow(
    `The latest Release is v999.0.0, but the website is built from version ${version}`,
  );
});
