import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize } from "node:path";

import { chromium, type Page } from "playwright";

import { PICTURES, PICTURES_FOLDER, type PictureStep } from "./pictures.ts";

const [site, root] = process.argv.slice(2);
if (site === undefined || root === undefined) throw new Error("Usage: shootPictures.ts <built page> <repository>");

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

const server = createServer(async (request, response) => {
  const path = normalize(new URL(request.url ?? "/", "http://localhost").pathname).replace(/^\/+/, "") || "index.html";
  try {
    const body = await readFile(join(site, path));
    response.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const { port } = server.address() as AddressInfo;

async function takeStep(page: Page, step: PictureStep) {
  if ("click" in step) await page.getByRole("button", { name: step.click, exact: true }).first().click();
  if ("fill" in step) await page.getByLabel(step.fill.label, { exact: true }).fill(step.fill.text);
  if ("show" in step) {
    await page
      .getByRole("heading", { name: step.show, exact: true })
      .first()
      .evaluate((heading) => heading.scrollIntoView({ block: "start" }));
  }
}

const browser = await chromium.launch();
try {
  for (const picture of PICTURES) {
    const page = await browser.newPage({
      viewport: { width: picture.width, height: picture.height },
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));
    await page.addInitScript(() => localStorage.setItem("lanewise.theme", "light"));
    await page.goto(`http://127.0.0.1:${port}/index.html#${picture.scene}`);
    await page.waitForLoadState("networkidle");
    for (const step of picture.steps) await takeStep(page, step);
    await page.waitForTimeout(400);
    if (failures.length > 0) throw new Error(`${picture.file}: ${failures.join("; ")}`);
    await page.screenshot({ path: join(root, PICTURES_FOLDER, picture.file) });
    await page.close();
    console.log(`Took ${picture.file}`);
  }
} finally {
  await browser.close();
  server.close();
}
