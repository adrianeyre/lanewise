// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { expectNoAxeViolations } from "../test/axe";
import { Menu } from "./Menu";

afterEach(cleanup);

function Harness({ onReset = () => {} }: { onReset?: () => void }) {
  const [shown, setShown] = useState({ first: true, second: false });
  return (
    <>
      <Menu
        label="Things"
        ariaLabel="Things"
        items={[
          {
            kind: "checkbox",
            id: "first",
            label: "First",
            checked: shown.first,
            onToggle: () => setShown({ ...shown, first: !shown.first }),
          },
          {
            kind: "checkbox",
            id: "second",
            label: "Second",
            checked: shown.second,
            note: "empty",
            onToggle: () => setShown({ ...shown, second: !shown.second }),
          },
          { kind: "separator", id: "separator" },
          { kind: "action", id: "reset", label: "Reset", onSelect: onReset },
        ]}
      />
      <button type="button">Elsewhere</button>
    </>
  );
}

test("the keyboard opens the menu, moves between its items, and Escape hands focus back", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const button = screen.getByRole("button", { name: "Things" });
  expect(button).toHaveAttribute("aria-haspopup", "menu");
  expect(button).toHaveAttribute("aria-expanded", "false");

  button.focus();
  await user.keyboard("{Enter}");
  expect(button).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("menu", { name: "Things" })).toBeInTheDocument();
  expect(screen.getByRole("menuitemcheckbox", { name: "First" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitemcheckbox", { name: "Second (empty)" })).toHaveFocus();
  // The separator is passed over, and the arrows wrap.
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "Reset" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitemcheckbox", { name: "First" })).toHaveFocus();
  await user.keyboard("{End}");
  expect(screen.getByRole("menuitem", { name: "Reset" })).toHaveFocus();
  await user.keyboard("{Home}");
  expect(screen.getByRole("menuitemcheckbox", { name: "First" })).toHaveFocus();

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(button).toHaveFocus();

  // The up arrow opens it on its last item.
  await user.keyboard("{ArrowUp}");
  expect(screen.getByRole("menuitem", { name: "Reset" })).toHaveFocus();
  await user.keyboard("{Tab}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

test("a checkbox toggles without closing the menu, and an action closes it, handing focus back", async () => {
  const user = userEvent.setup();
  const onReset = vi.fn<() => void>();
  const { container } = render(<Harness onReset={onReset} />);
  await user.click(screen.getByRole("button", { name: "Things" }));
  const first = screen.getByRole("menuitemcheckbox", { name: "First" });
  expect(first).toHaveAttribute("aria-checked", "true");
  await user.keyboard(" ");
  expect(screen.getByRole("menuitemcheckbox", { name: "First" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  expect(screen.getByRole("menuitemcheckbox", { name: "First" })).toHaveFocus();
  await expectNoAxeViolations(container);

  await user.click(screen.getByRole("menuitem", { name: "Reset" }));
  expect(onReset).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Things" })).toHaveFocus();
});

test("a click outside closes the menu", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "Things" }));
  await user.click(screen.getByRole("button", { name: "Elsewhere" }));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

test("a submenu opens to the right by the right arrow, Enter or the pointer, and the left arrow or Escape close it back to its item", async () => {
  const user = userEvent.setup();
  const opened: string[] = [];
  render(
    <Menu
      label="App"
      ariaLabel="App"
      items={[
        {
          kind: "submenu",
          id: "file",
          label: "File",
          items: [
            { kind: "action", id: "open", label: "Open", onSelect: () => opened.push("open") },
            { kind: "action", id: "close", label: "Close", onSelect: () => opened.push("close") },
          ],
        },
        { kind: "action", id: "about", label: "About", onSelect: () => opened.push("about") },
      ]}
    />,
  );
  const button = screen.getByRole("button", { name: "App" });
  button.focus();
  await user.keyboard("{Enter}");
  const file = screen.getByRole("menuitem", { name: "File" });
  expect(file).toHaveFocus();
  expect(file).toHaveAttribute("aria-haspopup", "menu");
  expect(file).toHaveAttribute("aria-expanded", "false");

  await user.keyboard("{ArrowRight}");
  expect(file).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus();
  await user.keyboard("{ArrowLeft}");
  expect(screen.queryByRole("menu", { name: "File" })).not.toBeInTheDocument();
  expect(file).toHaveFocus();

  await user.keyboard("{Enter}");
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "Close" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(file).toHaveFocus();
  expect(screen.getByRole("menu", { name: "App" })).toBeInTheDocument();

  // The pointer resting on it opens it, without taking focus from where it is.
  await user.hover(file);
  expect(screen.getByRole("menu", { name: "File" })).toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "Open" }));
  expect(opened).toEqual(["open"]);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(button).toHaveFocus();
});

test("the list is drawn over the page, outside a Widget that scrolls or clips it, and closes on a click outside it", async () => {
  const user = userEvent.setup();
  const { container } = render(
    <>
      <aside style={{ overflow: "auto", height: "2rem" }}>
        <Menu label="Row" ariaLabel="Actions for main" items={[{ kind: "action", id: "go", label: "Go", onSelect: () => {} }]} />
      </aside>
      <button type="button">Elsewhere</button>
    </>,
  );

  await user.click(screen.getByRole("button", { name: "Actions for main" }));
  const menu = screen.getByRole("menu", { name: "Actions for main" });
  expect(container.querySelector("aside")).not.toContainElement(menu);
  expect(menu.parentElement).toHaveClass("menu-layer");
  expect(menu.parentElement?.parentElement).toBe(document.body);
  // Clicking the list itself isn't clicking outside it.
  await user.pointer({ keys: "[MouseLeft>]", target: menu });
  expect(screen.getByRole("menu", { name: "Actions for main" })).toBeInTheDocument();
  await user.pointer({ keys: "[/MouseLeft]" });
  await user.click(screen.getByRole("button", { name: "Elsewhere" }));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await expectNoAxeViolations(document.body);
});
