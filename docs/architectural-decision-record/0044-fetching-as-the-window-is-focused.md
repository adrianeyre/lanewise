# Fetching as the window is focused

The owner asked for Lanewise to fetch the Tab shown when its window is focused again, such as by clicking it after working in another app, so the Commit graph and the Upstream's counts are up to date when they come back. It builds on ADR 0039's fetch as a Tab is shown.

## On the window's `focus`

The Toolbar's fetch (`useRemoteOperation`) listens for the window's `focus` event, which the Desktop App's webview, and a browser in Web Mode, fires as the window is focused. Only the Tab shown has a Repository page drawn, so only it fetches. It is the same fetch as the one as a Tab is shown: it follows one running instead, a repository with no remotes has nothing to fetch, it shows its progress in the Toolbar's row and it takes no focus. Settings' "Fetch when you switch to a repository's tab or come back to Lanewise" turns both off, as it is when the window is focused, not as it was when the page was drawn.

It doesn't start before the fetch as the Tab is shown has had its chance, once the Commit graph has its first window (ADR 0043), nor while a fetch, pull or push is running, nor within 30 seconds (`FOCUS_FETCH_GAP`) of the last fetch that started without being asked for, as the Tab was shown or the window focused. Moving in and out of the window, as a native dialog or a Host page's webview does, doesn't fetch over and over.

## Considered options

- **Fetching on a timer as well.** Left out, as in ADR 0039: the focus is when the user looks again.
- **No gap.** Left out: a remote would be asked for every click into the window.

## Hand checks

- In the Desktop App on macOS and Windows, with a repository whose remote has a new commit: switch to another app and click back into Lanewise's window, and the Toolbar fetches and the Commit graph shows the commit.
