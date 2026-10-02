// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { expectNoAxeViolations } from "../test/axe";
import { type ActivityHandle, SHOW_AFTER_MS, startActivity } from "./activity";
import { ActivityIndicator } from "./ActivityIndicator";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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
