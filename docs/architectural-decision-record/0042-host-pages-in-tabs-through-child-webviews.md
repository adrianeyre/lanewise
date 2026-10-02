# Host pages in Tabs, through child webviews

The owner asked for GitHub's pages, and other Hosts', such as "Open repository" and each Pull Request, to open in a Tab of Lanewise's own beside the repositories, rather than in the browser. ADR 0041 left this out because it needed a decision of its own; this is it. It reverses `Platform.openLink`'s promise, in the Desktop App, that a Host's page never shows in Lanewise's window, and builds on ADR 0003, ADR 0040 and ADR 0041.

## A child webview for each Host page

The Hosts refuse to be framed (`X-Frame-Options`, CSP `frame-ancestors`), so an `iframe` can't show them. Each Host page is a native child webview of the main window instead, through Tauri's `Window::add_child`, which needs Tauri's `unstable` feature (`desktop/Cargo.toml`). `desktop/src/host_pages.rs` opens, moves, shows, hides, closes and navigates one, numbered by its Tab's key, and tells the UI its title, where it has gone, a new window it asked for, and its keys, on the `host-page` event.

The page lays the webview over its Tab's place, `.host-page-view`. That place is read each frame, since nothing says when something above it moves it. The page sends it in CSS pixels with its own `innerWidth`; the shell works out the zoom (Ctrl or Cmd with + or −) from the main webview's real width, since the page can't read it. A native webview is drawn over everything, so it's hidden while a menu or dialog is open, while another Tab is shown, and it stops above the Activity indicator while one shows.

## It reaches nothing

A Host page is a remote page. The default capability now names the main webview, `webviews: ["main"]`, not the window, so no capability covers a Host page, and it reaches none of Lanewise's commands; a test asks for `call`, the Update commands and the Host page commands from `https://github.com` and is refused each time. A Host page only goes to `https` pages: anything else never loads. A link it opens in a new window opens in a new Tab. Its cookies are the main webview's own store's, so signing in to GitHub there stays signed in, as in a browser.

## The keyboard

A native webview keeps focus once it has it, which would trap the keyboard (WCAG 2.1.2). Every page a Host page loads gets a script, before its own, that asks by starting a navigation to `https://lanewise.invalid/…`, which can never load: the shell refuses it, and hands focus back. F6 hands focus back to the Tab's toolbar, and Ctrl or Cmd+W closes the Tab. F6 on the toolbar, or "Go to the page", moves focus into it.

## Which links

`isHostPage` says which links open in a Tab: `https` pages on GitHub.com, GitLab.com, Bitbucket Cloud, Azure DevOps and the GitHub Enterprise Servers added in Settings. Anything else, such as a Host's documentation, opens in the browser, and so does the latest Release, to download it. Settings' "Host pages" turns it off, for the browser. Web Mode's browser won't frame a Host's pages either, so its `Platform` has no `hostPages`, and they open in a new browser tab. Host page Tabs aren't kept for the next launch.

## Considered options

- **An `iframe`.** Not possible: every Host refuses to be framed.
- **A window of its own for each Host page.** Left out: it's what the browser already does, and it isn't a Tab.
- **Reaching Lanewise from a Host page over IPC, with a capability for its origin, for its keys.** Left out: a remote page would then reach a command, and one refused navigation does the same with none.

## Hand checks

On macOS, Windows and Linux:
- Open repository and a Pull Request open in Tabs, signed in to GitHub there, and stay signed in.
- The page follows its place as the window resizes, the sidebar resizes, an Update notice shows, and at each zoom.
- It hides under the App menu and Settings.
- F6 and Ctrl or Cmd+W work in it.
- A link that opens a new window opens a new Tab.
- A screen reader reads the page and the toolbar.
