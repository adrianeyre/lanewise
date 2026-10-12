/**
 * The Host page probe (pen-testing PRD §6, W2) is served here over plain
 * HTTP on a free local port, which is all its handler cares about, and
 * checked: that it answers the page at `/` and nothing else, and that the
 * page reaches nowhere off this machine, since it's only for a disposable
 * Release.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, expect, test } from "vitest";

import { handler, PROBE_PAGE } from "./hostPageProbe";

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("serves the probe page at / and nothing else", async () => {
  const page = await fetch(`${base}/`);
  expect(page.status).toBe(200);
  expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(await page.text()).toBe(PROBE_PAGE);

  const others = await Promise.all(["/other", "/report", "/../package.json"].map(async (path) => [path, (await fetch(`${base}${path}`)).status]));
  expect(others).toEqual([
    ["/other", 404],
    ["/report", 404],
    ["/../package.json", 404],
  ]);
  expect((await fetch(`${base}/`, { method: "POST", body: "x" })).status).toBe(404);
});

test("the page reaches nowhere off this machine but the Hosts its refused commands name", () => {
  // The only web addresses are the ones the probe asks Lanewise's refused
  // commands to reach, which are never sent if the command is refused.
  const addresses = new Set(PROBE_PAGE.match(/https?:\/\/[^\s"'<>)]+/g));
  expect([...addresses].toSorted()).toEqual(["http://ipc.localhost/call", "http://tauri.localhost/", "https://github.com/", "https://raw.githubusercontent.com/adrianeyre/lanewise/main/catalog/models.json"]);
  expect(PROBE_PAGE).not.toMatch(/sendBeacon|XMLHttpRequest|WebSocket|<img|<link/);
});

test("checks every frame and navigation the W2 brief names", () => {
  for (const each of ["srcdoc", "blob", "data", "about:blank", "tauri://localhost/", "http://tauri.localhost/", "about:srcdoc"]) {
    expect(PROBE_PAGE).toContain(each);
  }
});
