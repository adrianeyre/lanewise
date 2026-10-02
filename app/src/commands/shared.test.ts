import { expect, test, vi } from "vitest";

import type { CommandClient } from "./api";
import { holdReads, shareReads } from "./shared";

const branches = { branches: [], remotes: [] };

function client() {
  const call = vi.fn<(name: string, request: unknown) => Promise<unknown>>(() =>
    Promise.resolve({ ok: true, value: branches }),
  );
  return { call, commands: { call } as unknown as CommandClient };
}

test("the same read asked for together is sent once, and each gets its reply", async () => {
  const { call, commands } = client();
  const shared = shareReads(commands, ["branches"]);

  const first = shared.call("branches", { repository: "/work/lanewise" });
  const second = shared.call("branches", { repository: "/work/lanewise" });

  expect(call).toHaveBeenCalledTimes(1);
  expect(await first).toEqual({ ok: true, value: branches });
  expect(await second).toEqual({ ok: true, value: branches });
});

test("a read asked for after them is sent afresh", async () => {
  const { call, commands } = client();
  const shared = shareReads(commands, ["branches"]);

  shared.call("branches", { repository: "/work/lanewise" });
  await Promise.resolve();
  shared.call("branches", { repository: "/work/lanewise" });

  expect(call).toHaveBeenCalledTimes(2);
});

test("another repository's read, or a command not shared, is sent as it is", () => {
  const { call, commands } = client();
  const shared = shareReads(commands, ["branches"]);

  shared.call("branches", { repository: "/work/lanewise" });
  shared.call("branches", { repository: "/work/other" });
  shared.call("stashes", { repository: "/work/lanewise" });
  shared.call("stashes", { repository: "/work/lanewise" });

  expect(call).toHaveBeenCalledTimes(4);
});

test("a held read waits until it's let go, then is sent, and everything else is sent at once", async () => {
  const sent: string[] = [];
  const commands = {
    call: vi.fn<(name: string) => Promise<unknown>>(async (name) => {
      sent.push(name);
      return { ok: true, value: name };
    }),
  } as unknown as CommandClient;
  const { promise, resolve } = Promise.withResolvers<void>();
  const held = holdReads(commands, ["branches"], promise);

  const asked = held.call("branches", { repository: "/work/lanewise" });
  void held.call("checkOut", { repository: "/work/lanewise", branch: { kind: "local", name: "main" } });
  await Promise.resolve();
  expect(sent).toEqual(["checkOut"]);

  resolve();
  expect(await asked).toEqual({ ok: true, value: "branches" });
  expect(sent).toEqual(["checkOut", "branches"]);

  // Once let go, a held read goes at once.
  void held.call("branches", { repository: "/work/lanewise" });
  expect(sent).toEqual(["checkOut", "branches", "branches"]);
});
