# Web Mode reached only from its own page, with a fresh Access token, and never handed a key

Web Mode is `lanewise serve`: the core, run as a local server, carrying the command API over a WebSocket to the same UI in a browser (ADR 0003, PRD §7.12). ADR 0003 says it binds to `127.0.0.1` only and asks for a random token made fresh at each start. That is two lines, and the pen-testing PRD's §9 asks five questions of them before the first line of `serve/` is written: how the token is made and where it can leak, how the WebSocket checks a connection's `Origin` and refuses DNS rebinding, what a page on another site can do, which commands cross the WebSocket, and what happens with two browsers or two users on one machine. P1 (#32) reviewed the design against them, and this is the answer. Web Mode is built to it (#50).

The rule behind every answer: **whoever has the Access token is the user.** Through the command API they can open any folder the user can, read and write any repository, push with the user's Host sign-ins through `git credential`, and use their Model Provider keys. So the Access token is treated as the user's password for as long as `serve` runs, and nothing but the user's own page ever holds it.

## 1. The Access token

**How it's made.** 32 bytes from the operating system's own random source, the one `getrandom` reads, written as 43 characters of unpadded base64url: 256 bits. It's made as `serve` starts and is never written anywhere: no file, no setting, no flag, no environment variable. `lanewise serve` takes no token of the user's choosing, so none is ever typed. It is compared in constant time, and it ends when `serve` stops.

**How the browser gets it.** `serve` prints one URL, once, on standard output:

```
http://127.0.0.1:<port>/#token=<Access token>
```

The token is in the fragment. A browser never sends a URL's fragment to the server it loads, or in a `Referer`. The page reads it, keeps it in `sessionStorage`, which is this tab's and this origin's alone, and takes it out of the address bar with `history.replaceState` before it makes any other request. From then on it sends the token in one place only: the first frame of its WebSocket (§2).

**Where it can leak, and what stops it.**

| Where | What stops it |
| --- | --- |
| A `Referer` | It's never in a URL a request is made for. Every answer from `serve` also says `Referrer-Policy: no-referrer`, and links open with `noreferrer` (`app/src/platform/unavailable.ts`) |
| The browser's history | The address bar's entry has no fragment once the page has read it. Whether a browser keeps the URL as first visited, and syncs it to its own cloud, is the browser's; hand check 1. A token found there is worth nothing once `serve` stops, and opens nothing from another machine, since `serve` is only on this one's loopback |
| The Logs | `serve` never logs a URL, a request line, a header or a WebSocket frame. It logs that it started, with its port and not its URL, and each command by name and kind, as ADR 0028 says. A test holds its start line to that once it's built |
| A shell's history | It's never typed. `lanewise serve` takes no token as an argument, which `ps` would show every user, or from the environment |
| The terminal | It's printed there, once. Anyone who can read that terminal's output, its scrollback or a log of it, has it. `serve`'s help and `docs/development.md` will say so |
| The page | Never in local storage, a cookie, the page's text, an Activity or Diagnostics. Only in `sessionStorage` and the WebSocket's first frame |
| A browser extension | One allowed to read every site can read the page, and the token with it. Not something `serve` can stop. Its docs will say to use a browser profile without such extensions |

## 2. The WebSocket's `Origin`, and DNS rebinding

`serve` listens on `127.0.0.1` only, never `0.0.0.0` or `::`. Then every request, and every WebSocket handshake, passes three checks in this order, and nothing runs until all three have:

1. **`Host` is `127.0.0.1:<port>` or `localhost:<port>`.** Any port, because an SSH tunnel's local end can be on another port than `serve`. Anything else is refused with `403`, before anything else is read. **This is what refuses DNS rebinding:** a page whose own name has been made to point at `127.0.0.1` still sends that name in `Host`.
2. **For a handshake, `Origin` is there and is exactly `http://` and that `Host`.** Anything else, or none, is refused with `403`, and the connection is never upgraded. This refuses every other site, and every other server on this computer's loopback, which has an origin of its own by its port.
3. **The handshake's first frame is the Access token.** `serve` reads nothing else, and answers nothing, until it has it, for a few seconds at most, and then closes the connection on anything else. Not in the WebSocket's URL, where a proxy's log would keep it.

**No cookie, and no HTTP authentication.** Nothing a browser sends by itself ever counts. A cookie doesn't tell ports apart: one set by `serve` would be sent with a request from any page on any port of `127.0.0.1`, `SameSite=Strict` included, since the port isn't part of a site. P1 showed it in WebKitGTK (`docs/pen-test/P1.md`, probe 2). The Access token is only ever sent by the page's own script.

All three are needed. In P1's run, a page at a name that resolved to `127.0.0.1` sent an `Origin` exactly matching its `Host`, so check 2 alone let it through; check 1 refused it. And a process of another user on this computer can send any `Host` and `Origin` it likes, so checks 1 and 2 alone let it through; check 3 refuses it.

## 3. A page on another site

It can try. The browser sends that site's `Origin` with the handshake, `serve` refuses it at check 2, and the page sees the WebSocket close with code 1006 and learns nothing else. Even if it could send the right `Origin`, it would have no Access token, which no browser sends by itself. `serve` never sends a CORS header, so the page can't read any answer through `fetch` either. It can load the UI's own scripts as scripts, which hold nothing the public repository doesn't. It can tell that something answers on the port, which is all there is to learn.

`serve` also sends every page with `frame-ancestors 'none'` and `X-Frame-Options: DENY`, so no site can frame the UI, and `Cross-Origin-Opener-Policy: same-origin`.

## 4. The commands over the WebSocket

**Every command the command API has crosses, but one: `modelProviderKey`.** The server refuses it as an unknown command. `serve/tests/design.rs` holds this table to `lanewise_commands::NAMES`, so a new command fails the test until it has a row here.

| Commands | Over the WebSocket | Why |
| --- | --- | --- |
| `checkGitSetup`, `openRepository`, `fileStatus`, `commitHistory`, `graphWindow`, `graphRowOf`, `commitDetails`, `commitChanges`, `commitFileDiff` | Crosses | Repositories and their history, as in the Desktop App |
| `stageFiles`, `unstageFiles`, `stageHunk`, `unstageHunk`, `commit`, `lastCommit`, `workingTreeFileDiff`, `workingTreeChanges` | Crosses | The working tree |
| `branches`, `createBranch`, `renameBranch`, `deleteBranch`, `checkOut`, `createTag`, `deleteTag`, `renameTag`, `rewordCommit`, `cherryPick`, `revertCommit`, `previewReset`, `reset` | Crosses | Branches, tags and commit actions |
| `addRemote`, `renameRemote`, `setRemoteUrl`, `removeRemote`, `setUpstream` | Crosses | Remotes. `branches` hides credentials in a remote's URL, as it does for the Desktop App |
| `previewMerge`, `merge`, `mergeInProgress`, `abortMerge`, `stashes`, `createStash`, `applyStash`, `popStash`, `dropStash`, `stashChanges`, `stashFileDiff`, `stashApplyInProgress` | Crosses | Merges and Stashes |
| `startClone`, `cloneProgress`, `cancelClone`, `startFetch`, `startPull`, `startPush`, `deleteRemoteBranch`, `remoteProgress`, `cancelRemote`, `remoteOperation` | Crosses | Clones, fetches, pulls and pushes, run by the core's `git` with the user's own Git Setup |
| `rebaseInProgress`, `abortRebase`, `operationInProgress`, `continueOperation`, `skipCommit`, `abortOperation`, `markResolved`, `markUnresolved`, `conflictedFile`, `resolveConflict`, `resolveWholeFile` | Crosses | In-Progress Operations and their conflicts |
| `detectHost`, `signInToHost`, `hostRepositories`, `hostOwners`, `pullRequests` | Crosses | Host Integrations. The Host's token stays in the core (ADR 0016) |
| `issueTrackerAccount`, `saveIssueTrackerAccount`, `forgetIssueTrackerAccount`, `issues` | Crosses | Issue Trackers. The Issue Tracker's token goes in once, to be kept, and never comes back (ADR 0038) |
| `gatewayOf`, `saveGateway`, `forgetGateway`, `gatewayRequest` | Crosses | Gateways. Their headers' values go in once, to be kept, and never come back (ADR 0035) |
| `modelProviderKeyStored`, `saveModelProviderKey`, `forgetModelProviderKey` | Crosses | A key goes in once, to be kept, and never comes back |
| `writeLog`, `diagnostics` | Crosses | The Logs and Diagnostics (ADR 0028) |
| `modelProviderKey` | Doesn't cross | It hands the page a Model Provider's or Jev's key. In Web Mode the page is a tab in the user's everyday browser, with its extensions, so the key stays in the core (below) |

**Model Providers' and Jev's requests are made by the core, with the key added there.** The browser can't make them itself, since CORS would stop it (ADR 0020). So Web Mode's `Platform.fetch` sends each request over the WebSocket as a command of its own, as `gatewayRequest` does, and the core makes it:

- only to a URL on the same list the Desktop App's HTTP allow-list has, one list shared by both shells and held by one test (ADR 0020, ADR 0051);
- following no redirect;
- with the key for the Model Provider it's for read from the credential store just then, and put in that Model Provider's own header (`x-api-key`, `x-goog-api-key` or `authorization`), in place of whatever the page put there;
- and with its answer handed back without the key.

The page asks with no key, so the adapters (ADR 0022 to ADR 0024) and Jev (ADR 0036) run as they are, on a `fetch` that doesn't need one. That command, and the in-app folder chooser that stands in for the native dialog (PRD §7.12), are added to this table, with a row each, when they're built.

**The Desktop App's own commands have no counterpart.** Its Update commands and Host page commands (`desktop/src/lib.rs`) aren't the command API's. Web Mode has no Updates, and opens Host pages in the browser (`Platform.updater` and `Platform.hostPages` are `null`).

## 5. Two browsers, and two users on one machine

**Two browsers, or two tabs, of the same user.** Each is given the URL, so each has the same Access token, and each is an equal connection. Neither has anything of its own in the core, which is shared: so a clone, fetch, pull or push one starts is seen by the other through its long poll (ADR 0007, ADR 0012, ADR 0013), and `git`'s own locks keep two writes to a repository from interleaving. Undo is each page's own, and takes an action back only while the repository is as it left it (ADR 0045), so one page never undoes over the other's later change. Settings are each browser's own, in its local storage for `serve`'s origin.

**Two users.** `127.0.0.1` is shared by every user on the machine, so any of them can connect to the port, and only the Access token stands between them. So:

- each user's `serve` has its own token, and one opens nothing on another's;
- the token is never somewhere another user can read it: not a command line, which `ps` shows them, not a file, and not the Logs, which are in the user's own folder (S3);
- `serve` listens on a fixed default port, which `--port` changes, so that the UI's Settings, kept per origin, last from one start to the next. If the port is taken, `serve` says so and stops, rather than move to another one quietly. Another user can take the port first and serve a page that looks like Lanewise. A token sent to it is useless, since none is valid while the user's own `serve` isn't running, and the URL `serve` prints is the only one to trust. Its docs will say so;
- whatever later serves the same origin, another user's server included, can read what the UI keeps in that origin's local storage: Settings and Recent Repositories. They hold no secret: a key is never kept there (`app/src/settings/ModelProviderSettings.test.tsx`), and the token never is.

The same holds at both ends of an SSH tunnel: on the machine `serve` runs on, and on the one whose `ssh -L` listens on its own loopback.

## What else `serve` serves

The UI's build, compiled into the binary, so no URL path ever names a file on disk: `GET` and `HEAD` only, and no listing. Every answer carries the headers above, `X-Content-Type-Options: nosniff`, and the main webview's policy (ADR 0050), with two changes: `connect-src` names `serve`'s own `ws://` origin, as the `Host` that passed check 1 gives it, in place of IPC, and `serve` puts the hash of `index.html`'s theme script in `script-src`, and a fresh style nonce in each page, as Tauri does for the Desktop App. Plain `http`, on loopback only: PRD §11's TLS doesn't reach it, as it doesn't reach a local Model Provider (ADR 0051), and an SSH tunnel encrypts the leg between machines.

## Considered options

- **The token in the URL's query, as Jupyter does.** Left out: the query is sent with every request, lands in any log of request lines, and goes in a `Referer` to the same origin. P1's run showed a fragment sent nowhere.
- **A cookie after the first visit.** Left out: a cookie doesn't tell ports apart, so every server on `127.0.0.1` would be sent it, and a page on any of them would be let in (`docs/pen-test/P1.md`, probe 2).
- **The token in `Sec-WebSocket-Protocol`.** Workable, but it's a header, which proxies and servers log. The first frame is the page's own.
- **A new random port at each start.** Left out: Settings, kept per origin, would be lost at every start, and a port is no secret, since it can be found by trying each.
- **A Unix socket or a named pipe, whose file permissions keep other users out.** Left out: no browser can open one.
- **An `Origin` check with no token.** Left out: another user's process sends any `Origin` it likes.
- **`modelProviderKey` over the WebSocket, as over IPC.** Left out: the key would sit in a tab of the user's everyday browser, where its extensions can read the page. The Desktop App's webview has none, and its key outlives no request (S1).
- **A forwarding endpoint of its own, at an HTTP path beside the WebSocket**, as ADR 0020 first had it. Left out: a second way in, with its own checks to get right. Carried over the WebSocket, it passes the same three.

## Consequences

- P1's first line of `serve/` is held to this: each check in §2 and each header has a test, against a stand-in browser's requests, as it's built (#50).
- The core gains a command that makes a Model Provider's request with its key, and a list of the Model Providers' URLs that both shells share. A new cloud Model Provider adds its host there once.
- The Desktop App keeps `modelProviderKey` as it is (ADR 0020).
- ADR 0003's per-start token is this ADR's Access token. ADR 0020's forwarding by `serve` is §4's command over the WebSocket.

## Look again

When Web Mode is built (#50); when a command is added, which `serve/tests/design.rs` asks for; when the browsers Lanewise supports all ask before a public site reaches this computer's network (Chrome's Local Network Access), which would stand in front of check 2; and at the next Pen-test round.

## Hand checks, once Web Mode is built

On macOS and Windows, in a disposable account (the rules of engagement, §3), in each of Chrome, Firefox and Safari or Edge:

1. Start `lanewise serve`, open the URL it prints, and use Lanewise for a minute. Open the browser's history. Note whether any entry holds `#token=`, and whether the browser syncs history. Stop `serve`, start it again, and open the old URL: the page asks for the new one.
2. With `serve` running, open any `https` page in the same browser, and in its console run `new WebSocket("ws://127.0.0.1:<port>/")`. It closes with code 1006, and `serve` runs nothing.
3. Sign in to a second, disposable user account on the same machine. From it, run `ps aux` and check that no line holds the token. Then run `curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" -H "Origin: http://127.0.0.1:<port>" http://127.0.0.1:<port>/`, which sends every check but the token. `serve` upgrades the connection, then closes it within a few seconds, and runs nothing.
4. Read the Logs `serve` wrote. No line holds the token or a URL.
