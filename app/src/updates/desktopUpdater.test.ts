import { afterEach, expect, test, vi } from "vitest";

import { desktopUpdater, type Invoke, PROGRESS_MS } from "./desktopUpdater";

afterEach(() => {
  vi.useRealTimers();
});

/** An `invoke` that answers each command from `answers`, and records what was sent. */
function invoking(answers: Record<string, (() => unknown) | undefined>) {
  const sent: string[] = [];
  const invoke = (async (command: string) => {
    sent.push(command);
    const answer = answers[command];
    if (!answer) throw `No answer for ${command}`;
    return answer();
  }) as Invoke;
  return { invoke, sent };
}

test("the status and a check are the shell's own update commands", async () => {
  const found = { version: "1.2.3", date: null, notes: "Bug Fixes\n• Draw the graph faster" };
  const { invoke, sent } = invoking({
    update_status: () => ({ version: "1.0.0", off: null }),
    update_check: () => found,
  });
  const updater = desktopUpdater(invoke);

  await expect(updater.status()).resolves.toEqual({ version: "1.0.0", off: null });
  await expect(updater.check()).resolves.toEqual(found);
  expect(sent).toEqual(["update_status", "update_check"]);
});

test("what the shell rejects with becomes an Error saying it", async () => {
  const { invoke } = invoking({
    update_check: () => {
      throw "Lanewise couldn't reach GitHub to check for an Update.";
    },
  });

  await expect(desktopUpdater(invoke).check()).rejects.toThrow(
    new Error("Lanewise couldn't reach GitHub to check for an Update."),
  );
});

test("an install polls the download's progress until it settles, and a failed one says why", async () => {
  vi.useFakeTimers();
  let fail: ((why: string) => void) | undefined;
  let downloaded = 0;
  const { invoke, sent } = invoking({
    update_install: () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
    update_progress: () => (downloaded += 0.25),
  });
  const said: number[] = [];

  const installing = desktopUpdater(invoke).install((fraction) => said.push(fraction));
  const failed = installing.catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(PROGRESS_MS * 2);
  expect(said).toEqual([0.25, 0.5]);

  fail?.("The Update's signature isn't Lanewise's.");
  expect(await failed).toEqual(new Error("The Update's signature isn't Lanewise's."));
  await vi.advanceTimersByTimeAsync(PROGRESS_MS * 4);
  expect(said).toEqual([0.25, 0.5]);
  expect(sent.filter((command) => command === "update_install")).toHaveLength(1);
});
