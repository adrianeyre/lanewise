import { RefreshCw } from "lucide-react";
import { useId } from "react";

import { ExternalLink, type LinkOpener } from "../legal/ExternalLink";
import { RELEASES_URL, UPDATE_OFF } from "./updater";
import { UpdateProgress } from "./UpdateProgress";
import type { Updates } from "./useUpdates";

/**
 * Updates in Settings: the version running, whether to check for an Update
 * at each start, Check for updates, and what's new in one found, with
 * Install and restart. Only the Desktop App has it.
 */
export function UpdateSettings({ updates, onOpenLink }: { updates: Updates } & LinkOpener) {
  const headingId = useId();
  const noteId = useId();
  const foundId = useId();
  const notesId = useId();
  if (!updates.supported) return null;
  const { status, run } = updates;
  const update = run.state === "found" || run.state === "installing" || run.state === "failed" ? run.update : null;
  const busy = run.state === "checking" || run.state === "installing";

  return (
    <section className="settings-group" aria-labelledby={headingId}>
      <h3 id={headingId} className="settings-legend">
        Updates
      </h3>
      {status === null ? (
        <p className="settings-choice-note">Asking which version this is…</p>
      ) : status.off !== null ? (
        <>
          <p>You have Lanewise {status.version}.</p>
          <p className="settings-choice-note">{UPDATE_OFF[status.off]}</p>
          {status.off !== "development" && (
            <p>
              <ExternalLink href={RELEASES_URL} onOpenLink={onOpenLink} note="on GitHub, opens in your browser">
                Lanewise&apos;s Releases
              </ExternalLink>
            </p>
          )}
        </>
      ) : (
        <>
          <p id={noteId} className="settings-choice-note">
            You have Lanewise {status.version}. Lanewise asks GitHub whether a newer Release is out, sending nothing
            about you or how you use it, and installs one only when you say so. Installing restarts Lanewise.
          </p>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={updates.checkAtStart}
              aria-describedby={noteId}
              onChange={(event) => updates.setCheckAtStart(event.target.checked)}
            />
            Check for updates when Lanewise starts
          </label>
          <div>
            <button
              type="button"
              className="button button-small"
              aria-disabled={busy || undefined}
              onClick={updates.check}
            >
              <RefreshCw aria-hidden="true" className="button-icon" />
              Check for updates
            </button>
          </div>
          <p role="status" className="settings-choice-note">
            {run.state === "checking" && "Checking for an Update…"}
            {run.state === "upToDate" && `Lanewise ${status.version} is the latest Release.`}
          </p>
          {update !== null && (
            <div className="update-found">
              <p id={foundId}>
                <strong>Lanewise {update.version}</strong> is out
                {update.date !== null && <> (released {new Date(update.date).toLocaleDateString()})</>}.
              </p>
              {update.notes !== null && (
                <>
                  <h4 id={notesId} className="update-notes-heading">
                    What&apos;s new
                  </h4>
                  {/* It scrolls on its own, so the keyboard can reach it to scroll it. */}
                  <div className="update-notes" role="group" aria-labelledby={notesId} tabIndex={0}>
                    {update.notes}
                  </div>
                </>
              )}
              {run.state === "installing" ? (
                <UpdateProgress fraction={run.progress} labelledBy={foundId} />
              ) : (
                <div>
                  <button type="button" className="button button-small" onClick={updates.install}>
                    Install and restart
                  </button>
                </div>
              )}
              <p className="settings-choice-note">
                Installing closes Lanewise and opens the new version. It waits for any clone, fetch, pull or push,
                and for a merge, rebase or stash apply in progress, to be done with first. On Windows the installer
                shows its progress.
              </p>
            </div>
          )}
          {run.state === "failed" && (
            <p role="alert" className="problem">
              {run.problem}
            </p>
          )}
        </>
      )}
    </section>
  );
}
