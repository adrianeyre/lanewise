// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, test } from "vitest";

import { expectNoAxeViolations } from "../test/axe";
import { Dialog } from "./Dialog";

afterEach(cleanup);

function Opener() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <button type="button">Behind</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="About" closeLabel="Close about">
        <p>
          Some text and <a href="https://example.com/one">a first link</a>.
        </p>
        <details>
          <summary>More</summary>
          <a href="https://example.com/hidden">a link inside</a>
        </details>
      </Dialog>
    </>
  );
}

test("opening moves focus to the labelled close button, in a dialog named by its title", async () => {
  const user = userEvent.setup();
  const { container } = render(<Opener />);

  await user.click(screen.getByRole("button", { name: "Open" }));

  const dialog = screen.getByRole("dialog", { name: "About" });
  expect(dialog).toBeVisible();
  expect(screen.getByRole("button", { name: "Close about" })).toHaveFocus();
  await expectNoAxeViolations(container);
});

test("Tab and Shift+Tab stay in the dialog, which ends at a closed summary", async () => {
  const user = userEvent.setup();
  render(<Opener />);
  await user.click(screen.getByRole("button", { name: "Open" }));

  const close = screen.getByRole("button", { name: "Close about" });
  const summary = screen.getByText("More");
  await user.tab();
  expect(screen.getByRole("link", { name: "a first link" })).toHaveFocus();
  await user.tab();
  expect(summary).toHaveFocus();
  // What the closed summary hides isn't a stop, so Tab goes round to the start.
  await user.tab();
  expect(close).toHaveFocus();
  await user.tab({ shift: true });
  expect(summary).toHaveFocus();

  // Opened, what it holds is the last stop.
  await user.click(summary);
  await user.tab();
  const inside = screen.getByRole("link", { name: "a link inside" });
  expect(inside).toHaveFocus();
  await user.tab();
  expect(close).toHaveFocus();
  await user.tab({ shift: true });
  expect(inside).toHaveFocus();
});

test("Escape closes the dialog and hands focus back to what opened it", async () => {
  const user = userEvent.setup();
  render(<Opener />);
  const opener = screen.getByRole("button", { name: "Open" });
  await user.click(opener);

  await user.keyboard("{Escape}");

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(opener).toHaveFocus();
});

test("the close button and the backdrop close it too", async () => {
  const user = userEvent.setup();
  render(<Opener />);
  const opener = screen.getByRole("button", { name: "Open" });

  await user.click(opener);
  await user.click(screen.getByRole("button", { name: "Close about" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(opener).toHaveFocus();

  await user.click(opener);
  // A click on the backdrop lands on the dialog element itself.
  await user.click(screen.getByRole("dialog"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(opener).toHaveFocus();
});

/** A dialog whose body asks for a name, marking its field to take focus. */
function Asking() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Name it" closeLabel="Cancel naming">
        {open && (
          <label>
            Name <input type="text" data-autofocus />
          </label>
        )}
      </Dialog>
    </>
  );
}

test("what its body marks to take focus, such as a form's field, takes it instead of the close button", async () => {
  const user = userEvent.setup();
  const { container } = render(<Asking />);
  const opener = screen.getByRole("button", { name: "Open" });

  await user.click(opener);
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
  await expectNoAxeViolations(container);
  await user.keyboard("{Escape}");
  expect(opener).toHaveFocus();
});
