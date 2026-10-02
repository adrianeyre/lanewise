import { GitCommitHorizontal, ShieldCheck } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useId, useRef, useState } from "react";

import type { AmendableCommit, CommandClient, GitRunError, OpenedRepository } from "../commands/api";
import { type CommitCheck, type CommitType, LIKELY } from "../ai/jevDecisions";
import { describeFailure } from "./problems";
import { describeGitRunError } from "./workingTreeProblems";
import { recordUndo } from "./undo";

interface Props {
  commands: CommandClient;
  repository: OpenedRepository;
  /** Called once a commit is made or amended. */
  onCommitted: () => void;
  /**
   * Jev's check of the staged changes and the message, where it's on
   * (ADR 0036): asked by Check with Jev, and before each commit, which it
   * stops only to warn.
   */
  checkWithJev?: ((message: string) => Promise<CommitCheck>) | null;
}

/** What Jev found last, or why it couldn't look. */
type Checked = { ok: true; check: CommitCheck; blocking: boolean } | { ok: false; problem: string };

/** What the last commit or amend did. */
type Outcome =
  | { ok: true; said: string; hooks: string }
  | { ok: false; problem: string; git: string | null };

/** The last commit, as amending it needs it. */
type Amending =
  | { kind: "off" }
  | { kind: "reading" }
  /** `prefilled` is the message read from `last` into the box, or `null` if one was already written. */
  | { kind: "on"; last: AmendableCommit; prefilled: { subject: string; body: string } | null };

/**
 * The Working tree Widget's Commit Message box: a subject and a body, and
 * "Commit", which commits the staged changes through `git commit`, so its
 * hooks run. "Amend the last commit" puts the last commit's message in the
 * box to edit, and warns if the commit has been pushed. What the hooks
 * write is shown, and a failed commit keeps the message to try again.
 * Ctrl+Enter, or Cmd+Enter on macOS, commits from either field.
 */
