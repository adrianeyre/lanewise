// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { expectNoAxeViolations } from "../test/axe";
import { Footer } from "./Footer";
import { REPOSITORY_URL } from "./links";

afterEach(cleanup);

const { version } = JSON.parse(readFileSync(join(import.meta.dirname, "../../../package.json"), "utf8")) as {
  version: string;
};

/** Each modal: the button that opens it, its title, its close button's label and its last heading. */
const MODALS = [
  { button: "Privacy Policy", title: "Privacy Policy", close: "Close privacy policy", last: "Contact us" },
  {
    button: "Terms and Conditions",
    title: "Terms and Conditions",
    close: "Close terms and conditions",
    last: "Contact us",
  },
  { button: "Cookie Policy", title: "Cookie Policy", close: "Close cookie policy", last: "Contact us" },
  {
    button: "Accessibility",
    title: "Accessibility",
    close: "Close accessibility statement",
    last: "If something does not work for you",
  },
  // The bundled credits load when the dialog opens.
  { button: "Credits", title: "Credits", close: "Close credits", last: "Crates" },
] as const;

test("the footer has Site design, the version, then Privacy Policy, Terms and Conditions, Cookie Policy, Accessibility and Credits, in order", () => {
  render(<Footer />);

  const nav = within(screen.getByRole("contentinfo")).getByRole("navigation", { name: "About Lanewise" });
  expect([...nav.children].map((item) => item.textContent)).toEqual([
    "Site design (source on GitHub, opens in a new tab)",
    `Version: ${version}`,
    "Privacy Policy",
    "Terms and Conditions",
    "Cookie Policy",
    "Accessibility",
    "Credits",
  ]);
  expect(within(nav).getByRole("button", { name: `Version: ${version}` })).toBeVisible();
  for (const name of ["Privacy Policy", "Terms and Conditions", "Cookie Policy", "Accessibility", "Credits"]) {
    expect(within(nav).getByRole("button", { name })).toBeVisible();
  }
});

test("Site design is GitHub's mark, linking to Lanewise's source in a new tab", () => {
  render(<Footer />);

  // jsdom's name computation drops the space that starts the hidden note, which browsers keep.
  const link = screen.getByRole("link", { name: /^Site design ?\(source on GitHub, opens in a new tab\)$/ });
  expect(link).toHaveTextContent(/^Site design \(source on GitHub, opens in a new tab\)$/);
  expect(link).toHaveAttribute("href", "https://github.com/adrianeyre/lanewise");
  expect(REPOSITORY_URL).toBe("https://github.com/adrianeyre/lanewise");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  // The mark is decoration: the text names the link.
  expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
});

test("given a way to open links, as the Desktop App is, the footer's links go through it", async () => {
  const user = userEvent.setup();
  const opened: string[] = [];
  render(<Footer onOpenLink={(url) => opened.push(url)} />);

  await user.click(screen.getByRole("link", { name: /^Site design/ }));
  await user.click(screen.getByRole("button", { name: "Cookie Policy" }));
  await user.click(screen.getByRole("link", { name: /open an issue on GitHub/ }));

  expect(opened).toEqual([REPOSITORY_URL, `${REPOSITORY_URL}/issues`]);
});

test("the version is the build's, which the Desktop App takes from the repository's package.json", () => {
  render(<Footer />);

  expect(import.meta.env.VITE_APP_VERSION).toBe(version);
  expect(screen.getByText(`Version: ${version}`)).toBeVisible();
});

test("the version opens the Changelog from the keyboard, which says the version running and keeps focus", async () => {
  const user = userEvent.setup();
  const { container } = render(<Footer />);
  const opener = screen.getByRole("button", { name: `Version: ${version}` });

  opener.focus();
  await user.keyboard("{Enter}");

  const dialog = screen.getByRole("dialog", { name: "Changelog" });
  expect(within(dialog).getByText(`You are running version ${version}.`)).toBeVisible();
  // The repository's own CHANGELOG.md, which loads when the dialog opens.
  expect(await within(dialog).findByText(/All notable changes to Lanewise are documented here\./)).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "Close changelog" })).toHaveFocus();

  await expectNoAxeViolations(container);

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(opener).toHaveFocus();
});

for (const modal of MODALS) {
  test(`${modal.button} opens an accessible modal from the keyboard, which keeps focus and hands it back`, async () => {
    const user = userEvent.setup();
    const { container } = render(<Footer />);
    const opener = screen.getByRole("button", { name: modal.button });

    opener.focus();
    await user.keyboard("{Enter}");

    const dialog = screen.getByRole("dialog", { name: modal.title });
    expect(await within(dialog).findByRole("heading", { level: 3, name: modal.last })).toBeVisible();
    const close = within(dialog).getByRole("button", { name: modal.close });
    expect(close).toHaveFocus();

    // Focus goes round inside the dialog, both ways.
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(close).not.toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await expectNoAxeViolations(container);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();

    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: modal.close }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });
}
