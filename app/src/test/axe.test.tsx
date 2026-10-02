// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { expectNoAxeViolations } from "./axe";

afterEach(cleanup);

test("an axe violation fails the check, naming the rule", async () => {
  const { container } = render(<img src="lanewise.png" />);

  await expect(expectNoAxeViolations(container)).rejects.toThrow(/image-alt/);
});

test("markup with no axe violations passes the check", async () => {
  const { container } = render(<img src="lanewise.png" alt="Lanewise" />);

  await expectNoAxeViolations(container);
});
