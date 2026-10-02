import { useSyncExternalStore } from "react";

import type { BranchToCheckOut, CommandClient, Path, ResetMode } from "../commands/api";
import { describeBranchError } from "./branchProblems";
import { describeFailure } from "./problems";
import { describeStashError } from "./stashProblems";
import { describeCommitActionError } from "./useCommitActions";

/** Where `HEAD` is: on a local branch, or detached at a commit. */
export type Place = { kind: "branch"; name: string } | { kind: "detached"; commit: string };

/**
 * One of Lanewise's own actions that Undo can take back (ADR 0045), with
 * what undoing and redoing it need. Each is undone, and redone, only while
 * the repository is still as it left it.
 */
export type UndoStep =
  /** A commit, `id`, with its subject; once undone, `parent` is the commit undoing it went back to. */
  | { kind: "commit"; id: string; subject: string; parent?: string }
  /** An amend, which replaced the commit `replaced` with `id`. */
  | { kind: "amend"; id: string; replaced: string; subject: string }
  /** A checkout, from `from` to `to`. */
  | { kind: "checkOut"; from: Place; to: Place }
  /** A new local branch, `name`, at `tip`, or at `HEAD` if that wasn't known. */
  | { kind: "createBranch"; name: string; tip: string | null }
  /** A deleted local branch, `name`, whose tip was `tip`. */
  | { kind: "deleteBranch"; name: string; tip: string }
  /** A reset, in `mode`, of `HEAD` from `from` to `to`, moving `branch`, or a detached `HEAD`. */
  | { kind: "reset"; branch: string | null; mode: ResetMode; from: string; to: string }
  /** A stash, `id`, made with `message`. */
  | { kind: "stash"; id: string; message: string | null; includeUntracked: boolean }
  /** A stash popped, which had `message`; once undone, `again` is the stash its changes went back into. */
  | { kind: "popStash"; message: string | null; again?: string };

/** What undoing or redoing a step did: the step to put on the other list, or why it couldn't be done. */
export type UndoOutcome = { ok: true; said: string; step: UndoStep } | { ok: false; problem: string };

interface History {
  undo: readonly UndoStep[];
  redo: readonly UndoStep[];
}

/** How many steps each repository keeps to undo. */
export const KEPT_STEPS = 50;

const EMPTY: History = { undo: [], redo: [] };
// By repository root, for as long as Lanewise runs: a Tab shown again keeps what it could undo.
const histories = new Map<Path, History>();
const listeners = new Set<() => void>();

function publish(root: Path, history: History) {
  histories.set(root, history);
  for (const listener of listeners) listener();
}

/** What `root` can undo and redo, newest last. */
export function historyOf(root: Path): History {
  return histories.get(root) ?? EMPTY;
}

/** Adds `step` to what `root` can undo. A new action can't be followed by a redo of an old one, so those go. */
export function recordUndo(root: Path, step: UndoStep): void {
  publish(root, { undo: [...historyOf(root).undo, step].slice(-KEPT_STEPS), redo: [] });
}

