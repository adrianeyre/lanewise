import { afterEach, expect, test } from "vitest";

import type { CommandClient, CommandName, CommandRequest, Outcome } from "../commands/api";
import { describeStep, forgetUndoHistories, historyOf, KEPT_STEPS, recordUndo, redo, undo } from "./undo";

afterEach(forgetUndoHistories);

const root = "/work/lanewise";
const id = (n: number) => n.toString(16).padStart(40, "0");

type Answer = { [N in CommandName]?: (request: CommandRequest<N>) => Outcome<N> };

/** A repository whose `HEAD` is `head`, on `branch`, answering as `answers` adds, and the calls made of it. */
function repository(state: { head: string; branch: string | null; tips?: Record<string, string> }, answers: Answer = {}) {
  const calls: { name: string; request: unknown }[] = [];
  const tips = state.tips ?? {};
  const answered: Answer = {
    previewReset: () => ({
      ok: true,
      value: { branch: state.branch, head: state.head, count: 0, lost: [], uncommitted: false },
    }),
    reset: ({ commit, head }) => {
      if (head !== state.head) return { ok: false, error: { kind: "headMoved" } };
      state.head = commit;
      return { ok: true, value: null };
    },
    branches: () => ({
      ok: true,
      value: {
        local: [
          ...(state.branch === null ? [] : [{ name: state.branch, commit: state.head, current: true, upstream: null }]),
          ...Object.entries(tips).map(([name, commit]) => ({ name, commit, current: false, upstream: null })),
        ],
        remotes: [],
        tags: [],
        detached: state.branch === null ? state.head : null,
      },
    }),
    checkOut: ({ branch }) => {
      if (branch.kind === "local") state.branch = branch.name;
      return { ok: true, value: { branch: branch.kind === "local" ? branch.name : null, stash: null } };
    },
    createBranch: ({ name, start }) => {
      tips[name] = start ?? state.head;
      return { ok: true, value: null };
    },
    deleteBranch: ({ name }) => {
      delete tips[name];
      return { ok: true, value: null };
    },
    ...answers,
  };
  const commands: CommandClient = {
    async call<N extends CommandName>(name: N, request: CommandRequest<N>) {
      calls.push({ name, request });
      const answer = answered[name] as ((request: CommandRequest<N>) => Outcome<N>) | undefined;
      if (!answer) throw new Error(`No answer for ${name}`);
      return answer(request);
    },
  };
  return { commands, calls, state, tips };
}

test("a commit is undone with a soft reset to its parent, leaving its changes staged, and redone back to it", async () => {
  const repo = repository(
    { head: id(2), branch: "main" },
    {
      commitDetails: () => ({ ok: true, value: { id: id(2), parents: [{ id: id(1), shortId: "0000001" }] } as never }),
    },
  );
  recordUndo(root, { kind: "commit", id: id(2), subject: "Fix the build" });

  const undone = await undo(repo.commands, root);

  expect(undone).toEqual(expect.objectContaining({ ok: true, said: "Undid the commit “Fix the build”. Its changes are staged again." }));
  expect(repo.state.head).toBe(id(1));
  expect(repo.calls.find(({ name }) => name === "reset")?.request).toEqual({
    repository: root,
    commit: id(1),
    mode: "soft",
    head: id(2),
  });
  expect(historyOf(root).undo).toEqual([]);
  expect(historyOf(root).redo.map(describeStep)).toEqual(["the commit “Fix the build”"]);

  const redone = await redo(repo.commands, root);
  expect(redone).toEqual(expect.objectContaining({ ok: true, said: "Redid the commit “Fix the build”." }));
  expect(repo.state.head).toBe(id(2));
  expect(historyOf(root).undo).toHaveLength(1);
});

test("a step isn't undone once the repository has moved on, says why, and is forgotten", async () => {
  // HEAD has moved past the commit since, as a commit made outside Lanewise would.
  const repo = repository(
    { head: id(3), branch: "main" },
    {
      commitDetails: () => ({ ok: true, value: { id: id(2), parents: [{ id: id(1), shortId: "0000001" }] } as never }),
    },
  );
  recordUndo(root, { kind: "commit", id: id(2), subject: "Fix the build" });

  const undone = await undo(repo.commands, root);

  expect(undone).toEqual({
    ok: false,
    problem: "Didn't undo the commit “Fix the build”. The repository has changed since, so it was left as it is.",
  });
  expect(repo.calls.map(({ name }) => name)).not.toContain("reset");
  expect(repo.state.head).toBe(id(3));
  expect(historyOf(root)).toEqual({ undo: [], redo: [] });
});

test("an amend is undone back to the commit it replaced", async () => {
  const repo = repository({ head: id(5), branch: "main" });
  recordUndo(root, { kind: "amend", id: id(5), replaced: id(4), subject: "Fix the build" });

  expect(await undo(repo.commands, root)).toEqual(expect.objectContaining({ ok: true }));
  expect(repo.state.head).toBe(id(4));
  expect(await redo(repo.commands, root)).toEqual(expect.objectContaining({ ok: true }));
  expect(repo.state.head).toBe(id(5));
});

