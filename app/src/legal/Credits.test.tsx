// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import credits from "virtual:credits";
import { afterEach, expect, test } from "vitest";

import { expectNoAxeViolations } from "../test/axe";
import { Credits } from "./Credits";
import { REPOSITORY_URL } from "./links";

afterEach(cleanup);

test("the credits open with Lanewise's author, its source and its licence", async () => {
  render(<Credits />);

  const own = screen.getByRole("region", { name: "Lanewise" });
  expect(own).toHaveTextContent("Lanewise by Adrian Eyre");
  expect(within(own).getByRole("link", { name: /Lanewise on GitHub/ })).toHaveAttribute("href", REPOSITORY_URL);
  expect(own).toHaveTextContent("MIT licence");
  // It comes before anyone else's work.
  await screen.findByRole("region", { name: "Crates" });
  expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
    "Lanewise",
    "npm packages",
    "Crates",
  ]);
});

// axe over every package and crate takes seconds on its own, so with the rest
// of the suite running beside it, it's given longer than Vitest's 5s default.
test("every bundled npm package and crate is listed, with its version and licence", { timeout: 20_000 }, async () => {
  const { container } = render(<Credits />);

  const npm = await screen.findByRole("region", { name: "npm packages" });
  const crates = screen.getByRole("region", { name: "Crates" });
  expect(within(npm).getAllByRole("listitem")).toHaveLength(credits.npm.length);
  expect(within(crates).getAllByRole("listitem")).toHaveLength(credits.crates.length);
  expect(within(npm).getByText("react").closest("summary")).toHaveTextContent(/^react \d+\.\d+\.\d+, licence: MIT$/);
  expect(within(crates).getByText("tauri").closest("summary")).toHaveTextContent(
    /^tauri \d+\.\d+\.\d+, licence: Apache-2\.0 OR MIT$/,
  );
  await expectNoAxeViolations(container);
});

test("opening a package shows the licence texts it ships", async () => {
  const user = userEvent.setup();
  render(<Credits />);
  const npm = await screen.findByRole("region", { name: "npm packages" });

  const react = within(npm).getByText("react").closest("summary")!;
  await user.click(react);

  const entry = credits.npm.find((credit) => credit.name === "react")!;
  expect(react.parentElement).toHaveTextContent(credits.texts[entry.texts[0]!]!.split("\n")[0]!);
  expect(react.parentElement).toHaveTextContent(/Copyright \(c\) Meta Platforms/);
});
