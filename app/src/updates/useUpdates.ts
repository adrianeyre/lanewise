import { useEffect, useRef, useState } from "react";

import { startActivity } from "../ui/activity";
import { readLocal, UPDATE_CHECK_KEY, writeLocal } from "../settings/localSettings";
import type { FoundUpdate, Updater, UpdateStatus } from "./updater";

export type UpdateRun =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "upToDate" }
  | { state: "found"; update: FoundUpdate }
  | { state: "installing"; update: FoundUpdate; progress: number }
  /**
   * A check or an install that failed, or an install that has to wait; after
   * an install, the Update it was, to try again.
   */
  | { state: "failed"; problem: string; update: FoundUpdate | null };

export interface Updates {
  /** Whether this shell has Updates at all: the Desktop App does, Web Mode doesn't. */
  supported: boolean;
  /** The version running and whether it updates itself; null until the shell says. */
  status: UpdateStatus | null;
  run: UpdateRun;
  checkAtStart: boolean;
  setCheckAtStart(on: boolean): void;
  /** Whether to show the notice of an Update: until it is installed, or put off with Later. */
  notice: boolean;
  check(): void;
  install(): void;
  /** Puts the notice off until the next start; Settings still has the Update. */
  later(): void;
}

export interface UpdatesOptions {
  /** Why the Update mustn't be installed now, such as an In-Progress Operation, or null if it may. */
  whyNotInstall?: () => Promise<string | null>;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The app's Updates: its status, a check at start unless turned off, a
 * check from Settings, and installing what was found, only when the user
 * says so and nothing running would be cut short. A check at start that
 * fails (offline, say) shows nothing but in Settings; one that finds an
 * Update shows the notice.
 */
export function useUpdates(updater: Updater | null, { whyNotInstall = async () => null }: UpdatesOptions = {}): Updates {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [run, setRun] = useState<UpdateRun>({ state: "idle" });
  const [checkAtStart, setCheckAtStartState] = useState(() => readLocal(UPDATE_CHECK_KEY) !== "false");
  const [putOff, setPutOff] = useState(false);
  // Set while a check or an install is under way, so a second click starts no other.
  const busy = useRef(false);

  const check = async () => {
    if (!updater || busy.current) return;
    busy.current = true;
    setRun({ state: "checking" });
    const activity = startActivity("Checking for an Update…");
    try {
      const update = await updater.check();
      setRun(update ? { state: "found", update } : { state: "upToDate" });
    } catch (error) {
      setRun({ state: "failed", problem: message(error), update: null });
    } finally {
      activity.end();
      busy.current = false;
    }
  };
  // The check at start is the one made as the updater is first given, with the latest `check`.
  const checkNow = useRef(check);
  useEffect(() => {
    checkNow.current = check;
  });

  useEffect(() => {
    if (!updater) return;
    let live = true;
    void updater.status().then(
      (found) => {
        if (!live) return;
        setStatus(found);
        if (found.off === null && readLocal(UPDATE_CHECK_KEY) !== "false") void checkNow.current();
      },
      // A shell that can't say which version it is can't update itself: Settings says it is still asking.
      () => {},
    );
    return () => {
      live = false;
    };
  }, [updater]);

  const install = async () => {
    const update = run.state === "found" || run.state === "failed" ? run.update : null;
    if (!updater || !update || busy.current) return;
    busy.current = true;
    const activity = startActivity(`Checking Lanewise ${update.version} can be installed now…`);
    try {
      const why = await whyNotInstall().catch(message);
      if (why !== null) {
        setRun({ state: "failed", problem: why, update });
        return;
      }
      setRun({ state: "installing", update, progress: 0 });
      activity.update(`Downloading and installing Lanewise ${update.version}…`, 0);
      await updater.install((progress) => {
        activity.update(`Downloading and installing Lanewise ${update.version}…`, Math.round(progress * 100));
        setRun((now) => (now.state === "installing" ? { ...now, progress } : now));
      });
    } catch (error) {
      setRun({ state: "failed", problem: message(error), update });
    } finally {
      activity.end();
      busy.current = false;
    }
  };

  const found = run.state === "found" || run.state === "installing" || (run.state === "failed" && run.update !== null);
  return {
    supported: updater !== null,
    status,
    run,
    checkAtStart,
    setCheckAtStart(on) {
      setCheckAtStartState(on);
      writeLocal(UPDATE_CHECK_KEY, String(on));
    },
    notice: found && !putOff,
    check: () => void check(),
    install: () => void install(),
    later: () => setPutOff(true),
  };
}
