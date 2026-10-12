# Releases unchanged once published, and the Update key held, backed up and rotated

ADR 0030 makes an Update trusted only if the Update key signed its package for its version, and ADR 0029 builds every Release from `main` in `release.yml`. Before the Update key's public half is set, the pen-testing PRD's §8 asks for four things to be written down: who holds the private half, where its backup is, how it is rotated (including the Release that would ship a new public half if the old one leaked), and who can edit a Release's assets. It also asks that an older, genuinely signed Update be shown to be refused. R1 (#27) probed those, from H11, and this is what it found and what it decided. Its record is `docs/pen-test/R1.md`.

## Who can change a Release's files today

GitHub lets anyone with push access edit a Release and its assets ("Users with push access to the repository can edit a release asset", the REST API's Release assets page). `latest.json` is one of those assets, so the same people and tokens decide what installed copies are offered:

| Who | How |
| --- | --- |
| The owner, and any collaborator with the Write, Maintain or Admin role | the Release's page, `gh release` or the API |
| `release.yml`'s `release` job | `contents: write`: semantic-release makes the draft Release |
| `release.yml`'s `publish` job | `contents: write`: it uploads the installers, the update packages, their `.sig` files and `latest.json`, then publishes |
| Any workflow run on a branch of this repository, which only someone with push access can push | a workflow can ask for `contents: write` for its own token |
| A GitHub App or token given write access to contents | the API |

A pull request from a fork, and Dependabot's, get a token that can only read and no secrets, so neither can.

**What they can do to an installed copy is limited by the updater, not by GitHub.** A copy takes only a package the Update key signed, for the version `latest.json` announces, and only if that version is newer than its own (`desktop/tests/updater.rs`, `the_apps_own_updater_offers_no_older_release` in `desktop/src/lib.rs`). So a changed `latest.json` can't make a copy go back to an older Release, even one the key signed: announced as itself it isn't newer, and announced as newer it isn't the version it was signed for. Taking `latest.json` away, or putting an older one in its place, only stops copies finding an Update. Lanewise still says as it starts that a newer version is out, because that check reads `main`'s `package.json`, not the Release (ADR 0047).

**The updater doesn't cover a first install.** The disk image and the NSIS installer a user downloads from the Release page are checked by nothing of Lanewise's, so whoever can change a Release's files can change what a new user installs.

## Published Releases are made immutable

The repository turns on GitHub's **release immutability** (Settings → General → Releases → Enable release immutability). Once a Release is published, its assets and its tag can't be changed or deleted by anyone, the owner and the workflows included. Its title, notes and whether it's the latest can still be changed. It applies only to Releases published after it's turned on.

`release.yml` already works the way GitHub recommends for it: semantic-release makes a draft, the build jobs and `publish` put every file on the draft, and only then is it published. Nothing is uploaded to a Release after that, so the workflow doesn't change.

Holding a roll-out back, which ADR 0030 did by editing `latest.json`, is now done by marking the previous Release as the latest, which immutability allows. Installed copies then read its `latest.json`, find nothing newer, and stay where they are. Fixing a Release's mistake means making another Release.

## Who holds the Update key, and its backup

- **The owner, Adi (`adrianeyre`), holds the private half alone.** It's made on the owner's machine (`docs/releases.md`, "The Update key") and given to the release workflow as `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, which only the build steps get (ADR 0030).
- **Its backup is the key file and its password, away from the owner's machine**, the password in the owner's password manager and the key file somewhere else. Where exactly is in the owner's own records, not in this public repository.
- **The owner checks the backup** each Pen-test round: the backed-up key, with its password, signs a scratch file (`pnpm exec tauri signer sign -f <backup> <file>`), and the public half backed up beside it is the one in `desktop/tauri.conf.json`.

## Rotating it

A copy of Lanewise trusts the one public key it was built with. `publish` checks every update package against the public key committed in the tag it builds (ADR 0030), so a Release can only carry the key it was signed with. Rotating is therefore a clean break: copies made before it can't take an Update signed by the new key, and their users install the first Release with it by hand, once.

If the private half leaks, or might have, or is lost:

1. **Make a new key** on your own machine, with a new password: `pnpm exec tauri signer generate -w ~/.tauri/lanewise-2.key`.
2. **Replace the two secrets** in the `release` environment (ADR 0053) with the new key and its password, before anything else merges to `main`, so no later Release is signed by the old key.
3. **Commit the new public half** to `plugins.updater.pubkey` in `desktop/tauri.conf.json` as a `fix:` commit. Its Release is the first signed by the new key; `publish` checks it against the new public half.
4. **Copies of every earlier Release still trust only the old key.** They find the new Release, but Install and restart refuses its package, saying it "isn't signed by Lanewise's Update key for the version it says, so it wasn't trusted", and installs nothing. Lanewise's check at start still says a newer version is out (ADR 0047). Each user installs the new Release from its page, once.
5. **If it leaked, publish a security advisory** naming the Releases that trusted the old key and asking their users to install the new one by hand. Until they do, their copies trust the old key. Whoever has it would also need those copies to read a `latest.json` of their own, which needs push access to `adrianeyre/lanewise` or a break of TLS to `github.com`.
6. **Back up the new key** as above, and destroy the old one and its backup.

A bridging Release, signed by the old key and carrying the new public half, would move copies over at their next Update instead of by hand. It needs `publish` to check packages against the public key installed copies have, the previous Release's, rather than the one the tag commits. That isn't built. It is a follow-up issue for the owner to file. Until it is built, a rotation is the clean break above.

## Considered options

- **Leave Releases editable, as ADR 0030 did.** Left out: the updater limits what a changed `latest.json` can do, but nothing limits a changed installer for a first install, or a package replaced by another the key signed.
- **Sign `latest.json` as well.** Left out again, as in ADR 0030: Tauri's updater doesn't check it. A forged one can only offer packages already signed, for their own versions, newer than the copy running.
- **Keep the Update key in a GitHub environment that only `main` can use.** That's R2's (#28), which probes the release workflow's secrets, and ADR 0053 does it. It doesn't change who can edit a Release.
- **Ship two public keys, so a rotation needs no bridge.** Tauri's updater takes one.

## Consequences

- A published Release's files stay as `publish` left them. A mistake on one is fixed by a new Release.
- A deleted immutable Release's tag name can't be used again. semantic-release only ever moves to a newer version, so that never blocks a Release.
- GitHub makes a release attestation for each immutable Release, a record of its tag, commit and assets.
- ADR 0030 held a roll-out back by editing `latest.json`, and rotated the key by shipping a new one "the same way". It now points here for both: marking the previous Release as the latest, and the steps above.

## Look again

When the Update key is set (pen-testing PRD §8), when the bridging Release is built, if Tauri's updater takes more than one key, and at the next Pen-test round.

## Hand checks

1. **Accept the decision.** Then, in `adrianeyre/lanewise`'s Settings → General → Releases, select **Enable release immutability**.
2. **Write down who has push access:** Settings → Collaborators and teams, and Settings → GitHub Apps. Note each person and App with write access to contents in the owner's records, and remove any that don't need it.
3. **On the first Release published after step 1:** its page says it is immutable, and `gh release upload <tag> <a scratch file>` with the owner's own token is refused. Marking the previous Release as the latest still works, and marking this one again puts it back.
4. **Before the Update key is set:** make it and back it up as above, write in the owner's own records where the backup is, and check that the backup signs.
5. **Once step 3 holds,** add to `SECURITY.md`'s "How Lanewise protects what it holds" that a published Release's files can't be changed.
