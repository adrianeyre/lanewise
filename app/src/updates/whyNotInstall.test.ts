import { expect, test } from "vitest";

import type { InProgressOperation } from "../commands/api";
import { fakePlatform, historyCommit } from "../test/fakePlatform";
import { whyNotInstall } from "./whyNotInstall";

const lanewise = { root: "/work/lanewise", name: "lanewise" };
const soundcheck = { root: "/work/soundcheck", name: "soundcheck" };
const open = [lanewise, soundcheck];

const rebase: InProgressOperation = {
  kind: "rebase",
  branch: "feature",
  onto: historyCommit(1),
  step: 2,
  steps: 3,
  conflicts: ["README.md"],
  resolved: [],
};

test("with nothing running and nothing in progress, the Update may be installed", async () => {
  const fake = fakePlatform({});

  await expect(whyNotInstall(fake.platform.commands, open, false)).resolves.toBeNull();
  expect(fake.calls.map(({ name, request }) => [name, request])).toEqual([
    ["remoteOperation", { repository: lanewise.root }],
    ["operationInProgress", { repository: lanewise.root }],
    ["remoteOperation", { repository: soundcheck.root }],
    ["operationInProgress", { repository: soundcheck.root }],
  ]);
});

test("a clone running is a reason to wait", async () => {
  const fake = fakePlatform({});

  await expect(whyNotInstall(fake.platform.commands, open, true)).resolves.toBe(
    "A clone is running. Let it finish, or cancel it, first: installing the Update restarts Lanewise.",
  );
});

test("a fetch, pull or push running in any open repository is a reason to wait", async () => {
  const fake = fakePlatform({
    commands: {
      remoteOperation: ({ repository }) => ({
        ok: true,
        value: repository === soundcheck.root ? { operation: 1, kind: "pull" } : null,
      }),
    },
  });

  await expect(whyNotInstall(fake.platform.commands, open, false)).resolves.toBe(
    "A pull is running in soundcheck. Let it finish first: installing the Update restarts Lanewise.",
  );
});

test("an In-Progress Operation in any open repository is a reason to wait", async () => {
  const fake = fakePlatform({
    commands: {
      operationInProgress: ({ repository }) => ({ ok: true, value: repository === soundcheck.root ? rebase : null }),
    },
  });

  await expect(whyNotInstall(fake.platform.commands, open, false)).resolves.toBe(
    "A rebase is in progress in soundcheck. Finish or abort it on its Conflicts page first: installing the Update restarts Lanewise.",
  );
});

test("a repository that can't be asked about is a reason to wait, since it can't be known to be safe", async () => {
  const fake = fakePlatform({
    commands: {
      operationInProgress: () => {
        throw new Error("The core stopped.");
      },
    },
  });

  await expect(whyNotInstall(fake.platform.commands, [lanewise], false)).resolves.toBe(
    "Lanewise couldn't tell whether anything is running in lanewise, so it hasn't installed the Update. Try again.",
  );
});
