# The Update key in a job of its own, that only `main` can use

ADR 0030 gave the Update key's two secrets to the Mac and Windows build steps of `release.yml`. That step runs `pnpm desktop:build`, so it also runs every Cargo build script and proc macro in the Desktop App's dependency graph, the Vite plugins and the npm packages Vite loads, the Tauri CLI, and the bundlers' own tools. The pen-testing PRD's H12 asked what a malicious transitive dependency could take there. R2 (#28) probed it, and the release job's token beside it, with the key's public half still empty, so nothing was there yet to take. Its record is `docs/pen-test/R2.md`. PRD §8 asks for R2 to be closed before the key is set. This ADR is what it decided, as defence in depth.

## What ran beside the key

Counted from `Cargo.lock` and `pnpm-lock.yaml` at `75479b9`, for the Desktop App's normal and build dependencies:

| In the build step | Windows (`x86_64-pc-windows-msvc`) | macOS (`aarch64-apple-darwin`) |
| --- | --- | --- |
| Crates compiled | 430 | 430 |
| Build scripts (`build.rs`), each run as a program | 59 | 61 |
| Proc macros, each run inside the compiler | 30 | 28 |
| npm packages Vite's config loads (`vite`, `@vitejs/plugin-react`, `vitest/config`), with one native binding for the platform | up to 127 | up to 127 |
| The Tauri CLI, a native binary from npm | 1 | 1 |

Any one of them could read the step's environment. A step boundary isn't a trust boundary either. Every step of a job runs on the same runner as the same user, so code one step runs can leave a process that outlives it, or change what a later step runs, through `PATH`, `GITHUB_ENV` or the files a later step reads. Only another job, on a fresh runner, is apart from it.

## The update packages are signed in a job that installs and builds nothing

- **The build jobs never have the key.** The Windows build makes the NSIS installer, which is the update package itself, and uploads it. Tauri makes the Mac's update package, a `.app.tar.gz` of the ad-hoc signed app, only when it can sign it too. So once the app has a public key, the Mac's build is given a throwaway key, made in the job with `tauri signer generate` and thrown away with the runner. Tauri only warns that it isn't the key the app trusts, which was checked with Tauri CLI 2.12.2. Its `.sig` is left behind.
- **A `sign` job signs them.** It needs both builds, and runs on a fresh Ubuntu runner with four of GitHub's own actions (`checkout`, `setup-node` with no cache, `download-artifact`, `upload-artifact`), Node and two of Lanewise's scripts, which import only Node's own modules. Nothing is installed: no `pnpm install`, no Cargo, no Tauri CLI. Only its signing step gets the secrets.
- **`updater.ts sign` is Lanewise's own signer.** It reads the key as `tauri signer generate` writes it: base64 of minisign's secret key, encrypted with scrypt from its password. It decrypts it with Node's `scrypt`, at the cost minisign's `opslimit` and `memlimit` give, as libsodium works it out. It checks that the password is right, and that the key is the one whose public half is committed in `desktop/tauri.conf.json`, before it signs anything. Then it writes each package's `.sig` as Tauri does: minisign's Ed25519 signature over the package's BLAKE2b-512 hash, and a global signature over that and a trusted comment of `timestamp`, `file` and `version`. It signs only packages named for the version, since the name goes into the trusted comment, and checks every signature it wrote, as `publish` and the app will.
- **It is checked against Tauri's own.** `updater.test.ts` signs with keys made by `tauri signer generate`. `desktop/tests/updater.rs`'s `a_package_the_release_script_signed_downloads` serves packages signed by `updater.ts sign` to the real updater plugin, which takes them, and still refuses them announced as another version. Tauri's signatures are hedged, randomized per signature, so the two signers' bytes can't be compared. Each checks the other's.

## The key lives in an environment only `main` can use

A repository secret reaches a workflow run on any branch of the repository, and anyone with push access can push a branch with a workflow of their own. So the two secrets move to a **`release` environment** whose deployment branches are `main` alone. Only the `sign` job names it. The owner can also make themselves its required reviewer, so that each Release waits for them to approve its signing. Making the environment, and moving the secrets, is the owner's (hand check 1).

## The tag that is signed is the commit merged, and its version commit

semantic-release runs among about 314 npm packages, counted the same way, with a token that can push. Before it signs anything, the `sign` job runs `versionCommit.ts` from the commit merged (`github.sha`), never from the tag. The check fails unless all of these hold:

- the tag's one parent is the commit merged;
- it changes only `CHANGELOG.md` and `package.json`, both plain files;
- it changes nothing in `package.json` but the version, which is the one released.

`publish` needs `sign`, so nothing is published unless the check passed, and the website waits for `publish`. The build jobs, `publish` and the website check out `refs/tags/<tag>` in full. Given a bare name, `actions/checkout` takes a branch of the same name over the tag, so a bare name could build a branch rather than the tag `sign` checks.

## Each job's token only what it needs

| Job | Token | Why |
| --- | --- | --- |
| `verify` (`ci.yml`) | `contents: read` | checks out the tree |
| `release` | `contents`, `issues` and `pull-requests: write` | semantic-release pushes the version commit and the tag, makes the draft Release, and comments on and labels what it released (ADR 0029). Only its step has the token |
| `windows`, `macos` | `contents: read`, the workflow's | build and upload artifacts |
| `sign` | `contents: read` | checks out the commit merged; the key is the environment's |
| `publish` | `contents: write` | uploads to the draft and publishes it. The token now goes only to its two `gh` steps, not to the whole job |
| `pages` | `pages: read` | asks whether Pages is on |
| `website` | `contents: read`, `pages: read` | builds the site, with its npm packages |
| `deploy` | `pages` and `id-token: write` | runs `deploy-pages` and nothing else. It used to share a job with the build, whose packages then had a deployment's token in their job |

`app/scripts/workflows.test.ts` holds the workflow to every row, to the key in one step of one job, and to that job's actions, commands and scripts.

## What this doesn't change

- **A build is still only as sound as what it builds with.** Keeping the key out of the build stops a dependency taking the key. It doesn't stop one changing the app it's built into, which the key then signs. Dependabot, the lockfiles and code scanning (ADR 0049) are what stand there.
- **The Windows signing secrets stay in the Windows build step.** Tauri runs `signWindows.ts` on the app, the installer and the uninstaller while it bundles, so the PFX has to be there. ADR 0029 keeps a PFX for testing the signing path with a self-signed certificate, never for a Release, and SignPath Foundation will sign the uploaded artifacts outside the build.
- **semantic-release still runs among its packages with its token.** What that token can do is in R2's record. The check above holds what is signed and published to the commit merged. Caches restored into the release jobs, and `main`'s branch protection, are R3's (#29).

## Considered options

- **Sign in a later step of the same job.** Left out: the build's code can still reach the next step on the same runner, as above.
- **`tauri signer sign` in the `sign` job.** It is Tauri's own signer, but it needs the Tauri CLI installed from npm in the job that holds the key, and `pnpm install` runs the lockfile's allowed build scripts.
- **`tauri build --no-sign`** to make the update packages without a key. It also skips the Mac app's ad hoc code signature, which Apple Silicon needs, so the update package would be of an app that doesn't run.
- **Make the `.app.tar.gz` with `tar` on the Mac runner.** The updater unpacks every entry below the archive's first folder, so macOS's `tar` would add its `._` metadata files to the app and break its seal unless told not to. Tauri's own archive is the one ADR 0030's hand checks install, so the throwaway key keeps it.
- **Sign in `publish`.** Left out: that job holds `contents: write`, and the key and a write token are kept apart.
- **Drop semantic-release's comments and labels**, to take `issues` and `pull-requests: write` from its token. Left for the owner: ADR 0029 chose them, and `contents: write`, which it needs anyway, is the larger power.

## Consequences

- A Release has one more job, of about a minute, after both builds.
- The first Release after the key is made needs the `release` environment to exist, with the secrets, or `sign` fails. That's the same failure as today's when the public half is committed without the secret.
- Each signed Release shows a deployment to `release` in the repository, as the website's does to `github-pages`.
- Lanewise now has its own minisign signer, about a hundred lines, held by its tests against keys `tauri signer generate` makes and against the real updater plugin. If Tauri's key or signature format changes, those tests fail before a Release does.
- If a later Tauri CLI refuses a key that isn't the app's, the Mac build fails loudly rather than ship an unsigned Release.

## Look again

When the Update key is set (PRD §8), when SignPath signs the Windows installer, if Tauri can make update packages without signing them, and at the next Pen-test round.

## Hand checks

1. **Make the `release` environment** as `docs/releases.md`'s "The Update key" says: deployment branches `main` alone, the two secrets in it, and none of them left as repository secrets. Optionally, add yourself as a required reviewer.
2. **On the first Release after the key is made:** neither build job has the Update key in its log or its environment. The `sign` job says "… is … and its version commit for …, and nothing more", then "Signed Lanewise_<version>_universal.app.tar.gz, Lanewise_<version>_x64-setup.exe for <version>", and `publish` writes `latest.json` from its signatures.
3. **On a Mac, from the Release before it:** the Update installs, as ADR 0030's hand check 4 says. That shows the `.app.tar.gz` made with the throwaway key, and signed in `sign`, is a package the updater takes.
4. **Try a workflow on another branch** that prints whether `secrets.TAURI_SIGNING_PRIVATE_KEY` is set, without printing it, in a job that names `environment: release`. The run is refused, or waits, because the branch isn't `main`. Delete the branch afterwards.
