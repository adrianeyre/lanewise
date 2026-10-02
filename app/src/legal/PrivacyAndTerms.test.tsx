// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { expectNoAxeViolations } from "../test/axe";
import { REPOSITORY_URL } from "./links";
import { PrivacyPolicy } from "./PrivacyPolicy";
import { TermsAndConditions } from "./TermsAndConditions";

afterEach(cleanup);

test("the Privacy Policy says Lanewise collects nothing, and names everything it sends, and to whom", async () => {
  const { container } = render(<PrivacyPolicy />);
  expect(screen.getByRole("heading", { name: "What Lanewise collects" }).nextElementSibling).toHaveTextContent(
    "Nothing. There is no telemetry, analytics, crash reporting or advertising of any kind.",
  );
  const sent = screen.getByRole("heading", { name: "What is sent, and only when you ask" }).nextElementSibling!;
  for (const to of [
    "Your remotes and Hosts",
    "The Model Provider you chose",
    "Jev, from TypeSafe",
    "Your Issue Tracker",
    "GitHub, for authors' pictures",
    "GitHub, for Updates and the model catalog",
  ]) {
    expect(sent).toHaveTextContent(to);
  }
  await expectNoAxeViolations(container);
});

test("the Terms and Conditions are the MIT License's, in plain words, linking to it", async () => {
  const user = userEvent.setup();
  const opened: string[] = [];
  const { container } = render(<TermsAndConditions onOpenLink={(url) => opened.push(url)} />);
  expect(screen.getByRole("heading", { name: "No warranty" })).toBeVisible();
  expect(screen.getByText(/never applies one for you/)).toBeVisible();
  await user.click(screen.getByRole("link", { name: /MIT License/ }));
  expect(opened).toEqual([`${REPOSITORY_URL}/blob/main/LICENSE`]);
  await expectNoAxeViolations(container);
});
