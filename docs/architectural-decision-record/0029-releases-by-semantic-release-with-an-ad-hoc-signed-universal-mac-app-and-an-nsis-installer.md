# Releases by semantic-release, with an ad hoc signed universal Mac app and an NSIS installer

PRD §12 asks for GitHub Actions to build installers for Windows and macOS and publish GitHub Releases. The Mac app is ad hoc signed and never notarized, since there is no Apple Developer account. The Windows installer ships unsigned, with SmartScreen guidance, until SignPath Foundation approves the project. PRD §10.1 asks for soundcheck's signing, installer and semantic-release setup to be adapted, not vendored blindly. This ADR records what was taken from soundcheck's ADRs 0009 and 0010, its `release.yml` and its `.releaserc.json`, and what was changed. The pieces are `.github/workflows/release.yml`, `.releaserc.json`, `desktop/tauri.macos.conf.json`, `desktop/tauri.windows.conf.json` and `app/scripts/release/`.

## semantic-release versions each Release from the Conventional Commits merged to `main`

`release.yml` runs on every push to `main`. It first calls `ci.yml`, so the pull request's checks, the Commit graph benchmark included, run again on the merged tree. `ci.yml` no longer runs on a push to `main` by itself, or every merge would run them twice. Then semantic-release (`.releaserc.json`, as soundcheck has it) reads the commits since the last `v*` tag with the `conventionalcommits` preset:

- `feat:` makes a minor version;
- `fix:`, `perf:`, `refactor:`, `revert:` and `build:` make a patch;
- a `!` or a `BREAKING CHANGE:` footer makes a major;
- `docs:`, `test:`, `chore:`, `ci:` and `style:` make none.

A subject that isn't a Conventional Commit makes none either. With a version, semantic-release writes it into the root `package.json` (`@semantic-release/npm`, which never publishes), writes `CHANGELOG.md`, and commits both as `chore(release): <version> [skip ci]`. It then tags `v<version>` and makes a **draft** GitHub Release with the notes, commenting on the issues and pull requests it released. The Release stays a draft until the installers are on it, so the latest Release never lacks them.

Only `adrianeyre/lanewise` releases. A fork's `main` is verified and nothing more.

The latest `conventional-changelog-conventionalcommits` (10) renders notes only with `conventional-changelog-writer` 9. The latest `@semantic-release/release-notes-generator` (14.1.1) and `@semantic-release/commit-analyzer` (13.0.1) still ask for 8, which fails with "Missing helper". Rather than pin the preset back to 9, `pnpm-workspace.yaml` overrides the writer to its latest, 9.2.1. A dry run and a real run against a local remote were checked with that override: they numbered `feat`, `fix`, `docs` and `feat!` commits as above, rendered the notes and wrote `CHANGELOG.md`, `package.json`, the commit and the tag. The override comes out once both plugins take writer 9.

## The Mac app is universal, signed ad hoc and never notarized

`desktop/tauri.macos.conf.json` turns Tauri's bundler on for macOS, making the app and a disk image. The macOS job builds them with `--target universal-apple-darwin`: Tauri builds `aarch64-apple-darwin` and `x86_64-apple-darwin` and joins them with `lipo`. That gives one `Lanewise_<version>_universal.dmg` for Apple Silicon and Intel, as PRD §6 asks. soundcheck built for Apple Silicon only because its ONNX Runtime has no Intel build. Lanewise links nothing like it, so a universal app costs only a second compile.

- `minimumSystemVersion` is `14.0` (PRD §6), so macOS refuses the app on anything older with a message rather than a crash.
- `signingIdentity` is `-`, **ad hoc**. On Apple Silicon an unsigned app doesn't run at all. An ad hoc signature needs no secret and no account, and lets it run. A downloaded copy is still stopped by Gatekeeper until the user allows it.
- The hardened runtime, Tauri's default, is kept. It costs nothing, and the app needs no entitlement to loosen it: the webview's JavaScript runs in WebKit's own processes, and running `git` is allowed.

