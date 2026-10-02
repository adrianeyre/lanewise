import { ShieldCheck } from "lucide-react";

import { ExternalLink, type LinkOpener } from "./ExternalLink";
import { ACCESSIBILITY_ISSUE_URL } from "./links";

/** The accessibility statement's text, shown in its dialog. */
export function AccessibilityStatement({ onOpenLink }: LinkOpener) {
  return (
    <>
      <p className="policy-updated">Last reviewed: September 2026</p>

      <div className="status-box">
        <ShieldCheck aria-hidden="true" className="status-box-icon" />
        <p>
          <strong>Conformance status:</strong> Lanewise is built to meet the Web Content Accessibility Guidelines
          (WCAG) 2.2 at <strong>Level AA</strong>, in the Desktop App, in Web Mode and on the project website.
        </p>
      </div>

      <h3>Our commitment</h3>
      <p>
        Lanewise should be usable by everyone who works with Git, including people who use a screen reader,
        magnification, speech input or a keyboard on its own, and people who need reduced motion or higher
        contrast.
      </p>

      <h3>What we have done</h3>
      <ul>
        <li>
          <strong>Keyboard access</strong>: every control, menu and dialog can be reached and operated with a
          keyboard alone, with a clear focus outline.
        </li>
        <li>
          <strong>No dragging required</strong>: every Widget has a grip button, where the arrow keys move it a
          cell and Shift and the arrow keys resize it, and buttons to Pin and hide it. Each move is announced.
        </li>
        <li>
          <strong>Screen readers</strong>: one main heading, labelled landmarks and regions, a label for every
          control, and changes such as a repository&apos;s status announced as they happen.
        </li>
        <li>
          <strong>Colour and contrast</strong>: text meets at least 4.5:1 against its background in both the light
          and dark themes, and borders, icons and focus outlines at least 3:1. Nothing is shown by colour alone: each
          kind of change has a label and an icon too.
        </li>
        <li>
          <strong>Themes</strong>: light and dark, matching your operating system unless you choose one in
          Settings. The theme you chose is shown from the moment Lanewise opens.
        </li>
        <li>
          <strong>Motion</strong>: animations are switched off if your device is set to reduce motion.
        </li>
        <li>
          <strong>Target sizes</strong>: every button is at least 24 by 24 pixels. The edges that resize a Widget
          are thinner, and its grip button resizes it too.
        </li>
        <li>
          <strong>Text size, zoom and reflow</strong>: text is sized from the default your system and browser set,
          so it grows with them, and Ctrl or Cmd with plus and minus zoom in and out. In a narrow window, or zoomed
          in, the Widgets stack in a single column.
        </li>
      </ul>

      <h3>Compatibility</h3>
      <p>
        Lanewise is designed for the Desktop App on Windows and macOS, and for Web Mode in current browsers, used
        with screen readers such as NVDA, JAWS, Narrator and VoiceOver.
      </p>

      <h3>Known limitations</h3>
      <ul>
        <li>
          This statement is based on our own testing with automated checks, keyboard-only use and screen readers.
          There has not yet been an independent audit.
        </li>
        <li>
          Suggestions come from the Model Provider you choose, and their wording is outside our control.
        </li>
      </ul>

      <h3>If something does not work for you</h3>
      <p>
        Please tell us: we would rather hear about a barrier than leave it in place.{" "}
        <ExternalLink href={ACCESSIBILITY_ISSUE_URL} onOpenLink={onOpenLink}>
          Open an issue on adrianeyre/lanewise with the accessibility label
        </ExternalLink>
        , saying which screen or feature it was, what you were trying to do, and the assistive technology you were
        using.
      </p>
    </>
  );
}
