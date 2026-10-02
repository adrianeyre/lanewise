import { useCallback, useEffect, useRef, useState } from "react";

import type { CheckedGitSetup, CommandClient } from "../commands/api";
import { describeFailure } from "../repository/problems";

/** Where the Git Setup check has got to. */
export type GitSetupCheck =
  /** The first check hasn't answered yet. */
  | { kind: "checking" }
  | { kind: "checked"; setup: CheckedGitSetup }
  /** The check couldn't run at all, which was reported. */
  | { kind: "failed" };

export interface GitSetupState {
  check: GitSetupCheck;
  /** "Check again" is running; `check` still holds the last answer. */
  rechecking: boolean;
  /** How many checks have answered, so a screen can tell a recheck's answer from the first. */
  answers: number;
  checkAgain(): void;
}

/**
 * Checks the Git Setup on start, and again on `checkAgain`. A check that
 * can't run at all, such as outside the Desktop App, is given to `report`,
 * and the app carries on without it.
 */
export function useGitSetup(
  commands: CommandClient,
  report: (problem: string) => void,
): GitSetupState {
  const [check, setCheck] = useState<GitSetupCheck>({ kind: "checking" });
  const [rechecking, setRechecking] = useState(false);
  const [answers, setAnswers] = useState(0);
  // Only the latest check's answer is shown.
  const latest = useRef(0);

  /** Runs a check, and returns a function that drops its answer. */
  const run = useCallback(() => {
    const id = ++latest.current;
    let dropped = false;
    void checkGitSetup(commands).then((answer) => {
      if (dropped || latest.current !== id) return;
      setRechecking(false);
      setAnswers((count) => count + 1);
      if (answer.ok) {
        setCheck({ kind: "checked", setup: answer.setup });
      } else {
        setCheck({ kind: "failed" });
        report(answer.problem);
      }
    });
    return () => {
      dropped = true;
    };
  }, [commands, report]);

  useEffect(() => run(), [run]);

  const checkAgain = useCallback(() => {
    if (rechecking) return;
    setRechecking(true);
    run();
  }, [rechecking, run]);

  return { check, rechecking, answers, checkAgain };
}

type Answer = { ok: true; setup: CheckedGitSetup } | { ok: false; problem: string };

async function checkGitSetup(commands: CommandClient): Promise<Answer> {
  try {
    const outcome = await commands.call("checkGitSetup", {});
    if (outcome.ok) return { ok: true, setup: outcome.value };
    // The check has no error of its own, so this is the core misbehaving.
    return { ok: false, problem: describeFailure("The core couldn't check the Git Setup.") };
  } catch (failure) {
    return { ok: false, problem: describeFailure(failure) };
  }
}
