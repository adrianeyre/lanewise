import type { CommandClient, LogLevel } from "../commands/api";

/** The most stack frames an uncaught error's line keeps. */
const FRAMES = 12;

/**
 * Adds `message` to Lanewise's logs, on this machine (PRD §11), which hide
 * whatever in it looks like a credential. Never give it a file's contents, a
 * prompt, an API key or a message that could quote one: a kind, a name or
 * a count. A line that can't be written is let go, so logging never gets in
 * the user's way.
 */
export function writeLog(commands: CommandClient, level: LogLevel, message: string): void {
  commands.call("writeLog", { level, message }).catch(() => {});
}

/**
 * How an uncaught `thrown` is logged: its name and where it was thrown, from
 * its stack, but never its message, which could quote whatever it was
 * working on. Anything that isn't an `Error` is logged by its type alone.
 */
export function uncaughtWords(thrown: unknown): string {
  if (!(thrown instanceof Error)) return `something that isn't an Error (${typeof thrown})`;
  const { name, message, stack = "" } = thrown;
  // V8's stack starts with the name and message; WebKit's with the frames.
  const heading = message === "" ? name : `${name}: ${message}`;
  const frames = (stack.startsWith(heading) ? stack.slice(heading.length) : stack)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at ") || line.includes("@"))
    .slice(0, FRAMES);
  return frames.length === 0 ? name : `${name} ${frames.join(" | ")}`;
}

/**
 * Logs every error nothing in the UI caught, and every promise rejected with
 * no one to hear it, in `target`, the window, until the function it returns
 * is called.
 */
export function logUncaught(commands: CommandClient, target: EventTarget): () => void {
  const onError = (event: Event) =>
    writeLog(commands, "error", `Uncaught ${uncaughtWords((event as ErrorEvent).error)}`);
  const onRejection = (event: Event) =>
    writeLog(commands, "error", `Unhandled rejection: ${uncaughtWords((event as PromiseRejectionEvent).reason)}`);
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
