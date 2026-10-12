# Security policy

Lanewise holds things worth protecting: your repositories, the credentials Git signs in to Hosts with, and the API keys you give it for Model Providers. If you find a way to get at any of them that you shouldn't, please tell us privately, so it can be fixed before anyone else learns of it.

## Supported versions

Only the [latest Release](https://github.com/adrianeyre/lanewise/releases/latest) is supported, and a fix comes in a new Release. Once the Update key is made, the installed Desktop App offers it as an Update (Settings → Updates), so staying current is one click. Until then, it says as it starts when a newer Release is out, with a link to download it. A copy built from source is supported at the latest commit on `main`.

## Reporting a vulnerability

**Don't open a public issue, pull request or discussion about it.**

1. Report it through GitHub's private vulnerability reporting: [Report a vulnerability](https://github.com/adrianeyre/lanewise/security/advisories/new) (or **Security → Report a vulnerability** on the repository). Only the maintainer can see it.
2. If that page isn't open to you, email the maintainer, Adrian Eyre, at [adrian.eyre@hotmail.co.uk](mailto:adrian.eyre@hotmail.co.uk), with "Lanewise security" in the subject.

Please include:

- the Lanewise version, from the footer or Settings → Updates, and your operating system;
- what someone could do, and what they'd need first, such as a repository you open or a URL you clone;
- the steps to show it, or a proof of concept, kept to what's needed to show it;
- whether you'd like to be credited, and how.

Please don't send real credentials, API keys or anyone's private repository contents: make throwaway ones to show it. Settings' **Copy diagnostics** leaves them out, so its output is safe to include.

## What happens next

The maintainer aims to reply within a week to say the report has been read, and to keep you told how the fix is going. Once a fixed Release is out, the report is published as a GitHub security advisory, crediting you if you'd like. Please keep it private until then.

## What's in scope

Anything in `adrianeyre/lanewise`: the Desktop App, Web Mode once it's built, the command API, the release workflow and the project website. For example:

- a credential, API key, file's contents or prompt that reaches the Logs, the Diagnostics, the UI or any place other than the Host or Model Provider it's for;
- a request the app makes to a URL outside its HTTP allow-list;
- a repository, remote URL, branch name or Model Provider's answer that makes Lanewise run a command, write a file or apply a Suggestion you didn't ask for;
- a way to have the Desktop App install an Update not signed by the Update key;
- a way into the release workflow, its secrets or the packages on a Release.

The [pen-testing PRD](docs/product-requirements-document/pen-testing.md) sets out the surface in more detail, with what a tester should try first. If you test Lanewise to find something, keep to its [rules of engagement](docs/product-requirements-document/pen-testing-rules-of-engagement.md): your own throwaway accounts and synthetic data, nothing done to a Host, Model Provider or Issue Tracker beyond what a normal user's account does, no pushing to any repository but your own, and anything with a way to do harm reported here privately first.

These are out of scope here:

- **Git, Git Credential Manager and Tauri themselves.** Report them to [Git](https://git-scm.com/community), [Git Credential Manager](https://github.com/git-ecosystem/git-credential-manager/security) or [Tauri](https://github.com/tauri-apps/tauri/security). Tell us too, if Lanewise should do something about it.
- **What a repository's own Git configuration or hooks run.** Lanewise runs the system `git`, which runs them as it does on the command line.
- **The Gatekeeper and SmartScreen warnings.** The Mac app is signed ad hoc and never notarized, and the Windows installer is unsigned until SignPath Foundation signs it, as the README says.
- **What a Model Provider does with what it's sent.** Settings shows exactly what goes to it before AI is turned on, and its own terms say what it keeps.

## How Lanewise protects what it holds

- API keys are kept in the OS credential store (Keychain on macOS, Credential Manager on Windows, the Secret Service on Linux), never in Lanewise's settings, and go only to the Model Provider they're for (ADR 0020). So are Gateways' headers and Issue Tracker tokens, which go only to the Gateway or Issue Tracker they're for (ADR 0035, ADR 0038). Each is kept under one of Lanewise's own services, `com.adrianeyre.lanewise.model-provider`, `com.adrianeyre.lanewise.gateway` or `com.adrianeyre.lanewise.issue-tracker`, and forgetting it in Settings deletes it. Uninstalling Lanewise doesn't: forget them first, or delete them in the credential store.
- Lanewise signs in to Hosts through Git and Git Credential Manager, and never keeps or shows those credentials itself (ADR 0016). A Host page you sign in to in a Tab stays signed in, as a browser does: the Host's own cookies are kept in the Desktop App's web data on your computer until you sign out on that page (ADR 0042).
- There's no telemetry. The Logs stay on your computer, in a folder other users of it can't open, never hold credentials, API keys, file contents or prompts, and hide anything that still looks like a credential as they're written and read (ADR 0028).
- The window's own requests, to Model Providers, Jev, the Model catalog and the latest version's number, go only to the URLs on its HTTP allow-list, which a test holds it to, and reach a Model Provider on this computer only at its API's own paths (ADR 0051). Besides those, it shows authors' pictures from GitHub, while Settings allows them (ADR 0035). Hosts, Issue Trackers and Gateways are asked by Lanewise's core, not the window.
- The Desktop App's window runs only the scripts it was built with: its Content-Security-Policy refuses any other script, and anything the page would load or send from somewhere it doesn't name (ADR 0050).
- An Update is installed only if it is signed by the Update key, for a version newer than the one running, and only when you choose to install it (ADR 0030). So an older Release, even one the key signed, is never installed as an Update.
