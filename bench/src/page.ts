/**
 * What the benchmark runs in the Desktop App's page, through WebDriver. Only
 * each function's source reaches the page, so none of them may use anything
 * from this module, or any import, except the helpers `graph.ts` sends with
 * it, which it calls by name. They see the app as a user would: through its
 * DOM, never its code.
 */

/** What the page is showing: the Git Setup screen, the Welcome screen, a repository, or nothing yet. */
export type Screen = "gitSetup" | "welcome" | "repository" | "loading";

/** Waits up to `timeout` milliseconds for the Git Setup screen, the Welcome screen or a repository. */
export function waitForScreen(timeout: number): Promise<Screen> {
  const until = performance.now() + timeout;
  return new Promise((resolve) => {
    const look = () => {
      const continuing = [...document.querySelectorAll("button")].some((b) => b.textContent === "Continue for now");
      if (continuing) return resolve("gitSetup");
      if (document.querySelector(".welcome")) return resolve("welcome");
      if (document.querySelector(".repository")) return resolve("repository");
      if (performance.now() > until) return resolve("loading");
      setTimeout(look, 50);
    };
    look();
  });
}

/** Presses "Continue for now" on the Git Setup screen, as a user without Git Credential Manager does. */
export function continueSetup(): void {
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Continue for now");
  if (!button) throw new Error('The Git Setup screen has no "Continue for now"');
  button.click();
}

/** Leaves `repository` as the only Recent Repository, with no Tabs to open again once the page reloads. */
export function listOnlyRecent(repository: { root: string; name: string }): void {
  localStorage.clear();
  localStorage.setItem("lanewise.recent-repositories", JSON.stringify([repository]));
}

/** What the page runs in: its WebKit, and its size. */
export function describePage(): { userAgent: string; screen: string } {
  return { userAgent: navigator.userAgent, screen: `${innerWidth}×${innerHeight} at ${devicePixelRatio}x` };
}

/**
 * Which of the rows in `viewport` show, and how many of those aren't drawn
 * with their commit: `absent`, when the page hasn't drawn the row at all, or
 * `reading`, when it says "Reading…" until its window comes. Rows are found
 * by `aria-rowindex`, which is the row's index plus 2 (the header row is 1).
 */
export function rowsInView(viewport: HTMLElement): {
  first: number;
  shown: number;
  missing: number;
  absent: number;
  reading: number;
  inDom: number;
} {
  const grid = viewport.closest("[role=grid]");
  const total = Number(grid?.getAttribute("aria-rowcount") ?? 1) - 1;
  const drawn = new Map<number, Element>();
  for (const row of viewport.querySelectorAll(".history-row")) {
    drawn.set(Number(row.getAttribute("aria-rowindex")) - 2, row);
  }
  const sample = drawn.values().next().value as HTMLElement | undefined;
  const height = sample?.offsetHeight ?? 0;
  if (height === 0) return { first: 0, shown: 0, missing: 1, absent: 1, reading: 0, inDom: drawn.size };
  const first = Math.floor(viewport.scrollTop / height);
  const end = Math.min(total, Math.ceil((viewport.scrollTop + viewport.clientHeight) / height));
  let absent = 0;
  let reading = 0;
  for (let index = first; index < end; index++) {
    const row = drawn.get(index);
    if (!row) absent++;
    else if (row.querySelector(".history-reading")) reading++;
  }
  return { first, shown: end - first, missing: absent + reading, absent, reading, inDom: drawn.size };
}

/** A command sent over Tauri IPC: its name, and when it was sent and answered, on the page's clock. */
export interface Sent {
  name: string;
  sent: number;
  answered: number;
}

/**
 * Records each command sent over Tauri IPC from here on. Tauri 2 sends each
 * one as a `fetch` to an `ipc:` URL, with the app's `call` carrying the
 * command's name in its body, so wrapping `fetch` sees them all; Tauri's own
 * `invoke` can't be wrapped.
 */
export function recordCommands(): void {
  const sent: Sent[] = [];
  const send = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith("ipc:") && !url.startsWith("http://ipc.localhost")) return send(input, init);
    let name = new URL(url).pathname.replace(/^\//, "");
    if (name === "call" && typeof init?.body === "string") {
      name = (JSON.parse(init.body) as { name?: string }).name ?? name;
    }
    const at = performance.now();
    try {
      return await send(input, init);
    } finally {
      sent.push({ name, sent: at, answered: performance.now() });
    }
  };
  (window as unknown as { lanewiseSent: Sent[] }).lanewiseSent = sent;
}

/** The commands answered since `recordCommands`, or since this was last called. */
export function takeCommands(): Sent[] {
  const sent = (window as unknown as { lanewiseSent?: Sent[] }).lanewiseSent ?? [];
  return sent.splice(0);
}

