import { Download } from "lucide-react";
import { useId } from "react";

import { UpdateProgress } from "./UpdateProgress";
import type { Updates } from "./useUpdates";

/**
 * The notice that an Update is out, under the title bar: install it now,
 * which restarts Lanewise, or Later, from Settings. It is a labelled region,
 * not a dialog, so nothing waits on it and focus stays where it was. The App
 * doesn't show it on a Conflicts page, so it never comes between the user
 * and an In-Progress Operation.
 */
export function UpdateNotice({ updates }: { updates: Updates }) {
  const headingId = useId();
  const { run } = updates;
  if (!updates.notice || (run.state !== "found" && run.state !== "installing" && run.state !== "failed")) return null;
  const version = run.update?.version;
  return (
    <section className="update-notice" aria-labelledby={headingId}>
      <Download aria-hidden="true" className="button-icon update-notice-icon" />
      <h2 id={headingId} className="update-notice-heading">
        Lanewise {version} is out
      </h2>
      {run.state === "installing" ? (
        <div className="update-notice-body">
          <p className="update-notice-text">Downloading it. Lanewise restarts once it is installed.</p>
          <UpdateProgress fraction={run.progress} labelledBy={headingId} />
        </div>
      ) : (
        <div className="update-notice-body">
          <p className="update-notice-text" role={run.state === "failed" ? "alert" : undefined}>
            {run.state === "failed"
              ? run.problem
              : `You have ${updates.status?.version}. Settings has what's new. Installing it restarts Lanewise.`}
          </p>
          <div className="update-notice-actions">
            <button type="button" className="button button-small" onClick={updates.install}>
              {run.state === "failed" ? "Try again" : "Install and restart"}
            </button>
            <button type="button" className="button button-small" onClick={updates.later}>
              Later
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
