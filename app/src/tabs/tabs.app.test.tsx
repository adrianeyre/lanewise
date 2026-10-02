// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "../App";
import type { OpenedRepository, Outcome } from "../commands/api";
import { OPEN_REPOSITORIES_KEY, RECENT_REPOSITORIES_KEY } from "../settings/localSettings";
import { openFromFileMenu } from "../test/appMenu";
import { expectNoAxeViolations } from "../test/axe";
import { type FakeCommands, fakePlatform, pagedStatus } from "../test/fakePlatform";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const lanewise = { root: "/work/lanewise", name: "lanewise" };
const soundcheck = { root: "/work/soundcheck", name: "soundcheck" };
const git = { root: "/src/git", name: "git" };
const repositories = [lanewise, soundcheck, git];

/**
 * An `openRepository` that knows `known`, by their roots or any folder inside
 * them, and finds every other folder missing.
 */
function opensAny(known: OpenedRepository[] = repositories) {
  return ({ path }: { path: string }): Outcome<"openRepository"> => {
    const repository = known.find((each) => path === each.root || path.startsWith(`${each.root}/`));
    return repository
      ? { ok: true, value: repository }
      : { ok: false, error: { kind: "notAFolder", path } };
  };
}

function platformFor(folders: (string | null)[] = [], commands: FakeCommands = {}) {
  return fakePlatform({
    folders,
    commands: { openRepository: opensAny(), fileStatus: pagedStatus([]), ...commands },
  });
}

/** Each Tab's name, in order, with the selected one starred. */
function tabNames(): string[] {
  return screen
    .getAllByRole("tab")
    .map((tab) => `${tab.getAttribute("aria-selected") === "true" ? "*" : ""}${tab.querySelector(".tab-name")!.textContent}`);
}

/** Opens the first `count` repositories: the first from the Welcome screen, the rest from the File menu. */
async function openEach(count: number) {
  const user = userEvent.setup();
  for (let n = 0; n < count; n++) {
    if (n === 0) await user.click(await screen.findByRole("button", { name: "Open repository" }));
    else await openFromFileMenu(user);
    await screen.findByRole("heading", { level: 2, name: repositories[n]!.name });
  }
  return user;
}

