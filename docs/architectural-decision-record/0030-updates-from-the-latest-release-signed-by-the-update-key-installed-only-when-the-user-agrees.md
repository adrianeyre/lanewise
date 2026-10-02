# Updates from the latest Release, signed by the Update key, installed only when the user agrees

PRD §12 makes auto-update P0 in M7: "The app updates itself from the latest GitHub Release with Tauri's updater plugin and signed update packages, as soundcheck does." Issue #43 asks that it check at start and from Settings, show what's new, install only when the user agrees, and never interrupt an In-Progress Operation. [ADR 0029](0029-releases-by-semantic-release-with-an-ad-hoc-signed-universal-mac-app-and-an-nsis-installer.md) makes the Releases it updates from. This ADR records what was taken from soundcheck's ADR 0011, its `scripts/updater.ts` and its `release.yml`, and what was changed. The pieces are `app/scripts/release/updater.ts`, `desktop/src/update.rs`, the updater's config in `desktop/tauri.conf.json`, `app/src/updates/` and `.github/workflows/release.yml`.

## Tauri's updater, with the Update key

The Desktop App registers `tauri-plugin-updater` 2.13.0, the latest stable release (3.0 is an alpha). It downloads `latest.json` from one endpoint, finds the package for its own platform, and installs it only if the package is signed by the **Update key**, a minisign Ed25519 key of Lanewise's own, separate from any code signature:

- its **private half** is the `TAURI_SIGNING_PRIVATE_KEY` secret, with `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, which only the release workflow's build steps get;
- its **public half** is committed, as `plugins.updater.pubkey` in `desktop/tauri.conf.json`, and built into the app. It stays **empty until the maintainer makes the key**, as the README's "Updates" says.

The config also sets:

- the endpoint, `https://github.com/adrianeyre/lanewise/releases/latest/download/latest.json`, GitHub's address for a file on the latest Release, which is never a draft or a pre-release;
- `requireSignedVersion`, so a package signed for one version can't be announced as another, and an old Release's signed package can't be offered again as newer;
- on Windows, `installMode: passive`: the NSIS installer shows its progress, asks nothing, and starts the new version itself.

| Platform | Installed from | Update package | Installed by |
| --- | --- | --- | --- |
| Windows x64 | the NSIS installer | the same installer, `Lanewise_<version>_x64-setup.exe` | the installer, per user, with no administrator prompt (ADR 0029) |
| macOS, Apple Silicon and Intel | the universal disk image | `Lanewise_<version>_universal.app.tar.gz`, the ad hoc signed universal app | the updater, replacing the app in place |

The Mac app is universal, so `latest.json` lists its one package for `darwin-aarch64` and `darwin-x86_64`, each with and without `-app`. soundcheck's was Apple Silicon only, and it also had Linux packages, which Lanewise doesn't have yet (PRD §6).

## The app's own commands, and only in a copy that can update

The window's capability doesn't grant the plugin's commands, so a script in the page can't point the updater at another endpoint or key. `desktop/src/update.rs` has four commands of its own, which take no address: `update_status` (the version, and why this copy doesn't update itself, if it doesn't), `update_check`, `update_install` (download, check, install, restart) and `update_progress`. They sit beside `call`, not in the command API, because Web Mode has no Updates: its UI is served afresh by `serve` (ADR 0003).

A copy **doesn't update itself**, and says why rather than failing, when:

- it has **no public key**, because it was built before the maintainer made the key, or on a fork;
- it is a **development build** (`pnpm desktop:dev`), which an Update would replace with a Release;
- it **wasn't installed from a Release's package**, such as a binary built from source. Tauri writes which bundle a binary was built into, and only NSIS and the Mac app update.

A failure is logged, and told to the UI, by its kind (`network`, `signature`, `platform` or `install`), never its message, which can hold the address asked (ADR 0028).

## Asked, shown, and installed only when the user agrees

The UI reaches the commands through the Platform's `updater`, which the Desktop App's Platform has and Web Mode's doesn't (`null`), so Web Mode shows nothing about Updates.

- **At each start** the app checks, unless *Check for updates when Lanewise starts* is turned off in Settings (kept on this machine, and listed in the Cookie Policy). A check at start that fails, offline say, shows nothing but in Settings. One that finds an Update shows a **notice** under the Tabs, with **Install and restart** and **Later**. The notice is a labelled region, not a dialog, so nothing waits on it and focus stays where it was. It is never shown on a Conflicts page.
- **Settings → Updates** shows the version running and, where this copy can't update, why, with a link to the Releases. Otherwise it has the check at start, **Check for updates**, and the Update found with its date and **what's new**, then Install and restart with the download's progress.
- **Nothing installs until the user chooses Install and restart.** Even then, installing restarts Lanewise, so it first asks every open repository whether an In-Progress Operation, or a fetch, pull or push, is under way, and whether a clone is running (`app/src/updates/whyNotInstall.ts`). If one is, or it can't tell, it installs nothing and says what to finish first. So an Update never interrupts an In-Progress Operation.

