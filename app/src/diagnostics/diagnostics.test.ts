import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "vitest";

import type { Diagnostics } from "../commands/api";
import { BUG_REPORT_URL, DIAGNOSTICS_FIELD, LONGEST_BUG_REPORT_URL, bugReportUrl, diagnosticsText } from "./diagnostics";

const repository = join(import.meta.dirname, "../../..");

const diagnostics: Diagnostics = {
  operatingSystem: "Mac OS 15.6.1 (aarch64)",
  git: { kind: "supported", version: "2.56.0" },
  credentialManager: { version: "2.7.0+abc1234", configured: true },
  logFolder: "/Users/ada/Library/Logs/com.adrianeyre.lanewise",
  recentLogLines: [
    "2026-09-29T14:00:00Z INFO  lanewise_desktop: Lanewise 0.1.0 started on macos (aarch64)",
    "2026-09-29T14:00:05Z WARN  lanewise_commands: openRepository failed: notARepository",
  ],
};

test("copies the version, the operating system, Git and Git Credential Manager, then the latest log lines", () => {
  expect(diagnosticsText("0.1.0", diagnostics)).toBe(
    [
      "Lanewise: 0.1.0",
      "Operating system: Mac OS 15.6.1 (aarch64)",
      "Git: 2.56.0",
      "Git Credential Manager: 2.7.0+abc1234",
      "",
      "The latest 2 log lines:",
      ...diagnostics.recentLogLines,
    ].join("\n"),
  );
});

test("says what it couldn't find, and never the log folder, which names the user's home", () => {
  const text = diagnosticsText("0.1.0", {
    ...diagnostics,
    git: { kind: "tooOld", version: "2.39.5" },
    credentialManager: { version: "2.7.0", configured: false },
    recentLogLines: [],
  });

  expect(text).toContain("Git: 2.39.5 (too old)");
  expect(text).toContain("Git Credential Manager: 2.7.0 (not one of Git's credential helpers)");
  expect(text).toContain("No recent log lines.");
  expect(text).not.toContain("/Users/ada");
  expect(
    diagnosticsText("0.1.0", { ...diagnostics, git: { kind: "missing" }, credentialManager: { version: null, configured: false } }),
  ).toContain("Git: not found\nGit Credential Manager: not found\n");
  expect(diagnosticsText("0.1.0", { ...diagnostics, git: { kind: "unusable" } })).toContain(
    "Git: found, but it didn't run",
  );
});

test("opens the bug-report form with its diagnostics filled in", () => {
  const url = new URL(bugReportUrl("0.1.0", diagnostics));

  expect(`${url.origin}${url.pathname}`).toBe("https://github.com/adrianeyre/lanewise/issues/new");
  expect(url.searchParams.get("template")).toBe("bug-report.yml");
  expect(url.searchParams.get(DIAGNOSTICS_FIELD)).toBe(diagnosticsText("0.1.0", diagnostics));
});

test("a link too long for GitHub drops the oldest log lines until it fits", () => {
  const recentLogLines = Array.from({ length: 50 }, (_, n) => `line ${n} ${"x".repeat(300)}`);
  const url = bugReportUrl("0.1.0", { ...diagnostics, recentLogLines });
  const filled = new URL(url).searchParams.get(DIAGNOSTICS_FIELD) ?? "";

  expect(url.length).toBeLessThanOrEqual(LONGEST_BUG_REPORT_URL);
  expect(filled).toContain("line 49 ");
  expect(filled).not.toContain("line 0 ");
  expect(filled).toContain("Git Credential Manager: 2.7.0+abc1234");
});

test("the bug-report form is in the repository, with the field Copy diagnostics fills in", () => {
  const file = new URL(BUG_REPORT_URL).searchParams.get("template") ?? "";
  const template = readFileSync(join(repository, ".github/ISSUE_TEMPLATE", file), "utf8");

  expect(template).toMatch(new RegExp(`- type: textarea\\n\\s+id: ${DIAGNOSTICS_FIELD}\\n`));
});
