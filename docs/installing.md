# Installing Lanewise

[Back to the README](../README.md)

Download the latest [Release](https://github.com/adrianeyre/lanewise/releases/latest), or get it from [the project website](https://lanewise.adrianeyre.co.uk/). The installed Desktop App updates itself from then on ([Updates](#updates)).

**macOS 14 or later**, on Apple Silicon or Intel: open `Lanewise_<version>_universal.dmg` and drag Lanewise to Applications. Lanewise is signed ad hoc and not notarized by Apple, as it has no Apple Developer account, so the first time you open a downloaded copy, macOS says it can't check it and won't open it. To open it anyway, either:

- open **System Settings → Privacy & Security**, scroll to **Security**, choose **Open Anyway** beside the message about Lanewise, and confirm with your password; or
- in Terminal, run `xattr -d com.apple.quarantine /Applications/Lanewise.app`.

After that it opens as any other app. A copy you build from source opens without a warning.

**Windows 10 22H2 or later, or Windows 11**, on x64: run `Lanewise_<version>_x64-setup.exe`. It installs Lanewise for you alone, without asking for administrator rights. The installer isn't signed yet, so Microsoft Defender SmartScreen may say **Windows protected your PC**: choose **More info**, then **Run anyway**. It will be signed once SignPath Foundation, which signs open-source projects for free, has approved Lanewise.

## Git and Git Credential Manager

Lanewise runs the Git installed on your computer (ADR 0002), which must be **2.40 or later**, and signs in to Hosts through **[Git Credential Manager](https://github.com/git-ecosystem/git-credential-manager)**. It checks both each time it starts, and if either is missing it says what to install and how, with a **Check again** button. Without Git Credential Manager it still works with the repositories on your computer, SSH remotes and other credential helpers, but can't sign in to Hosts for you.

| | Git | Git Credential Manager |
| --- | --- | --- |
| Windows | [Git for Windows](https://git-scm.com/install/windows), or `winget install --id Git.Git -e --source winget` | Included with Git for Windows. If it isn't Git's credential helper, run `git config --global credential.helper manager` |
| macOS | `brew install git`, from [Homebrew](https://brew.sh). The Git that comes with Apple's Command Line Tools can be older than 2.40 | `brew install --cask git-credential-manager`, then, if Lanewise still doesn't find it, `git-credential-manager configure` |
| Linux | Your package manager ([Git's instructions for Linux](https://git-scm.com/install/linux)) | [Its install instructions](https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/install.md), then `git-credential-manager configure` |

To check them yourself:

```bash
git --version                        # git version 2.40.0 or later
git credential-manager --version     # any version
git config --get-all credential.helper   # one of them runs Git Credential Manager (manager, or a path to git-credential-manager)
```

## Updates

The installed Desktop App updates itself from the latest Release through [Tauri's updater](https://v2.tauri.app/plugin/updater/) (ADR 0030). **Settings → Updates** shows the version running, and **Check for updates** asks `https://github.com/adrianeyre/lanewise/releases/latest/download/latest.json` whether a newer one is out. Unless *Check for updates when Lanewise starts* is turned off, it asks at each start too, and a notice under the Tabs says when one is. **Install and restart** downloads it, installs it and opens the new version, but not while an In-Progress Operation, a clone, a fetch, a pull or a push is under way: it says what to finish first. A copy run with `pnpm desktop:dev`, one built from source and Web Mode don't update themselves. How a Release is signed so that it can update itself is in [Releases](releases.md#the-update-key).
