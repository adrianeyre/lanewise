import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { MARKER, releaseNotes } from "./releaseNotes";

const SCRIPT = fileURLToPath(new URL("./releaseNotes.ts", import.meta.url));
const INSTALLING = fileURLToPath(new URL("../../../docs/installing.md", import.meta.url));

/** What semantic-release's notes generator writes for a release, in the conventionalcommits preset. */
const CHANGES = `## [1.2.0](https://github.com/adrianeyre/lanewise/compare/v1.1.0...v1.2.0) (2026-10-01)

### Features

* suggest for every Conflict Hunk in a file ([c3ee00a](https://github.com/adrianeyre/lanewise/commit/c3ee00a))
`;

describe("releaseNotes", () => {
  test("keeps semantic-release's changes first, then says how to install each download", () => {
    const notes = releaseNotes(CHANGES, "1.2.0", "unsigned");
    expect(notes.startsWith(CHANGES.trimEnd())).toBe(true);
    expect(notes).toContain("## Installing");
    expect(notes).toContain("`Lanewise_1.2.0_universal.dmg`");
    expect(notes).toContain("`Lanewise_1.2.0_x64-setup.exe`");
  });

  test("says how to open the Mac app, which isn't notarized, both ways", () => {
    const notes = releaseNotes(CHANGES, "1.2.0", "unsigned");
    expect(notes).toContain("signed ad hoc and not notarized");
    expect(notes).toContain("**System Settings → Privacy & Security**");
    expect(notes).toContain("**Open Anyway**");
    expect(notes).toContain("`xattr -d com.apple.quarantine /Applications/Lanewise.app`");
  });

  test("says how to get past SmartScreen while the Windows installer isn't signed", () => {
    const notes = releaseNotes(CHANGES, "1.2.0", "unsigned");
    expect(notes).toContain("isn't signed yet");
    expect(notes).toContain("**More info**, then **Run anyway**");
  });

  test("once it's signed, doesn't say it isn't", () => {
    const notes = releaseNotes(CHANGES, "1.2.0", "signed");
    expect(notes).not.toContain("isn't signed");
    expect(notes).toContain("The installer is signed.");
  });

  test("made again, replaces its section rather than adding another", () => {
    const once = releaseNotes(CHANGES, "1.2.0", "unsigned");
    const twice = releaseNotes(once, "1.2.0", "signed");
    expect(twice.split(MARKER)).toHaveLength(2);
    expect(twice).toBe(releaseNotes(CHANGES, "1.2.0", "signed"));
  });

  test("with no changes to list, is only the installing section", () => {
    expect(releaseNotes("", "1.2.0", "unsigned").startsWith(MARKER)).toBe(true);
  });
});

describe("the script", () => {
  test("rewrites the notes file in place", () => {
    const folder = mkdtempSync(join(tmpdir(), "lanewise-notes-"));
    try {
      const file = join(folder, "notes.md");
      writeFileSync(file, CHANGES);
      const result = spawnSync(process.execPath, [SCRIPT, file, "1.2.0", "unsigned"], { encoding: "utf8" });
      expect({ status: result.status, stderr: result.stderr }).toMatchObject({ status: 0 });
      expect(readFileSync(file, "utf8")).toBe(releaseNotes(CHANGES, "1.2.0", "unsigned"));
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test("refuses a signing it doesn't know", () => {
    const result = spawnSync(process.execPath, [SCRIPT, "notes.md", "1.2.0", "maybe"], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/<signed\|unsigned>/);
  });
});

test("Installing Lanewise, which the README links to, says the same about opening the Mac app and getting past SmartScreen (PRD §12)", () => {
  const readme = readFileSync(INSTALLING, "utf8");
  expect(readme).toContain("**System Settings → Privacy & Security**");
  expect(readme).toContain("**Open Anyway**");
  expect(readme).toContain("`xattr -d com.apple.quarantine /Applications/Lanewise.app`");
  expect(readme).toContain("**More info**, then **Run anyway**");
});
