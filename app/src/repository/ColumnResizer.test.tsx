// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { COLUMN_WIDTHS_KEY } from "../settings/localSettings";
import { expectNoAxeViolations } from "../test/axe";
import { ColumnResizer } from "./ColumnResizer";
import { MIN_WIDTHS, useColumnWidths } from "./columnWidths";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function Columns() {
  const columns = useColumnWidths();
  return (
    <div>
      <div id="left">Branches</div>
      <ColumnResizer
        column="sidebar"
        label="Resize the branches column"
        controls="left"
        widths={columns.widths}
        total={() => 1440}
        onResize={(width) => columns.resize("sidebar", width)}
        onReset={() => columns.reset("sidebar")}
      />
      <div>Commit graph</div>
      <ColumnResizer
        column="detail"
        label="Resize the details column"
        controls="right"
        widths={columns.widths}
        total={() => 1440}
        onResize={(width) => columns.resize("detail", width)}
        onReset={() => columns.reset("detail")}
      />
      <div id="right">Working tree</div>
    </div>
  );
}

test("the keyboard moves a column's edge, and the width is kept for next time", async () => {
  const user = userEvent.setup();
  const { container } = render(<Columns />);
  const left = screen.getByRole("separator", { name: "Resize the branches column" });
  const right = screen.getByRole("separator", { name: "Resize the details column" });
  expect(left).toHaveAttribute("aria-valuenow", "256");
  expect(left).toHaveAttribute("aria-controls", "left");
  expect(left).toHaveAttribute("aria-valuemin", String(MIN_WIDTHS.sidebar));
  await expectNoAxeViolations(container);

  left.focus();
  await user.keyboard("{ArrowRight}{ArrowRight}");
  expect(left).toHaveAttribute("aria-valuenow", "288");
  await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
  expect(left).toHaveAttribute("aria-valuenow", "224");
  await user.keyboard("{Home}");
  expect(left).toHaveAttribute("aria-valuenow", String(MIN_WIDTHS.sidebar));
  // Moving the right column's edge left widens it.
  right.focus();
  await user.keyboard("{ArrowLeft}");
  expect(right).toHaveAttribute("aria-valuenow", "400");
  expect(JSON.parse(localStorage.getItem(COLUMN_WIDTHS_KEY) ?? "")).toEqual({ sidebar: MIN_WIDTHS.sidebar, detail: 400 });

  await user.keyboard("{Enter}");
  expect(right).toHaveAttribute("aria-valuenow", "384");
});

test("dragging an edge resizes its column, and its menu does the same without dragging", async () => {
  const user = userEvent.setup();
  render(<Columns />);
  const left = screen.getByRole("separator", { name: "Resize the branches column" });

  fireEvent.pointerDown(left, { button: 0, clientX: 256, pointerId: 1 });
  fireEvent.pointerMove(left, { clientX: 356, pointerId: 1 });
  fireEvent.pointerUp(left, { clientX: 356, pointerId: 1 });
  expect(left).toHaveAttribute("aria-valuenow", "356");
  fireEvent.pointerMove(left, { clientX: 500, pointerId: 1 });
  expect(left).toHaveAttribute("aria-valuenow", "356");

  await user.pointer({ keys: "[MouseRight]", target: left });
  await user.click(screen.getByRole("menuitem", { name: "Make narrower" }));
  expect(left).toHaveAttribute("aria-valuenow", "292");
  await user.dblClick(left);
  expect(left).toHaveAttribute("aria-valuenow", "256");
});
