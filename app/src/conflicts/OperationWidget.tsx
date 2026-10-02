import { CircleX, Play, SkipForward } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { CommandClient, InProgressOperation, OpenedRepository, Outcome } from "../commands/api";
import { describeFailure } from "../repository/problems";
import { Dialog } from "../ui/Dialog";
import {
  describeAbort,
  describeContinue,
  describeOperation,
  describeOperationError,
  describeStanding,
  files,
  operationHeading,
  operationNoun,
  type OperationRun,
} from "./operationWords";

interface Props {
  commands: CommandClient;
  repository: OpenedRepository;
  operation: InProgressOperation;
  /** Whether its heading takes focus as it's drawn: when the page has just changed to the Conflicts page. */
  focusOnShow: boolean;
  /** Called with the In-Progress Operation as continuing or skipping left it, or `null` once it finished or was aborted. */
  onDone: (operation: InProgressOperation | null) => void;
  /** Called to have the page read the In-Progress Operation again. */
  onChanged: () => void;
  /** Says what was done, where it's still heard once the page has changed back to the Repository page. */
  onSay: (said: string) => void;
}

/**
 * The Conflicts page's In-Progress Operation Widget (PRD §7.7), along its
 * top: which operation Git stopped partway, as "commit 3 of 7" for a rebase,
 * and its actions, all run through the `git` CLI. Continue can be used once
 * every file is marked resolved; Skip is a rebase's, cherry-pick's or
 * revert's alone; Abort asks first, saying what it undoes.
 */
export function OperationWidget({ commands, repository, operation, focusOnShow, onDone, onChanged, onSay }: Props) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const continueNoteId = useId();
  const noun = operationNoun(operation);
  const unresolved = operation.conflicts.length > 0;

  // Only as it's first drawn, not each time it's told again.
  const focusFirst = useRef(focusOnShow);
  useEffect(() => {
    if (focusFirst.current) heading.current?.focus();
  }, []);

  async function run(
    what: OperationRun,
    call: () => Promise<Outcome<"continueOperation"> | Outcome<"skipCommit"> | Outcome<"abortOperation">>,
  ) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await call();
      if (!outcome.ok) {
        setProblem(describeOperationError(outcome.error, what));
        onChanged();
        return;
      }
      const after = outcome.value;
      if (what === "abort") {
        onSay(`Aborted the ${noun}. Everything it changed is back as it was before it.`);
        onDone(null);
      } else if (after === null) {
        onSay(what === "skip" ? `Skipped the commit, and the ${noun} finished.` : `Continued, and the ${noun} finished.`);
        onDone(null);
      } else {
        onSay(`${what === "skip" ? "Skipped the commit" : "Continued"}. ${describeStanding(after)}`);
        onDone(after);
        heading.current?.focus();
      }
      onChanged();
    } catch (failure) {
      setProblem(describeFailure(failure));
    } finally {
      setBusy(false);
    }
  }

  const request = { repository: repository.root };
  const continueOperation = () => {
    if (unresolved) {
      setProblem(describeOperationError({ kind: "unresolved", conflicts: operation.conflicts }, "continue"));
      return;
    }
    void run("continue", () => commands.call("continueOperation", request));
  };

  return (
    <section className="surface operation-in-progress" aria-labelledby={headingId} aria-busy={busy || undefined}>
      <h3 ref={heading} id={headingId} className="surface-heading" tabIndex={-1}>
        {operationHeading(operation)}
      </h3>
      <p className="operation-standing">
        {describeOperation(operation)}
        {unresolved ? `: ${files(operation.conflicts.length)} still conflicted.` : ". Nothing is conflicted."}
      </p>
      <p id={continueNoteId} className="surface-note">
        {unresolved
          ? `Mark every file resolved to continue. ${describeContinue(operation)}`
          : describeContinue(operation)}
      </p>
      {problem !== null && (
        <p role="alert" className="problem problem-output">
          {problem}
        </p>
      )}
      <div className="dialog-actions">
        <button
          type="button"
          className="button"
          aria-disabled={busy || unresolved || undefined}
          aria-describedby={continueNoteId}
          onClick={continueOperation}
        >
          <Play aria-hidden="true" className="button-icon" />
          Continue
        </button>
        {(operation.kind === "rebase" || operation.kind === "cherryPick" || operation.kind === "revert") && (
          <button
            type="button"
            className="button"
            aria-disabled={busy || undefined}
            onClick={() => void run("skip", () => commands.call("skipCommit", request))}
          >
            <SkipForward aria-hidden="true" className="button-icon" />
            Skip commit
          </button>
        )}
        <button
          type="button"
          className="button"
          aria-disabled={busy || undefined}
          onClick={() => {
            if (!busy) setAsking(true);
          }}
        >
          <CircleX aria-hidden="true" className="button-icon" />
          Abort {noun}
        </button>
      </div>
      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title={`Abort the ${noun}?`}
        closeLabel={`Close, keeping the ${noun} in progress`}
      >
        <div className="branch-form">
          <p className="warning">{describeAbort(operation)}</p>
          <div className="dialog-actions">
            <button
              type="button"
              className="button"
              aria-disabled={busy || undefined}
              onClick={() => {
                if (busy) return;
                setAsking(false);
                void run("abort", () => commands.call("abortOperation", request));
              }}
            >
              Abort {noun}
            </button>
            <button type="button" className="button" onClick={() => setAsking(false)} data-autofocus>
              Keep going
            </button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}
