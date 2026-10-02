// @vitest-environment jsdom
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, expect, test } from "vitest";

import { CommandRejectedError } from "../commands/reply";
import { tauriPlatform } from "./tauri";

// `isTauri()` reads the global the Desktop App's webview sets; `mockIPC` doesn't.
function inTauri() {
  Object.assign(globalThis, { isTauri: true });
}

afterEach(() => {
  clearMocks();
  Reflect.deleteProperty(globalThis, "isTauri");
});

test("outside a Tauri window there is no Tauri platform", () => {
  expect(tauriPlatform()).toBeUndefined();
});

test("commands travel as the one IPC command, call, and come back as outcomes", async () => {
  inTauri();
  const sent: unknown[] = [];
  mockIPC((command, args) => {
    sent.push({ command, args });
    return { outcome: "failed", error: { kind: "notARepository", path: "/tmp" } };
  });

  const outcome = await tauriPlatform()?.commands.call("openRepository", { path: "/tmp" });

  expect(outcome).toEqual({ ok: false, error: { kind: "notARepository", path: "/tmp" } });
  expect(sent).toEqual([
    { command: "call", args: { name: "openRepository", request: { path: "/tmp" } } },
  ]);
});

test("a command the core rejects rejects", async () => {
  inTauri();
  mockIPC(() => ({ outcome: "rejected", rejection: { kind: "internal", message: "It stopped." } }));

  await expect(
    tauriPlatform()?.commands.call("fileStatus", { repository: "/work/lanewise" }),
  ).rejects.toBeInstanceOf(CommandRejectedError);
});

test("choosing a folder opens the native folder dialog, titled", async () => {
  inTauri();
  const sent: unknown[] = [];
  mockIPC((command, args) => {
    sent.push({ command, args });
    return "/work/lanewise";
  });

  const folder = await tauriPlatform()?.chooseFolder("Open repository");

  expect(folder).toBe("/work/lanewise");
  expect(sent).toEqual([
    {
      command: "plugin:dialog|open",
      args: { options: { directory: true, multiple: false, title: "Open repository" } },
    },
  ]);
});

test("a link opens in the default browser, through the opener plugin", async () => {
  inTauri();
  const sent: unknown[] = [];
  mockIPC((command, args) => {
    sent.push({ command, args });
  });

  await tauriPlatform()?.openLink("https://git-scm.com/install/windows");

  expect(sent).toEqual([
    { command: "plugin:opener|open_url", args: { url: "https://git-scm.com/install/windows" } },
  ]);
});

test("text is copied through the clipboard plugin", async () => {
  inTauri();
  const sent: unknown[] = [];
  mockIPC((command, args) => {
    sent.push({ command, args });
  });

  await tauriPlatform()?.copyText("Lanewise: 0.1.0");

  expect(sent).toEqual([
    { command: "plugin:clipboard-manager|write_text", args: { label: undefined, text: "Lanewise: 0.1.0" } },
  ]);
});

test("the window's title bar is drawn in the Theme chosen, or as the OS is set", async () => {
  inTauri();
  mockWindows("main");
  const sent: unknown[] = [];
  mockIPC((command, args) => {
    sent.push({ command, args });
  });

  await tauriPlatform()?.showTheme("dark");
  await tauriPlatform()?.showTheme(null);

  expect(sent).toEqual([
    { command: "plugin:window|set_theme", args: { label: "main", value: "dark" } },
    { command: "plugin:window|set_theme", args: { label: "main", value: null } },
  ]);
});

test("a Model Provider's request is made by the HTTP plugin, never following a redirect", async () => {
  inTauri();
  const sent: { command: string; args: unknown }[] = [];
  const body = [...new TextEncoder().encode('{"models":[]}')];
  const chunks = [[...body, 0], [1]];
  mockIPC((command, args) => {
    sent.push({ command, args });
    switch (command) {
      case "plugin:http|fetch":
        return 7;
      case "plugin:http|fetch_send":
        return { status: 200, statusText: "OK", url: "https://api.fake.test/models", headers: [], rid: 8 };
      case "plugin:http|fetch_read_body":
        return chunks.shift();
    }
  });
  const init: RequestInit = { method: "POST", headers: { "x-api-key": "sk-fake" }, body: "{}" };

  const response = await tauriPlatform()?.fetch("https://api.fake.test/models", init);

  expect(response?.status).toBe(200);
  expect(await response?.json()).toEqual({ models: [] });
  expect(sent[0]).toEqual({
    command: "plugin:http|fetch",
    args: {
      clientConfig: expect.objectContaining({
        method: "POST",
        url: "https://api.fake.test/models",
        headers: expect.arrayContaining([["x-api-key", "sk-fake"]]),
        data: [...new TextEncoder().encode("{}")],
        maxRedirections: 0,
      }),
    },
  });
  expect(sent.map(({ command }) => command)).toEqual([
    "plugin:http|fetch",
    "plugin:http|fetch_send",
    "plugin:http|fetch_read_body",
    "plugin:http|fetch_read_body",
  ]);
  expect(init).toEqual({ method: "POST", headers: { "x-api-key": "sk-fake" }, body: "{}" });
});

test("Updates are the shell's own update commands, never the updater plugin's", async () => {
  inTauri();
  const sent: string[] = [];
  mockIPC((command) => {
    sent.push(command);
    return command === "update_status" ? { version: "1.0.0", off: null } : null;
  });
  const updater = tauriPlatform()?.updater;

  await expect(updater?.status()).resolves.toEqual({ version: "1.0.0", off: null });
  await expect(updater?.check()).resolves.toBeNull();
  expect(sent).toEqual(["update_status", "update_check"]);
});

test("a Host page's commands are sent one after another, so a second open waits for the first to make it", async () => {
  inTauri();
  const made = new Set<number>();
  const answered: string[] = [];
  let running = 0;
  mockIPC(async (command, args) => {
    const { page } = args as { page: number };
    running += 1;
    // At most one of a page's commands is with the shell at a time.
    expect(running).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
    if (command === "host_page_open") {
      answered.push(made.has(page) ? "shown" : "made");
      made.add(page);
    } else answered.push(command);
    return null;
  });
  const pages = tauriPlatform()!.hostPages!;
  const bounds = { x: 0, y: 0, width: 800, height: 600, viewport: 800 };

  // As React's effects run twice: open, the cleanup's hide, and open again, all at once.
  await Promise.all([
    pages.open(5, "https://github.com/adrianeyre/lanewise/pull/42", bounds),
    pages.show(5, false),
    pages.open(5, "https://github.com/adrianeyre/lanewise/pull/42", bounds),
  ]);

  // In the order they were asked for: the page is shown at the end, not hidden.
  expect(answered).toEqual(["made", "host_page_visible", "shown"]);
});

test("a Host page's command that fails doesn't hold up the next", async () => {
  inTauri();
  const sent: string[] = [];
  mockIPC((command) => {
    sent.push(command);
    if (command === "host_page_bounds") throw new Error("There's no Host page 5.");
    return null;
  });
  const pages = tauriPlatform()!.hostPages!;
  const bounds = { x: 0, y: 0, width: 1, height: 1, viewport: 1 };

  await expect(pages.place(5, bounds)).rejects.toThrow("There's no Host page 5.");
  await pages.close(5);
  expect(sent).toEqual(["host_page_bounds", "host_page_close"]);
});
