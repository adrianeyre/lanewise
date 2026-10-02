# Issue Trackers, Jira Cloud and Trello, read through the core with tokens in the OS credential store

The owner wanted what GitKraken has beside its branches: the user's open Issues, from Jira or Trello, with a branch made for one in a click. Neither is a Host: they store no repositories, and Git's credential helpers know nothing of them, so ADR 0016's sign-in through `git credential` doesn't apply. Both give each user an API token of their own. PRD §4 had left Jira and Trello out of v1; reading the user's Issues, and nothing more, is now in, and §4 says so. This ADR records where those tokens are kept, who makes the requests, what's read and what never is, and how the Issues Widget and Settings use them.

## Tokens are kept by the core, in the OS credential store, and never go back to the UI

Each Issue Tracker's account is kept through the `keyring` crate, as a Model Provider's API key is (ADR 0020), under the service `com.adrianeyre.lanewise.issue-tracker`, with `jira` or `trello` as the user name, as JSON:

- Jira Cloud: the site's host name, such as `your-team.atlassian.net`, the email the user signs in with, their API token and the name Jira gave them.
- Trello: the API key of a Power-Up of the user's own, its token and the name Trello gave them.

The `commands` crate carries four commands (`commands/src/issues/`):

- `issueTrackerAccount` says what's kept for an Issue Tracker, without its token or key: Jira's site and email, and the name. This is all Settings and the Issues Widget ever ask.
- `saveIssueTrackerAccount` takes the site, email and token, or the key and token, trimmed. It checks them against the Issue Tracker first, with Jira's `GET /rest/api/3/myself` or Trello's `GET /1/members/me`, and keeps them only if the Issue Tracker took them, answering with who signed in.
- `forgetIssueTrackerAccount` deletes the account, and succeeds when there was none.
- `issues` reads a page of the user's open Issues.

Unlike a Model Provider's key, which the UI reads out for the request it makes (ADR 0020), an Issue Tracker's token never leaves the core once it's saved: the core makes every request. A `Secret` prints as `Secret(hidden)`, so it can't reach a log through `Debug`, and every error's message has the token, the key and the `Authorization` value taken out before it's sent. The Logs name the command and the error's `kind` alone (ADR 0028). A credential store failure that carries what was read is said without it, as ADR 0020's are.

A Jira site is only ever a Jira Cloud site: a host name ending `.atlassian.net`, which a pasted `https://your-team.atlassian.net/jira/…` is cut down to. Anything else is `invalidSite`, and nothing is sent. Jira Server and Data Center, at a company's own address, are left for later.

## Requests are made by the core, through the Host Integrations' agent

Every request goes through the `ureq` agent the Host Integrations share (ADR 0016): it trusts the OS's certificates, takes a proxy from `HTTPS_PROXY`, gives up after 30 seconds and never follows a redirect, so a token can't be carried to a host it wasn't meant for. Nothing is added to the Desktop App window's HTTP allow-list (ADR 0020): the window makes no request to either Issue Tracker, and links to their pages open in the user's browser.

- Jira takes HTTP Basic authentication, the email and API token, at `https://{site}`.
- Trello takes the key and token in its `Authorization: OAuth oauth_consumer_key="…", oauth_token="…"` header, so neither is ever in a URL, where a proxy could log it. A key or token with anything but letters, digits, `-`, `_` and `.` in it is refused before it's sent.

A 401 or 403 is `tokenRefused`, a 429 `rateLimited`, a connection that fails `unreachable`, and anything else `trackerFailed`, with the status and the Issue Tracker's own message, at most 200 characters, and never a page of HTML.

## What's read, and what never is

Lanewise only reads, and writes nothing to either Issue Tracker:

- Jira: `GET /rest/api/3/search/jql` with `assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC` and the fields `summary`, `status` and `updated`, at most 100 a page, paged by Jira's own `nextPageToken`, which the cursor carries. A search adds `AND text ~ "…"`. What the user typed is only ever inside that JQL string, with every character JQL or its text search reads as an operator (quotes, backslashes, brackets, `+ - & | ! ^ ~ * ? : /`) left out, and at most 100 characters of it, so a search can't change what's asked.
- Trello: `GET /1/members/me/cards?filter=open` with the fields `name`, `idShort`, `shortUrl` and `dateLastActivity`: every open card the user is a member of, which Trello gives all at once. They're searched here, each word in the card's name or its `#` number, sorted most recently active first and paged by position, the cursor naming the last card sent (`commands/src/page.rs`). A card's list isn't read, since that would cost a request for each, so Trello's Issues have no status.

