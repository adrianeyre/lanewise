import { expect, test } from "vitest";

import type { InProgressOperation } from "../commands/api";
import { historyCommit } from "../test/fakePlatform";
import { describeSides } from "./sideWords";

const onto = historyCommit(0, { labels: [{ kind: "remoteBranch", name: "origin/main" }] });

test("each side is said in the In-Progress Operation's own terms", () => {
  const merge: InProgressOperation = { kind: "merge", into: null, merging: [historyCommit(2)], conflicts: [], resolved: [] };
  expect(describeSides(merge)).toEqual({
    base: "Before either side changed it, where the two branches last met.",
    ours: "HEAD, the branch being merged into.",
    theirs: `Commit ${historyCommit(2).shortId}, being merged.`,
  });

  const rebase: InProgressOperation = {
    kind: "rebase",
    branch: "topic",
    onto,
    step: 2,
    steps: 4,
    conflicts: [],
    resolved: [],
  };
  expect(describeSides(rebase)).toEqual({
    base: "Before the commit being replayed changed it.",
    ours: "“origin/main”, being rebased onto, with the commits replayed so far.",
    theirs: "The commit of “topic” being replayed.",
  });
  expect(describeSides({ ...rebase, branch: null, onto: null }).ours).toBe(
    "The commit being rebased onto, with the commits replayed so far.",
  );

  const stash: InProgressOperation = { kind: "stashApply", stash: null, pop: true, conflicts: [], resolved: [] };
  expect(describeSides(stash)).toEqual({
    base: "The commit the stash was made on.",
    ours: "The working tree the stash is applied to.",
    theirs: "The stash.",
  });
});

test("a cherry-pick's and a revert's sides say which way the commit's change goes", () => {
  const commit = historyCommit(3);
  const pick: InProgressOperation = { kind: "cherryPick", into: "main", commit, conflicts: [], resolved: [] };
  expect(describeSides(pick)).toEqual({
    base: `Before commit ${commit.shortId} changed it.`,
    ours: "“main”, the branch being picked onto.",
    theirs: `Commit ${commit.shortId}, being cherry-picked.`,
  });

  const revert: InProgressOperation = { kind: "revert", into: null, commit: null, conflicts: [], resolved: [] };
  expect(describeSides(revert)).toEqual({
    base: "As the commit left it.",
    ours: "HEAD, the branch it's reverted on.",
    theirs: "As it was before the commit, which the revert goes back to.",
  });
});
