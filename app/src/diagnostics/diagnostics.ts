import type { DiagnosedGit, Diagnostics } from "../commands/api";

/** Where a bug report is made: the bug-report issue form, `.github/ISSUE_TEMPLATE/bug-report.yml`. */
export const BUG_REPORT_URL = "https://github.com/adrianeyre/lanewise/issues/new?template=bug-report.yml";

/** The bug-report form's field that Copy diagnostics fills in. */
export const DIAGNOSTICS_FIELD = "diagnostics";

/** The longest link to the bug-report form, which GitHub still opens. */
export const LONGEST_BUG_REPORT_URL = 8000;

function gitWords(git: DiagnosedGit): string {
  switch (git.kind) {
    case "supported":
      return git.version;
    case "tooOld":
      return `${git.version} (too old)`;
    case "unusable":
      return "found, but it didn't run";
    case "missing":
      return "not found";
  }
}

/**
 * What Copy diagnostics copies: the Lanewise `version`, what the core says
 * it runs on, and the latest `lines` of its logs, oldest first, which is
 * all of them unless fewer are asked for.
 */
export function diagnosticsText(version: string, diagnostics: Diagnostics, lines = diagnostics.recentLogLines.length): string {
  const { version: manager, configured } = diagnostics.credentialManager;
  const recent = lines > 0 ? diagnostics.recentLogLines.slice(-lines) : [];
  return [
    `Lanewise: ${version}`,
    `Operating system: ${diagnostics.operatingSystem}`,
    `Git: ${gitWords(diagnostics.git)}`,
    `Git Credential Manager: ${manager === null ? "not found" : `${manager}${configured ? "" : " (not one of Git's credential helpers)"}`}`,
    "",
    recent.length === 0 ? "No recent log lines." : `The latest ${recent.length} log lines:`,
    ...recent,
  ].join("\n");
}

/**
 * The bug-report form on GitHub with its diagnostics field filled in from
 * `diagnostics`, with as many of the latest log lines as fit in a link
 * GitHub opens. Nothing is sent: the user reads the form before they submit it.
 */
export function bugReportUrl(version: string, diagnostics: Diagnostics): string {
  const link = (lines: number) =>
    `${BUG_REPORT_URL}&${DIAGNOSTICS_FIELD}=${encodeURIComponent(diagnosticsText(version, diagnostics, lines))}`;
  let lines = diagnostics.recentLogLines.length;
  while (lines > 0 && link(lines).length > LONGEST_BUG_REPORT_URL) lines--;
  return link(lines);
}