/** Forgets every repository's history, as a test starts. */
export function forgetUndoHistories(): void {
  histories.clear();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What `root` can undo and redo, drawn again as it changes. */
export function useUndoHistory(root: Path): History {
  return useSyncExternalStore(subscribe, () => historyOf(root));
}

/** How a step is named after "Undo" or "Redo", such as “the commit “Fix the build””. */
export function describeStep(step: UndoStep): string {
  switch (step.kind) {
    case "commit":
      return `the commit “${step.subject}”`;
    case "amend":
      return `the amend of “${step.subject}”`;
    case "checkOut":
      return `the checkout of ${describePlace(step.to)}`;
    case "createBranch":
      return `the new branch “${step.name}”`;
    case "deleteBranch":
      return `deleting the branch “${step.name}”`;
    case "reset":
      return `the reset of ${step.branch === null ? "HEAD" : `“${step.branch}”`} to ${step.to.slice(0, 7)}`;
    case "stash":
      return step.message === null ? "the stash" : `the stash “${step.message}”`;
    case "popStash":
      return step.message === null ? "popping the stash" : `popping the stash “${step.message}”`;
  }
}

function describePlace(place: Place): string {
  return place.kind === "branch" ? `“${place.name}”` : `commit ${place.commit.slice(0, 7)}`;
}

function toCheckOut(place: Place): BranchToCheckOut {
  return place.kind === "branch" ? { kind: "local", name: place.name } : { kind: "commit", commit: place.commit };
}

function samePlace(a: Place, b: Place): boolean {
  return a.kind === "branch" ? b.kind === "branch" && a.name === b.name : b.kind === "detached" && a.commit === b.commit;
}

/** Where `HEAD` is now. */
export async function placeOf(commands: CommandClient, root: Path): Promise<Place | null> {
  const read = await commands.call("branches", { repository: root });
  if (!read.ok) return null;
  if (read.value.detached !== null) return { kind: "detached", commit: read.value.detached };
  const current = read.value.local.find((branch) => branch.current);
  return current === undefined ? null : { kind: "branch", name: current.name };
}

/** Why a step can't be undone or redone: the repository has moved on from where it left it. */
const MOVED = "The repository has changed since, so it was left as it is.";

/** Moves `HEAD` from `head`, where the step left it, to `commit`, in `mode`, or says why it didn't. */
async function resetFrom(
  commands: CommandClient,
  root: Path,
  head: string,
  commit: string,
  mode: ResetMode,
): Promise<string | null> {
  const preview = await commands.call("previewReset", { repository: root, commit });
  if (!preview.ok) return describeCommitActionError(preview.error, "reset");
  if (preview.value.head !== head) return MOVED;
  const reset = await commands.call("reset", { repository: root, commit, mode, head });
  if (!reset.ok) return reset.error.kind === "headMoved" ? MOVED : describeCommitActionError(reset.error, "reset");
  return null;
}

async function checkOutFrom(commands: CommandClient, root: Path, now: Place, to: Place): Promise<string | null> {
  const place = await placeOf(commands, root);
  if (place === null || !samePlace(place, now)) return MOVED;
  const outcome = await commands.call("checkOut", { repository: root, branch: toCheckOut(to), stashFirst: false });
  return outcome.ok ? null : describeBranchError(outcome.error, "checkOut");
}

/** The tip of the local branch `name`, if there is one. */
export async function tipOf(commands: CommandClient, root: Path, name: string): Promise<string | null> {
  const read = await commands.call("branches", { repository: root });
  return read.ok ? (read.value.local.find((branch) => branch.name === name)?.commit ?? null) : null;
}

/**
 * Deletes the local branch `name` if its tip is still `tip`; with `tip`
 * `null`, if nothing would be lost. Gives the tip it had, or why it didn't.
 */
async function deleteAt(
  commands: CommandClient,
  root: Path,
  name: string,
  tip: string | null,
): Promise<{ tip: string } | { problem: string }> {
  const now = await tipOf(commands, root, name);
  if (now === null || (tip !== null && now !== tip)) return { problem: MOVED };
  const outcome = await commands.call("deleteBranch", { repository: root, name, confirmedTip: tip });
  if (outcome.ok) return { tip: now };
  return { problem: outcome.error.kind === "unmerged" ? MOVED : describeBranchError(outcome.error, "delete") };
}

async function createAt(commands: CommandClient, root: Path, name: string, tip: string): Promise<string | null> {
  const outcome = await commands.call("createBranch", { repository: root, name, start: tip });
  return outcome.ok ? null : describeBranchError(outcome.error, "create");
}

async function popById(commands: CommandClient, root: Path, id: string): Promise<string | null> {
  const outcome = await commands.call("popStash", { repository: root, stash: id });
  if (!outcome.ok) return outcome.error.kind === "stashNotFound" ? MOVED : describeStashError(outcome.error, "pop");
  if (outcome.value.kind === "stopped") {
    return `Popping it stopped with conflicts in ${outcome.value.conflicts.join(", ")}, and the stash was kept.`;
  }
  return null;
}

async function stashAgain(
  commands: CommandClient,
  root: Path,
  message: string | null,
  includeUntracked: boolean,
): Promise<{ id: string } | { problem: string }> {
  const outcome = await commands.call("createStash", { repository: root, message, includeUntracked });
  return outcome.ok ? { id: outcome.value.id } : { problem: describeStashError(outcome.error, "create") };
}

/** Takes `step` back, if the repository is as it left it. */
async function undoStep(commands: CommandClient, root: Path, step: UndoStep): Promise<UndoOutcome> {
  const what = describeStep(step);
  const failed = (problem: string): UndoOutcome => ({ ok: false, problem: `Didn't undo ${what}. ${problem}` });
  switch (step.kind) {
    case "commit": {
      const details = await commands.call("commitDetails", { repository: root, commit: step.id });
      const parent = details.ok ? details.value.parents[0]?.id : undefined;
      if (parent === undefined) return failed(details.ok ? "It's the repository's first commit." : MOVED);
      const problem = await resetFrom(commands, root, step.id, parent, "soft");
      return problem === null
        ? { ok: true, said: `Undid ${what}. Its changes are staged again.`, step: { ...step, parent } }
        : failed(problem);
    }
    case "amend": {
      const problem = await resetFrom(commands, root, step.id, step.replaced, "soft");
      return problem === null ? { ok: true, said: `Undid ${what}. The commit it replaced is back, with the amend's changes staged.`, step } : failed(problem);
    }
    case "checkOut": {
      const problem = await checkOutFrom(commands, root, step.to, step.from);
      return problem === null ? { ok: true, said: `Undid ${what}: ${describePlace(step.from)} is checked out again.`, step } : failed(problem);
    }
    case "createBranch": {
      const deleted = await deleteAt(commands, root, step.name, step.tip);
      if ("problem" in deleted) return failed(deleted.problem);
      return { ok: true, said: `Undid ${what}: it's deleted.`, step: { ...step, tip: deleted.tip } };
    }
    case "deleteBranch": {
      const problem = await createAt(commands, root, step.name, step.tip);
      return problem === null ? { ok: true, said: `Undid ${what}: it's back at ${step.tip.slice(0, 7)}.`, step } : failed(problem);
    }
    case "reset": {
      const problem = await resetFrom(commands, root, step.to, step.from, step.mode);
      const lost = step.mode === "hard" ? " Uncommitted changes the reset lost can't come back." : "";
      return problem === null ? { ok: true, said: `Undid ${what}: it's back at ${step.from.slice(0, 7)}.${lost}`, step } : failed(problem);
    }
    case "stash": {
      const problem = await popById(commands, root, step.id);
      return problem === null ? { ok: true, said: `Undid ${what}: its changes are back in the working tree.`, step } : failed(problem);
    }
    case "popStash": {
      const stashed = await stashAgain(commands, root, step.message, true);
      if ("problem" in stashed) return failed(stashed.problem);
      return { ok: true, said: `Undid ${what}: the changes are stashed again.`, step: { ...step, again: stashed.id } };
    }
  }
}

/** Does `step` again, after it was undone, if the repository is as undoing it left it. */
async function redoStep(commands: CommandClient, root: Path, step: UndoStep): Promise<UndoOutcome> {
  const what = describeStep(step);
  const failed = (problem: string): UndoOutcome => ({ ok: false, problem: `Didn't redo ${what}. ${problem}` });
  switch (step.kind) {
    case "commit": {
      if (step.parent === undefined) return failed(MOVED);
      const problem = await resetFrom(commands, root, step.parent, step.id, "soft");
      return problem === null ? { ok: true, said: `Redid ${what}.`, step } : failed(problem);
    }
    case "amend": {
      const problem = await resetFrom(commands, root, step.replaced, step.id, "soft");
      return problem === null ? { ok: true, said: `Redid ${what}.`, step } : failed(problem);
    }
    case "checkOut": {
      const problem = await checkOutFrom(commands, root, step.from, step.to);
      return problem === null ? { ok: true, said: `Redid ${what}.`, step } : failed(problem);
    }
    case "createBranch": {
      if (step.tip === null) return failed(MOVED);
      const problem = await createAt(commands, root, step.name, step.tip);
      return problem === null ? { ok: true, said: `Redid ${what}.`, step } : failed(problem);
    }
    case "deleteBranch": {
      const deleted = await deleteAt(commands, root, step.name, step.tip);
      return "problem" in deleted ? failed(deleted.problem) : { ok: true, said: `Redid ${what}.`, step };
    }
    case "reset": {
      const problem = await resetFrom(commands, root, step.from, step.to, step.mode);
      return problem === null ? { ok: true, said: `Redid ${what}.`, step } : failed(problem);
    }
    case "stash": {
      const stashed = await stashAgain(commands, root, step.message, step.includeUntracked);
      if ("problem" in stashed) return failed(stashed.problem);
      return { ok: true, said: `Redid ${what}.`, step: { ...step, id: stashed.id } };
    }
    case "popStash": {
      if (step.again === undefined) return failed(MOVED);
      const problem = await popById(commands, root, step.again);
      return problem === null ? { ok: true, said: `Redid ${what}.`, step } : failed(problem);
    }
  }
}

/**
 * Undoes `root`'s newest step, moving it to what can be redone; or, if it
 * can't be undone, as the repository has changed since, says why and
 * forgets it, since it never can be.
 */
export async function undo(commands: CommandClient, root: Path): Promise<UndoOutcome | null> {
  return move(commands, root, "undo");
}

/** Redoes the step `root` undid last, as `undo` does. */
export async function redo(commands: CommandClient, root: Path): Promise<UndoOutcome | null> {
  return move(commands, root, "redo");
}

async function move(commands: CommandClient, root: Path, way: "undo" | "redo"): Promise<UndoOutcome | null> {
  const from = historyOf(root)[way];
  const step = from.at(-1);
  if (step === undefined) return null;
  let outcome: UndoOutcome;
  try {
    outcome = way === "undo" ? await undoStep(commands, root, step) : await redoStep(commands, root, step);
  } catch (failure) {
    return { ok: false, problem: `Didn't ${way} ${describeStep(step)}. ${describeFailure(failure)}` };
  }
  const now = historyOf(root);
  const rest = now[way].filter((each) => each !== step);
  if (!outcome.ok) {
    publish(root, way === "undo" ? { undo: rest, redo: now.redo } : { undo: now.undo, redo: rest });
    return outcome;
  }
  publish(
    root,
    way === "undo"
      ? { undo: rest, redo: [...now.redo, outcome.step] }
      : { undo: [...now.undo, outcome.step].slice(-KEPT_STEPS), redo: rest },
  );
  return outcome;
}