What's new is semantic-release's notes for the Release, as plain text: `updater.ts` drops the heading that repeats the version, the links and the commits' hashes, and makes each change a bullet. It is written before the publish job adds the Installing section, which an installed copy doesn't need.

## Update packages made by the build only when they are signed

Tauri makes and signs update packages when `bundle.createUpdaterArtifacts` is on, and then fails the build without the private key, which would break every fork, pull request and developer's machine. So it's off in the config, and `pnpm desktop:build` runs through `node app/scripts/release/updater.ts build`, which turns it on with `--config` when the private key and the public key are both there:

- **both**: the packages are signed, each with a `.sig` beside it;
- **neither**, or only the public key: the build goes on without update packages, saying so;
- **half a set**, the private key without the public key or a password without the key, fails, naming what is missing and never a value, as `signWindows.ts` does.

`updater.ts --how` says which it would do. It also drops the empty variables GitHub gives for secrets it doesn't have, which Tauri would otherwise take for set. The Windows installer is signed for the updater after `signWindows.ts` has code signed it. The Mac's `.app.tar.gz` is made from the ad hoc signed app.

## The release workflow publishes `latest.json` with each Release

`release.yml` gives the two secrets to the macOS and Windows build steps only, and to an **Update key** step before each build. That step fails on half a set of secrets, and also when the public key is committed but the private key isn't set: that Release would announce nothing no installed copy could take, so it is better to fail than to publish silently without Updates. With neither, it leaves a notice, "No update package".

The Windows job uploads the installer with its `.sig`. Tauri names the Mac's package `Lanewise.app.tar.gz` whatever the version, so the macOS job uploads it and its `.sig` renamed to `Lanewise_<version>_universal.app.tar.gz`, as the installers are named. The signature is over the contents, not the name, so renaming it is safe.

The publish job runs `updater.ts manifest` on the downloaded files, with the Release's download address. It pairs each package with its `.sig` and **checks every signature against the committed public key and the tag's version, as the app will**. Then it writes `latest.json`: the version, what's new, the date, and each platform's package address and signature. It fails on:

- a package without a signature, or a signature without a package;
- a package signed by another key, or for another version;
- two packages for one platform;
- signatures with no public key, or a public key with no signatures.

With no key at all, and so nothing signed, it writes no `latest.json`, which is no failure, and the job leaves a notice, "No latest.json". `latest.json` goes on the draft with the installers, and only then is the Release published, so the latest Release never points at a package it doesn't have. A pre-release is never the latest, so no installed copy updates to one.

## Why

