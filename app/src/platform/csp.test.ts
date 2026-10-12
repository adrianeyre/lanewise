import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "vitest";

import { AVATAR_HOST } from "../avatars/avatars";
import { STYLE_NONCE_META } from "../ui/styleNonce";

const repository = join(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(join(repository, path), "utf8");

const security = (
  JSON.parse(read("desktop/tauri.conf.json")) as {
    app: { security: { csp: Record<string, string[]>; dangerousDisableAssetCspModification?: unknown } };
  }
).app.security;
const csp = security.csp;
const html = read("app/index.html");

type Permission = string | { identifier: string };
const capability = JSON.parse(read("desktop/capabilities/default.json")) as { permissions: Permission[] };

// ADR 0050: defence in depth for the main webview, which holds every command
// `call` carries. The UI renders no HTML it didn't write; if a script ever got
// in all the same, the policy keeps it from running, loading or sending.
test("the main webview runs only the scripts Lanewise ships, and the theme script, which Tauri allows by its hash", () => {
  expect(csp["default-src"]).toEqual(["'self'"]);
  expect(csp["script-src"]).toEqual(["'self'"]);
  // Tauri adds the hash of each inline script in index.html, and the style nonce, only while this is unset.
  expect(security).not.toHaveProperty("dangerousDisableAssetCspModification");
  const inline = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  expect(inline).toHaveLength(1);
  expect(inline[0]![1]).toContain('localStorage.getItem("lanewise.theme")');
});

test("its styles are its own stylesheet's, and CodeMirror's by the nonce Tauri puts in index.html", () => {
  expect(csp["style-src"]).toEqual(["'self'"]);
  expect(html).toContain(`<meta name="${STYLE_NONCE_META}" content="__TAURI_STYLE_NONCE__" />`);
  // Tauri replaces every one it finds with a nonce of its own, so there's one.
  expect(html.match(/__TAURI_STYLE_NONCE__/g)).toHaveLength(1);
  expect(html).not.toContain("__TAURI_SCRIPT_NONCE__");
});

test("its page sends nothing but over IPC, and shows no picture but its own and authors' from GitHub (ADR 0035)", () => {
  expect(csp["connect-src"]).toEqual(["ipc:", "http://ipc.localhost"]);
  expect(csp["img-src"]).toEqual(["'self'", AVATAR_HOST]);
  const elsewhere = Object.entries(csp).flatMap(([directive, sources]) =>
    sources.filter((source) => !source.startsWith("'")).map((source) => `${directive} ${source}`),
  );
  expect(elsewhere).toEqual([
    "img-src https://avatars.githubusercontent.com",
    "connect-src ipc:",
    "connect-src http://ipc.localhost",
  ]);
});

test("nothing may embed it, frame a page in it, plug in, start a worker, change its base or post a form", () => {
  const none = ["object-src", "frame-src", "worker-src", "base-uri", "form-action", "frame-ancestors"];
  expect(Object.fromEntries(none.map((directive) => [directive, csp[directive]]))).toEqual(
    Object.fromEntries(none.map((directive) => [directive, ["'none'"]])),
  );
  expect(Object.values(csp).flat().filter((source) => /unsafe|\*|^data:|^blob:/.test(source))).toEqual([]);
});

test("the main webview has only the core permissions it uses", () => {
  const core = capability.permissions
    .map((each) => (typeof each === "string" ? each : each.identifier))
    .filter((identifier) => identifier.startsWith("core:"));
  expect(core).toEqual([
    // The shell's events, such as a Host page's news.
    "core:event:allow-listen",
    "core:event:allow-unlisten",
    // The title bar in the chosen Theme.
    "core:window:allow-set-theme",
    // Zooming with Ctrl or Cmd and + or -.
    "core:webview:allow-set-webview-zoom",
  ]);
});
