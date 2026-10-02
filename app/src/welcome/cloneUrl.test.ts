import { expect, test } from "vitest";

import { repositoryName } from "./cloneUrl";

test.each([
  ["https://github.com/adrianeyre/lanewise.git", "lanewise"],
  ["https://github.com/adrianeyre/lanewise", "lanewise"],
  ["https://github.com/adrianeyre/lanewise/", "lanewise"],
  ["https://github.com/adrianeyre/lanewise.git?ref=main#readme", "lanewise"],
  ["git@github.com:adrianeyre/lanewise.git", "lanewise"],
  ["git@example.com:lanewise.git", "lanewise"],
  ["ssh://git@github.com:22/adrianeyre/lanewise.git/", "lanewise"],
  ["  https://github.com/adrianeyre/lanewise.git  ", "lanewise"],
  ["/work/lanewise.git", "lanewise"],
  ["C:\\work\\lanewise", "lanewise"],
  ["file:///work/Lanewise.GIT", "Lanewise"],
])("a clone of %s is named %s", (url, name) => {
  expect(repositoryName(url)).toBe(name);
});

test.each(["", "   ", "..", "git@github.com:"])(
  "%j gives no name",
  (url) => {
    expect(repositoryName(url)).toBe("");
  },
);
