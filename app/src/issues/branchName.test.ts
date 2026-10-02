import { expect, test } from "vitest";

import { branchNameFor, MAX_BRANCH_NAME } from "./branchName";

test("a branch for an Issue is its key, then its title as a lowercase slug", () => {
  expect(branchNameFor({ key: "PROJ-12", title: "Draw the lanes: straight down!" })).toBe(
    "PROJ-12-draw-the-lanes-straight-down",
  );
  expect(branchNameFor({ key: "#7", title: "Café résumé naïve" })).toBe("7-cafe-resume-naive");
  expect(branchNameFor({ key: null, title: "  Fix  the  graph  " })).toBe("fix-the-graph");
});

test("a long title is cut at a word, within the longest name", () => {
  const name = branchNameFor({
    key: "LW-1234",
    title: "Make the commit graph draw every lane straight down from each commit to its parent",
  });
  expect(name.length).toBeLessThanOrEqual(MAX_BRANCH_NAME);
  expect(name).toBe("LW-1234-make-the-commit-graph-draw-every-lane");
  expect(branchNameFor({ key: null, title: "x".repeat(80) })).toBe("x".repeat(MAX_BRANCH_NAME));
});

test("only characters Git allows in any ref name are kept, and there's always a name", () => {
  for (const title of ["a..b", "a~b^c:d?e*f[g", "back\\slash", "at@{0}", "end.lock", "-leading", "sp ace"]) {
    const name = branchNameFor({ key: null, title });
    expect(name).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(name).not.toMatch(/--|-$/);
  }
  expect(branchNameFor({ key: null, title: "!!!" })).toBe("issue");
  expect(branchNameFor({ key: "#12", title: "" })).toBe("12");
  expect(branchNameFor({ key: "LW-1", title: "日本語" })).toBe("LW-1");
});
