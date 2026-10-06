# The latest version checked as Lanewise starts

The owner asked for Lanewise to check, each time it starts, whether it is the latest version, and if it isn't, to say so in a modal dialog: the version running, the latest, and a link to the latest Release on GitHub to download and install it from.

## As Help's check does

Help's "Check for the latest version…" already asks GitHub for `main`'s `package.json`, whose version each Release sets (ADR 0029). The check at start is the same request, made once as the app is first drawn (`useOutOfDateAtStart` in `app/src/updates/OutOfDateDialog.tsx`). It sends nothing but the request, as the Help check doesn't, so there's still no telemetry (PRD §11), and the URL is already in the HTTP allow-list.

If the version running is older, the dialog "A newer version of Lanewise is out" says which version is running and which is the latest, with a link to `https://github.com/adrianeyre/lanewise/releases/latest`. The link opens in the browser, which does the download, as Help's does. Close, Escape or the dialog's own close button dismiss it until the next start. If the version is the latest, or GitHub can't be asked, as when offline, nothing is shown at start: Help's check says why.

## It follows "Check for updates when Lanewise starts"

The Desktop App's Settings has "Check for updates when Lanewise starts", on by default, for its Updates (ADR 0030). The check at start follows it too, so turning it off stops Lanewise asking GitHub anything as it starts. Web Mode has no Updates and no such setting, so it always checks.

The two can both find a newer version in the Desktop App: the Update notice offers to install it, and the dialog says it is out. The dialog is shown because the Update notice needs signed update packages, which a Release may not have, and the dialog needs only the version.

## Considered options

- **Only the Update notice.** Left out: it is only in the Desktop App, and only for a Release with signed update packages.
- **A setting of its own.** Left out: two settings for asking GitHub at start would say the same thing.

## Hand checks

- In the Desktop App, built at an older version than the latest Release: the dialog shows as it starts, the link opens the Release in the browser, and Close dismisses it with focus going back to where it was.
- With "Check for updates when Lanewise starts" off, nothing is asked at start.
- With a screen reader: the dialog is announced with its title, and its text read in full.
