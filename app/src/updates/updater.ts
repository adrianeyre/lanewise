/**
 * Updates (ADR 0030): the installed Desktop App finds a newer Release and,
 * only once the user says so, installs it and restarts into it. Web Mode has
 * no part here: its UI is served by the `serve` it runs with.
 */

/** Why this copy doesn't update itself, as the shell (`desktop/src/update.rs`) names it. */
export type UpdateOff = "no-key" | "development" | "not-installed";

export interface UpdateStatus {
  /** The version running. */
  version: string;
  /** Why it doesn't update itself, or null when it does. */
  off: UpdateOff | null;
}

/** A newer version, as its Release announces it. */
export interface FoundUpdate {
  version: string;
  /** When it was released, as RFC 3339, if the Release says. */
  date: string | null;
  /** What's new in it, as plain text, if the Release says. */
  notes: string | null;
}

export interface Updater {
  status(): Promise<UpdateStatus>;
  /** Asks the latest Release for a newer version; null if this is the latest. */
  check(): Promise<FoundUpdate | null>;
  /**
   * Downloads the version the last check found, checks its signature,
   * installs it and restarts into it, so it settles only if that fails.
   */
  install(onProgress: (fraction: number) => void): Promise<void>;
}

/** Where every Release is, with its installers. */
export const RELEASES_URL = "https://github.com/adrianeyre/lanewise/releases";

/** What Settings says about each reason this copy doesn't update itself. */
export const UPDATE_OFF: Record<UpdateOff, string> = {
  "no-key":
    "This copy of Lanewise doesn't update itself: it was made before Lanewise's Releases were signed for Updates. Get the latest Release from GitHub.",
  development: "Lanewise run from source with pnpm desktop:dev doesn't update itself.",
  "not-installed":
    "This copy of Lanewise wasn't installed from a Release, so it can't update itself. Get the latest Release from GitHub.",
};
