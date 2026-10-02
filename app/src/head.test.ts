import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "vitest";

const app = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(app, path), "utf8");
const html = read("index.html");

test("the app's page links its favicons, device icons and manifest, each of them there", () => {
  const linked = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)" href="\/([^"]+)"/g)].map(
    ([, file]) => file!,
  );
  expect(linked).toEqual([
    "favicon.ico",
    "favicon.svg",
    "favicon-32.png",
    "favicon-16.png",
    "apple-touch-icon.png",
    "app.webmanifest",
  ]);
  expect(linked.filter((file) => !existsSync(join(app, "public", file)))).toEqual([]);
  const manifest = JSON.parse(read("public/app.webmanifest")) as { name: string; icons: { src: string }[] };
  expect(manifest.name).toBe("Lanewise");
  expect(manifest.icons.filter(({ src }) => !existsSync(join(app, "public", src)))).toEqual([]);
});

test("its icons are the website's, so the two never drift apart", () => {
  const icons = ["favicon.ico", "favicon.svg", "favicon-32.png", "favicon-16.png", "apple-touch-icon.png"];
  const differ = icons.filter(
    (icon) => !readFileSync(join(app, "public", icon)).equals(readFileSync(join(app, "..", "website", "public", icon))),
  );
  expect(differ).toEqual([]);
});

test("its theme colours are each Theme's page background, and it's never indexed (PRD §12.1)", () => {
  const styles = read("src/styles.css");
  const light = /:root,\s*:root\[data-theme="light"\] \{[^}]*--background: (#[0-9a-f]{6});/.exec(styles)?.[1];
  const dark = /:root\[data-theme="dark"\] \{[^}]*--background: (#[0-9a-f]{6});/.exec(styles)?.[1];
  expect(html).toContain(`<meta name="theme-color" content="${light}" media="(prefers-color-scheme: light)" />`);
  expect(html).toContain(`<meta name="theme-color" content="${dark}" media="(prefers-color-scheme: dark)" />`);
  expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
  expect(html).toMatch(/<meta\s+name="description"\s+content="[^"]+"/);
});