soundcheck's `sign-macos.ts` chooses between ad hoc and a notarized Developer ID from `APPLE_*` secrets. Lanewise has only ad hoc, so `app/scripts/release/signMacos.ts` is left with two jobs:

- It **runs the build without any `APPLE_*` variable.** Tauri signs with a Developer ID in place of the config's `-`, and notarizes, whenever it finds `APPLE_SIGNING_IDENTITY`, `APPLE_CERTIFICATE`, `APPLE_API_KEY` or `APPLE_ID`. Removing them all, and naming any it removes, keeps a release ad hoc even if such a secret is added. A developer's Mac with its own identity set builds what CI builds.
- **`--check` asks what a Mac would.** It reads the app's `codesign --display` and checks the signature is ad hoc, names no team and seals the whole bundle, not only the executable the linker signed. It reads `lipo -archs` and checks both architectures are there. It checks the `Info.plist` version is the repository's.

The job also runs `codesign --verify --deep --strict` and `hdiutil verify`. It keeps only the disk image as an artifact, since an artifact is a zip, which would lose the app's symlinks.

## The Windows installer is NSIS, per user, signed only when a signing secret is set

`desktop/tauri.windows.conf.json` turns the bundler on for Windows with one target, NSIS, as in soundcheck's ADR 0009. It installs for the current user, with no administrator prompt, and fetches WebView2 only if it's missing. Tauri runs `bundle.windows.signCommand`, `node ../app/scripts/release/signWindows.ts %1`, on the app, the installer and its uninstaller.

soundcheck's script signs through Azure Artifact Signing or a PFX. Artifact Signing is a paid service, which Lanewise doesn't use, so it's gone. What's left:

- **A PFX**, when `WINDOWS_CERTIFICATE` (base64) and `WINDOWS_CERTIFICATE_PASSWORD` are set. The script signs with the newest Windows SDK's signtool, SHA-256, with an RFC 3161 timestamp.
- **Unsigned**, otherwise. The build succeeds, and the job leaves a notice, "Windows installer not signed".
- **Half a set fails** before the build, naming what's missing and never a value.

A certificate the public trusts can no longer be exported to a PFX (since June 2023 its key must stay in hardware). So the PFX is for testing the signing path with a self-signed certificate, not for releases.

**SignPath later.** SignPath Foundation signs what a workflow has uploaded as an artifact, through its own action, after its review. It can't reach inside an NSIS installer. So when Lanewise is approved, the Windows job is likely to become three steps. Tauri builds the app with `--no-bundle`, and SignPath signs the executable. `tauri bundle` packs the signed executable into the installer, and SignPath signs the installer. The uninstaller NSIS writes is covered by either signing it in that second request or by SignPath's own configuration. That's a `TODO` in `signWindows.ts`. The job's `signed` output already tells the release notes whether the installer was signed.

## The notes say how to install, and the Release is published last

Once both builds are done, the publish job puts the disk image and the installer on the draft. It then adds an Installing section to semantic-release's notes (`app/scripts/release/releaseNotes.ts`) and publishes the Release. That section says, for macOS, how to open an app that isn't notarized: **System Settings → Privacy & Security → Open Anyway**, or `xattr -d com.apple.quarantine /Applications/Lanewise.app`. For Windows it says how to get past SmartScreen: **More info**, then **Run anyway**. Once the installer is signed, it says instead that SmartScreen may still warn about a new release, and doesn't say the installer is unsigned. The README says the same. A version with a `-` is published as a pre-release, never as the latest.

## The footer's version is the Release's

The footer and Diagnostics show `VITE_APP_VERSION`, which `app/vite.config.ts` reads from the root `package.json`. `desktop/tauri.conf.json` takes the Desktop App's version from there too (`"version": "../package.json"`), and so do the Logs. semantic-release writes the version there before tagging, and both builds check out the tag. Three checks hold the chain:

