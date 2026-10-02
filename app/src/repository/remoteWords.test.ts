import { expect, test } from "vitest";

import { describePulled, describePushed, describeRemoteError, describeStarting, describeUpstream } from "./remoteWords";

const upstream = (ahead: number, behind: number, gone = false) => ({
  name: "origin/main",
  remote: "origin",
  ahead,
  behind,
  gone,
});

test("an Upstream's counts are put in words", () => {
  expect(describeUpstream(upstream(0, 0))).toBe("Up to date with origin/main");
  expect(describeUpstream(upstream(1, 0))).toBe("1 commit ahead of origin/main");
  expect(describeUpstream(upstream(0, 3))).toBe("3 commits behind origin/main");
  expect(describeUpstream(upstream(2, 1))).toBe("2 commits ahead of origin/main and 1 behind");
  expect(describeUpstream(upstream(0, 0, true))).toBe("Its Upstream, origin/main, is gone from the remote");
});

test("what a pull or push did is said", () => {
  expect(describePulled({ kind: "updated", commits: 1 })).toBe("Pulled 1 commit.");
  expect(describePulled({ kind: "stopped", operation: "merge", conflicts: ["a", "b"], messages: "" })).toBe(
    "The pull stopped partway through merging, with conflicts in 2 files. The merge is still in progress.",
  );
  expect(describePulled({ kind: "stopped", operation: "rebase", conflicts: [], messages: "hook failed" })).toBe(
    "The pull stopped partway through rebasing, and the rebase is still in progress. Git said:\nhook failed",
  );
  expect(describePushed({ kind: "upToDate" })).toBe("Pushed: already up to date.");
  expect(describePushed({ kind: "updated", commits: null })).toBe("Pushed.");
  const topic = { remote: "origin", branch: "topic" };
  expect(describeStarting("push", null, topic)).toBe("Pushing to origin/topic…");
  expect(describePushed({ kind: "updated", commits: 2 }, topic)).toBe(
    "Pushed 2 commits. origin/topic is the branch's Upstream now.",
  );
});

test("why a fetch, pull or push failed is said, in Git's words where they're Git's", () => {
  expect(describeRemoteError({ kind: "noRemotes" }, "fetch")).toBe(
    "Nothing was fetched: the repository has no remotes. Add one in the Branches & remotes Widget.",
  );
  expect(describeRemoteError({ kind: "noUpstream", branch: "topic" }, "push")).toBe(
    "Nothing was pushed: “topic” has no Upstream. Push it and set one, choosing where it goes.",
  );
  expect(describeRemoteError({ kind: "noUpstream", branch: "topic" }, "pull")).toBe(
    "Nothing was pulled: “topic” has no Upstream. Set one from its menu in the Branches & remotes Widget.",
  );
  expect(describeRemoteError({ kind: "remoteNotFound", remote: "upstream" }, "push")).toBe(
    "Nothing was pushed: there's no remote called “upstream” any more.",
  );
  expect(describeRemoteError({ kind: "invalidName", name: "two..dots" }, "push")).toBe(
    "Nothing was pushed: Git doesn't allow “two..dots” as a branch name. Branch names can't have spaces, “..”, “~”, “^”, “:”, “?”, “*” or “[”, or start with “-”.",
  );
  expect(describeRemoteError({ kind: "invalidName", name: " " }, "push")).toBe(
    "Nothing was pushed: the branch on the remote needs a name.",
  );
  expect(describeRemoteError({ kind: "wouldOverwrite", paths: ["a.txt", "b.txt"] }, "pull")).toBe(
    "Nothing was pulled: pulling would overwrite your uncommitted changes to a.txt, b.txt. Commit or stash them first.",
  );
  expect(describeRemoteError({ kind: "notFastForward", upstream: "origin/main" }, "pull")).toBe(
    "Nothing was pulled: the branch and origin/main have diverged, so it can't be fast-forwarded. Pull with merge or with rebase instead.",
  );
  expect(describeRemoteError({ kind: "alreadyRunning", operation: 3, running: "fetch" }, "push")).toBe(
    "Nothing was pushed: a fetch is running in the repository already.",
  );
  expect(
    describeRemoteError(
      { kind: "gitFailed", command: "git fetch --all", code: 128, message: "fatal: Authentication failed" },
      "fetch",
    ),
  ).toBe("The fetch failed. Git stopped with exit code 128:\nfatal: Authentication failed");
});
