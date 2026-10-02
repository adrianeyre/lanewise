/**
 * The little of W3C WebDriver the benchmark needs, over plain HTTP: a session
 * with the Desktop App, as `tauri-driver` starts it, and scripts run in its
 * page. https://www.w3.org/TR/webdriver2/
 */

/** A function run in the page: self-contained, since only its source travels, with JSON arguments and result. */
export type PageFunction<A extends unknown[], R> = (...args: A) => R | Promise<R>;

/** A function the page script defines before running one, by its name. */
export type Helper = (...args: never[]) => unknown;

export interface Session {
  /** What the driver says it's driving, such as `browserVersion`. */
  capabilities: Record<string, unknown>;
  /** Runs `run` in the page with `args`, after `helpers`, which it may call by name, and waits for what it returns. */
  run<A extends unknown[], R>(helpers: readonly Helper[], run: PageFunction<A, R>, ...args: A): Promise<R>;
  /** Reloads the page. */
  refresh(): Promise<void>;
  /** Ends the session, which closes the app. */
  end(): Promise<void>;
}

/** Waits up to `timeout` milliseconds for a WebDriver server at `base` to answer. */
export async function waitForDriver(base: string, timeout: number): Promise<void> {
  const until = Date.now() + timeout;
  for (;;) {
    try {
      const reply = await fetch(`${base}/status`);
      if (reply.ok) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > until) throw new Error(`No WebDriver server answered at ${base}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Starts a session with `capabilities`, whose page scripts may take up to `scriptTimeout` milliseconds. */
export async function startSession(base: string, capabilities: object, scriptTimeout: number): Promise<Session> {
  const { sessionId, capabilities: granted } = await send<{ sessionId: string; capabilities: Record<string, unknown> }>(base, "POST", "/session", {
    capabilities: { alwaysMatch: capabilities },
  });
  const at = `/session/${sessionId}`;
  await send(base, "POST", `${at}/timeouts`, { script: scriptTimeout });
  return {
    capabilities: granted,
    async run(helpers, run, ...args) {
      // The last argument is the callback WebDriver waits for.
      const script = `${helpers.map(String).join("\n")}
const done = arguments[arguments.length - 1];
const args = Array.prototype.slice.call(arguments, 0, -1);
Promise.resolve()
  .then(() => (${String(run)})(...args))
  .then((value) => done({ value }), (error) => done({ error: String((error && error.stack) || error) }));`;
      const outcome = await send<{ value: never } | { error: string }>(base, "POST", `${at}/execute/async`, {
        script,
        args,
      });
      if ("error" in outcome) throw new Error(`In the page: ${outcome.error}`);
      return outcome.value;
    },
    async refresh() {
      await send(base, "POST", `${at}/refresh`, {});
    },
    async end() {
      await send(base, "DELETE", at);
    },
  };
}

async function send<T = unknown>(base: string, method: string, path: string, body?: object): Promise<T> {
  const reply = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const { value } = (await reply.json()) as { value: T & { error?: string; message?: string } };
  if (!reply.ok) throw new Error(`WebDriver ${method} ${path}: ${value.error ?? reply.status} ${value.message ?? ""}`);
  return value;
}
