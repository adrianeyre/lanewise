import { afterEach, expect, test, vi } from "vitest";

import type { CommandClient } from "../commands/api";
import { fakePlatform } from "../test/fakePlatform";
import { currentActivities as peek, SHOW_AFTER_MS, startActivity, withActivity } from "./activity";
import { trackCommands } from "./commandActivity";

afterEach(() => {
  vi.useRealTimers();
});

test("an Activity says what it's doing, moves on by its steps, and goes once it ends", () => {
  vi.useFakeTimers();
  const activity = startActivity("Reading your Anthropic API key…", { steps: 3 });
  expect(peek()).toMatchObject([{ words: "Reading your Anthropic API key…", percent: 0, step: { at: 1, of: 3 } }]);
  const [started] = peek();
  expect(started!.shownFrom - started!.started).toBe(SHOW_AFTER_MS);
  activity.step(3, "Asking Anthropic for a Suggestion…");
  expect(peek()).toMatchObject([{ words: "Asking Anthropic for a Suggestion…", percent: 67, step: { at: 3, of: 3 } }]);
  activity.update("Receiving objects: 45%", 45);
  expect(peek()).toMatchObject([{ words: "Receiving objects: 45%", percent: 45 }]);
  activity.end();
  activity.end();
  expect(peek()).toEqual([]);
});

test("withActivity ends its Activity however the work finishes", async () => {
  await expect(
    withActivity("Checking for the latest version…", () => {
      expect(peek()).toHaveLength(1);
      return Promise.reject(new Error("offline"));
    }),
  ).rejects.toThrow("offline");
  expect(peek()).toEqual([]);
});

test("every command shows while it runs, in its own words, but a long poll or the Logs never do", async () => {
  const answers: (() => void)[] = [];
  const fake = fakePlatform({
    commands: {
      checkOut: () =>
        new Promise((resolve) => {
          answers.push(() => resolve({ ok: true, value: { branch: "topic", stash: null } }));
        }),
    },
  });
  const commands: CommandClient = trackCommands(fake.platform.commands);
  const checkingOut = commands.call("checkOut", {
    repository: "/work/lanewise",
    branch: { kind: "localAt", name: "topic", at: "origin/topic" },
  });
  expect(peek().map((each) => each.words)).toEqual(["Moving “topic” to “origin/topic” and checking it out…"]);
  answers[0]!();
  await checkingOut;
  expect(peek()).toEqual([]);

  await commands.call("writeLog", { level: "info", message: "hello" });
  await commands.call("workingTreeChanges", { repository: "/work/lanewise", seen: null }).catch(() => {});
  expect(peek()).toEqual([]);
});

test("a fetch shows Git's progress, with its percentage, until its long poll says it's done", async () => {
  const reports = [
    { generation: 1, state: { kind: "running", progress: null } },
    {
      generation: 2,
      state: {
        kind: "running",
        progress: { phase: "Receiving objects", remote: false, done: 450, total: 1000, percent: 45, finished: false },
      },
    },
    { generation: 3, state: { kind: "fetched" } },
  ] as const;
  let at = 0;
  const fake = fakePlatform({
    commands: {
      startFetch: () => ({ ok: true, value: { operation: 7, kind: "fetch" } }),
      remoteProgress: () => ({ ok: true, value: reports[at++]! }),
    },
  });
  const commands = trackCommands(fake.platform.commands);
  await commands.call("startFetch", { repository: "/work/lanewise" });
  expect(peek().map((each) => each.words)).toEqual(["Fetching…"]);
  await commands.call("remoteProgress", { operation: 7 });
  expect(peek()).toMatchObject([{ words: "Starting…", percent: null }]);
  await commands.call("remoteProgress", { operation: 7, seen: 1 });
  expect(peek()).toMatchObject([{ words: "Receiving objects: 45% (450 of 1,000)", percent: 45 }]);
  await commands.call("remoteProgress", { operation: 7, seen: 2 });
  expect(peek()).toEqual([]);
});
