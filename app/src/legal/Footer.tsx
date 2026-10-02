import { useState } from "react";

import { Dialog } from "../ui/Dialog";
import { AccessibilityStatement } from "./AccessibilityStatement";
import { Changelog } from "./Changelog";
import { CookiePolicy } from "./CookiePolicy";
import { Credits } from "./Credits";
import { PrivacyPolicy } from "./PrivacyPolicy";
import { TermsAndConditions } from "./TermsAndConditions";
import { ExternalLink, type LinkOpener } from "./ExternalLink";
import { REPOSITORY_URL } from "./links";

/** The dialogs about Lanewise itself. */
export type Policy = "changelog" | "privacy" | "terms" | "cookies" | "accessibility" | "credits";

interface Props extends LinkOpener {
  /** The dialog open, where something else opens them too, as the App menu does; the footer's own otherwise. */
  policy?: Policy | null;
  onPolicy?: (policy: Policy | null) => void;
}

/**
 * The footer on every page, in the Desktop App, in Web Mode and on the project
 * website (PRD §7.11), carried over from soundcheck: the Site design credit,
 * the version, which opens the Changelog, and the Privacy Policy, Terms and
 * Conditions, Cookie Policy, Accessibility and Credits dialogs, which the App
 * menu opens too.
 */
export function Footer({ onOpenLink, policy: given, onPolicy }: Props) {
  const [own, setOwn] = useState<Policy | null>(null);
  const policy = given === undefined ? own : given;
  const setPolicy = onPolicy ?? setOwn;
  const close = () => setPolicy(null);

  return (
    <>
      <footer className="app-footer">
        <nav aria-label="About Lanewise" className="footer-nav">
          <ExternalLink
            href={REPOSITORY_URL}
            className="footer-item"
            note="source on GitHub, opens in a new tab"
            onOpenLink={onOpenLink}
          >
            <GitHubMark />
            Site design
          </ExternalLink>
          <button type="button" className="footer-item footer-version" onClick={() => setPolicy("changelog")}>
            Version: {import.meta.env.VITE_APP_VERSION}
          </button>
          <button type="button" className="footer-item" onClick={() => setPolicy("privacy")}>
            Privacy Policy
          </button>
          <button type="button" className="footer-item" onClick={() => setPolicy("terms")}>
            Terms and Conditions
          </button>
          <button type="button" className="footer-item" onClick={() => setPolicy("cookies")}>
            Cookie Policy
          </button>
          <button type="button" className="footer-item" onClick={() => setPolicy("accessibility")}>
            Accessibility
          </button>
          <button type="button" className="footer-item" onClick={() => setPolicy("credits")}>
            Credits
          </button>
        </nav>
      </footer>

      <Dialog open={policy === "changelog"} onClose={close} title="Changelog" closeLabel="Close changelog">
        <Changelog onOpenLink={onOpenLink} />
      </Dialog>
      <Dialog open={policy === "privacy"} onClose={close} title="Privacy Policy" closeLabel="Close privacy policy">
        <PrivacyPolicy onOpenLink={onOpenLink} />
      </Dialog>
      <Dialog
        open={policy === "terms"}
        onClose={close}
        title="Terms and Conditions"
        closeLabel="Close terms and conditions"
      >
        <TermsAndConditions onOpenLink={onOpenLink} />
      </Dialog>
      <Dialog open={policy === "cookies"} onClose={close} title="Cookie Policy" closeLabel="Close cookie policy">
        <CookiePolicy onOpenLink={onOpenLink} />
      </Dialog>
      <Dialog
        open={policy === "accessibility"}
        onClose={close}
        title="Accessibility"
        closeLabel="Close accessibility statement"
      >
        <AccessibilityStatement onOpenLink={onOpenLink} />
      </Dialog>
      <Dialog open={policy === "credits"} onClose={close} title="Credits" closeLabel="Close credits">
        <Credits onOpenLink={onOpenLink} />
      </Dialog>
    </>
  );
}

/** GitHub's mark, as GitHub publishes it for linking to a repository. */
function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" className="footer-mark" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.42c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.36-3.88-1.36-.53-1.34-1.3-1.7-1.3-1.7-1.06-.72.08-.71.08-.71 1.17.08 1.79 1.2 1.79 1.2 1.04 1.79 2.73 1.27 3.4.97.1-.76.41-1.27.74-1.56-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.2-3.1-.12-.29-.52-1.46.11-3.05 0 0 .98-.31 3.2 1.18a11.1 11.1 0 0 1 5.82 0c2.22-1.5 3.2-1.18 3.2-1.18.63 1.59.23 2.76.11 3.05.75.81 1.2 1.84 1.2 3.1 0 4.43-2.7 5.41-5.26 5.69.42.36.8 1.08.8 2.18v3.23c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z" />
    </svg>
  );
}
