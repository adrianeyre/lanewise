/**
 * Takes the README's and the website's screenshots, `public/screenshots/*.webp`,
 * of the Desktop App's release build, over WebDriver through `tauri-driver`,
 * as `bench/` drives it: the Repository page and a split diff in the light
 * Theme, and the Conflicts page in the dark. It makes the demo repository
 * first, with `demoRepository.sh`, and converts each PNG to lossless WebP with
 * ImageMagick's `convert`. On Linux, run it under Xvfb at 1680 × 1050
 * (website/README.md, "Screenshots").
 */
import { execFileSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const application = join(root, "target/release", process.platform === "win32" ? "lanewise-desktop.exe" : "lanewise-desktop");
const screenshots = join(root, "website/public/screenshots");
// Always the same folder, since the Repository page shows its path: `/tmp/demo` on Linux and macOS.
const demo = join(tmpdir(), "demo");
const port = "4446";
const base = `http://127.0.0.1:${port}`;

/** A WebDriver command's `value`. */
async function send(method: string, path: string, body?: object): Promise<unknown> {
  const reply = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const { value } = (await reply.json()) as { value: { error?: string; message?: string } };
  if (!reply.ok) throw new Error(`WebDriver ${method} ${path}: ${value.error ?? reply.status} ${value.message ?? ""}`);
  return value;
}

/** What every page script can use: `wait` for something to be there, and `byText` to find an element. */
const HELPERS = `const done = arguments[arguments.length - 1];
const args = Array.prototype.slice.call(arguments, 0, -1);
const wait = (test, ms = 20000) => new Promise((ok, fail) => {
  const until = performance.now() + ms;
  const look = () => {
    let found;
    try { found = test(); } catch {}
    if (found) return ok(found);
    if (performance.now() > until) {
      return fail(new Error("Timed out waiting for " + test + ", with the page saying: " + document.body.innerText.slice(0, 400)));
    }
    setTimeout(look, 50);
  };
  look();
});
const byText = (selector, text) => [...document.querySelectorAll(selector)].find((element) => element.textContent.trim() === text);
const settle = () => new Promise((ok) => setTimeout(ok, 1500));`;

interface Session {
  /** Runs `body`, an async function's, in the page, with `args`; it throws what the page threw. */
  run(body: string, ...args: unknown[]): Promise<unknown>;
  /** Saves the window as `public/screenshots/<name>.webp`. */
  shoot(name: string): Promise<void>;
  end(): Promise<void>;
}

async function startSession(): Promise<Session> {
  const { sessionId } = (await send("POST", "/session", {
    capabilities: { alwaysMatch: { "tauri:options": { application } } },
  })) as { sessionId: string };
  const at = `/session/${sessionId}`;
  await send("POST", `${at}/timeouts`, { script: 60_000 });
  await send("POST", `${at}/window/rect`, { x: 0, y: 0, width: 1680, height: 1050 });
  const run = async (body: string, ...args: unknown[]) => {
    const outcome = (await send("POST", `${at}/execute/async`, {
      script: `${HELPERS}
(async () => { ${body} })().then((value) => done({ value: value ?? null }), (error) => done({ error: String(error && error.message || error) }));`,
      args,
    })) as { value: unknown } | { error: string };
    if ("error" in outcome) throw new Error(`In the page: ${outcome.error}`);
    return outcome.value;
  };
  return {
    run,
    async shoot(name) {
      const png = join(demo, `${name}.png`);
      writeFileSync(png, Buffer.from((await send("GET", `${at}/screenshot`)) as string, "base64"));
      execFileSync("convert", [png, "-strip", "-define", "webp:lossless=true", join(screenshots, `${name}.webp`)]);
      console.log(`Took ${name}.webp at ${String(await run("return `${innerWidth} × ${innerHeight}`;"))}`);
    },
    end: async () => void (await send("DELETE", at)),
  };
}

/**
 * Launches the app with only `folder` as a Recent Repository, in `theme`,
 * fetching nothing and checking for no Update, and opens it.
 */
async function open(folder: string, theme: "light" | "dark"): Promise<Session> {
  const first = await startSession();
  await first.run(
    `await wait(() => byText("button", "Continue for now") || document.querySelector("button.recent-open, .repository"));
    byText("button", "Continue for now")?.click();
    localStorage.clear();
    localStorage.setItem("lanewise.recent-repositories", JSON.stringify([{ root: args[0], name: args[1] }]));
    localStorage.setItem("lanewise.theme", args[2]);
    localStorage.setItem("lanewise.fetch-on-show", "off");
    localStorage.setItem("lanewise.updates.check-at-start", "false");
    setTimeout(() => location.reload(), 50);`,
    folder,
    folder.split("/").at(-1),
    theme,
  );
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await first.end();
  const session = await startSession();
  await session.run(
    `await settle();
    // A Tab kept from before is closed, for the Welcome screen's Recent Repositories.
    const entry = await wait(() => {
      byText("button", "Continue for now")?.click();
      for (const close of document.querySelectorAll(".tab-close")) close.click();
      return [...document.querySelectorAll("button.recent-open")].find((button) => button.querySelector(".recent-root")?.textContent === args[0]);
    });
    entry.click();
    await wait(() => document.querySelector(".history-row[aria-label]") || document.body.textContent.includes("Conflicted files"));
    await settle();`,
    folder,
  );
  return session;
}

execFileSync("bash", [join(root, "website/scripts/demoRepository.sh"), demo], { stdio: "inherit" });
const driver = spawn("tauri-driver", ["--port", port], { stdio: "inherit" });
try {
  for (let tries = 0; ; tries++) {
    try {
      await fetch(`${base}/status`);
      break;
    } catch {
      if (tries > 100) throw new Error("tauri-driver didn't start");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // The Repository page, with a commit's details; then a split diff of one of its files.
  const station = await open(join(demo, "station"), "light");
  await station.run(`const row = await wait(() => [...document.querySelectorAll(".history-row")].find((row) => row.textContent.includes("Round temperatures to a tenth")));
    row.focus();
    await wait(() => document.querySelector(".repository-detail")?.textContent.includes("Committer"));
    await settle();`);
  await station.shoot("repository");
  await station.run(`const row = await wait(() => [...document.querySelectorAll(".history-row")].find((row) => row.textContent.includes("Show the temperature in Fahrenheit too")));
    row.focus();
    await wait(() => document.querySelector(".repository-detail")?.textContent.includes("Show the temperature in Fahrenheit too"));
    const file = await wait(() => [...document.querySelectorAll(".repository-detail button, .repository-detail li")].find((element) => element.textContent.includes("src/format.ts")));
    (file.querySelector("button") ?? file).click();
    await wait(() => document.querySelector(".cm-editor, .split-diff, .diff"));
    await settle();`);
  await station.shoot("diff");
  await station.end();

  // The Conflicts page, partway through the merge, with its one conflicted file chosen.
  const merging = await open(join(demo, "merging"), "dark");
  await merging.run(`const file = await wait(() => [...document.querySelectorAll("button, [role=option]")].find((element) => element.textContent.includes("src/format.ts")));
    file.click();
    await wait(() => document.body.textContent.includes("Accept Ours"));
    await settle();`);
  await merging.shoot("conflicts");
  await merging.end();
} finally {
  driver.kill();
}
