# An Activity indicator for every command, and Host pages in the browser

The owner asked that anything that takes time say what it's doing, with a spinner, words that change as it moves on and a percentage bar, so nobody takes Lanewise for stuck; that every place a repository shows offer to open it on its Host; and that the Cookie Policy, Accessibility, Credits and the version be in the App menu. This ADR records how. It builds on ADR 0003, ADR 0028, ADR 0032 and ADR 0040.

## Every command, through one client

`App` wraps the platform's `CommandClient` in `trackCommands` (`app/src/ui/commandActivity.ts`), so every command any Widget sends starts an Activity, in words `WORDS` gives it, and ends it as the command answers. `WORDS` names every command, so a new one has to say what it shows, or `null` for one never shown: the long polls (`workingTreeChanges`, `cloneProgress`, `remoteProgress`), which wait on purpose, the Logs, and the key and gateway reads an AI request makes. A clone, fetch, pull or push goes on after its start command answers, so its Activity stays, showing Git's own phase and percentage from its long poll, until that says it's done.

What isn't a command starts its own Activity through `startActivity` or `withActivity` (`app/src/ui/activity.ts`): a Suggestion, in three steps (the API key, the Model Provider's models, the request), Jev's questions, a Model Provider's models, the model catalog, the version check and an Update's check and install, with the updater's own percentage.

The Activity indicator shows the newest Activity once it has run 400 ms, so what's quickly done doesn't flash. Its bar is filled to the percentage where Git, the updater or the steps know it; where nothing knows it, the bar says so, moving, or still and paler with reduced motion, beside how many seconds it has run, rather than a made-up percentage. A screen reader hears each change of words through a polite live region; the bar's value is the percentage, and it has none where that isn't known. Nothing about an Activity is logged or sent (PRD §11).

## Host pages open in the browser

A repository's page on its Host, from `openRepository`'s `web` (ADR 0040), or from a remote's URL or a listed repository's clone URL in the UI (`webPageOf`), is "Open repository" with the Host's logo, from `simple-icons` (CC0), or a globe for a Host with none there: in the Recent Repositories, Browse repositories, beside the repository's name and on each remote. It and each Pull Request open through `Platform.openLink`, in the user's browser.

## Considered options

- **An estimated percentage from how long a command usually takes.** Left out: it would say something Lanewise doesn't know. The seconds say it's still going.
- **Showing only commands a Widget marks as slow.** Left out: any read can be slow on a big repository, and every command through one client can't be missed.
- **Host pages inside Lanewise, in a Tab.** Left out for now. GitHub, GitLab, Bitbucket and Azure DevOps all refuse to be framed (`X-Frame-Options`, CSP `frame-ancestors`), so an `iframe` can't show them. The Desktop App could show them in a Tauri child webview, but that's behind Tauri's `unstable` feature. It would put a Host's sign-in page inside Lanewise's own window, which `Platform.openLink` promises never to do. And Web Mode couldn't have it at all. It needs its own decision. ADR 0042 makes it, for the Desktop App.

## Hand checks

- A clone, fetch and pull of `git/git`, a Suggestion and Browse repositories, each showing the Activity indicator as it goes, in both Themes, with reduced motion, and with a screen reader.
