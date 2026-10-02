import type { Platform } from "./platform";

/**
 * Why a command fails outside the Desktop App: not a bug, just the UI on its
 * own in a browser (`pnpm dev`), with no core to run Git. Said as it is,
 * not as something gone wrong.
 */
export class CoreUnavailableError extends Error {
  constructor() {
    super(
      "This is Lanewise's UI on its own, in a browser, so nothing that needs Git works here. Run the Desktop App with `pnpm desktop:dev` to use it.",
    );
    this.name = "CoreUnavailableError";
  }
}

function unavailable(): Promise<never> {
  return Promise.reject(new CoreUnavailableError());
}

// TODO(#50): Web Mode (PRD §7.12, P1) supplies a platform that carries commands over
// `serve`'s WebSocket, chooses folders in the app and makes Model Providers'
// requests through `serve`'s forwarding endpoint. Until then, the UI outside
// the Desktop App (`pnpm dev`) has no core to talk to.
/**
 * The platform when the UI isn't in the Desktop App: everything that needs
 * the core fails, saying why. Links open in a new tab, as in any browser,
 * text is copied through the browser's clipboard, and the browser draws its
 * own window as its user set it. It doesn't update itself, or show Host
 * pages in Tabs of its own.
 */
export const unavailablePlatform: Platform = {
  commands: { call: unavailable },
  chooseFolder: unavailable,
  async openLink(url) {
    window.open(url, "_blank", "noopener,noreferrer");
  },
  copyText(text) {
    return navigator.clipboard.writeText(text);
  },
  async showTheme() {},
  // Never the browser's own `fetch`: CORS would stop it, and the request
  // must not come from the page (ADR 0020).
  fetch: unavailable,
  updater: null,
  // A browser won't frame a Host's pages, so they open in a new browser tab.
  hostPages: null,
};
