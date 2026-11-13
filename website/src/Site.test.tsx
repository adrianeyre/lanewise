// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "vitest";

import { expectNoAxeViolations } from "../../app/src/test/axe";
import { REPOSITORY_URL } from "../../app/src/legal/links";
import type { Downloads } from "./downloads";
import { buildDocUrl, DOCS_INDEX_URL, GUIDES } from "./Setup";
import { Site } from "./Site";
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
    "What you need",
    "Install",
    "Build from source",
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

test("the header links to each section of the page, and to the source in a new tab", () => {
  render(<Site downloads={DOWNLOADS} />);
  const nav = screen.getByRole("navigation", { name: "Lanewise" });
  for (const [name, href] of [
    ["Download", "#download"],
    ["Install", "#install"],
    ["Build from source", "#build"],
    ["Documentation", "#docs"],
  ] as const) {
    expect(within(nav).getByRole("link", { name })).toHaveAttribute("href", href);
    expect(document.getElementById(href.slice(1))).toBeInTheDocument();
  }
  const source = within(nav).getByRole("link", { name: /^Source on GitHub/ });
  expect(source).toHaveAttribute("href", REPOSITORY_URL);
  expect(source).toHaveAttribute("target", "_blank");
  expect(source).toHaveAccessibleName(/\(opens in a new tab\)$/);
});

test("Install has the steps for Windows, macOS and Linux, each linking its Setup guide", () => {
  render(<Site downloads={DOWNLOADS} />);
  const install = screen.getByRole("region", { name: "Install" });
  for (const [system, guide] of [
    ["Windows", "setup/windows.md"],
    ["macOS", "setup/macos.md"],
    ["Linux", "setup/linux.md"],
  ] as const) {
    const block = within(install).getByRole("region", { name: system });
    expect(within(block).getAllByRole("listitem").length).toBeGreaterThan(1);
    expect(within(block).getByRole("link", { name: new RegExp(`^Every step on ${system}`) })).toHaveAttribute(
      "href",
      buildDocUrl(guide),
    );
  }
  const windows = within(install).getByRole("region", { name: "Windows" });
  expect(windows).toHaveTextContent("winget install --id Git.Git -e --source winget");
  expect(windows).toHaveTextContent("More info, then Run anyway");
});

test("Install gives every Terminal command for opening the Mac app, which isn't notarized", () => {
  render(<Site downloads={DOWNLOADS} />);
  const macos = within(screen.getByRole("region", { name: "Install" })).getByRole("region", { name: "macOS" });
  for (const command of [
    "brew install git",
    "brew install --cask git-credential-manager",
    "hdiutil attach -nobrowse -mountpoint /tmp/lanewise-dmg ~/Downloads/Lanewise_*_universal.dmg",
    "xattr -d com.apple.quarantine /Applications/Lanewise.app",
    "xattr -dr com.apple.quarantine /Applications/Lanewise.app",
    "xattr -cr /Applications/Lanewise.app",
    "codesign --force --deep --sign - /Applications/Lanewise.app",
    "open /Applications/Lanewise.app",
  ]) {
    expect(macos).toHaveTextContent(command, { normalizeWhitespace: false });
  }
  expect(macos).toHaveTextContent("System Settings → Privacy & Security");
  expect(macos).toHaveTextContent("Open Anyway");
});

test("each block of commands can be reached and scrolled from the keyboard, and is named", () => {
  render(<Site downloads={DOWNLOADS} />);
  const blocks = document.querySelectorAll("pre");
  expect(blocks.length).toBeGreaterThan(5);
  for (const block of blocks) {
    expect(block).toHaveAttribute("tabindex", "0");
    expect(block).toHaveAccessibleName(/commands$/);
  }
});

test("Build from source gives each system's tools, then the same commands for all", () => {
  render(<Site downloads={DOWNLOADS} />);
  const build = screen.getByRole("region", { name: "Build from source" });
  for (const system of ["Windows", "macOS", "Linux"]) {
    expect(within(build).getByRole("region", { name: `Tools for ${system}` })).toBeInTheDocument();
  }
  for (const command of ["corepack enable", "git clone https://github.com/adrianeyre/lanewise.git", "pnpm desktop:dev", "pnpm test"]) {
    expect(build).toHaveTextContent(command);
  }
});

test("Documentation links every Setup guide and the index of every document, in a new tab", () => {
  render(<Site downloads={DOWNLOADS} />);
  const docs = screen.getByRole("region", { name: "Documentation" });
  for (const guide of GUIDES) {
    const link = within(docs).getByRole("link", { name: new RegExp(`^${guide.name}`) });
    expect(link).toHaveAttribute("href", buildDocUrl(guide.path));
    expect(link).toHaveAttribute("target", "_blank");
  }
  expect(within(docs).getByRole("link", { name: /^Every document/ })).toHaveAttribute("href", DOCS_INDEX_URL);
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
