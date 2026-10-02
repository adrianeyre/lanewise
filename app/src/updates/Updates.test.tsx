// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "../App";
import { UPDATE_CHECK_KEY } from "../settings/localSettings";
import { expectNoAxeViolations } from "../test/axe";
import { type FakeCommands, fakePlatform, historyCommit } from "../test/fakePlatform";
import { fakeUpdater, FOUND } from "../test/fakeUpdater";
import { RELEASES_URL } from "./updater";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const lanewise = { root: "/work/lanewise", name: "lanewise" };

function started(updater = fakeUpdater(), commands: FakeCommands = {}) {
  const user = userEvent.setup();
  const fake = fakePlatform({
    folders: [lanewise.root],
    commands: { openRepository: () => ({ ok: true, value: lanewise }), ...commands },
    updater: updater.updater,
  });
  const { container } = render(<App platform={fake.platform} />);
  return { user, fake, updater, container };
}

async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Settings" }));
  return within(screen.getByRole("dialog", { name: "Settings" })).getByRole("region", { name: "Updates" });
}

const notice = () => screen.queryByRole("region", { name: "Lanewise 1.2.3 is out" });

test("an Update found at start is offered under the title bar, to install now or later, and nothing is installed until the user says so", async () => {
  const { updater, container } = started();

  const offered = await screen.findByRole("region", { name: "Lanewise 1.2.3 is out" });
  expect(offered).toHaveTextContent("You have 1.0.0. Settings has what's new. Installing it restarts Lanewise.");
  expect(within(offered).getByRole("button", { name: "Install and restart" })).toBeVisible();
  expect(within(offered).getByRole("button", { name: "Later" })).toBeVisible();
  expect(updater.checks).toBe(1);
  expect(updater.installs).toBe(0);
  await expectNoAxeViolations(container);
});

test("Later puts the notice off, and Settings still has the Update, with what's new in it, to install", async () => {
  const { user, updater, container } = started();
  await user.click(await screen.findByRole("button", { name: "Later" }));
  expect(notice()).toBeNull();

  const settings = await openSettings(user);
  expect(settings).toHaveTextContent(/You have Lanewise 1\.0\.0\./);
  expect(settings).toHaveTextContent(
    `Lanewise 1.2.3 is out (released ${new Date(FOUND.date!).toLocaleDateString()}).`,
  );
  const notes = within(settings).getByRole("group", { name: "What's new" });
  expect(notes).toHaveTextContent("Check for and install Updates in the Desktop App");
  // It scrolls on its own, and the keyboard can reach it to scroll it.
  expect(notes).toHaveAttribute("tabindex", "0");
  expect(updater.installs).toBe(0);
  await expectNoAxeViolations(container);
});

test("installing shows the download's progress, and one that fails says why and can be tried again", async () => {
  const { user, updater, container } = started();
  await user.click(await screen.findByRole("button", { name: "Install and restart" }));

  expect(updater.installs).toBe(1);
  const offered = notice()!;
  expect(offered).toHaveTextContent("Downloading it. Lanewise restarts once it is installed.");
  act(() => updater.progress(0.4));
  expect(within(offered).getByRole("progressbar", { name: "Lanewise 1.2.3 is out" })).toHaveAttribute(
    "aria-valuetext",
    "40% downloaded",
  );
  await expectNoAxeViolations(container);

  await act(async () => updater.failInstall("The Update's signature isn't Lanewise's, so it wasn't installed."));
  expect(within(offered).getByRole("alert")).toHaveTextContent(
    "The Update's signature isn't Lanewise's, so it wasn't installed.",
  );
  await user.click(within(offered).getByRole("button", { name: "Try again" }));
  expect(updater.installs).toBe(2);
});

test("with the check at start turned off in Settings, the next start checks only when asked", async () => {
  const first = started(fakeUpdater({ found: null }));
  const settings = await openSettings(first.user);
  const checkAtStart = within(settings).getByRole("checkbox", { name: "Check for updates when Lanewise starts" });
  expect(checkAtStart).toBeChecked();
  expect(checkAtStart).toHaveAccessibleDescription(/sending nothing about you or how you use it/);
  await first.user.click(checkAtStart);
  expect(localStorage.getItem(UPDATE_CHECK_KEY)).toBe("false");
  cleanup();

  const { user, updater, container } = started(fakeUpdater({ found: null }));
  const again = await openSettings(user);
  expect(within(again).getByRole("checkbox", { name: /Check for updates when/ })).not.toBeChecked();
  expect(updater.checks).toBe(0);

  await user.click(within(again).getByRole("button", { name: "Check for updates" }));
  expect(updater.checks).toBe(1);
  expect(within(again).getByRole("status")).toHaveTextContent("Lanewise 1.0.0 is the latest Release.");
  await expectNoAxeViolations(container);
});

test("a check at start that fails, as offline, interrupts nothing, and Settings says why", async () => {
  const { user } = started(fakeUpdater({ found: new Error("Lanewise couldn't reach GitHub to check for an Update.") }));
  const settings = await openSettings(user);

  expect(await within(settings).findByRole("alert")).toHaveTextContent(
    "Lanewise couldn't reach GitHub to check for an Update.",
  );
  expect(notice()).toBeNull();
});

test("a copy that doesn't update itself never checks, and Settings says where the Releases are", async () => {
  const { user, fake, updater, container } = started(fakeUpdater({ status: { version: "0.1.0", off: "not-installed" } }));
  const settings = await openSettings(user);

  expect(await within(settings).findByText(/wasn't installed from a Release, so it can't update itself/)).toBeVisible();
  expect(within(settings).queryByRole("button", { name: "Check for updates" })).toBeNull();
  await user.click(within(settings).getByRole("link", { name: /Lanewise's Releases/ }));
  expect(fake.links).toEqual([RELEASES_URL]);
  expect(updater.checks).toBe(0);
  await expectNoAxeViolations(container);
});

test("without an updater, as in Web Mode, Settings has no Updates", async () => {
  const user = userEvent.setup();
  render(<App platform={fakePlatform({}).platform} />);
  await user.click(screen.getByRole("button", { name: "Settings" }));

  expect(within(screen.getByRole("dialog", { name: "Settings" })).queryByRole("region", { name: "Updates" })).toBeNull();
});

test("the notice never shows on a Conflicts page, and an Update isn't installed while an In-Progress Operation is", async () => {
  const merge = { kind: "merge" as const, into: "main", merging: [historyCommit(2)], conflicts: [], resolved: [] };
  const { user, updater, container } = started(fakeUpdater(), {
    operationInProgress: () => ({ ok: true, value: merge }),
  });
  expect(await screen.findByRole("region", { name: "Lanewise 1.2.3 is out" })).toBeVisible();
  await user.click(await screen.findByRole("button", { name: "Open repository" }));

  expect(await screen.findByRole("region", { name: "Merge in progress" })).toBeVisible();
  // The Tab says it shows its Conflicts page once that page is drawn.
  await waitFor(() => expect(notice()).toBeNull());

  await user.click(screen.getByRole("button", { name: "New tab" }));
  const offered = await screen.findByRole("region", { name: "Lanewise 1.2.3 is out" });
  await user.click(within(offered).getByRole("button", { name: "Install and restart" }));

  expect(await within(offered).findByRole("alert")).toHaveTextContent(
    "A merge is in progress in lanewise. Finish or abort it on its Conflicts page first: installing the Update restarts Lanewise.",
  );
  expect(updater.installs).toBe(0);
  await expectNoAxeViolations(container);
});