function keep(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

test("the Welcome screen lists the Recent Repositories, most recent first, and marks a missing folder", async () => {
  keep(RECENT_REPOSITORIES_KEY, [soundcheck, { root: "/gone/old", name: "old" }, lanewise]);
  const fake = platformFor();
  const { container } = render(<App platform={fake.platform} />);

  const recent = await screen.findByRole("region", { name: "Recent repositories" });
  const entries = within(recent).getAllByRole("listitem");
  expect(entries.map((entry) => within(entry).getAllByRole("button")[0]!.textContent)).toEqual([
    "soundcheck /work/soundcheck",
    "old /gone/old",
    "lanewise /work/lanewise",
  ]);
  const missing = await within(recent).findByText("Missing: its folder isn't there any more.");
  expect(within(entries[1]!).getByRole("button", { name: "old /gone/old" })).toHaveAccessibleDescription(
    missing.textContent!,
  );
  expect(within(entries[0]!).queryByText(/Missing/)).toBeNull();
  // With nothing open, the Welcome screen has a Tab of its own.
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Welcome"]);
  await expectNoAxeViolations(container);
});

test("a Recent Repository can be removed, and focus stays in the list", async () => {
  const user = userEvent.setup();
  keep(RECENT_REPOSITORIES_KEY, [soundcheck, { root: "/gone/old", name: "old" }, lanewise]);
  render(<App platform={platformFor().platform} />);
  await screen.findByText("Missing: its folder isn't there any more.");

  await user.click(screen.getByRole("button", { name: "Remove old from recent repositories" }));

  expect(screen.queryByRole("button", { name: /^old / })).toBeNull();
  expect(screen.getByRole("button", { name: "Remove lanewise from recent repositories" })).toHaveFocus();
  expect(JSON.parse(localStorage.getItem(RECENT_REPOSITORIES_KEY)!)).toEqual([soundcheck, lanewise]);

  await user.keyboard("{Enter}");
  expect(screen.getByRole("button", { name: "Remove soundcheck from recent repositories" })).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(screen.queryByRole("region", { name: "Recent repositories" })).toBeNull();
  expect(JSON.parse(localStorage.getItem(RECENT_REPOSITORIES_KEY)!)).toEqual([]);
});

test("choosing a Recent Repository opens it in a Tab, and it comes first next time", async () => {
  const user = userEvent.setup();
  keep(RECENT_REPOSITORIES_KEY, [lanewise, soundcheck]);
  const fake = platformFor();
  render(<App platform={fake.platform} />);

  await user.click(await screen.findByRole("button", { name: "soundcheck /work/soundcheck" }));

  expect(await screen.findByRole("heading", { level: 2, name: "soundcheck" })).toBeVisible();
  expect(tabNames()).toEqual(["*soundcheck"]);
  expect(fake.dialogs).toEqual([]);
  expect(JSON.parse(localStorage.getItem(RECENT_REPOSITORIES_KEY)!)).toEqual([soundcheck, lanewise]);
});

test("a Recent Repository that won't open says why, and is marked", async () => {
  const user = userEvent.setup();
  keep(RECENT_REPOSITORIES_KEY, [lanewise]);
  let there = true;
  render(
    <App
      platform={
        platformFor([], {
          openRepository: ({ path }) =>
            there ? { ok: true, value: lanewise } : { ok: false, error: { kind: "notARepository", path } },
        }).platform
      }
    />,
  );
  const entry = await screen.findByRole("button", { name: "lanewise /work/lanewise" });
  there = false;

  await user.click(entry);

  expect(await screen.findByRole("alert")).toHaveTextContent("“/work/lanewise” isn't in a Git repository.");
  expect(await screen.findByText("No longer a Git repository.")).toBeVisible();
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Welcome"]);
});

test("each open repository is a Tab with its own Repository page, as the tabs pattern has it", async () => {
  const { container } = render(
    <App platform={platformFor(["/work/lanewise", "/work/soundcheck/src", "/src/git"]).platform} />,
  );
  await openEach(3);

  const list = screen.getByRole("tablist", { name: "Open repositories" });
  expect(tabNames()).toEqual(["lanewise", "soundcheck", "*git"]);
  const selected = within(list).getByRole("tab", { name: "git" });
  expect(selected).toHaveAttribute("tabindex", "0");
  expect(selected).toHaveAccessibleDescription(/^\/src\/git Arrow keys choose another tab/);
  for (const other of within(list).getAllByRole("tab").filter((tab) => tab !== selected)) {
    expect(other).toHaveAttribute("tabindex", "-1");
    expect(other).not.toHaveAttribute("aria-controls");
  }
  const panel = screen.getByRole("tabpanel", { name: "git" });
  expect(selected).toHaveAttribute("aria-controls", panel.id);
  expect(within(panel).getByRole("heading", { level: 2, name: "git" })).toBeVisible();
  // Only the Tab shown has its page drawn.
  expect(screen.queryByRole("heading", { level: 2, name: "lanewise" })).toBeNull();
  await expectNoAxeViolations(container);
});

test("the keyboard switches Tabs with the arrow keys, Home and End, and focus follows", async () => {
  render(<App platform={platformFor(["/work/lanewise", "/work/soundcheck", "/src/git"]).platform} />);
  const user = await openEach(3);

  screen.getByRole("tab", { name: "git" }).focus();
  await user.keyboard("{ArrowLeft}");
  expect(tabNames()).toEqual(["lanewise", "*soundcheck", "git"]);
  expect(screen.getByRole("tab", { name: "soundcheck" })).toHaveFocus();
  expect(await screen.findByRole("heading", { level: 2, name: "soundcheck" })).toBeVisible();

  await user.keyboard("{Home}");
  expect(tabNames()).toEqual(["*lanewise", "soundcheck", "git"]);
  await user.keyboard("{ArrowLeft}");
  expect(tabNames()).toEqual(["lanewise", "soundcheck", "*git"]);
  expect(screen.getByRole("tab", { name: "git" })).toHaveFocus();
  await user.keyboard("{ArrowRight}");
  expect(tabNames()).toEqual(["*lanewise", "soundcheck", "git"]);
  await user.keyboard("{End}");
  expect(tabNames()).toEqual(["lanewise", "soundcheck", "*git"]);

  // Tab leaves the tablist for the page, from the selected Tab only.
  await user.tab();
  expect(screen.getByRole("tablist")).not.toContainElement(document.activeElement as HTMLElement);
  await user.tab({ shift: true });
  expect(screen.getByRole("tab", { name: "git" })).toHaveFocus();
});

test("Shift and an arrow key move the Tab, announcing where it went, and the order is kept", async () => {
  render(<App platform={platformFor(["/work/lanewise", "/work/soundcheck", "/src/git"]).platform} />);
  const user = await openEach(3);

  screen.getByRole("tab", { name: "git" }).focus();
  await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");

  expect(tabNames()).toEqual(["lanewise", "*git", "soundcheck"]);
  expect(screen.getByRole("tab", { name: "git" })).toHaveFocus();
  expect(screen.getByText("git moved to tab 2 of 3.")).toHaveAttribute("role", "status");
  await user.keyboard("{Shift>}{ArrowLeft}{ArrowLeft}{/Shift}");
  expect(tabNames()).toEqual(["*git", "lanewise", "soundcheck"]);
  expect(JSON.parse(localStorage.getItem(OPEN_REPOSITORIES_KEY)!)).toEqual({
    repositories: ["/src/git", "/work/lanewise", "/work/soundcheck"],
    active: "/src/git",
  });
});

test("Delete closes the Tab, showing the next, and closing the last shows the Welcome screen", async () => {
  render(<App platform={platformFor(["/work/lanewise", "/work/soundcheck"]).platform} />);
  const user = await openEach(2);

  screen.getByRole("tab", { name: "lanewise" }).focus();
  await user.keyboard("{Delete}");
  expect(tabNames()).toEqual(["*soundcheck"]);
  expect(screen.getByRole("tab", { name: "soundcheck" })).toHaveFocus();
  expect(screen.getByText("lanewise closed.")).toBeVisible();

  await user.keyboard("{Delete}");
  // Closing the last shows the Welcome screen, in its own Tab.
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Welcome"]);
  expect(screen.getByText("Open a repository to see its changes.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Open repository" })).toHaveFocus();
  // Both are there to open again.
  expect(
    within(screen.getByRole("region", { name: "Recent repositories" }))
      .getAllByRole("listitem")
      .map((entry) => within(entry).getAllByRole("button")[0]!.textContent),
  ).toEqual(["soundcheck /work/soundcheck", "lanewise /work/lanewise"]);
});

