// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { expectNoAxeViolations } from "../test/axe";
import { ChangelogText } from "./Changelog";

afterEach(cleanup);

const RELEASED = `# Changelog

All notable changes to Lanewise are documented here.

## [1.1.0](https://github.com/adrianeyre/lanewise/compare/v1.0.0...v1.1.0) (2026-10-01)

### Features

* **footer:** the version opens the Changelog ([abc1234](https://github.com/adrianeyre/lanewise/commit/abc1234))

## 1.0.0 (2026-09-30)

### Bug Fixes

* <img src=x onerror=alert(1)> stays text, as does [this](javascript:alert(1))
`;

test("each Release is a heading under the dialog's title, with its sections and changes, and the file's own title left out", async () => {
  const { container } = render(<ChangelogText markdown={RELEASED} />);

  expect(screen.queryByRole("heading", { name: "Changelog" })).toBeNull();
  expect(screen.getByText("All notable changes to Lanewise are documented here.")).toBeVisible();
  expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
    "1.1.0 (opens in a new tab) (2026-10-01)",
    "1.0.0 (2026-09-30)",
  ]);
  expect(screen.getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent)).toEqual([
    "Features",
    "Bug Fixes",
  ]);
  expect(screen.getByText("footer:").tagName).toBe("STRONG");
  expect(screen.getByRole("link", { name: /^abc1234/ })).toHaveAttribute(
    "href",
    "https://github.com/adrianeyre/lanewise/commit/abc1234",
  );
  expect(screen.queryByText("Nothing has been released yet.")).toBeNull();

  await expectNoAxeViolations(container);
});

test("a commit message's HTML and script links are only text", () => {
  const { container } = render(<ChangelogText markdown={RELEASED} />);

  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText(/<img src=x onerror=alert\(1\)> stays text, as does this\)/)).toBeVisible();
  expect(screen.queryByRole("link", { name: /^this/ })).toBeNull();
});

test("given a way to open links, as the Desktop App is, the changelog's links go through it", async () => {
  const user = userEvent.setup();
  const opened: string[] = [];
  render(<ChangelogText markdown={RELEASED} onOpenLink={(url) => opened.push(url)} />);

  await user.click(screen.getByRole("link", { name: /^1\.1\.0/ }));

  expect(opened).toEqual(["https://github.com/adrianeyre/lanewise/compare/v1.0.0...v1.1.0"]);
});

test("before the first Release, it says nothing has been released yet", () => {
  render(<ChangelogText markdown={"# Changelog\n\nAll notable changes to Lanewise are documented here.\n"} />);

  expect(screen.getByText("Nothing has been released yet.")).toBeVisible();
});