export function CommitForm({ commands, repository, onCommitted, checkWithJev = null }: Props) {
  const [checked, setChecked] = useState<Checked | null>(null);
  const [checking, setChecking] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [amending, setAmending] = useState<Amending>({ kind: "off" });
  const [committing, setCommitting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [noSubject, setNoSubject] = useState(false);
  const subjectField = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const subjectId = useId();
  const bodyId = useId();
  const amendId = useId();
  const pushedId = useId();
  const busy = committing || amending.kind === "reading";
  const pushed = amending.kind === "on" && amending.last.pushedTo.length > 0;

  async function toggleAmend(on: boolean) {
    if (busy) return;
    if (!on) {
      // A message only read from the last commit goes with it.
      const { prefilled } = amending.kind === "on" ? amending : { prefilled: null };
      if (prefilled !== null && subject === prefilled.subject && body === prefilled.body) {
        setSubject("");
        setBody("");
      }
      setAmending({ kind: "off" });
      return;
    }
    setAmending({ kind: "reading" });
    try {
      const read = await commands.call("lastCommit", { repository: repository.root });
      if (!read.ok) {
        setAmending({ kind: "off" });
        setOutcome({ ok: false, problem: describeGitRunError(read.error, "readLastCommit"), git: null });
        return;
      }
      if (read.value === null) {
        setAmending({ kind: "off" });
        setOutcome({ ok: false, problem: "There's no commit to amend yet.", git: null });
        return;
      }
      const last = read.value;
      // A message already written is kept; otherwise it's the last commit's, to edit.
      const keep = subject.trim() !== "" || body.trim() !== "";
      if (!keep) {
        setSubject(last.subject);
        setBody(last.body);
      }
      setAmending({ kind: "on", last, prefilled: keep ? null : { subject: last.subject, body: last.body } });
      setOutcome(null);
    } catch (failure) {
      setAmending({ kind: "off" });
      setOutcome({ ok: false, problem: describeFailure(failure), git: null });
    }
  }

  const messageOf = () => (body.trim() === "" ? subject.trim() : `${subject.trim()}\n\n${body.trim()}`);

  /** Asks Jev about the staged changes, showing what it found: `true` if it found a secret or a leftover. */
  async function askJev(): Promise<boolean> {
    if (checkWithJev === null) return false;
    setChecking(true);
    try {
      const check = await checkWithJev(messageOf());
      const blocking = check.secret > LIKELY || check.leftover > LIKELY;
      setChecked({ ok: true, check, blocking });
      return blocking;
    } catch (failure) {
      setChecked({ ok: false, problem: failure instanceof Error ? failure.message : String(failure) });
      return false;
    } finally {
      setChecking(false);
    }
  }

  async function commit(event?: FormEvent, anyway = false) {
    event?.preventDefault();
    if (busy || checking) return;
    if (subject.trim() === "") {
      setNoSubject(true);
      subjectField.current?.focus();
      return;
    }
    setNoSubject(false);
    // Jev looks first, and stops the commit only to say what it found, for the user to decide.
    if (!anyway && checkWithJev !== null && (await askJev())) return;
    setChecked(null);
    const amend = amending.kind === "on";
    const message = messageOf();
    setCommitting(true);
    setOutcome(null);
    try {
      const made = await commands.call("commit", { repository: repository.root, message, amend });
      if (made.ok) {
        const madeSubject = subject.trim();
        recordUndo(
          repository.root,
          amending.kind === "on"
            ? { kind: "amend", id: made.value.id, replaced: amending.last.id, subject: madeSubject }
            : { kind: "commit", id: made.value.id, subject: madeSubject },
        );
        setSubject("");
        setBody("");
        setAmending({ kind: "off" });
        setOutcome({
          ok: true,
          said: amend ? `Amended the last commit: it is now ${made.value.shortId}.` : `Committed ${made.value.shortId}.`,
          hooks: made.value.messages,
        });
        onCommitted();
      } else {
        setOutcome(failed(made.error, amend));
      }
    } catch (failure) {
      setOutcome({ ok: false, problem: describeFailure(failure), git: null });
    } finally {
      setCommitting(false);
    }
  }

  function commitOnModEnter(event: KeyboardEvent) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void commit(event);
  }

  return (
    <form className="commit-form" aria-labelledby={headingId} onSubmit={(event) => void commit(event)} noValidate>
      <h4 id={headingId} className="surface-subheading">
        Commit
      </h4>
      <div className="commit-field">
        <label htmlFor={subjectId}>Subject</label>
        <input
          id={subjectId}
          ref={subjectField}
          type="text"
          value={subject}
          autoComplete="off"
          spellCheck
          aria-invalid={noSubject}
          aria-describedby={noSubject ? `${subjectId}-problem` : undefined}
          onChange={(event) => setSubject(event.target.value)}
          onKeyDown={commitOnModEnter}
        />
        {noSubject && (
          <p id={`${subjectId}-problem`} role="alert" className="problem">
            Write a subject: one line saying what the commit does.
          </p>
        )}
      </div>
      <div className="commit-field">
        <label htmlFor={bodyId}>Body (optional)</label>
        <textarea
          id={bodyId}
          value={body}
          rows={4}
          spellCheck
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={commitOnModEnter}
        />
      </div>
      <div className="commit-amend">
        <input
          id={amendId}
          type="checkbox"
          checked={amending.kind !== "off"}
          aria-disabled={busy}
          aria-describedby={pushed ? pushedId : undefined}
          onChange={(event) => void toggleAmend(event.target.checked)}
        />
        <label htmlFor={amendId}>Amend the last commit</label>
      </div>
      {amending.kind === "reading" && (
        <p role="status" className="file-status-summary">
          Reading the last commit…
        </p>
      )}
      {amending.kind === "on" && (
        <p className="surface-note">
          Amending {amending.last.shortId}, {amending.last.subject}: its changes, the staged ones and this message
          make one new commit in its place.
        </p>
      )}
      {pushed && (
        <p id={pushedId} role="alert" className="warning">
          {amending.last.shortId} is already on {listed(amending.last.pushedTo)}. Amending it rewrites history others
          may have: pushing it then needs a force push, and anyone who has the commit must reset to the new one.
        </p>
      )}
      <div className="commit-actions">
        <button type="submit" className="button" aria-disabled={busy} aria-keyshortcuts="Control+Enter Meta+Enter">
          <GitCommitHorizontal aria-hidden="true" className="button-icon" />
          {amending.kind === "on" ? "Amend" : "Commit"}
        </button>
        <span className="surface-note">or Ctrl+Enter (⌘+Enter on a Mac)</span>
        {checkWithJev !== null && (
          <button type="button" className="button button-small" aria-disabled={busy || checking} onClick={() => void askJev()}>
            <ShieldCheck aria-hidden="true" className="button-icon" />
            Check with Jev
          </button>
        )}
      </div>
      {checking && (
        <p role="status" className="file-status-summary">
          Jev is checking the staged changes…
        </p>
      )}
      {checked !== null && !checked.ok && (
        <p role="alert" className="problem">
          Jev couldn&apos;t check the staged changes. {checked.problem}
        </p>
      )}
      {checked?.ok && (
        <JevFindings
          check={checked.check}
          blocking={checked.blocking}
          subject={subject}
          onUseType={(type) => setSubject(withType(subject, type))}
          onCommitAnyway={() => void commit(undefined, true)}
        />
      )}
      <p role="status" className="file-status-summary">
        {committing ? (amending.kind === "on" ? "Amending…" : "Committing…") : outcome?.ok ? outcome.said : ""}
      </p>
      {outcome?.ok && outcome.hooks !== "" && <GitOutput heading="What the hooks said" text={outcome.hooks} />}
      {outcome !== null && !outcome.ok && (
        <div role="alert" className="problem commit-problem">
          <p>{outcome.problem}</p>
          {outcome.git !== null && <GitOutput heading="What Git and the hooks said" text={outcome.git} />}
        </div>
      )}
    </form>
  );
}

