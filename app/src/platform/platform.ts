import type { CommandClient } from "../commands/api";
import type { Theme } from "../settings/theme";
import type { Updater } from "../updates/updater";

/** Where a Host page goes, in CSS pixels, with the page's own width, for the shell to work out its zoom. */
export interface HostPageBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  /** `innerWidth`. */
  viewport: number;
}

/** What a Host page tells the UI, by its number. */
export type HostPageNews =
  /** It started loading `url`, or finished. */
  | { kind: "loading"; page: number; url: string; done: boolean }
  /** Its page's title changed. */
  | { kind: "title"; page: number; title: string }
  /** It asked to open `url` in a new window, for a new Tab. */
  | { kind: "newTab"; page: number; url: string }
  /** Its F6 handed focus back to its Tab. */
  | { kind: "focus"; page: number }
  /** Its Ctrl or Cmd+W asked to close its Tab. */
  | { kind: "close"; page: number };

/**
 * Host pages: a page on a Host, such as a repository or a Pull Request on
 * GitHub, shown in a Tab of Lanewise's own, laid over the Tab's place in the
 * page (ADR 0042). Each is numbered by the UI.
 */
export interface HostPages {
  /** Opens page `page` at `url` over `bounds`, or shows it there again if it's open. */
  open(page: number, url: string, bounds: HostPageBounds): Promise<void>;
  /** Moves it, as its place in the page moves or resizes. */
  place(page: number, bounds: HostPageBounds): Promise<void>;
  /** Shows or hides it: hidden while another Tab is, or a menu or dialog is open over it. */
  show(page: number, visible: boolean): Promise<void>;
  /** Goes back or forward in its history, loads it again, or moves focus into it. */
  go(page: number, go: "back" | "forward" | "reload" | "focus"): Promise<void>;
  /** Closes it, with its Tab. */
  close(page: number): Promise<void>;
  /** Calls `listener` with each Host page's news, until the function it returns is called. */
  listen(listener: (news: HostPageNews) => void): () => void;
}

/**
 * What the UI needs from the shell it runs in. The Desktop App supplies it
 * from `tauri.ts`, the only module that imports Tauri, and Web Mode will
 * supply its own, so nothing else in the UI knows which it's in (ADR 0003).
 */
export interface Platform {
  /** Carries commands to Lanewise's core. */
  commands: CommandClient;
  /**
   * Asks the user for a folder, titled `title`: the native folder dialog in
   * the Desktop App, opened in `startIn`, such as the base folder Settings
   * has, if it's given. `null` if they cancel.
   */
  chooseFolder(title: string, startIn?: string | null): Promise<string | null>;
  /** Opens an `https` link in the user's browser, never in Lanewise's own window. */
  openLink(url: string): Promise<void>;
  /** Puts `text` on the clipboard, as Copy diagnostics does. */
  copyText(text: string): Promise<void>;
  /**
   * Draws the shell's own window, such as the Desktop App's title bar, in
   * the Theme chosen, or as the OS is set for `null`. The page draws itself.
   */
  showTheme(theme: Theme | null): Promise<void>;
  /**
   * Makes an HTTP request to a Model Provider, or for the model catalog
   * (ADR 0021), as the web's `fetch` does, but from the shell rather than
   * the page, so CORS never applies: the Desktop App's through Tauri's HTTP
   * plugin, to the hosts its capability allows. Redirects are never followed, so a request's API key never goes
   * anywhere it wasn't sent (ADR 0020).
   */
  fetch(url: string, init?: RequestInit): Promise<Response>;
  /**
   * Finds and installs Updates (ADR 0030): the Desktop App's, through its
   * own update commands. `null` where the shell doesn't update itself, as in
   * Web Mode, whose UI is served by the `serve` it runs with.
   */
  updater: Updater | null;
  /**
   * Shows Host pages in Tabs of Lanewise's own (ADR 0042): the Desktop
   * App's, in child webviews. `null` where the shell can't, as in Web Mode,
   * whose browser won't frame them, so they open in the browser.
   */
  hostPages: HostPages | null;
}
