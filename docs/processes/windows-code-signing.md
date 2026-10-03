# Windows code signing through SignPath Foundation

Windows builds of the Desktop App ship unsigned until SignPath Foundation
approves Lanewise for its free code signing. Until then SmartScreen warns
about them, and the README explains how to get past the warning (PRD §12).
This guide is for the owner of `adrianeyre/lanewise`, and covers GitHub issue
#46: what the repository has to satisfy before applying, how to apply, what to
set up once approved, and what an agent does after that.

It follows SignPath's own pages as read on 2026-09-29 (see
[Sources](#sources)). Their terms are marked **Draft**, so read them again
before applying.

## What SignPath Foundation gives

- **A certificate in SignPath Foundation's name.** SignPath isn't a
  Certificate Authority, and a CA only issues code signing certificates to a
  legal entity. So the certificate is issued to SignPath Foundation, which
  shows as the publisher, and projects sign with it. Signed Lanewise
  installers will say SignPath Foundation, not Lanewise or the owner.
- **A key nobody holds.** The private key stays in SignPath.io's hardware
  security module. There is no USB token, so the signing works from CI.
- **Signatures that vouch for the build.** Each signature says the binary is
  an automated build from the source in `adrianeyre/lanewise`. SignPath.io
  checks that with GitHub for every signing request. The build scripts and CI
  workflows count as source, so they deserve the closest review.
- **No entitlement.** Acceptance is at the Foundation's discretion, with no
  appeal, and it can pause the subscription or revoke the certificate if the
  terms are broken.

It costs nothing, which the free-tooling rule in `CLAUDE.md` needs.

## Before applying

Each row is a condition from SignPath Foundation's terms, or from what the
application asks for. As of 2026-09-29:

| Condition | Where Lanewise stands | What to do |
| --- | --- | --- |
| **Public repository.** SignPath verifies builds from it, and nobody can judge a project whose source they can't read. | Not public: GitHub's API answers `404` for `adrianeyre/lanewise`. | Make `adrianeyre/lanewise` public. |
| **An OSI-approved licence for all components, with no commercial dual-licensing.** | MIT (`LICENSE`). The Credits modal lists the dependencies' licences (PRD §7.11). | Confirm again that every dependency is under an OSI licence (PRD §12). |
| **No proprietary code**, except system libraries. | None. | Nothing, as long as it stays that way. |
| **Actively maintained.** | Yes. | Nothing. |
| **Already released in the form to be signed.** | No release yet. | Wait for the first release with the NSIS installer from #42's release workflow, unsigned, on GitHub Releases. |
| **Documented.** The download page or store entry describes what the program does. | The README describes it in a sentence. | Make sure the GitHub Release, and the project website (PRD §12.1) once it's live, say what Lanewise does. |
| **Verifiable reputation.** Downloadable programs need evidence that people use and trust them. Libraries don't. | A new project with no users yet. | Collect the evidence: download counts, stars and forks, GitHub Insights, articles or posts about it. This is the hardest condition for a new project, so applying after the public beta (M7) has had some use gives it the best chance. |
| **An unambiguous name.** A web search for the name should find the project. | "Lanewise" | Search for it, and check nobody else holds it as a trademark. |
| **Multi-factor authentication** on GitHub and SignPath for everyone on the team. | | Turn it on for the owner's GitHub account, and on SignPath.io when the account exists. |
| **Signing roles.** *Authors* change the source without review, *Reviewers* review every change from anyone else, such as a pull request, and *Approvers* approve each signing request. | `.github/CODEOWNERS` names only `@adrianeyre`, so the owner holds all three. | List the roles in the code signing policy (next row). |
| **A code signing policy** named "Code signing policy" on the home page and the download/release pages, as a heading or a link. It says "Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org)", lists the roles and their members, and gives the privacy policy. | Not written. | Draft it now. Publish it in the README, the release notes and the website once approved, since before then the sentence isn't true. |
| **Privacy.** Either link a privacy policy, or say "This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it". Software that sends user data to systems the user didn't choose also shows the policy while installing, and offers an option there to turn that off. | There's no telemetry (PRD §11). Remotes and Model Providers are the user's own choice, and AI is off until they turn it on (PRD §8.2). But two things are automatic: the updater checks `adrianeyre/lanewise`'s GitHub Releases (PRD §12), and the model catalog refreshes from `adrianeyre/lanewise` (PRD §8.3). | Decide whether those two requests fit the stock sentence. If not, write a short privacy policy naming them and GitHub's own privacy policy, and ask #42 to show it in the installer. |
| **Uninstallation**, if there's an installer. | The NSIS installer comes from #42. | Check that #42's installer ships an uninstaller, as NSIS installers do by default. |
| **System changes announced.** | The installer may install the WebView2 runtime (PRD §6). | Check that the installer says so when it does. |
| **No hacking tools.** | A Git client. | Nothing. |

## Applying

1. Read [the terms](https://signpath.org/terms) again. They are a draft and
   may have changed.
2. Open [the application form](https://signpath.org/apply). It's an embedded
   HubSpot form. Its fields can't be read outside a browser, so the list below
   comes from the spreadsheet it replaced in April 2026
   (`OSSRequestForm-v4.xlsx` in the Foundation's website source). Expect
   something close to it:

   | Field | Answer for Lanewise |
   | --- | --- |
   | Name | Lanewise |
   | Type | Program. Libraries are only for things developers use and nobody runs. |
   | Licence | MIT, `https://opensource.org/license/mit` |
   | Repository URL | `https://github.com/adrianeyre/lanewise`, the URL CI builds from. SignPath checks it on every build. |
   | Homepage URL | `https://lanewise.adrianeyre.co.uk/` once the website is live (PRD §12.1), or the repository until then |
   | Tagline | A short line, such as "A visual Git client with AI-assisted merge conflict resolution" |
   | Description | One paragraph that won't go out of date with a new version: no feature lists, no OS versions. `CONTEXT.md`'s first line is a good start. |
   | Download URL | `https://github.com/adrianeyre/lanewise/releases` |
   | Privacy policy URL | Whatever the privacy row above decided |
   | Reputation | The evidence collected above, with links |
   | Wikipedia URL | Leave it empty unless there is an article |

3. Accept the terms and submit the form. SignPath contacts the owner. Its
   terms ask applicants to keep the back-and-forth short, and not to argue
   policy.
4. Tick #46's first criterion once submitted.

## Once approved: set up SignPath.io

SignPath's own documentation is the reference. In outline:

1. Sign in to SignPath.io and turn on multi-factor authentication.
2. Add the predefined **GitHub.com** trusted build system to the organization
   and link it to the Lanewise project. Install the
   [SignPath GitHub App](https://github.com/apps/signpath) on
   `adrianeyre/lanewise`.
3. Write the **artifact configuration**. The terms require metadata
   restrictions on every signed binary: the product name set to `Lanewise`
   (`productName` in `desktop/tauri.conf.json`), and the product version the
   same for everything in one build (Tauri takes it from `package.json`).
4. Set up the **signing policy**, with `@adrianeyre` as its Approver.
5. Create an **API token** for a user with submitter rights on that policy.
6. Add what the release workflow needs as repository secrets: the API token,
   the organization ID, and the project, signing policy and artifact
   configuration slugs.
   TODO(#42): the secret names the release workflow reads.
7. Tick #46's second criterion.

## How signing fits the release workflow

#42 builds the release workflow, so this section says what SignPath's GitHub
integration expects, not what the workflow does.

TODO(#42): the signing step, and the secret names it reads.

What SignPath's documentation expects:

- The unsigned file goes up as a workflow artifact with
  `actions/upload-artifact` (v4 or later). SignPath's action,
  [`signpath/github-action-submit-signing-request`](https://github.com/SignPath/github-action-submit-signing-request),
  sends it for signing by the artifact's ID. It waits, and downloads the
  signed file into a folder the workflow names. Like everything else, it goes
  in at its latest release.
- SignPath checks with GitHub that a workflow run built the artifact.
  For an open-source project, every job before the signing request must run on
  GitHub-hosted runners. CI already does (`windows-latest`).
- An upload is zipped unless it's made with `archive: false` and signed with
  `skip-decompress: true`. The artifact configuration's root has to match.

What the release workflow will have to handle:

- **SignPath can't open an NSIS installer.** It signs one as a single PE
  file, since NSIS isn't one of the formats it can look inside. So
  `Lanewise.exe` has to be signed before NSIS packs it, and the installer
  after. That's two signing requests, or one build step that signs both.
- **The updater signs the installer too.** If the installer is the update
  package, Tauri's updater signature has to be made from the Authenticode-signed
  installer. A signature made before SignPath signs it won't match the file
  users download.
- **Every release waits for the Approver.** The terms require a manual
  approval for each signing request. A release the owner doesn't approve
  within the action's wait (600 seconds by default) fails, so the timeout has
  to leave time to approve.

## After approval: what an agent does

With #46's second criterion ticked and a signed release out:

1. **Hand check on Windows**, which no agent can do: download the installer
   from the GitHub Release on Windows 10 and Windows 11. Its Properties show a
   Digital Signatures tab naming SignPath Foundation. Running it shows no
   SmartScreen warning. The warning is the only reason for the caveat, so
   don't remove it until this passes.
2. Remove the SmartScreen caveat from the README's install section.
   TODO(#45): the README has no install section yet. #45 writes one with the
   caveat.
3. Remove the SmartScreen caveat from the release notes, wherever #42's
   workflow puts it.
   TODO(#42): where the release notes' caveat lives.
4. Publish the code signing policy drafted above, in the README, the release
   notes and the website.
5. Update PRD §12's Windows bullet and §15's code signing answer to say
   Windows builds are signed.

The macOS caveat (Gatekeeper, `xattr -d com.apple.quarantine`) stays. macOS
builds are ad-hoc signed and never notarized (PRD §12).

## If the application is turned down

Nothing changes: Windows builds ship unsigned with the SmartScreen guidance,
as PRD §12 says. A paid certificate is not an option (free tooling only).
Ask SignPath what was missing, which will usually be reputation, and apply
again once there's more of it.

## Sources

Read on 2026-09-29:

- [SignPath Foundation conditions for Open Source projects](https://signpath.org/terms)
  (the "Code of conduct", marked Draft), and its source in
  [SignPath/fdn-website](https://github.com/SignPath/fdn-website) at commit
  `df7801c` (2026-09-09), with the former application spreadsheet
  `docs/assets/OSSRequestForm-v4.xlsx`.
- [Apply for a free SignPath.io subscription](https://signpath.org/apply)
- [About SignPath Foundation](https://signpath.org/about)
- [SignPath: GitHub trusted build system](https://docs.signpath.io/trusted-build-systems/github)
- [SignPath: artifact configuration reference](https://docs.signpath.io/artifact-configuration/reference)
