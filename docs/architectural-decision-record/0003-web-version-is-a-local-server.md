# The web version is a local server, not a static site

Lanewise's web version is `lanewise serve`: the same Rust core, running as a local server on the machine that has the repositories, serving the same React build to a browser. soundcheck's browser version is a static GitHub Pages site, and we deliberately didn't copy it. A page can't run `git`, GCM or SSH, and github.com's Git endpoints send no CORS headers. A static site would therefore need a second Git engine in JavaScript, a CORS proxy we'd have to run, and keys in local storage on the shared `lanewise.adrianeyre.co.uk` origin, and it would still be a weaker product. The local server keeps one Git implementation and every feature.

## Consequences

- Every UI↔core command goes through one transport-agnostic API, carried by Tauri IPC in the desktop app and a WebSocket in `serve`. This is designed in M0 even though `serve` ships at P1.
- The server binds to `127.0.0.1` only and requires a random per-start access token in the URL. Without it, any website the user visits could send it Git commands.
- There is no zero-install "try it in the browser" link.
