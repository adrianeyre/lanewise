// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { expectNoAxeViolations } from "../test/axe";
import { AccessibilityStatement } from "./AccessibilityStatement";

afterEach(cleanup);

test("the statement targets WCAG 2.2 AA", async () => {
  const { container } = render(<AccessibilityStatement />);

  expect(screen.getByText(/Conformance status:/).closest("p")).toHaveTextContent(
    "Lanewise is built to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at Level AA",
  );
  await expectNoAxeViolations(container);
});

test("a barrier is reported as an issue on adrianeyre/lanewise with the accessibility label", () => {
  render(<AccessibilityStatement />);

  const report = screen.getByRole("link", { name: /Open an issue on adrianeyre\/lanewise with the accessibility label/ });
  // The issue template labels it `accessibility`, whoever opens it.
  expect(report).toHaveAttribute("href", "https://github.com/adrianeyre/lanewise/issues/new?template=accessibility.yml");
  expect(report).toHaveAttribute("target", "_blank");
  expect(report).toHaveAccessibleName(/opens in a new tab/);
});
