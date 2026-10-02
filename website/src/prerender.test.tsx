import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

import { prerender } from "./prerender";

// The build draws the page into `index.html` (`vite.config.ts`), so search
// engines and anyone without JavaScript get it all.

test("index.html has one place to draw the page, in the root main.tsx hydrates", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  expect(html.match(/<!--site-->/g)).toHaveLength(1);
  expect(html).toContain('<div id="root"><!--site--></div>');
});

test("the page is drawn to HTML, footer and all", () => {
  const html = prerender();
  expect(html).toMatch(/<h1 id="site-title">Lanewise<\/h1>/);
  expect(html).toContain('<section id="download"');
  expect(html).toContain('<footer class="app-footer">');
  expect(html).toContain(`Version: <!-- -->${import.meta.env.VITE_APP_VERSION}`);
});

/** The npm packages the package in `dir` ships. */
function dependencies(dir: string): object {
  return (JSON.parse(readFileSync(new URL(`${dir}/package.json`, import.meta.url), "utf8")) as { dependencies: object })
    .dependencies;
}

test("the website's own npm packages are among the app's, so the footer's Credits list them", () => {
  expect(Object.keys(dependencies("../../app"))).toEqual(expect.arrayContaining(Object.keys(dependencies(".."))));
});