Each Issue has the Issue Tracker's ID, its key (Jira's, such as `PROJ-12`, or a Trello card's `#12`), its title, its status, its page and when it last changed. A page that isn't `https://` with a host, and a Jira key that isn't one, are left out, so the UI never opens anything else.

## The UI

In Settings, the Issue Trackers section has Jira Cloud's site, email and API token and Trello's API key and token, each labelled, with its note and its problem beside it as an alert, the token and key in password fields with a Show toggle and `autocomplete="off"`. Save and check sends them, and once saved it says "Signed in to your-team.atlassian.net as you@example.com", with Forget. Links go to Atlassian's API token page and Trello's Power-Up admin page, opened in the browser. What happened is announced.

The Issues Widget is in the Repository page's left column, below the Stashes Widget, in its fixed place (ADR 0032), and scrolls on its own. It shows the Issue Trackers saved, with a choice between them when there are two, a search, the Issues with their keys, titles and statuses, and Load more, which hands focus to the first Issue it added. With none saved, it says to add one in Settings. Settings tells it when an account is saved or forgotten, and it reads them again. Activating an Issue, its "…" button, a right click, Shift+F10 or the Menu key open its actions:

- Create branch for this Issue…, which opens the New branch dialog (ADR 0009) with a name made from it: its key, then its title as a lowercase ASCII slug, cut at a word to at most 50 characters, such as `PROJ-12-draw-the-lanes`, which only has characters Git allows in any ref;
- Open in browser;
- Copy key and Copy link.

## Considered options

- **Read the Issues from the webview, through the HTTP plugin, as the Model Providers are (ADR 0020).** Rejected: the token would have to be read out to the UI for each request, and each Jira site would have to be in the window's allow-list, which is fixed when the app is built.
- **OAuth apps for Atlassian and Trello.** Rejected for now: each needs an app registered by the project, with a client secret or a redirect it can't keep in a free, open-source desktop app, and the user's own API token works the same for reading.
- **Trello's key and token in the query string, as its documentation shows.** Rejected: its `Authorization` header takes them just as well, and keeps them out of URLs.

## Consequences

- The user makes their own token and, for Trello, a Power-Up of their own for its key. Settings links to both pages.
- A token kept in the OS credential store stays there when Lanewise is uninstalled, until it's forgotten in Settings or in the credential store, as ADR 0020's keys do.
- Searching Trello reads every open card on each call. An account with thousands is slow to search, but is still one request.
- The tests stand a local HTTP server in for each Issue Tracker's API, and a store in memory in for the OS credential store. They cover saving, the check before it, forgetting, paging, searching, the JQL a search makes, refused tokens, rate limits, an unreachable Issue Tracker, a redirect not followed, and that the secrets go only in the `Authorization` header to the Issue Tracker's API and are in no error. The UI's tests cover the Settings section, the Issues Widget and the branch names made from Issues, each with axe checks.
- TODO: link Issue keys in Commit Messages and branch names to their Issues; add GitHub's and GitLab's issues through their Host Integrations, and Jira Server and Data Center by their own addresses; say an Issue's status for Trello from its list.

## Still to check by hand

- Against a real Jira Cloud site: saving with a real API token, a wrong one and a site that isn't there; the Issues assigned to the user listed, searched and paged; a branch made for one.
- Against a real Trello account: saving with a Power-Up's key and a token, a refused token, and the open cards listed and searched.
- In the Desktop App on each OS: the account shows in Keychain Access, Credential Manager and Seahorse under `com.adrianeyre.lanewise.issue-tracker`, and is gone once forgotten.
- Through a proxy and a company's own certificate authority, as ADR 0016's are.
- With a screen reader (NVDA, VoiceOver): the Settings section's fields, problems and announcements, and the Issues Widget's list, menus and Load more; and all of it from the keyboard.
- In both Themes and under forced colours: the Widget's rows, their hover and focus, and the Settings section.