test("by pointer, a Tab is chosen by clicking, closed by its × or a middle click, and moved by dragging", async () => {
  render(<App platform={platformFor(["/work/lanewise", "/work/soundcheck", "/src/git"]).platform} />);
  const user = await openEach(3);

  await user.click(screen.getByRole("tab", { name: "lanewise" }));
  expect(tabNames()).toEqual(["*lanewise", "soundcheck", "git"]);

  // Dragged onto the Tabs after it, it takes their places.
  const dragged = screen.getByRole("tab", { name: "lanewise" });
  fireEvent.pointerDown(dragged, { button: 0 });
  fireEvent.pointerEnter(screen.getByRole("tab", { name: "soundcheck" }));
  fireEvent.pointerEnter(screen.getByRole("tab", { name: "git" }));
  fireEvent.pointerUp(document);
  expect(tabNames()).toEqual(["soundcheck", "git", "*lanewise"]);
  // Once let go, it stays.
  fireEvent.pointerEnter(screen.getByRole("tab", { name: "soundcheck" }));
  expect(tabNames()).toEqual(["soundcheck", "git", "*lanewise"]);

  const close = screen.getByRole("tab", { name: "git" }).querySelector(".tab-close")!;
  await user.click(close);
  expect(tabNames()).toEqual(["soundcheck", "*lanewise"]);

  fireEvent(
    screen.getByRole("tab", { name: "soundcheck" }),
    new MouseEvent("auxclick", { bubbles: true, button: 1 }),
  );
  expect(tabNames()).toEqual(["*lanewise"]);
});

test("the Tab actions menu moves and closes the selected Tab without dragging", async () => {
  render(<App platform={platformFor(["/work/lanewise", "/work/soundcheck"]).platform} />);
  const user = await openEach(2);
  const actions = screen.getByRole("button", { name: "Tab actions" });

  await user.click(actions);
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "Move tab left",
    "Close tab",
  ]);
  await user.click(screen.getByRole("menuitem", { name: "Move tab left" }));
  expect(tabNames()).toEqual(["*soundcheck", "lanewise"]);
  expect(screen.getByText("soundcheck moved to tab 1 of 2.")).toBeVisible();

  await user.click(actions);
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "Move tab right",
    "Close tab",
  ]);
  await user.click(screen.getByRole("menuitem", { name: "Close tab" }));
  expect(tabNames()).toEqual(["*lanewise"]);
});

