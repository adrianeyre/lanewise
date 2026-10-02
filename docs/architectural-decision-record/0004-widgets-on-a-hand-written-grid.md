# Pages are Widgets on a hand-written snapping Grid

**Superseded by [ADR 0032](0032-a-fixed-layout-as-gitkrakens-in-place-of-the-grid.md).** Lanewise no longer has a Grid; this record is kept for why it once did.

Lanewise's pages are Widgets on a snapping Grid, carried over from soundcheck (its ADR 0004 and `app/src/grid/`): a pure layout model plus one component, written by hand rather than taken from a library such as react-grid-layout. Grid libraries have no keyboard alternative to dragging, which WCAG 2.2 AA requires (2.5.7 Dragging Movements, 2.1.1 Keyboard), and none has Zones that stay on screen while the page scrolls.

We differ from soundcheck on one point. A Widget can be placed in any free space, including background space beside or below a taller neighbour, and a vertical gap between it and the Widget above it is kept. Only rows that nothing covers across the Zone's whole width are closed up. Don't "fix" a gap a user left on purpose.

## The contract

`app/src/grid/layout.ts` is the layout model: pure functions over a `WidgetLayout`, tested without a browser. `app/src/grid/WidgetGrid.tsx` draws it, `useWidgetLayout` loads and saves it, and `GridMenu` is the page's Grid menu.

- **The Grid** is 24 columns of 24 px rows with 16 px gaps. Widgets snap to whole cells, can't overlap and are kept inside the 24 columns.
- **Zones.** Each page has three: `main`, which scrolls with the page, and the Pinned `top` and `bottom` Zones, drawn in slots between the title bar and the page and below the page. A Pinned Widget is full width, and the Pinned Widgets stack in their Zone. Each Pinned Zone is headed by a visually hidden `h2`, so the page's headings stay in order, and is at most 45% of the window high, scrolling beyond that, so it never covers what has focus (2.4.11 Focus Not Obscured).
- **Controls.** The Grid draws every Widget's frame and controls, so each Widget gets the same ones:
  - a drag bar, which moves it by pointer, with Escape cancelling the drag;
  - a grip button, where the arrow keys move it a cell and Shift+arrows resize it, each move announced with where it now is;
  - a resize corner, or in a Pinned Zone a resize edge;
  - a Pin toggle for each Pinned Zone;
  - a close button (×), which hides it and says how to show it again.
- **The Grid menu** in the title bar has a checkbox for each of the open page's Widgets, marked "(empty)" while it has nothing to show, and Reset layout, which puts every Widget back where it started.
- **Placement.**
  - A Widget stays exactly where it's dropped, in `main` or beside or below a taller neighbour.
  - Widgets it overlaps are pushed down, and the Widgets they then overlap after them, and nothing else moves.
  - Moved down onto the Widgets below it, a Widget swaps with them, so the grip can step it past a neighbour.
  - When a Widget is hidden, Pinned, made shorter or empty, the rows it alone covered are closed up, but only rows that no shown Widget covers across the whole width. Blank rows the user left stay.
- **Content stays mounted.** Moving, resizing, Pinning or hiding a Widget, or narrowing the window, never remounts its content, so a scroll position, a selection or a half-typed commit message survives.
- **Empty Widgets step aside.** A Widget with nothing to show just now leaves the Grid, and its rows are closed up. When it has something again, it comes back where it was. Whether the user hid it is kept as it was.
- **Content-fitting.** A Widget is drawn no taller than its content, measured with a `ResizeObserver`. The rows it started with are kept as its `room`, and it grows back into them, pushing down what is there, only if its content grows. A Widget the user resized is `sized`: it keeps that height until Reset layout.
- **Narrow windows.** Below 768 px there is no room for columns: Widgets stack full width in Grid menu order, which is also their keyboard and screen reader order. There is no drag, grip or resize, but Pin and close still work.
- **Persistence.** Each page's layout is kept in local storage under `lanewise.grid.<page>`, never in the repository, and is listed in the Cookie Policy (PRD §7.11). A saved layout that is broken or out of date is repaired Widget by Widget, falling back to each one's default.

## Pages

Each page has a Grid and a layout of its own, holding only its own Widgets, and the Grid menu lists the open page's Widgets. `PAGE_WIDGETS` lists them: `REPOSITORY_WIDGETS` for the Repository page (PRD §7.10) and `CONFLICTS_WIDGETS` for the Conflicts page, shown while an In-Progress Operation has conflicts. Its Operation Widget starts Pinned to the top.

## How a new Widget conforms

1. Add its id to `WidgetId` and a `WidgetSpec` to its page's list in `layout.ts`, with its title, starting cell, Zone if it starts Pinned, and smallest size. Its place in the list is its Grid menu, keyboard and narrow-window order.
2. Give its content in the page's `widgets`, keyed by that id.
3. Draw one element with the `surface` class and its own `h3` heading, labelling it. Inside a Widget the surface drops its own frame, since the Widget is the frame.
4. List it in `empty` while it has nothing to show.
5. Draw no controls of its own for moving, resizing, Pinning or hiding. Don't use fixed or `position: sticky` positioning, and assume no size: it may be any width from 4 columns to 24, and full width in a narrow window.
6. Test it in the Grid, with `expectNoAxeViolations`.

## Consequences

- We own the Grid's code and its tests, and a new layout feature is ours to write.
- Every Widget moves, resizes, Pins and hides the same way, by pointer and by keyboard.
- The layout model is pure, so placement rules are tested in Node with no browser, and the component's tests only check that it's drawn and driven right.
- A real-window drag, content fitting with a real `ResizeObserver`, and narrow-window stacking are hand checks, since jsdom has no layout.
- soundcheck took the same placement fix in its commit `05308d2`: it closed every blank row, so a Widget dropped into background space beside a taller neighbour jumped back up. Only rows a change frees are closed now, and a gap the user left, even one across the whole width, is kept.
