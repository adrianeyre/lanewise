// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { expectNoAxeViolations } from "../../../app/src/test/axe";
import { type Act, Stage } from "./Stage";

interface Scene {
  step: string;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A browser that can draw scenes, with reduced motion asked for or not; `seen` shows the scene. */
function browser({ reduced }: { reduced: boolean }) {
  const watching: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        watching.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: reduced,
    addEventListener() {},
    removeEventListener() {},
  }));
  return { seen: () => act(() => watching.forEach((callback) => callback([{ isIntersecting: true }]))) };
}

async function story(a: Act<Scene>) {
  a.set({ step: "asked" });
  await a.wait(300);
  a.set({ step: "answered" });
  await a.wait(300);
}

function Demo() {
  return (
    <Stage
      name="demo"
      width={400}
      height={300}
      initial={{ step: "start" }}
      poster={{ step: "done" }}
      script={story}
      label="A question asked and answered."
      controls
    >
      {(scene) => <p className="demo-step">{scene.step}</p>}
    </Stage>
  );
}

const step = () => document.querySelector(".demo-step")?.textContent;

test("before it's drawn, as on the prerendered page, a scene is its box and its words alone", () => {
  render(<Demo />);
  expect(screen.getByRole("img", { name: "A question asked and answered." })).toBeEmptyDOMElement();
  expect(screen.queryByRole("button")).toBeNull();
});

test("with reduced motion, a scene is its still, the story's result, with no pointer and nothing to stop", async () => {
  browser({ reduced: true });
  const { container } = render(<Demo />);
  expect(step()).toBe("done");
  expect(container.querySelector(".scene-pointer")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
  await expectNoAxeViolations(container);
});

test("a story plays once it's seen, can be stopped, showing its result, and played again", async () => {
  const user = userEvent.setup();
  const { seen } = browser({ reduced: false });
  const { container } = render(<Demo />);
  // Its result shows until it's seen, never a blank box.
  expect(step()).toBe("done");

  seen();
  expect(step()).toBe("asked");
  await user.click(screen.getByRole("button", { name: "Stop the animation" }));
  expect(step()).toBe("done");
  await expectNoAxeViolations(container);

  await user.click(screen.getByRole("button", { name: "Play the animation again" }));
  expect(step()).toBe("asked");
  // Played through, it holds its result and offers to play again.
  expect(await screen.findByRole("button", { name: "Play the animation again" }, { timeout: 2000 })).toBeVisible();
  expect(step()).toBe("answered");
});
