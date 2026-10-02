import { expect, test } from "vitest";

import type { GraphRow } from "../commands/api";
import { graphRow } from "../test/fakePlatform";
import { describePlace } from "./graphWords";

const place = (found: Partial<GraphRow>, index = 0) => describePlace(graphRow(index, found), index);

test("a commit on a branch is on it", () => {
  expect(place({ line: "main" })).toBe("on main");
});

test("a merge says what it merges into what", () => {
  expect(place({ line: "main", merged: ["feature/x"] })).toBe("merge of feature/x into main");
  expect(place({ line: null, merged: ["feature/x"] })).toBe("merge of feature/x");
});

test("an octopus merge lists every branch, counting the unnamed ones", () => {
  expect(place({ line: "main", merged: ["feature/x", "feature/y", null] })).toBe(
    "merge of feature/x, feature/y and an unnamed branch into main",
  );
  expect(place({ line: "main", merged: ["feature/x", null, null] })).toBe(
    "merge of feature/x and 2 unnamed branches into main",
  );
});

const merge = (summary: string) => place({ summary, line: "main", merged: [null] });

test("a merged branch deleted since is named from the merge's summary, as Git and Hosts write it", () => {
  expect(merge("Merge branch 'feature/x'")).toBe("merge of feature/x into main");
  expect(merge("Merge branch 'feature/x' into main")).toBe("merge of feature/x into main");
  expect(merge("Merge remote-tracking branch 'origin/fix'")).toBe("merge of origin/fix into main");
  expect(merge("Merge pull request #15 from adrianeyre/lanes")).toBe(
    "merge of adrianeyre/lanes into main",
  );
  expect(merge("Bring the fixes in")).toBe("merge of an unnamed branch into main");
});

test("a fork point says which branches branch off", () => {
  expect(place({ line: "main", branchesOff: ["feature/y"] })).toBe(
    "on main, where feature/y branches off",
  );
  expect(place({ line: "main", branchesOff: ["feature/y", null] })).toBe(
    "on main, where feature/y and an unnamed branch branch off",
  );
});

test("a cut edge says how far away the parent or child is", () => {
  expect(place({ line: "main", farParents: [350] }, 100)).toBe("on main, a parent 250 commits below");
  expect(place({ line: null, farChildren: [99] }, 100)).toBe("a child 1 commit above");
});

test("a commit the graph says nothing about has no words", () => {
  expect(place({ line: null })).toBe("");
});
