// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { expectNoAxeViolations } from "../test/axe";
import { Avatar } from "./Avatar";
import { AvatarsShown, forgetPictures } from "./avatars";

afterEach(() => {
  cleanup();
  forgetPictures();
});

test("an author's avatar is their initials, in their own colour, hidden from screen readers beside their name", async () => {
  const { container } = render(
    <p>
      <Avatar name="Grace Hopper" email="grace@example.com" /> Grace Hopper
    </p>,
  );

  const avatar = container.querySelector(".avatar")!;
  expect(avatar).toHaveTextContent("GH");
  expect(avatar).toHaveAttribute("aria-hidden", "true");
  expect(avatar.className).toMatch(/avatar-[0-7]/);
  await expectNoAxeViolations(container);
});

test("with pictures from GitHub shown, the picture is asked for from GitHub's avatars, the initials drawn until it loads", () => {
  const asked: string[] = [];
  const original = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
  Object.defineProperty(HTMLImageElement.prototype, "src", {
    configurable: true,
    set(url: string) {
      asked.push(url);
    },
    get: () => "",
  });
  try {
    const { container } = render(
      <AvatarsShown.Provider value>
        <Avatar name="Adrian Eyre" email="Adrian.Eyre@Hotmail.co.uk" />
      </AvatarsShown.Provider>,
    );
    expect(container.querySelector(".avatar")).toHaveTextContent("AE");
    expect(asked).toEqual(["https://avatars.githubusercontent.com/u/e?email=adrian.eyre%40hotmail.co.uk&s=64"]);
  } finally {
    Object.defineProperty(HTMLImageElement.prototype, "src", original);
  }
});

test("with them off, nothing is asked for", () => {
  const asked: string[] = [];
  const original = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
  Object.defineProperty(HTMLImageElement.prototype, "src", { configurable: true, set: (url: string) => asked.push(url), get: () => "" });
  try {
    render(<Avatar name="Ada Lovelace" email="ada@example.com" />);
    expect(asked).toEqual([]);
  } finally {
    Object.defineProperty(HTMLImageElement.prototype, "src", original);
  }
});