test("opening a repository that is already open switches to its Tab", async () => {
  const fake = platformFor(["/work/lanewise", "/work/soundcheck", "/work/lanewise/src"]);
  render(<App platform={fake.platform} />);
  const user = await openEach(2);

  await openFromFileMenu(user);

  expect(await screen.findByRole("heading", { level: 2, name: "lanewise" })).toBeVisible();
  expect(tabNames()).toEqual(["*lanewise", "soundcheck"]);
});

test("New tab shows the Welcome screen in a Tab, which the repository opened from it replaces", async () => {
  keep(RECENT_REPOSITORIES_KEY, [git]);
  render(<App platform={platformFor(["/work/lanewise"]).platform} />);
  const user = await openEach(1);

  await user.click(screen.getByRole("button", { name: "New tab" }));
  expect(tabNames()).toEqual(["lanewise", "*Welcome"]);
  const panel = screen.getByRole("tabpanel", { name: "Welcome" });
  expect(within(panel).getByText("Open a repository to see its changes.")).toBeVisible();
  await expectNoAxeViolations(document.body);
  // One Welcome Tab is enough.
  await user.click(screen.getByRole("tab", { name: "lanewise" }));
  await user.click(screen.getByRole("button", { name: "New tab" }));
  expect(tabNames()).toEqual(["lanewise", "*Welcome"]);

  await user.click(await within(panel).findByRole("button", { name: "git /src/git" }));

  expect(await screen.findByRole("heading", { level: 2, name: "git" })).toBeVisible();
  expect(tabNames()).toEqual(["lanewise", "*git"]);
});

test("the open Tabs and the Recent Repositories are restored on the next launch", async () => {
  render(<App platform={platformFor(["/work/lanewise", "/work/soundcheck", "/src/git"]).platform} />);
  const user = await openEach(3);
  await user.click(screen.getByRole("tab", { name: "soundcheck" }));
  cleanup();

  const fake = platformFor();
  const { container } = render(<App platform={fake.platform} />);

  expect(await screen.findByRole("heading", { level: 2, name: "soundcheck" })).toBeVisible();
  expect(tabNames()).toEqual(["lanewise", "*soundcheck", "git"]);
  expect(fake.calls.filter((call) => call.name === "openRepository").map((call) => call.request)).toEqual([
    { path: "/work/lanewise" },
    { path: "/work/soundcheck" },
    { path: "/src/git" },
  ]);
  await expectNoAxeViolations(container);

  // The Welcome screen's Tab isn't kept: with it shown, the first repository is shown next time.
  await user.click(screen.getByRole("button", { name: "New tab" }));
  expect(JSON.parse(localStorage.getItem(OPEN_REPOSITORIES_KEY)!)).toEqual({
    repositories: ["/work/lanewise", "/work/soundcheck", "/src/git"],
    active: null,
  });
  expect(
    within(screen.getByRole("region", { name: "Recent repositories" }))
      .getAllByRole("listitem")
      .map((entry) => within(entry).getAllByRole("button")[0]!.textContent),
  ).toEqual(["git /src/git", "soundcheck /work/soundcheck", "lanewise /work/lanewise"]);
});

test("a repository that doesn't reopen on launch is left out, saying why, and marked in Recent Repositories", async () => {
  keep(OPEN_REPOSITORIES_KEY, { repositories: ["/gone/old", "/work/lanewise"], active: "/gone/old" });
  keep(RECENT_REPOSITORIES_KEY, [{ root: "/gone/old", name: "old" }, lanewise]);
  const { container } = render(<App platform={platformFor().platform} />);

  expect(await screen.findByRole("heading", { level: 2, name: "lanewise" })).toBeVisible();
  expect(tabNames()).toEqual(["*lanewise"]);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Lanewise couldn't reopen every repository you had open. “/gone/old” isn't a folder, or is no longer there.",
  );
  expect(JSON.parse(localStorage.getItem(OPEN_REPOSITORIES_KEY)!)).toEqual({
    repositories: ["/work/lanewise"],
    active: "/work/lanewise",
  });
  await expectNoAxeViolations(container);

  await userEvent.click(screen.getByRole("button", { name: "New tab" }));
  expect(await screen.findByText("Missing: its folder isn't there any more.")).toBeVisible();
});
