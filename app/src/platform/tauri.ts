// The one module that imports Tauri (enforced by `.oxlintrc.json`). Everything
// else reaches the Desktop App through the `Platform` this makes.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import { fetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";

import { outcomeOf } from "../commands/reply";
import { desktopUpdater } from "../updates/desktopUpdater";
import type { HostPageNews, HostPages, Platform } from "./platform";

/**
 * Host pages in child webviews of the window, through
 * `desktop/src/host_pages.rs`. Each page's commands are sent one after
 * another, in the order they're asked for: two opens, as React's effects
 * run twice, or a hide sent as one Tab goes and an open as it comes back,
 * would otherwise run at once, and land in either order.
 */
function hostPages(): HostPages {
  // The last command sent to each page, which its next waits for.
  const last = new Map<number, Promise<unknown>>();
  function inTurn<T>(page: number, send: () => Promise<T>): Promise<T> {
    const sent = (last.get(page) ?? Promise.resolve()).then(send, send);
    const settled = sent.catch(() => {});
    last.set(page, settled);
    // Forgotten once nothing waits on it, so a closed page leaves nothing behind.
    void settled.then(() => {
      if (last.get(page) === settled) last.delete(page);
    });
    return sent;
  }
  return {
    open: (page, url, bounds) => inTurn(page, () => invoke("host_page_open", { page, url, bounds })),
    place: (page, bounds) => inTurn(page, () => invoke("host_page_bounds", { page, bounds })),
    show: (page, visible) => inTurn(page, () => invoke("host_page_visible", { page, visible })),
    go: (page, go) => inTurn(page, () => invoke("host_page_go", { page, go })),
    close: (page) => inTurn(page, () => invoke("host_page_close", { page })),
    listen(listener) {
      let stop: (() => void) | null = null;
      let stopped = false;
      void listen<HostPageNews>("host-page", (event) => listener(event.payload)).then((unlisten) => {
        if (stopped) unlisten();
        else stop = unlisten;
      });
      return () => {
        stopped = true;
        stop?.();
      };
    },
  };
}

/**
 * The Desktop App's platform, with commands carried over Tauri IPC by the
 * one IPC command `desktop/src/lib.rs` registers, `call`, links opened in
 * the default browser, text copied by the clipboard plugin, the window's
 * title bar drawn in the Theme, and Model Providers' requests made by the
 * HTTP plugin, Updates found and installed by the shell's update
 * commands, and Host pages shown in Tabs by its Host page commands. `undefined` outside a Tauri window.
 */
export function tauriPlatform(): Platform | undefined {
  if (!isTauri()) return undefined;
  return {
    commands: {
      async call(name, request) {
        return outcomeOf(name, await invoke("call", { name, request }));
      },
    },
    chooseFolder(title, startIn) {
      return open({ directory: true, multiple: false, title, defaultPath: startIn ?? undefined });
    },
    openLink(url) {
      return openUrl(url);
    },
    copyText(text) {
      // The plugin's, since a webview may refuse the page's own clipboard
      // once the click that asked for it has awaited the core.
      return writeText(text);
    },
    showTheme(theme) {
      // On macOS this sets the whole app's appearance, and with it what the
      // webview reports as the OS's theme; `null` hands both back to the OS.
      return getCurrentWindow().setTheme(theme);
    },
    fetch(url, init) {
      // A fresh object: the plugin deletes its own options from the one it's given.
      return fetch(url, { ...init, maxRedirections: 0 });
    },
    updater: desktopUpdater(invoke),
    hostPages: hostPages(),
  };
}
