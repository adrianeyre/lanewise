// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { expectNoAxeViolations } from "../test/axe";
import { CookiePolicy } from "./CookiePolicy";
import { STORED_ITEMS } from "./stored";

afterEach(cleanup);

function storedNames(): string[] {
  const table = screen.getByRole("table", { name: "Items Lanewise may save in local storage on this device." });
  const [, ...rows] = within(table).getAllByRole("row");
  return rows.map((row) => within(row).getAllByRole("cell")[0]!.textContent ?? "");
}

test("the Cookie Policy lists the theme, the base folder, fetching on switching tabs, the left column's open sections, the columns' widths, recent and open repositories, GitHub Enterprise Servers, the diff size limit and view, Model Provider choices and the check for Updates", async () => {
  const { container } = render(<CookiePolicy />);

  expect(storedNames()).toEqual([
    "lanewise.theme",
    "lanewise.palette",
    "lanewise.avatars",
    "lanewise.hostPages",
    "lanewise.base-folder",
    "lanewise.fetch-on-show",
    "lanewise.sidebar-sections",
    "lanewise.column-widths",
    "lanewise.history-columns",
    "lanewise.recent-repositories",
    "lanewise.open-repositories",
    "lanewise.github-enterprise-hosts",
    "lanewise.diff-limit",
    "lanewise.diff-view",
    "lanewise.model-provider",
    "lanewise.jev",
    "lanewise.updates.check-at-start",
  ]);
  expect(storedNames()).toEqual(STORED_ITEMS.map((item) => item.name));
  const table = screen.getByRole("table");
  expect(within(table).getByRole("row", { name: /lanewise\.theme/ })).toHaveTextContent(/colour theme/);
  expect(within(table).getByRole("row", { name: /lanewise\.base-folder/ })).toHaveTextContent(
    /folder on this machine you keep your repositories in/,
  );
  expect(within(table).getByRole("row", { name: /lanewise\.sidebar-sections/ })).toHaveTextContent(/closed or opened/);
  expect(within(table).getByRole("row", { name: /lanewise\.column-widths/ })).toHaveTextContent(/how wide/);
  expect(within(table).getByRole("row", { name: /lanewise\.history-columns/ })).toHaveTextContent(/size to fit/);
  expect(within(table).getByRole("row", { name: /lanewise\.recent-repositories/ })).toHaveTextContent(
    /repositories you opened recently/,
  );
  expect(within(table).getByRole("row", { name: /lanewise\.open-repositories/ })).toHaveTextContent(
    /repositories you have open in tabs/,
  );
  expect(within(table).getByRole("row", { name: /lanewise\.github-enterprise-hosts/ })).toHaveTextContent(
    /GitHub Enterprise Servers you added in Settings.*Never your password or token/,
  );
  expect(within(table).getByRole("row", { name: /lanewise\.diff-limit/ })).toHaveTextContent(
    /how many lines a diff may have/,
  );
  expect(within(table).getByRole("row", { name: /lanewise\.diff-view/ })).toHaveTextContent(
    /two sides next to each other/,
  );
  expect(within(table).getByRole("row", { name: /lanewise\.model-provider/ })).toHaveTextContent(
    /Model Provider, model, version and effort, .*Never your API keys\./,
  );
  expect(within(table).getByRole("row", { name: /lanewise\.updates\.check-at-start/ })).toHaveTextContent(
    /checks for an Update each time it starts/,
  );
  // The table scrolls on its own, and the keyboard can reach it to scroll it.
  expect(screen.getByRole("group", { name: /Items Lanewise may save/ })).toHaveAttribute("tabindex", "0");
  await expectNoAxeViolations(container);
});

test("it says keys are never stored there, and there are no tracking, analytics or advertising cookies", () => {
  render(<CookiePolicy />);

  expect(screen.getByText(/no tracking, analytics or advertising cookies/)).toBeVisible();
  expect(screen.getByText(/no cookies/).closest("p")).toHaveTextContent(/That is why there is no cookie banner\./);
  const keys = screen.getByRole("heading", { level: 3, name: "Your API keys" }).nextElementSibling;
  expect(keys).toHaveTextContent(/never kept in local storage/);
  expect(keys).toHaveTextContent(/operating system's credential store/);
  expect(screen.getByRole("heading", { level: 3, name: "The project website" }).nextElementSibling).toHaveTextContent(
    "Lanewise's website stores nothing on your device at all.",
  );
});

test("it says the logs stay on this device, hold no secrets and aren't sent: there is no telemetry", () => {
  render(<CookiePolicy />);

  const logs = screen.getByRole("heading", { level: 3, name: "Lanewise's logs" }).nextElementSibling;
  expect(logs).toHaveTextContent(/never hold credentials, API keys, your files' contents or prompts/);
  expect(logs).toHaveTextContent(/there is no telemetry of any kind/);
  expect(logs).toHaveTextContent(/Copy diagnostics/);
});
