# A Model Provider on this computer reached only at its API's two paths

The main webview makes its requests through Tauri's HTTP plugin, from Rust, to the URLs its capability allows (ADR 0020). For a Model Provider the user runs on this computer, such as Ollama, LM Studio or llama.cpp's `llama-server`, that list had `http://localhost:*` and `http://127.0.0.1:*`: every port and every path. A request made that way has no CORS and takes any method and body. So the list let the page reach every HTTP server on this computer, not just a Model Provider: a container engine's API, a dev server or a database's admin page. The pen-testing PRD's H4 asked what a script in the main webview could do through those two entries, and whether they could be narrowed to the Model Providers' own paths. W3 (#16) probed it, and this is the answer: they can, and now are, as defence in depth.

## The entries

In `desktop/capabilities/default.json`, in place of the two:

| Entry | For |
| --- | --- |
| `http://localhost:*/models` and `http://localhost:*/*/models` | The list of models, at a base URL with no path or with one |
| `http://localhost:*/chat/completions` and `http://localhost:*/*/chat/completions` | A Suggestion |
| The same four for `http://127.0.0.1:*` | The same server, named by its address |

These are the only two paths the OpenAI-compatible adapter asks a local server for (ADR 0024). The `openai` SDK puts `/models` or `/chat/completions` after the base URL Settings gives it, and `openAiCompatible.test.ts` holds each request to its URL. The port, and the path in front, stay open, because both are the user's to choose: Ollama is at `http://localhost:11434/v1`, LM Studio at `http://localhost:1234/v1` and `llama-server` at `http://localhost:8080/v1`, and a server behind a proxy of the user's own can be at any path. `localBaseUrl` (`app/src/ai/aiSettings.ts`) already turns down anything that isn't plain `http` to `localhost` or `127.0.0.1` with a port.

The plugin treats `*` in a path as anything, slashes included, and reads a path after the URL parser has resolved its `.` and `..` segments. A query or fragment is matched separately from the path. So `/v1/models` and `/api/openai/v1/chat/completions` are allowed, and `/`, `/api/pull`, `/v1/models/a-model`, `/v1/models/../../api/pull` and `/containers/json?at=/models` are not. `the_windows_http_requests_reach_only_its_allow_list` in `desktop/src/lib.rs` holds the whole list to this through the plugin's own check, against the app's own capability in Tauri's mock runtime. `app/src/platform/allowList.test.ts` holds the capability to the list.

## What it changes, and what it doesn't

- **No other server on this computer is reached through the plugin**, unless one of its own paths ends in `/models` or `/chat/completions`. Run headless on Linux, a request to any other path on a local port was refused by the plugin before anything was sent. The adapter's two paths were still answered.
- **It doesn't change the cloud Model Providers' entries.** Each is its API's host, every path on it, over `https` at its own port. A request there can only go to that Model Provider.
- **It doesn't cover the core's own requests.** Hosts, Issue Trackers and Gateways are asked by the core, not the page, and a Gateway on this computer is W4's (#17).
- **It doesn't cover Web Mode**, which will make its Model Provider requests some other way (PRD §9, P1, #32).

## Considered options

- **Leave the two entries as they were.** Left out: the page doesn't need every local server, and nothing stood behind the entries if a script ever ran in it (ADR 0050).
- **An entry for each known server's port: 11434, 1234 and 8080.** Left out: it breaks a server on any other port, which Settings lets the user choose, and still allows every path on those three.
- **Add the base URL from Settings to the scope as it's saved.** Left out: Tauri fixes a capability's scope when the app is built. Changing it at run time would need a command the page can call, which would let a script in the page widen it too.
- **Make a local Model Provider's requests in the core, as a Gateway's are (ADR 0035).** The bigger change. Left out for now: the adapter, its SDK and its tests would all change, for the same two paths.

## Consequences

- A new local endpoint the UI asks for, such as Ollama's own `/api/` routes, needs its own entries here, in `allowList.test.ts` and in `the_windows_http_requests_reach_only_its_allow_list`. A new adapter for a local server with other paths does too.
- ADR 0020's and ADR 0024's "on any port" now means any port, at these paths.

## Look again

When a local Model Provider needs a path other than these two, when Web Mode is built, and at the next Pen-test round.

## Hand checks

On a Release, on macOS and Windows, each in the disposable account of the rules of engagement:

1. Install Ollama, pull a small model, and leave Settings' base URL for the local Model Provider as it is (`http://localhost:11434/v1`). Its models are listed, and a Suggestion for E1's `conflict-merge` fixture comes back.
2. Run LM Studio's server instead, set the base URL to `http://localhost:1234/v1`, and do the same.
3. Set the base URL to `http://127.0.0.1:11434/v1` with Ollama running. The models are listed.
