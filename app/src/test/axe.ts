import { expect } from "vitest";
import { axe } from "vitest-axe";
// `vitest-axe/matchers` re-exports the matcher as a type only, so it comes from
// the file that declares it.
import { toHaveNoViolations } from "vitest-axe/dist/matchers.js";

// Automated axe checks run in the Vitest suite and fail CI (PRD §11). They
// catch what a machine can see, not everything WCAG 2.2 AA asks: keyboard,
// focus and screen reader passes still happen by hand. jsdom lays nothing out,
// so axe can't measure colours in it: `contrast.test.ts` computes contrast
// from the Theme's tokens instead, in both themes, and how they look in a
// real webview is checked by hand.

expect.extend({ toHaveNoViolations });

// vitest-axe 0.1.0 declares its matcher on Vitest's old global `Vi` namespace,
// which Vitest 5 no longer reads, so it is declared on the `vitest` module here.
declare module "vitest" {
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    /** The axe results have no violations; otherwise fails, naming each one. */
    toHaveNoViolations(): R;
  }
}

/** Runs axe over `container`, as rendered in jsdom, and fails the test on any violation. */
export async function expectNoAxeViolations(container: Element): Promise<void> {
  expect(await axe(container)).toHaveNoViolations();
}
