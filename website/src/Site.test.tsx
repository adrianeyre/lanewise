// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "vitest";

import { expectNoAxeViolations } from "../../app/src/test/axe";
import { REPOSITORY_URL } from "../../app/src/legal/links";
import type { Downloads } from "./downloads";
import { DOCS_URL, Site } from "./Site";
import { SCREENSHOTS } from "./screenshots";

const DOWNLOADS: Downloads = {
  version: "1.2.0",
  notes: `${REPOSITORY_URL}/releases/tag/v1.2.0`,
  macos: `${REPOSITORY_URL}/releases/download/v1.2.0/Lanewise_1.2.0_universal.dmg`,
  windows: `${REPOSITORY_URL}/releases/download/v1.2.0/Lanewise_1.2.0_x64-setup.exe`,
};

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
});

describe.each(["light", "dark"])("in the %s theme", (theme) => {
  test.each([
    ["with a Release", DOWNLOADS],
    ["before the first Release", null],
  ])("the page, %s, has no axe violations", async (_, downloads) => {
    document.documentElement.setAttribute("data-theme", theme);
    const { container } = render(<Site downloads={downloads} />);
    await expectNoAxeViolations(container);
  });
});

test("the page is Lanewise's, with a heading for each section in order", () => {
  render(<Site downloads={DOWNLOADS} />);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Lanewise");
  expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
    "What it does",
    "Screenshots",
    "Download",
    "Documentation",
  ]);
});

test("the skip link goes to the main content, which is the one main landmark", () => {
  render(<Site downloads={DOWNLOADS} />);
  expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute("href", "#main");
  expect(screen.getByRole("main")).toHaveAttribute("id", "main");
});

test("the download buttons link to the latest Release's installers, above the fold and in the download section", () => {
  render(<Site downloads={DOWNLOADS} />);
  for (const [name, href] of [
    ["Download for Windows", DOWNLOADS.windows],
    ["Download for macOS", DOWNLOADS.macos],
  ] as const) {
    const links = screen.getAllByRole("link", { name });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute("href", href);
  }
  const section = screen.getByRole("region", { name: "Download" });
  expect(within(section).getByText(/^Version 1\.2\.0\./)).toBeInTheDocument();
  expect(within(section).getByRole("link", { name: /^What's new in 1\.2\.0/ })).toHaveAttribute("href", DOWNLOADS.notes);
});

test("before the first Release, the page says there's nothing to download yet and links to the Releases", () => {
  render(<Site downloads={null} />);
  expect(screen.queryByRole("link", { name: /^Download for/ })).not.toBeInTheDocument();
  expect(screen.getAllByText(/There's no Release to download yet\./)).toHaveLength(2);
  for (const link of screen.getAllByRole("link", { name: /^Watch for the first on GitHub/ })) {
    expect(link).toHaveAttribute("href", `${REPOSITORY_URL}/releases`);
  }
});

test("the documentation and the source are linked from the header, and open in a new tab", () => {
  render(<Site downloads={DOWNLOADS} />);
  const nav = screen.getByRole("navigation", { name: "Lanewise" });
  expect(within(nav).getByRole("link", { name: "Download" })).toHaveAttribute("href", "#download");
  for (const [name, href] of [
    [/^Documentation/, DOCS_URL],
    [/^Source on GitHub/, REPOSITORY_URL],
  ] as const) {
    const link = within(nav).getByRole("link", { name });
    expect(link).toHaveAttribute("href", href);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAccessibleName(/\(opens in a new tab\)$/);
  }
  expect(screen.getByRole("link", { name: /^Read the documentation/ })).toHaveAttribute("href", DOCS_URL);
});

test("each screenshot is drawn at its own size, with what it shows in words", () => {
  render(<Site downloads={DOWNLOADS} />);
  const section = screen.getByRole("region", { name: "Screenshots" });
  const figures = within(section).getAllByRole("figure");
  expect(figures).toHaveLength(SCREENSHOTS.length);
  SCREENSHOTS.forEach((screenshot, n) => {
    const image = within(figures[n]!).getByRole("img");
    expect(image).toHaveAttribute("src", screenshot.src);
    expect(image).toHaveAttribute("width", String(screenshot.width));
    expect(image).toHaveAttribute("height", String(screenshot.height));
    expect(image).toHaveAccessibleName(screenshot.alt);
    expect(within(figures[n]!).getByText(screenshot.caption).tagName).toBe("FIGCAPTION");
  });
});

test("the page has the footer every page has, whose dialogs open", async () => {
  const user = userEvent.setup();
  render(<Site downloads={DOWNLOADS} />);
  const footer = screen.getByRole("contentinfo");
  expect(within(footer).getByText(`Version: ${import.meta.env.VITE_APP_VERSION}`)).toBeInTheDocument();
  await user.click(within(footer).getByRole("button", { name: "Cookie Policy" }));
  expect(screen.getByRole("dialog", { name: "Cookie Policy" })).toHaveTextContent(
    "Lanewise's website stores nothing on your device at all.",
  );
});
