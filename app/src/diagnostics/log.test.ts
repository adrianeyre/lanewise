// @vitest-environment jsdom
import { expect, test } from "vitest";

import { fakePlatform } from "../test/fakePlatform";
import { logUncaught, uncaughtWords, writeLog } from "./log";

test("a line goes to Lanewise's logs, and one that can't be written is let go", async () => {
  const fake = fakePlatform({});
  writeLog(fake.platform.commands, "info", "Opened a repository");
  expect(fake.logs).toEqual([{ level: "info", message: "Opened a repository" }]);

  const refusing = { call: () => Promise.reject(new Error("no core")) };
  expect(() => writeLog(refusing, "error", "lost")).not.toThrow();
  await Promise.resolve();
});

test("an uncaught error is logged by its name and where it was thrown, never its message", () => {
  const thrown = new TypeError("Cannot read “sk-ant-secret” of the file's contents");
  thrown.stack = [
    "TypeError: Cannot read “sk-ant-secret” of the file's contents",
    "    at readHunk (http://localhost/src/conflicts/hunks.ts:12:3)",
    "    at ConflictsPage (http://localhost/src/conflicts/ConflictsPage.tsx:40:9)",
  ].join("\n");

  expect(uncaughtWords(thrown)).toBe(
    "TypeError at readHunk (http://localhost/src/conflicts/hunks.ts:12:3) | at ConflictsPage (http://localhost/src/conflicts/ConflictsPage.tsx:40:9)",
  );
});

test("WebKit's stack, with no heading, is kept as its frames, and a message spread over lines is still left out", () => {
  const thrown = new RangeError("the prompt\\nsaid this");
  thrown.stack = "readHunk@tauri://localhost/assets/index.js:1:200\nConflictsPage@tauri://localhost/assets/index.js:1:900";
  expect(uncaughtWords(thrown)).toBe(
    "RangeError readHunk@tauri://localhost/assets/index.js:1:200 | ConflictsPage@tauri://localhost/assets/index.js:1:900",
  );

  const spread = new Error("line one\nline two, from the file");
  spread.stack = "Error: line one\nline two, from the file\n    at somewhere (app.ts:1:1)";
  expect(uncaughtWords(spread)).toBe("Error at somewhere (app.ts:1:1)");
});

test("an error with no stack is its name, and anything thrown that isn't an Error is its type", () => {
  const bare = new SyntaxError("the contents");
  bare.stack = undefined;
  expect(uncaughtWords(bare)).toBe("SyntaxError");
  expect(uncaughtWords("the prompt")).toBe("something that isn't an Error (string)");
  expect(uncaughtWords(undefined)).toBe("something that isn't an Error (undefined)");
});

test("uncaught errors and unhandled rejections are logged until it's stopped", () => {
  const fake = fakePlatform({});
  // Not the window itself, where Vitest counts an error as the test's own.
  const target = new EventTarget();
  const stop = logUncaught(fake.platform.commands, target);
  const thrown = new Error("secret");
  thrown.stack = "Error: secret\n    at here (app.ts:1:1)";

  target.dispatchEvent(new ErrorEvent("error", { error: thrown }));
  const rejection = Object.assign(new Event("unhandledrejection"), { reason: 42 });
  target.dispatchEvent(rejection);
  stop();
  target.dispatchEvent(new ErrorEvent("error", { error: thrown }));

  expect(fake.logs).toEqual([
    { level: "error", message: "Uncaught Error at here (app.ts:1:1)" },
    { level: "error", message: "Unhandled rejection: something that isn't an Error (number)" },
  ]);
});
