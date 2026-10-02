# Gateways through the core, and authors' pictures from GitHub

Two things the owner asked for would each send something somewhere Lanewise never has: a Model Provider's requests to a gateway of the user's own choosing, with headers of its own, and each commit author's email to GitHub for their picture. PRD §11 has no telemetry, and ADR 0020 keeps the Desktop App's HTTP requests to a fixed allow-list. This ADR records how each is done without loosening either.

## A Model Provider's gateway

A gateway is an address a Model Provider's requests go to in place of its own API, such as a company's AI gateway or Vercel AI Gateway, with headers of its own, such as the gateway's key.

- **Kept by the core.** Settings keeps a gateway for a cloud Model Provider, or for Jev (ADR 0036), with `saveGateway`: its address, `https://`, or `http://` on this computer, and up to 32 headers. The core keeps it in the OS credential store, under `com.adrianeyre.lanewise.gateway`, beside the API keys. `gatewayOf` tells the UI the address and the headers' names, never their values; a header saved with no value keeps the one it had.
- **Asked through the core.** Where a gateway is kept, a Model Provider's adapter gets a `fetch` (`app/src/ai/gateway.ts`) that hands each request for `https://<its host>` to `gatewayRequest`. The core adds the request's path to the gateway's address, adds the gateway's headers over the request's, and makes it, never following a redirect, and nowhere but the gateway. The Desktop App's HTTP allow-list is as it was: the page can't reach the gateway, or anywhere else, itself.
- **No logs of it.** The Logs name the command and a failure's kind, as ADR 0028 has them; a failure to reach a gateway says what kind of failure, never its address, which can hold a key.
- **Not streamed.** Suggestions are asked for whole, so an answer comes back whole.

## Authors' pictures from GitHub

GitKraken draws each author's picture wherever their name is. So does Lanewise, for a repository with a remote on GitHub.com (`app/src/avatars/`):

- **What's sent.** For each author whose commits it draws, Lanewise asks `https://avatars.githubusercontent.com` for a 64-pixel picture: by user ID for a GitHub no-reply address, which names it, and otherwise by the email in the commit, as GitHub draws its own commits. That email is all it sends. GitHub answers an email it doesn't know with an identicon.
- **When.** Only for a repository with a remote on GitHub.com, and only while Settings' "Show authors' pictures from GitHub" is on, which it is unless it's turned off (`lanewise.avatars`, in the Cookie Policy). Off, or offline, or until a picture loads, the author's initials are drawn, as they were.
- **How.** A picture loads as an image, with no referrer, once for the run. It is drawn in the Commit graph's lanes and beside the author's name in the history and in Commit details. The commands now carry each commit's author email to do it.

## Considered options

- **Open the HTTP allow-list to any `https://` for gateways.** Rejected: it would let the page reach anywhere, which is what the allow-list is there to stop.
- **Gravatar.** Rejected: GitHub already has the pictures of the people in a GitHub repository, and Gravatar would be a second service sent emails.
- **GitHub's API for each commit's author.** Rejected: it's limited to 60 requests an hour without signing in, and a picture needs no API.