/** What opening a repository showed, on the page's clock, as `performance.now()` gives it. */
export interface Opened {
  /** How many rows the history has. */
  rows: number;
  /** When each frame began, from the one the repository was opened in. */
  frames: number[];
  /** When the frame that first painted the Commit graph, before it has any rows, began. */
  shown: number;
  /** When the Commit graph first said how many rows it has: once the history was read and laid out. */
  counted: number;
  /** When the first screen of the Commit graph had been painted: every row in view with its commit, and the lanes beside them. */
  firstScreen: number;
}

/**
 * Opens the Recent Repository at `root` from the Welcome screen, as a user
 * does, and notes when every frame begins until the first screen of the
 * Commit graph, so a frame the UI thread was held up in shows. Gives up
 * after `timeout` milliseconds.
 */
export function openRecent(root: string, timeout: number): Promise<Opened> {
  const entry = [...document.querySelectorAll<HTMLButtonElement>("button.recent-open")].find(
    (button) => button.querySelector(".recent-root")?.textContent === root,
  );
  if (!entry) throw new Error(`The Welcome screen doesn't list ${root}`);
  return new Promise((resolve, reject) => {
    const frames: number[] = [];
    let shown: number | null = null;
    let counted: number | null = null;
    let drawn = false;
    const tick = (now: number) => {
      frames.push(now);
      if (drawn) {
        const grid = document.querySelector("[role=grid]");
        return resolve({
          rows: Number(grid?.getAttribute("aria-rowcount")) - 1,
          frames,
          shown: shown!,
          counted: counted!,
          firstScreen: now,
        });
      }
      if (document.querySelector(".commit-history")) shown ??= now;
      const viewport = document.querySelector<HTMLElement>(".history-viewport");
      if (viewport) {
        counted ??= now;
        const canvas = document.querySelector<HTMLCanvasElement>(".history-canvas");
        const view = rowsInView(viewport);
        // The frame now beginning paints them; the next begins once it has.
        drawn = view.shown > 0 && view.missing === 0 && (canvas?.width ?? 0) > 0;
      }
      if (now - frames[0]! > timeout) return reject(new Error(`No first screen after ${timeout} ms`));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame((now) => {
      frames.push(now);
      entry.click();
      requestAnimationFrame(tick);
    });
  });
}

/** A way of scrolling the Commit graph, a fixed distance every frame. */
export interface Scenario {
  name: string;
  /** How far each frame scrolls. */
  rowsPerFrame: number;
  /** How many frames it scrolls for, or `null` to scroll until the end of the history. */
  frames: number | null;
  /** Every this many frames, it jumps to a random row instead, as dragging the scrollbar does. */
  jumpEvery: number | null;
  /** The row it starts from, once that row's screen is drawn. */
  start: number;
}

export interface Scrolled {
  /** When each frame began, on the page's clock, from the one before the first scroll. */
  frames: number[];
  /** How many frames showed a place in view with no row drawn at all. */
  absent: number;
  /** How many frames showed a row still "Reading…". */
  reading: number;
  /** The most rows the history had in the DOM at once. */
  mostRowsInDom: number;
  /** How far it scrolled, in rows. */
  rows: number;
}

/** Waits for the next frame, and says when it began. */
export function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

/** Scrolls the Commit graph as `scenario` says, timing each frame and noting any that show a row without its commit. */
export async function scroll(scenario: Scenario): Promise<Scrolled> {
  const viewport = document.querySelector<HTMLElement>(".history-viewport");
  if (!viewport) throw new Error("The Commit graph isn't showing");
  const height = viewport.querySelector<HTMLElement>(".history-row")?.offsetHeight ?? 0;
  if (height === 0) throw new Error("The Commit graph has no rows");
  const total = Number(viewport.closest("[role=grid]")?.getAttribute("aria-rowcount")) - 1;
  const bottom = viewport.scrollHeight - viewport.clientHeight;

  // Start from a screen that's drawn, and a second's rest, so each scenario starts alike.
  viewport.scrollTop = scenario.start * height;
  for (let waited = 0; rowsInView(viewport).missing > 0 && waited < 600; waited++) await nextFrame();
  for (let rested = 0; rested < 60; rested++) await nextFrame();

  // The same jumps every run.
  let seed = 16;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  let absent = 0;
  let reading = 0;
  let mostRowsInDom = 0;
  let rows = 0;
  const frames = [await nextFrame()];
  for (let count = 1; scenario.frames === null ? viewport.scrollTop < bottom : count <= scenario.frames; count++) {
    const before = viewport.scrollTop;
    if (scenario.jumpEvery !== null && count % scenario.jumpEvery === 0) {
      viewport.scrollTop = Math.floor(random() * total) * height;
    } else {
      viewport.scrollTop = Math.min(bottom, before + scenario.rowsPerFrame * height);
    }
    rows += Math.abs(viewport.scrollTop - before) / height;
    frames.push(await nextFrame());
    // What this frame paints: the scroll, and whatever the app did about it before painting.
    const view = rowsInView(viewport);
    if (view.absent > 0) absent++;
    if (view.reading > 0) reading++;
    mostRowsInDom = Math.max(mostRowsInDom, view.inDom);
  }
  return { frames, absent, reading, mostRowsInDom, rows: Math.round(rows) };
}