/** `n`, from 0 to 1, as a percentage. */
function percent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** `subject` with the Conventional Commit `type` at its start, in place of any it had. */
function withType(subject: string, type: CommitType): string {
  const rest = subject.replace(/^[a-z]+(\([^)]*\))?!?:\s*/, "");
  return `${type}: ${rest}`;
}

/**
 * What Jev found in the staged changes: a likely secret or leftover, with
 * Commit anyway, and the Conventional Commit type they likely are, which
 * Use puts at the subject's start. Warnings only: the user decides.
 */
function JevFindings({
  check,
  blocking,
  subject,
  onUseType,
  onCommitAnyway,
}: {
  check: CommitCheck;
  blocking: boolean;
  subject: string;
  onUseType: (type: CommitType) => void;
  onCommitAnyway: () => void;
}) {
  const typed = check.type !== null && subject.startsWith(`${check.type}:`);
  return (
    <div className="jev-findings" role={blocking ? "alert" : "status"}>
      <p className="suggestion-label">Jev</p>
      {check.secret > LIKELY && (
        <p className="warning">It looks likely ({percent(check.secret)}) that the staged changes hold a secret, such as a key or a password. Check them before you commit.</p>
      )}
      {check.leftover > LIKELY && (
        <p className="warning">It looks likely ({percent(check.leftover)}) that they hold a leftover, such as debug output or a note to self.</p>
      )}
      {!blocking && <p>Jev found no secret or leftover in the staged changes.</p>}
      {check.type !== null && !typed && (
        <p>
          Jev takes this for a “{check.type}” commit.{" "}
          <button type="button" className="button button-small" onClick={() => onUseType(check.type!)}>
            Start the subject with {check.type}:
          </button>
        </p>
      )}
      {blocking && (
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onCommitAnyway}>
            Commit anyway
          </button>
        </div>
      )}
    </div>
  );
}

/** A failed commit's problem, with Git's own words, such as a hook's output, apart from it. */
function failed(error: GitRunError, amend: boolean): Outcome {
  if (error.kind === "gitFailed") {
    const exit = error.code === null ? "Git was stopped" : `Git stopped with exit code ${error.code}`;
    return {
      ok: false,
      problem: `${amend ? "The last commit wasn't amended" : "Nothing was committed"}. ${exit}, and the message is kept to try again.`,
      git: error.message === "" ? null : error.message,
    };
  }
  return { ok: false, problem: describeGitRunError(error, amend ? "amend" : "commit"), git: null };
}

function GitOutput({ heading, text }: { heading: string; text: string }) {
  const headingId = useId();
  return (
    <figure className="git-output" aria-labelledby={headingId}>
      <figcaption id={headingId}>{heading}</figcaption>
      {/* Focusable, so the keyboard can scroll a long one. */}
      <pre tabIndex={0}>{text}</pre>
    </figure>
  );
}

function listed(branches: string[]): string {
  const last = branches.at(-1) ?? "";
  return branches.length === 1 ? last : `${branches.slice(0, -1).join(", ")} and ${last}`;
}
