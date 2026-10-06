import { useEffect, useState } from "react";

import { ExternalLink, type LinkOpener } from "../legal/ExternalLink";
import type { Platform } from "../platform/platform";
import { readLocal, UPDATE_CHECK_KEY } from "../settings/localSettings";
import { Dialog } from "../ui/Dialog";
import { checkLatestVersion, LATEST_RELEASE_URL } from "./latestVersion";

/** The version running and the latest one, when the one running is older. */
export interface OutOfDate {
  running: string;
  latest: string;
}

/**
 * Asks once, as Lanewise starts, whether the version running is the latest,
 * as Help's "Check for the latest version…" does, unless Settings' "Check for
 * updates when Lanewise starts" is off. Gives the two versions if it's out of
 * date, and `null` otherwise, or if GitHub couldn't be asked, which says
 * nothing at start.
 */
export function useOutOfDateAtStart(
  platform: Pick<Platform, "fetch">,
  running: string = import.meta.env.VITE_APP_VERSION,
): [OutOfDate | null, () => void] {
  const [outOfDate, setOutOfDate] = useState<OutOfDate | null>(null);
  // Asked as the app is first drawn, with the platform it starts with.
  const [startedWith] = useState(() => ({ platform, running }));
  useEffect(() => {
    if (readLocal(UPDATE_CHECK_KEY) === "false") return;
    let live = true;
    void checkLatestVersion(startedWith.platform, startedWith.running).then((check) => {
      if (live && check.kind === "outOfDate") setOutOfDate({ running: check.running, latest: check.latest });
    });
    return () => {
      live = false;
    };
  }, [startedWith]);
  return [outOfDate, () => setOutOfDate(null)];
}

interface Props extends LinkOpener {
  outOfDate: OutOfDate | null;
  onClose: () => void;
}

/**
 * Says, as Lanewise starts, that the version running is out of date: which
 * it is, which is the latest, and a link to the latest Release on GitHub to
 * download and install it from.
 */
export function OutOfDateDialog({ outOfDate, onClose, onOpenLink }: Props) {
  return (
    <Dialog
      open={outOfDate !== null}
      onClose={onClose}
      title="A newer version of Lanewise is out"
      closeLabel="Close the notice of a newer version"
    >
      {outOfDate !== null && (
        <div className="version-check">
          <p>
            <strong>You are running Lanewise {outOfDate.running}, which is out of date.</strong> The latest version is{" "}
            {outOfDate.latest}.
          </p>
          <p>
            <ExternalLink href={LATEST_RELEASE_URL} note="opens in your browser" onOpenLink={onOpenLink}>
              Download Lanewise {outOfDate.latest} from its Release on GitHub
            </ExternalLink>
          </p>
          <p className="surface-note">
            Lanewise asks GitHub for <code>adrianeyre/lanewise</code>&apos;s <code>package.json</code> as it starts, and
            sends nothing else.
          </p>
          <div className="dialog-actions">
            <button type="button" className="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
