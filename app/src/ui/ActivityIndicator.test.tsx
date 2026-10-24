// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { ACTIVITY_PLACE_KEY } from "../settings/localSettings";
import { expectNoAxeViolations } from "../test/axe";
import { type ActivityHandle, SHOW_AFTER_MS, startActivity } from "./activity";
import { ActivityIndicator } from "./ActivityIndicator";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

/** Starts an Activity and waits until the indicator shows it, then hands back the real clock. */
function showActivity(words = "Fetching from origin…"): { handle: ActivityHandle; shown: HTMLElement } {
  vi.useFakeTimers();
  let handle!: ActivityHandle;
  act(() => {
    handle = startActivity(words);
  });
  act(() => vi.advanceTimersByTime(SHOW_AFTER_MS + 250));
  vi.useRealTimers();
  return { handle, shown: screen.getByTestId("activity") };
}

/** Where the indicator is, from the window's right and bottom edges. */
function placeOf(shown: HTMLElement): { right: string; bottom: string } {
  const layer = shown.parentElement!;
  return { right: layer.style.right, bottom: layer.style.bottom };
}

test("something that takes time shows a spinner, what it's doing, its step and a bar of how far it has got", async () => {
  vi.useFakeTimers();
  const { container } = render(
    <main>
      <ActivityIndicator />
    </main>,
  );
  let activity!: ActivityHandle;
  act(() => {
    activity = startActivity("Reading your Anthropic API key…", { steps: 3 });
  });
  // Nothing flashes for what's quickly done.
  expect(screen.queryByTestId("activity")).toBeNull();
  act(() => vi.advanceTimersByTime(SHOW_AFTER_MS + 250));
  const shown = screen.getByTestId("activity");
  expect(shown).toHaveTextContent("Reading your Anthropic API key…");
  expect(shown).toHaveTextContent("Step 1 of 3");
  expect(screen.getByRole("progressbar", { name: "Reading your Anthropic API key…" })).toHaveAttribute(
    "aria-valuenow",
    "0",
  );

  // The words change as it moves on, so nobody takes it for stuck.
  act(() => activity.step(3, "Asking Anthropic (claude-opus-5-5) for a Suggestion…"));
  expect(shown).toHaveTextContent("Step 3 of 3");
  expect(shown).toHaveTextContent("67%");
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "67");
  act(() => vi.advanceTimersByTime(2000));
  expect(shown).toHaveTextContent("2s");
  vi.useRealTimers();
  await expectNoAxeViolations(container);

  act(() => activity.end());
  expect(screen.queryByTestId("activity")).toBeNull();
});

test("where how far isn't known, the bar says so rather than a percentage", () => {
  vi.useFakeTimers();
  render(<ActivityIndicator />);
  let activity!: ActivityHandle;
  act(() => {
    activity = startActivity("Listing your repositories on github.com…");
  });
  act(() => vi.advanceTimersByTime(SHOW_AFTER_MS + 250));
  const bar = screen.getByRole("progressbar", { name: "Listing your repositories on github.com…" });
  expect(bar).not.toHaveAttribute("aria-valuenow");
  expect(bar).toHaveAttribute("data-indeterminate");
  act(() => activity.end());
});

test("it's dragged with the mouse, and kept where it's put for the next time Lanewise opens", async () => {
  const { container, unmount } = render(
    <main>
      <ActivityIndicator />
    </main>,
  );
  const { handle, shown } = showActivity();
  expect(placeOf(shown)).toEqual({ right: "16px", bottom: "36px" });
  await expectNoAxeViolations(container);

  fireEvent.pointerDown(shown, { button: 0, clientX: 500, clientY: 500, pointerId: 1 });
  // A press that barely moves isn't a drag.
  fireEvent.pointerMove(shown, { clientX: 502, clientY: 501, pointerId: 1 });
  expect(placeOf(shown)).toEqual({ right: "16px", bottom: "36px" });
  fireEvent.pointerMove(shown, { clientX: 400, clientY: 300, pointerId: 1 });
  expect(placeOf(shown)).toEqual({ right: "116px", bottom: "236px" });
  // Not kept until it's let go.
  expect(localStorage.getItem(ACTIVITY_PLACE_KEY)).toBeNull();
  fireEvent.pointerUp(shown, { clientX: 400, clientY: 300, pointerId: 1 });
  expect(JSON.parse(localStorage.getItem(ACTIVITY_PLACE_KEY) ?? "")).toEqual({ right: 116, bottom: 236 });
  // It can't be dragged out of the window.
  fireEvent.pointerDown(shown, { button: 0, clientX: 400, clientY: 300, pointerId: 1 });
  fireEvent.pointerMove(shown, { clientX: 5000, clientY: 5000, pointerId: 1 });
  fireEvent.pointerUp(shown, { clientX: 5000, clientY: 5000, pointerId: 1 });
  expect(placeOf(shown)).toEqual({ right: "0px", bottom: "0px" });
  act(() => handle.end());
  unmount();

  // Opened again, it's where it was left.
  localStorage.setItem(ACTIVITY_PLACE_KEY, JSON.stringify({ right: 116, bottom: 236 }));
  render(<ActivityIndicator />);
  const again = showActivity();
  expect(placeOf(again.shown)).toEqual({ right: "116px", bottom: "236px" });
  act(() => again.handle.end());
});

test("its grip moves it with the arrow keys, and Home puts it back", async () => {
  const user = userEvent.setup();
  render(<ActivityIndicator />);
  const { handle, shown } = showActivity();
  const grip = within(shown).getByRole("button", { name: "Move the progress" });
  expect(grip).toHaveAccessibleDescription(/arrow keys move it/);

  grip.focus();
  await user.keyboard("{ArrowLeft}{ArrowUp}{ArrowUp}");
  expect(placeOf(shown)).toEqual({ right: "32px", bottom: "68px" });
  await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
  expect(placeOf(shown)).toEqual({ right: "96px", bottom: "68px" });
  expect(JSON.parse(localStorage.getItem(ACTIVITY_PLACE_KEY) ?? "")).toEqual({ right: 96, bottom: 68 });
  await user.keyboard("{Home}");
  expect(placeOf(shown)).toEqual({ right: "16px", bottom: "36px" });
  act(() => handle.end());
});

test("its grip's menu sends it to a corner, so it never needs dragging", async () => {
  const user = userEvent.setup();
  const { container } = render(
    <main>
      <ActivityIndicator />
    </main>,
  );
  const { handle, shown } = showActivity();
  const grip = within(shown).getByRole("button", { name: "Move the progress" });

  await user.click(grip);
  const menu = screen.getByRole("menu", { name: "Move the progress" });
  expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "Move to the bottom right",
    "Move to the bottom left",
    "Move to the top left",
    "Move to the top right",
  ]);
  await expectNoAxeViolations(container);
  await user.click(within(menu).getByRole("menuitem", { name: "Move to the top left" }));
  // jsdom's window is 1024 by 768, and draws the indicator no size at all.
  expect(placeOf(shown)).toEqual({ right: "1008px", bottom: "752px" });
  expect(screen.queryByRole("menu")).toBeNull();

  // Shift+F10 opens it from the keyboard too.
  grip.focus();
  await user.keyboard("{Shift>}{F10}{/Shift}");
  await user.click(screen.getByRole("menuitem", { name: "Move to the bottom right" }));
  expect(placeOf(shown)).toEqual({ right: "16px", bottom: "36px" });
  act(() => handle.end());
});
