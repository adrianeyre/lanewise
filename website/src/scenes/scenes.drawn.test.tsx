// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { expectNoAxeViolations } from "../../../app/src/test/axe";
import { Site } from "../Site";

// Every scene on the page drawn as a browser draws it with reduced motion
// asked for: its still, named in words, with nothing in it read out twice.

beforeEach(() => {
  const observer = class {
    observe() {}
    disconnect() {}
  };
  vi.stubGlobal("ResizeObserver", observer);
  vi.stubGlobal("IntersectionObserver", observer);
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
});

const SCENES = [
  /^Lanewise's Conflicts page during a merge/,
  /^Lanewise's Commit graph/,
  /^A stash drawn as a dotted square/,
  /^Lanewise's AI settings/,
  /^A split diff of src\/display\.ts/,
];

describe.each(["light", "dark"])("in the %s theme", (theme) => {
  test("each scene is drawn, as its still, named in words, and the page has no axe violations", async () => {
    document.documentElement.setAttribute("data-theme", theme);
    const { container } = render(<Site downloads={null} />);
    for (const name of SCENES) {
      const scene = screen.getByRole("img", { name });
      // What's drawn is hidden from screen readers, which read the scene's name instead.
      expect(scene.firstElementChild).toHaveAttribute("aria-hidden", "true");
    }
    // The hero's story is stilled, so there's nothing to stop.
    expect(screen.queryByRole("button", { name: /animation/ })).toBeNull();
    await expectNoAxeViolations(container);
  });
});
