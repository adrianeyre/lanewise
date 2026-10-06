import { useCallback, useEffect, useRef, useState } from "react";

import { ExternalLink, type LinkOpener } from "../legal/ExternalLink";
import type { Platform } from "../platform/platform";
import { Dialog } from "../ui/Dialog";
import { checkLatestVersion, LATEST_RELEASE_URL, releasePageOf, type VersionCheck } from "./latestVersion";

interface Props extends LinkOpener {
  platform: Pick<Platform, "fetch">;
  open: boolean;
  onClose: () => void;
  /** The version running, as the footer shows it. */
  running?: string;
  /** Opens the latest Release's page, in a Tab of its own where Host pages can be (ADR 0042). */
  onOpenReleasePage: (url: string) => void;
}

/**
 * Help's "Check for the latest version…": whether the version running is
 * `main`'s, from its `package.json` on GitHub, and, if it's out of date, a
 * button that opens the latest Release's page and a link to download it. It asks each time it opens, and Check again
 * asks again.
 */
export function VersionCheckDialog({
  platform,
  open,
  onClose,
  running = import.meta.env.VITE_APP_VERSION,
  onOpenLink,
  onOpenReleasePage,
}: Props) {
  const [check, setCheck] = useState<VersionCheck | null>(null);
  // Counts the questions asked, so only the last one's answer is shown.
  const asked = useRef(0);
  const ask = useCallback(() => {
    const mine = ++asked.current;
    void checkLatestVersion(platform, running).then((result) => {
      if (asked.current === mine) setCheck(result);
    });
  }, [platform, running]);

  useEffect(() => {
    if (!open) return;
    const questions = asked;
    ask();
    // Closed, whatever answer comes is for no one.
    return () => {
      questions.current++;
    };
  }, [open, ask]);

  const close = () => {
    setCheck(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={close} title="Check for the latest version" closeLabel="Close the version check">
      <div className="version-check">
        {check === null ? (
          <p role="status">Asking GitHub for the latest version…</p>
        ) : check.kind === "current" ? (
          <p role="status">
            <strong>Lanewise {check.running} is up to date.</strong> The latest version is {check.latest}.
          </p>
        ) : check.kind === "outOfDate" ? (
          <>
            <p role="status">
              <strong>Lanewise {check.running} is out of date.</strong> The latest version is {check.latest}.
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  const url = releasePageOf(check.latest);
                  close();
                  onOpenReleasePage(url);
                }}
              >
                Open the Lanewise {check.latest} Release
              </button>
            </div>
            <p>
              <ExternalLink href={LATEST_RELEASE_URL} note="opens in your browser" onOpenLink={onOpenLink}>
                Get Lanewise {check.latest} from GitHub
              </ExternalLink>
            </p>
          </>
        ) : (
          <p role="alert" className="problem">
            Lanewise couldn&apos;t find out the latest version. {check.problem}
          </p>
        )}
        <p className="surface-note">
          Lanewise asks GitHub for <code>adrianeyre/lanewise</code>&apos;s <code>package.json</code>, and sends
          nothing else.
        </p>
        {check !== null && (
          <div className="dialog-actions">
            <button
              type="button"
              className="button"
              onClick={() => {
                setCheck(null);
                ask();
              }}
            >
              Check again
            </button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