test("a checkout is undone by checking out where HEAD was, but not once another branch is checked out", async () => {
  const repo = repository({ head: id(1), branch: "feature" });
  recordUndo(root, { kind: "checkOut", from: { kind: "branch", name: "main" }, to: { kind: "branch", name: "feature" } });

  expect(await undo(repo.commands, root)).toEqual(
    expect.objectContaining({ ok: true, said: "Undid the checkout of “feature”: “main” is checked out again." }),
  );
  expect(repo.state.branch).toBe("main");

  repo.state.branch = "other";
  expect(await redo(repo.commands, root)).toEqual({
    ok: false,
    problem: "Didn't redo the checkout of “feature”. The repository has changed since, so it was left as it is.",
  });
  expect(repo.state.branch).toBe("other");
});

test("a new branch is undone by deleting it, only while its tip is where it was made, and made again by redo", async () => {
  const repo = repository({ head: id(1), branch: "main", tips: { topic: id(1) } });
  recordUndo(root, { kind: "createBranch", name: "topic", tip: null });

  expect(await undo(repo.commands, root)).toEqual(expect.objectContaining({ ok: true, said: "Undid the new branch “topic”: it's deleted." }));
  expect(repo.tips).toEqual({});
  expect(await redo(repo.commands, root)).toEqual(expect.objectContaining({ ok: true }));
  expect(repo.tips).toEqual({ topic: id(1) });

  // Moved on since: undone again, it's left.
  repo.tips.topic = id(9);
  expect(await undo(repo.commands, root)).toEqual(expect.objectContaining({ ok: false }));
  expect(repo.tips).toEqual({ topic: id(9) });
});

test("a deleted branch is made again at its old tip", async () => {
  const repo = repository({ head: id(1), branch: "main" });
  recordUndo(root, { kind: "deleteBranch", name: "topic", tip: id(7) });

  expect(await undo(repo.commands, root)).toEqual(
    expect.objectContaining({ ok: true, said: "Undid deleting the branch “topic”: it's back at 0000000." }),
  );
  expect(repo.tips).toEqual({ topic: id(7) });
});

test("a reset is undone in its own mode, and a hard one says what can't come back", async () => {
  const repo = repository({ head: id(1), branch: "main" });
  recordUndo(root, { kind: "reset", branch: "main", mode: "hard", from: id(3), to: id(1) });

  const undone = await undo(repo.commands, root);

  expect(undone).toEqual(expect.objectContaining({ ok: true }));
  expect(undone?.ok && undone.said).toMatch(/Uncommitted changes the reset lost can't come back\.$/);
  expect(repo.calls.find(({ name }) => name === "reset")?.request).toEqual(
    expect.objectContaining({ commit: id(3), mode: "hard", head: id(1) }),
  );
});

test("a stash is undone by popping it, redone by stashing again, and a pop undone by stashing again", async () => {
  let made = 0;
  const popped: string[] = [];
  const repo = repository(
    { head: id(1), branch: "main" },
    {
      popStash: ({ stash }) => {
        popped.push(stash);
        return { ok: true, value: { kind: "applied" } };
      },
      createStash: ({ message }) => ({ ok: true, value: { id: `again-${++made}`, index: 0, message } as never }),
    },
  );
  recordUndo(root, { kind: "stash", id: "first", message: "Try a larger font", includeUntracked: false });

  expect(await undo(repo.commands, root)).toEqual(expect.objectContaining({ ok: true }));
  expect(popped).toEqual(["first"]);
  expect(await redo(repo.commands, root)).toEqual(expect.objectContaining({ ok: true }));
  // Made again, it's a new stash, which undoing it again pops.
  expect(await undo(repo.commands, root)).toEqual(expect.objectContaining({ ok: true }));
  expect(popped).toEqual(["first", "again-1"]);

  forgetUndoHistories();
  recordUndo(root, { kind: "popStash", message: "Try a larger font" });
  expect(await undo(repo.commands, root)).toEqual(
    expect.objectContaining({ ok: true, said: "Undid popping the stash “Try a larger font”: the changes are stashed again." }),
  );
  expect(await redo(repo.commands, root)).toEqual(expect.objectContaining({ ok: true }));
  expect(popped.at(-1)).toBe("again-2");
});

test("a new action leaves nothing to redo, each repository keeps its own, and only the newest steps are kept", async () => {
  const repo = repository({ head: id(5), branch: "main" });
  recordUndo(root, { kind: "amend", id: id(5), replaced: id(4), subject: "One" });
  await undo(repo.commands, root);
  expect(historyOf(root).redo).toHaveLength(1);

  recordUndo(root, { kind: "createBranch", name: "topic", tip: id(4) });
  expect(historyOf(root).redo).toEqual([]);
  expect(historyOf("/work/other")).toEqual({ undo: [], redo: [] });

  for (let n = 0; n < KEPT_STEPS + 5; n++) recordUndo(root, { kind: "createBranch", name: `b${n}`, tip: id(n) });
  expect(historyOf(root).undo).toHaveLength(KEPT_STEPS);
  expect(historyOf(root).undo.at(-1)).toEqual({ kind: "createBranch", name: `b${KEPT_STEPS + 4}`, tip: id(KEPT_STEPS + 4) });
});

test("with nothing to undo or redo, nothing is asked of the repository", async () => {
  const repo = repository({ head: id(1), branch: "main" });
  expect(await undo(repo.commands, root)).toBeNull();
  expect(await redo(repo.commands, root)).toBeNull();
  expect(repo.calls).toEqual([]);
});
