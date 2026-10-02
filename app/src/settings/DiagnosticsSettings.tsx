import { ClipboardCopy } from "lucide-react";
import { useId, useState } from "react";

import type { Diagnostics } from "../commands/api";
import { bugReportUrl, diagnosticsText } from "../diagnostics/diagnostics";
import type { Platform } from "../platform/platform";
import { describeFailure } from "../repository/problems";

interface Props {
  /** Reads the diagnostics, copies them and opens the bug report through it. */
  platform: Pick<Platform, "commands" | "copyText" | "openLink">;
  /** The Lanewise version the diagnostics name. */
  version: string;
}

type Copied = { state: "copying" } | { state: "copied"; clipboard: boolean; logFolder: string | null };

/**
 * Diagnostics (PRD §11): Lanewise sends nothing about how it's used. Copy
 * diagnostics copies what it runs on and its latest log lines, and opens a
 * bug report on GitHub with them filled in, which the user reads, and
 * submits, themselves.
 */
export function DiagnosticsSettings({ platform, version }: Props) {
  const headingId = useId();
  const noteId = useId();
  const [copied, setCopied] = useState<Copied | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function copy() {
    if (copied?.state === "copying") return;
    setCopied({ state: "copying" });
    setProblem(null);
    let diagnostics: Diagnostics;
    try {
      const outcome = await platform.commands.call("diagnostics", {});
      if (!outcome.ok) throw new Error("The core couldn't read the diagnostics.");
      diagnostics = outcome.value;
    } catch (failure) {
      setCopied(null);
      setProblem(describeFailure(failure));
      return;
    }
    // The bug report is still worth opening if the clipboard refuses.
    const clipboard = await platform.copyText(diagnosticsText(version, diagnostics)).then(
      () => true,
      () => false,
    );
    try {
      await platform.openLink(bugReportUrl(version, diagnostics));
    } catch (failure) {
      setProblem(describeFailure(failure));
    }
    setCopied({ state: "copied", clipboard, logFolder: diagnostics.logFolder });
  }

  return (
    <section className="settings-group" aria-labelledby={headingId}>
      <h3 id={headingId} className="settings-legend">
        Diagnostics
      </h3>
      <p id={noteId} className="settings-choice-note">
        Lanewise sends nothing about how you use it. It keeps logs on this computer, which never hold credentials,
        API keys, file contents or prompts. Copy diagnostics copies your Lanewise, operating system, Git and Git
        Credential Manager versions and the latest log lines, and opens a bug report on GitHub with them filled in,
        for you to read before you submit it.
      </p>
      <div>
        <button
          type="button"
          className="button button-small"
          aria-describedby={noteId}
          aria-disabled={copied?.state === "copying" || undefined}
          onClick={() => void copy()}
        >
          <ClipboardCopy aria-hidden="true" className="button-icon" />
          Copy diagnostics
        </button>
      </div>
      {problem !== null && (
        <p role="alert" className="problem">
          {problem}
        </p>
      )}
      <p role="status" className="settings-choice-note">
        {copied?.state === "copied" && copiedWords(copied.clipboard, copied.logFolder)}
      </p>
    </section>
  );
}

function copiedWords(clipboard: boolean, logFolder: string | null): string {
  const said = clipboard
    ? "Copied the diagnostics, and filled them in on a bug report on GitHub."
    : "Filled the diagnostics in on a bug report on GitHub. Lanewise couldn't copy them too.";
  return logFolder === null ? said : `${said} All of Lanewise's logs are in ${logFolder}.`;
}
