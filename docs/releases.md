# Releases

[Back to the README](../README.md)

Releases are made by [semantic-release](https://github.com/semantic-release/semantic-release) from the [Conventional Commits](https://www.conventionalcommits.org) merged to `main`, so nobody sets a version or pushes a tag (ADR 0029). `.github/workflows/release.yml` runs on every push to `main`:

1. **Verify:** the same checks as a pull request (`ci.yml`), on what was merged.
2. **Release:** semantic-release (`.releaserc.json`) works out the version. `feat:` makes a minor version; `fix:`, `perf:`, `refactor:`, `revert:` and `build:` a patch; a `!` after the type, or a `BREAKING CHANGE:` footer, a major. `docs:`, `test:`, `chore:`, `ci:` and `style:` make none, and nor does a subject that isn't a Conventional Commit, and then nothing below runs. With a version, it puts it in the root `package.json`, which `desktop/tauri.conf.json` and the footer take theirs from, writes `CHANGELOG.md`, which the footer's version opens, commits both to `main` as `chore(release): <version> [skip ci]`, tags `v<version>` and makes a **draft** GitHub Release with the notes.
3. **Build:** from that tag, the universal Mac app and its disk image, signed ad hoc, and the Windows NSIS installer, signed if a signing secret is set, with their update packages once there is an Update key ([the Update key](#the-update-key)).
4. **Publish:** it writes `latest.json` for the update packages, puts everything on the draft, adds the notes' Installing section (how to get past Gatekeeper and SmartScreen), and publishes it. A version with a `-`, such as `1.1.0-rc.1`, is a pre-release, never the latest.
5. **Website:** the project website goes to GitHub Pages with the latest Release's downloads, once GitHub Pages is turned on ([The project website](#the-project-website)).

`main` must let GitHub Actions push the version commit and the tag: under branch protection, allow `github-actions[bot]` to bypass it. `pnpm desktop:build` makes the same installer, or the same app and disk image, on your own machine (on a Mac, `node app/scripts/release/signMacos.ts -- pnpm desktop:build --target universal-apple-darwin`, as CI does).

## Signing the installer

With no secret, the Windows installer, the app in it and its uninstaller are left unsigned, and the build says so. Tauri runs `app/scripts/release/signWindows.ts` on each, which signs with a PFX certificate when both of these repository secrets are set:

- `WINDOWS_CERTIFICATE`: the `.pfx`, base64-encoded;
- `WINDOWS_CERTIFICATE_PASSWORD`: its password.

`WINDOWS_TIMESTAMP_URL` names another RFC 3161 timestamp server than DigiCert's. Half of the pair fails the build, naming what is missing. A PFX is for testing the signing path with a self-signed certificate: a certificate the public trusts can no longer be exported to one, which is why releases wait for SignPath Foundation.

The Mac app is never signed with a Developer ID or notarized (PRD §12): `signMacos.ts` builds it without any `APPLE_*` variable, which would have Tauri do either.

## The Update key

The app installs a package only if it is signed by the **Update key** for the version `latest.json` announces. The key's public half is built into the app, as `plugins.updater.pubkey` in `desktop/tauri.conf.json`, and its private half is a secret only the release workflow has. **Until the maintainer makes the key, nothing updates itself**: the public key is empty, Settings says so, and builds and Releases go on without update packages, with a notice. To make it, once, on your own machine:

```bash
pnpm exec tauri signer generate -w ~/.tauri/lanewise.key
```

It asks for a password: give one, and keep it in a password manager. It writes the private key, `~/.tauri/lanewise.key`, and the public key beside it, `~/.tauri/lanewise.key.pub`. Never commit the private key (`*.key` is ignored). Then:

1. Add two repository secrets (**Settings → Secrets and variables → Actions → New repository secret**):
   - `TAURI_SIGNING_PRIVATE_KEY`: the contents of `~/.tauri/lanewise.key`, a line of base64 (`pbcopy < ~/.tauri/lanewise.key` on a Mac, `Get-Content ~\.tauri\lanewise.key | Set-Clipboard` on Windows);
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: its password.
2. Paste the contents of `lanewise.key.pub`, also a line of base64, into `plugins.updater.pubkey` in `desktop/tauri.conf.json`, and merge that as a `feat:` or `fix:` commit, so it makes a Release. The public key isn't a secret. Copies made from then on update themselves; copies made before it don't, so their users install the first signed Release by hand, once.
3. **Back up the private key and its password** somewhere other than your machine. Without them no installed copy can be updated again, only reinstalled from a Release signed with a new key. If they leak, make a new key and ship its public half the same way.

With both secrets and the public key, `pnpm desktop:build` (through `app/scripts/release/updater.ts`) also makes the update packages: the NSIS installer and a `.app.tar.gz` of the Mac app, each with a `.sig`. The publish job checks every signature against the public key and the version, as the app will, and writes `latest.json`. The public key without the secret fails the release, since no installed copy would take it, and so does a secret without the public key, or a password without the secret. `node app/scripts/release/updater.ts --how` says whether a build would sign.

# The project website

`website/` is Lanewise's page on GitHub Pages, [lanewise.adrianeyre.co.uk](https://lanewise.adrianeyre.co.uk/) (ADR 0031): what Lanewise is, screenshots, download buttons for the latest Release, a link to the README and the footer every page has. The build draws the page into its HTML, with the search, Open Graph and Twitter card tags, favicons, web app manifest, JSON-LD, `robots.txt` and `sitemap.xml`. `website/README.md` says how to run it and check it.

After each push to `main`, `release.yml` builds it with the latest Release and deploys it, once everything before it has passed. **Until GitHub Pages is turned on, it isn't deployed**: the run says so in a notice and stays green. To turn it on, once: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The next push to `main` deploys it.

