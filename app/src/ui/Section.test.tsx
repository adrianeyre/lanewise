// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useId } from "react";
import { afterEach, expect, test } from "vitest";

import { SIDEBAR_SECTIONS_KEY } from "../settings/localSettings";
import { expectNoAxeViolations } from "../test/axe";
import { SectionHeading, type SidebarSection, useSectionOpen } from "./Section";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function Section({ name, title }: { name: SidebarSection; title: string }) {
  const [open, toggle] = useSectionOpen(name);
  const labelId = useId();
  const bodyId = useId();
  return (
    <section aria-labelledby={labelId}>
      <SectionHeading level={3} open={open} onToggle={toggle} controls={bodyId} labelId={labelId} count="(2)">
        {title}
      </SectionHeading>
      {open && <p id={bodyId}>What {title} holds.</p>}
    </section>
  );
}

test("each section opens and closes by its heading, from the keyboard too, saying which it is, and Tags starts closed", async () => {
  const user = userEvent.setup();
  const { container } = render(
    <>
      <Section name="remotes" title="Remotes" />
      <Section name="tags" title="Tags" />
    </>,
  );

  const remotes = screen.getByRole("button", { name: "Remotes (2)" });
  expect(remotes).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("What Remotes holds.")).toBeVisible();
  expect(remotes).toHaveAttribute("aria-controls", screen.getByText("What Remotes holds.").id);
  // The region keeps its own name, without the count.
  expect(screen.getByRole("region", { name: "Remotes" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Tags (2)" })).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("What Tags holds.")).toBeNull();
  await expectNoAxeViolations(container);

  remotes.focus();
  await user.keyboard("{Enter}");
  expect(remotes).toHaveAttribute("aria-expanded", "false");
  expect(remotes).not.toHaveAttribute("aria-controls");
  expect(screen.queryByText("What Remotes holds.")).toBeNull();
  await user.keyboard(" ");
  expect(screen.getByText("What Remotes holds.")).toBeVisible();
});

test("which sections are open is kept, for the next Tab and the next launch", async () => {
  const user = userEvent.setup();
  render(<Section name="stashes" title="Stashes" />);
  await user.click(screen.getByRole("button", { name: /^Stashes/ }));
  expect(JSON.parse(localStorage.getItem(SIDEBAR_SECTIONS_KEY) ?? "{}")).toEqual({ stashes: false });
  cleanup();

  render(<Section name="stashes" title="Stashes" />);
  expect(screen.getByRole("button", { name: /^Stashes/ })).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("What Stashes holds.")).toBeNull();
});

test("what's kept, if it can't be read, is as a first launch has it", () => {
  localStorage.setItem(SIDEBAR_SECTIONS_KEY, "not JSON");
  render(<Section name="issues" title="Issues" />);
  expect(screen.getByRole("button", { name: /^Issues/ })).toHaveAttribute("aria-expanded", "true");
});
