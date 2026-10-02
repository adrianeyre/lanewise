# Local rolling logs and Copy diagnostics, with no telemetry

PRD §11 rules out telemetry in v1, even opt-in. Lanewise writes local rolling log files instead, and Copy diagnostics fills in the bug-report issue template. This ADR records how the Logs are written (`commands/src/logs.rs`), what they never hold, and how Copy diagnostics puts them in a bug report the user sends themselves (`commands/src/diagnostics.rs`, `app/src/diagnostics/`, `app/src/settings/DiagnosticsSettings.tsx`).

## The Logs are written by the `commands` crate, in rolling files

Both shells share the command API (ADR 0003), so the Logs are kept there too, behind the `log` facade. The shell calls `logs::start` with its OS's log folder, and from then on anything Lanewise's crates log goes to `lanewise.log` in it. The Desktop App finds that folder with Tauri's `app_log_dir`: `~/Library/Logs/com.adrianeyre.lanewise` on macOS and `%LOCALAPPDATA%\com.adrianeyre.lanewise\logs` on Windows. Web Mode will call `logs::start` as well once it's built. The UI's own lines reach the Logs through the `writeLog` command, under the `lanewise_ui` target.

Before a line would take `lanewise.log` past 1 MiB, the file is rolled over. It becomes `lanewise.1.log`, the older files move up one, and anything past `lanewise.3.log` is removed. The Logs therefore never take more than about 4 MiB. Each line has the time in UTC to the second, the level and where it came from. A line is written at once, one at a time, behind a lock, so nothing is lost to a buffer when the app stops. The logger was written by hand rather than taken from a crate: all it needs is this, and a hand-written one keeps every line going through the redaction below.

Only `info` and above are kept. What's logged is:

- the Desktop App's start and version;
- the Git Setup, by its versions and kinds;
- each command that fails or is rejected;
- each panic;
- each error or rejected promise the UI didn't catch;
- each Suggestion that failed.

## What's logged can't hold a secret, and a redactor hides what might

The Logs never hold credentials, API keys, file contents or prompts. This is ensured first by what's logged, not by trying to find those things in it:

- `call` logs a failed command by its name and its error's `kind`. It never logs the request, the response or the error's message, which could quote a file or a remote's URL.
- A request that's rejected as malformed is logged as such, without serde's message, which quotes the field it didn't expect.
- An `internal` rejection, a bug in Lanewise, keeps its message, since without it the bug can't be found.
- The Git Setup is logged by the Git version and the kind of each finding, not by paths or credential helpers.
- A failed Suggestion is logged by its Model Provider and its failure's `kind`, never by its message, which a Model Provider's error could fill with the prompt.
- An error the UI didn't catch is logged by its name and stack frames. Its message is dropped, whether the stack starts with it (V8) or not (WebKit).

Only records whose target is Lanewise's own (`lanewise` or `lanewise_…`) are kept. A dependency's could log a request with its headers.

Every line then goes through `logs::redact` twice: as it's written and as it's read back for Copy diagnostics. It does four things:

- It hides a URL's user and password with `hide_credentials`, the core's function for remotes.
- It replaces anything shaped like a Model Provider's or Host's key or token with `***`. This covers the prefixes `sk-`, `sk-ant-`, `xai-`, `AIza`, `gh…_`, `github_pat_` and `glpat-`.
- It does the same for any value after `Bearer` or `Basic`, and after a name such as `api_key`, `token`, `password` or `authorization`.
- It keeps each record to one line of at most 2,000 characters.

## Copy diagnostics fills in a bug report the user sends

Settings has a Diagnostics section. It says Lanewise sends nothing about how it's used, and has a Copy diagnostics button. That button asks the core's `diagnostics` command for:

- the operating system, its version and the processor, from `os_info`;
- the Git version the Git Setup check found;
- `git credential-manager --version`, and whether Git Credential Manager is one of Git's credential helpers;
- the folder the Logs are in;
- the latest 50 lines of the Logs, read back from `lanewise.log` and `lanewise.1.log`.

The UI adds the Lanewise version and copies the text through the Platform's `copyText`. The Desktop App uses Tauri's clipboard plugin for this, since WebKit's clipboard can refuse once a click's handler has awaited. It then opens the bug-report form, `.github/ISSUE_TEMPLATE/bug-report.yml` on `adrianeyre/lanewise`, in the user's browser with its `diagnostics` field filled in. GitHub prefills an issue form's field from a query parameter named after its `id`. The link is kept to 8,000 characters by dropping the oldest log lines. The copy on the clipboard keeps all 50, so a report that lost some can still be pasted in whole.

Nothing is sent: the user reads the form in their browser, takes out what they'd rather not share, and submits it or doesn't. The log folder is shown in Settings, so the whole Logs can be attached, but it isn't copied, since it names the user's home folder.

## There's no telemetry, and a test holds the window to its allow-list

The UI reaches the network only through the Platform's `fetch`, which in the Desktop App is Tauri's HTTP plugin. That plugin only allows URLs in `desktop/capabilities/default.json`, so the test `app/src/platform/allowList.test.ts` checks that list against the code. It must hold exactly:

- each cloud Model Provider's API, from the adapters' own hosts;
- the model catalog's URL (ADR 0021);
- `localhost` and `127.0.0.1`, for a Model Provider on this computer (ADR 0020).

The test also checks that the window has no other HTTP, WebSocket, upload, updater, log or analytics permission. The Cookie Policy says there is no telemetry of any kind, and what the Logs hold.

## Consequences

- A bug that only shows in a request's contents or an error's message can't be seen in the Logs. The reporter has to describe it, or share what they choose to.
- An `internal` rejection's message, and a panic's, can still name a path on the user's machine. They're rare, and the user reads the bug report before sending it.
- The redactor goes by shapes, so a secret of a shape it doesn't know, in a line that isn't one of the kinds above, would be kept. What's logged is chosen so no such line is written. The redactor is a second line of defence.
- `writeLog` lets the UI write any text to the Logs. Its callers pass kinds, names and stack frames, and the redactor still reads what they send.

## Still to check by hand

- In the Desktop App on macOS and Windows: the Logs appear in the folder named above and roll over. Copy diagnostics puts the text on the clipboard, opens the bug-report form in the browser with Diagnostics filled in, and the form shows as the template has it once it's on `main`.
- Running `pnpm desktop:dev` and triggering a failed command: its line appears in the Logs with only its name and kind.
