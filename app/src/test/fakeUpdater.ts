import type { FoundUpdate, Updater, UpdateStatus } from "../updates/updater";

export interface FakeUpdater {
  updater: Updater;
  /** How many checks were made. */
  checks: number;
  /** How many installs were started. */
  installs: number;
  /** Reports how far the download has got to the install under way. */
  progress(fraction: number): void;
  /** Makes the install under way fail with `message`, as a bad signature would. */
  failInstall(message: string): void;
  /** What the next check finds, or throws. */
  answer(next: FoundUpdate | null | Error): void;
}

/** An Update for version 1.2.3, as a Release announces it. */
export const FOUND: FoundUpdate = {
  version: "1.2.3",
  date: "2026-09-29T12:00:00Z",
  notes: "Features\n• Check for and install Updates in the Desktop App",
};

/**
 * A fake updater for version 1.0.0, which updates itself unless `status`
 * says otherwise. Each check finds `found` until `answer` changes it; an
 * install waits, as the real one never settles once it restarts Lanewise,
 * until `failInstall`.
 */
export function fakeUpdater({
  status = { version: "1.0.0", off: null },
  found = FOUND,
}: { status?: UpdateStatus; found?: FoundUpdate | null | Error } = {}): FakeUpdater {
  let next = found;
  let reporting: ((fraction: number) => void) | null = null;
  let failing: ((error: Error) => void) | null = null;
  const fake: FakeUpdater = {
    updater: {
      async status() {
        return status;
      },
      async check() {
        fake.checks += 1;
        if (next instanceof Error) throw next;
        return next;
      },
      install(onProgress) {
        fake.installs += 1;
        reporting = onProgress;
        return new Promise((_, reject) => {
          failing = reject;
        });
      },
    },
    checks: 0,
    installs: 0,
    progress(fraction) {
      reporting?.(fraction);
    },
    failInstall(message) {
      failing?.(new Error(message));
    },
    answer(update) {
      next = update;
    },
  };
  return fake;
}