- **Tauri's updater.** It is Tauri's own. It knows how the NSIS installer and the app bundle install, and checks the signature before anything runs. Writing our own would mean a signature check, a download and two installers, each a place for a mistake that lets an unsigned file run.
- **A key of our own, not the code signature.** The updater needs its own key either way. It's free and made by one command, so Updates can start the day the maintainer chooses, without an Apple Developer account or a Windows certificate (PRD §12). An Update is trusted only if it came from Lanewise's release workflow, whoever else Windows or Apple would trust.
- **The public key committed, and empty until made.** It isn't secret, and committing it makes the key the app trusts a reviewed change, not whatever a build was given. While it's empty, every copy says it doesn't update itself, which is true.
- **GitHub Releases.** They're free, `releases/latest/download/…` always means the newest non-pre-release, and there's no server of ours to run or secure (no paid services, CLAUDE.md).
- **Checking the signatures before publishing.** A Release with a package the app would refuse would announce an Update no installed copy can take. Checking in CI with the same algorithm (minisign with Node's own Ed25519) turns that into a failed publish job the maintainer sees.
- **Our own commands, not the plugin's JavaScript API.** With the plugin's commands granted, anything in the page could have the updater check another endpoint. Our own also say why a copy doesn't update, which the plugin can't.
- **Asking, and waiting for In-Progress Operations.** An Update restarts Lanewise. Restarting in the middle of a merge, a rebase or a push is worse than a notice, so the notice waits for the user, Later puts it off until the next start, and Install and restart waits for what's running.

## Alternatives

- **CrabNebula Cloud**, Tauri's hosted updater: another account, and past its free tier a bill.
- **A server of our own** answering the updater dynamically, for staged roll-outs: more to run and secure. `latest.json` on a Release can be edited later if a roll-out has to be held back.
- **The plugin's JavaScript API** (`@tauri-apps/plugin-updater`): less Rust, but the page could point the updater anywhere.
- **Silent updates**, installed at the next start: fewer clicks, but a restart the user didn't choose, and it would have to know about In-Progress Operations left open at quit. A setting could add it later.
- **Signing `latest.json` itself.** The updater doesn't. It trusts the file only for where to look and what the version is. Each package's signature, bound to its version, is what it checks, so a forged `latest.json` can only offer packages already signed.

## Consequences

- **Nothing updates itself until the maintainer makes the key.** Copies made before the public key is committed never update: their users install the first signed Release by hand, once.
- **The private key can't be lost.** Without it, no installed copy can be updated again, only reinstalled from a Release with a new key. If it leaks, whoever has it can sign an Update every copy takes: make a new key and ship it the same way. It needs a backup, with its password, away from the maintainer's machine.
- **Committing the public key without the secret fails every Release** until the secret is added. That's deliberate: see above.
- The installed app contacts `github.com` at each start unless the check at start is off. GitHub sees the address asked for, as it would for any download. Nothing is sent about how Lanewise is used (PRD §11), and the window's HTTP allow-list is unchanged, since the shell asks, not the window (`app/src/platform/allowList.test.ts`).
- On Windows a per-user install updates per user: the updater runs the installer's own upgrade (ADR 0029).
- Every Release build job has the Update key in its build step's environment, as it has the Windows signing secrets. Pull requests never do.

## Limits of this result

The sandbox this was written in is Linux, with no display, no Windows and no Mac, no GitHub token, and no Release yet. What is proven here:

- `app/scripts/release/updater.ts`, in `updater.test.ts`: when it signs, how it passes that to Tauri, how it pairs packages and signatures, what's new, the `latest.json` it writes, and each way it refuses one. Its signature check agrees with the updater's on stand-in packages signed by throwaway keys (`app/scripts/release/fixtures/updater/`, public halves only), and it also accepted a package signed by `tauri signer sign` with a throwaway key made by `tauri signer generate`, and refused it for another version.
- The real plugin, in `desktop/tests/updater.rs`, served that script's `latest.json` from this machine: it finds each platform's package, downloads it and accepts its signature; the running version is no Update; and it turns away one signed by another key, and one announced for a version it wasn't signed for. The page can't call the plugin's own commands.
- `update.rs`'s status, failure kinds and progress, and the IPC commands through a mock window, in its tests.
- The UI, with a stand-in updater: the check at start and its setting, Check for updates, what's new, the notice and Later, that nothing installs without Install and restart, and that it waits for a clone, a fetch, pull or push, or an In-Progress Operation. The notice and Settings' Updates pass `expectNoAxeViolations`.
- `release.yml`, with actionlint 1.7.12 and shellcheck 0.11.0, and its Update key and manifest steps' shell run locally: no secrets (a notice), half a set (fails, naming what's missing), and unsigned artifacts (no `latest.json`, no failure).

## Still to check by hand

1. **Accept the decision**, then **make the Update key** as the README's "Updates" says, **back it up**, add the secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, and commit the public key.
2. **On the first signed Release's run:** neither build job has a "No update package" notice. The Windows artifact has the installer and its `.sig`, and the macOS artifact has the disk image, `Lanewise_<version>_universal.app.tar.gz` and its `.sig`. Publish wrote `latest.json` and left no "No latest.json" notice, and the published Release has all of them. `https://github.com/adrianeyre/lanewise/releases/latest/download/latest.json` downloads it.
3. **Make a second Release** by merging a `fix:` commit, so there are two to update between.
4. **With the first installed, on Windows 10 22H2 or 11, an Apple Silicon Mac and an Intel Mac:** at start, the notice says the second is out, and Settings → Updates shows the running version, the second's date and what's new. Install and restart downloads it with progress and restarts as the new version, whose footer shows it. On Windows the installer asks nothing, shows no administrator prompt, and keeps the Settings, Tabs and API keys. On macOS the app is replaced in place and opens without a new Gatekeeper prompt. If it does prompt, that goes in ADR 0029's notes.
5. **What it refuses:** with a merge stopped on conflicts in an open Tab, or a push running, Install and restart says what to finish first and installs nothing, and the notice isn't shown on the Conflicts page. Offline, the check at start shows nothing and Settings says it couldn't reach GitHub. With *Check for updates when Lanewise starts* off, no notice appears. A copy from `pnpm desktop:dev` says it's a development build, and Web Mode has no Updates in Settings.
6. **Keyboard and screen reader**, in a real window: the notice's buttons and Settings' Updates group are reachable by Tab, focus is visible in both Themes, and the progress bar is announced.