- the release job checks the tag's `package.json` has the tag's version;
- the upload steps name the installer and disk image by that version, so a build of any other fails;
- `signMacos.ts --check` compares the app's `Info.plist` with `package.json`.

`Footer.test.tsx` already checks that the footer shows `package.json`'s version.

## Consequences

- **Releases depend on commit subjects.** Lanewise's commits so far aren't Conventional Commits, so merging them as they are makes no Release. Squash-merging a pull request with a Conventional Commit title does, and so does merging commits whose subjects are Conventional Commits.
- **The first Release is 1.0.0.** With no `v*` tag yet, semantic-release numbers the first one 1.0.0, whatever `package.json` says. Tag an older commit `v0.0.0` first to start at 0.1.0 instead.
- **Releases wait for the benchmark.** The Commit graph benchmark is part of `ci.yml`, so it runs on `main` through `release.yml` and has to pass before a Release is made.
- **A failed build leaves a draft.** If the macOS or Windows build fails after the tag, the Release stays a draft with no installers. Re-running the failed jobs finishes it. The version commit and the tag stay.
- **`[skip ci]` skips the version commit's checks.** It only changes `package.json` and `CHANGELOG.md`, so neither workflow runs for it.
- **The icons are the logo's**, `desktop/icons/logo.svg`. The app, the disk image and the installer all take them from there.
- **Not yet:** Linux packages, which come post-launch (PRD §6). Auto-update's signed update packages and `latest.json` (PRD §12, M7) have since been added, in [ADR 0030](0030-updates-from-the-latest-release-signed-by-the-update-key-installed-only-when-the-user-agrees.md).
- The `commands` crate's HTTP user agent still carries its crate version, `0.1.0`, not the Release's.

## Still to check by hand

Nothing here has run on macOS or Windows, and nothing could publish a Release: the sandbox is Linux, with no GitHub token. What was checked here:

- both workflows, with actionlint 1.7.12 and shellcheck 0.11.0;
- the Tauri configs, merged and checked against the Tauri CLI's own schema (`app/scripts/release/tauriConfig.test.ts`);
- the three scripts, with their tests, which run each one with Node as CI does;
- semantic-release, run against a local remote.

To check by hand:

1. **Before merging**, decide how this lands. Merging the batch's commits as they are makes no Release. Squash-merging with a `feat:` title publishes 1.0.0 at once. Also decide whether every commit should be a Conventional Commit from now on (CLAUDE.md and `.sandcastle/prompt.md` would say so), or only pull request titles, squash-merged.
2. **Branch protection** on `main` must let `github-actions[bot]` push the version commit and the tag.
3. **On the first Release's run:** the release job made the tag and a draft. The macOS and Windows jobs made `Lanewise_<version>_universal.dmg` and `Lanewise_<version>_x64-setup.exe`, the macOS check passed, and the Windows job left the "not signed" notice. Publish attached both, added the Installing section and made the Release the latest. `CHANGELOG.md` and `package.json` on `main` have the version.
4. **On an Apple Silicon Mac and an Intel Mac with macOS 14 or later:** the downloaded disk image opens, and Lanewise is refused the first time. Open Anyway opens it, and so does `xattr -d com.apple.quarantine`. The footer shows the Release's version. `lipo -archs` names both architectures, and on an older macOS the app is refused with a message.
5. **On Windows 10 22H2 and Windows 11:** SmartScreen warns, and More info → Run anyway installs it without an administrator prompt, to `%LOCALAPPDATA%`, with a Start menu entry and an entry in Settings → Apps. The footer shows the Release's version. Installing a newer version over it upgrades it, and uninstalling removes it.
6. **With a test PFX set as the two secrets:** there's no notice, and signtool's output shows each of the three files signed. `signtool verify /pa /v` passes on the installer, `Lanewise.exe` and `uninstall.exe` if the certificate is trusted on that machine. The notes say the installer is signed.
