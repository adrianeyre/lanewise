/**
 * The release notes' installing section (ADR 0029). semantic-release writes a
 * Release's notes from its Conventional Commits; the release workflow then adds
 * how to install the Desktop App and get past what macOS and Windows say about
 * a build that isn't notarized or isn't signed (PRD §12):
 *
 *   node app/scripts/release/releaseNotes.ts <notes.md> <version> <signed|unsigned>
 *
 * The last is how the Windows installer was signed, as
 * `signWindows.ts --how` said. It rewrites the file in place, and running it
 * again replaces the section rather than adding a second one.
 *
 * Node runs it as it is, stripping the types, so it imports only Node's own modules.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Windows = "signed" | "unsigned";

/** Where the section starts, so a second run finds it. */
export const MARKER = "<!-- lanewise:installing -->";

/** How to install `version`, and open it the first time. */
export function installing(version: string, windows: Windows): string {
  const smartScreen =
    windows === "unsigned"
      ? [
          "The installer isn't signed yet, so Microsoft Defender SmartScreen may say **Windows protected your PC** and name the publisher as *Unknown*. Choose **More info**, then **Run anyway**. It will be signed once SignPath Foundation, which signs open-source projects for free, has approved Lanewise.",
        ]
      : [
          "The installer is signed. SmartScreen may still say **Windows protected your PC** about a new release until enough people have run it; choose **More info**, check that the publisher is named, then **Run anyway**.",
        ];
  return [
    MARKER,
    "## Installing",
    "",
    "Lanewise needs [Git](https://git-scm.com/downloads) 2.40 or later, and says so on start if it's missing.",
    "",
    "### macOS",
    "",
    `Download \`Lanewise_${version}_universal.dmg\`, which runs on Apple Silicon and Intel Macs with macOS 14 or later, open it and drag Lanewise to Applications.`,
    "",
    "Lanewise is signed ad hoc and not notarized by Apple, so the first time you open a downloaded copy, macOS says it can't check it and won't open it. To open it anyway, either:",
    "",
    "- open **System Settings → Privacy & Security**, scroll to **Security**, choose **Open Anyway** beside the message about Lanewise, and confirm with your password; or",
    "- in Terminal, run `xattr -d com.apple.quarantine /Applications/Lanewise.app`.",
    "",
    "After that it opens as any other app. A copy you build from source opens without a warning.",
    "",
    "### Windows",
    "",
    `Download and run \`Lanewise_${version}_x64-setup.exe\`, for Windows 10 22H2 or later and Windows 11 on x64. It installs Lanewise for you alone, without asking for administrator rights, and fetches Microsoft Edge WebView2 if it isn't already there.`,
    "",
    ...smartScreen,
    "",
  ].join("\n");
}

/** `notes` with the installing section after them, in place of any it had. */
export function releaseNotes(notes: string, version: string, windows: Windows): string {
  const [changes = ""] = notes.split(MARKER);
  return `${changes.trimEnd()}\n\n${installing(version, windows)}`.trimStart();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, version, windows] = process.argv.slice(2);
  if (file && version && (windows === "signed" || windows === "unsigned")) {
    writeFileSync(file, releaseNotes(readFileSync(file, "utf8"), version, windows));
  } else {
    console.error("usage: node app/scripts/release/releaseNotes.ts <notes.md> <version> <signed|unsigned>");
    process.exitCode = 2;
  }
}
