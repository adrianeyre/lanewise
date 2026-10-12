# A Content-Security-Policy for the main webview, and only the core permissions it uses

The main webview holds every command the command API has, through the one IPC command `call` (ADR 0003), and until now it had no Content-Security-Policy (`"csp": null` in `desktop/tauri.conf.json`). The UI renders no HTML it didn't write: React draws every name, message and path as text, and CodeMirror draws diffs and Conflict Hunks as text. So no way for a script to get in was known. But nothing stood behind that if it ever failed. The pen-testing PRD's H1 asked for a CSP, or a dated decision not to have one (§5, §10.4). W1 (#14) probed it, and this is the answer: a CSP, as defence in depth, and a capability narrowed to what the page uses.

## The policy

`app.security.csp` in `desktop/tauri.conf.json`:

| Directive | Sources | Why |
| --- | --- | --- |
| `default-src` | `'self'` | Anything not named below comes from the app's own assets, or nowhere |
| `script-src` | `'self'` | Only the scripts the build made. No `eval`, no inline script, no event handler written into markup |
| `style-src` | `'self'` | The stylesheet the build made, and CodeMirror's `<style>` element by a nonce (below) |
| `img-src` | `'self'`, `https://avatars.githubusercontent.com` | The app's own images, and authors' pictures from GitHub while Settings allows them (ADR 0035) |
| `connect-src` | `ipc:`, `http://ipc.localhost` | Tauri's IPC alone, the second form on Windows. Every request the UI makes, to a Model Provider, Jev, the Model catalog or GitHub's `package.json`, goes through the HTTP plugin over IPC and keeps to its allow-list (ADR 0020) |
| `object-src`, `frame-src`, `worker-src` | `'none'` | The page embeds nothing, frames nothing and starts no worker. Host pages are child webviews, not frames (ADR 0042) |
| `base-uri`, `form-action`, `frame-ancestors` | `'none'` | No `<base>` can move where relative URLs go, no form posts anywhere, and nothing frames the page |

`'unsafe-inline'`, `'unsafe-eval'`, `data:`, `blob:` and wildcards appear nowhere. `app/src/platform/csp.test.ts` holds the policy to this table, and `the_main_webview_has_a_content_security_policy` in `desktop/src/lib.rs` holds the compiled context to it.

### The theme script, by its hash

`app/index.html` has one inline script, which sets the saved Theme and palette before the first paint. When a CSP is set, Tauri works out the hash of each inline script in the page as it builds and adds it to `script-src`, so this script runs and nothing else inline does. It stays inline: an external script would load after a flash of the wrong Theme. The test checks it is still the page's only inline script.

### CodeMirror's styles, by a nonce

CodeMirror writes its themes into a `<style>` element, which `style-src 'self'` alone refuses. `app/index.html` has a `<meta name="lanewise-style-nonce">` holding Tauri's style nonce placeholder. Each time Tauri serves the page, it puts a fresh random nonce there and adds the same nonce to `style-src`. `app/src/ui/styleNonce.ts` reads it, and every CodeMirror editor is given it through `EditorView.cspNonce`. That covers the diff editor and the Three-way view and Resolution editors. The placeholder stays where nothing replaces it, in a test or `pnpm dev`, and is then ignored. That's safe because those have no policy.

## Only the core permissions the page uses

The capability in `desktop/capabilities/default.json` gave the page `core:default`. That is every default permission of Tauri's core: menus, tray icons, images, paths, app details, window and webview details and emitting events. The page uses only two: listening for, and no longer listening for, the shell's events, such as a Host page's news. It now has `core:event:allow-listen` and `core:event:allow-unlisten` in place of `core:default`, besides the permissions it already named: the Theme in the title bar, zooming, the folder dialog, the clipboard, the HTTP allow-list and the opener. `csp.test.ts` holds the core permissions to that list.

## What it changes, and what it doesn't

- **It doesn't change what `call` can do.** A script that runs in the page still has the whole command API, because the UI needs it. The policy only makes it much harder for a script to get to run. Whether a command should check more for itself is for the scope issues that own each one: S1 (#22) for keys crossing IPC, W4 (#17) for Gateways.
- **It doesn't govern Host pages.** Each Host page is a remote page in a child webview with its own origin and no capability (ADR 0042). W2 (#15) probes those.
- **It doesn't replace the HTTP allow-list.** The plugin's scope is still the list Model Provider requests keep to. The policy covers what the page's own `<img>`, `fetch`, stylesheet and beacon could do, which the plugin doesn't see. W3 (#16) owns whether `SECURITY.md`'s wording for the allow-list should now name both.
- **It applies to a build, not to development.** Tauri sends the policy with each asset it serves from the build. `pnpm desktop:dev` loads the UI from Vite's dev server, and `pnpm dev` is a plain browser tab, so neither has it. Something that works there can still be refused in a release build. `docs/development.md` says how to check one.

## Look again

The policy holds while three things stay true: the page loads nothing from anywhere but its own assets, GitHub's avatars and IPC; it has one inline script; and Web Mode isn't built. Look at it again when any of them changes:

- **A new origin the page loads from**, such as a font or picture service, goes into the policy and `csp.test.ts` in the same change, or the release build refuses it.
- **Web Mode** serves the same `index.html` from `serve/`. Before P1 (#32) ships, its server sends its own policy, makes the style nonce fresh for each page, and answers the PRD's §9 design review.
- **At the next Pen-test round**, and by **12 April 2027** at the latest, whichever comes first.

## Considered options

- **No CSP, with a dated decision.** H1 allowed it. Left out: the policy cost one config entry, a nonce and two tests. Run headless in WebKitGTK, the build's own pages raised no violation, and every way the round tried to run or send something from injected markup was refused.
- **`style-src 'unsafe-inline'`.** Simpler than the nonce. Left out: it would let injected markup restyle the page, such as hiding or covering part of a Suggestion. The nonce costs one line per editor.
- **The theme script as a file of its own.** No hash needed. Left out: it would load after the first paint, with a flash of the wrong Theme, and Tauri works out the hash anyway.
- **Tauri's isolation pattern**, which checks every IPC message in a sandboxed frame before the core gets it. Left out for now: a check there would have to tell the UI's own calls from a script's, which it can't, since both come from the same page. It adds a frame and a key exchange to every command.
- **Moving the commands that hand out secrets out of the main webview's reach.** The bigger change, and the one that would shrink what `call` can do. Left for S1 (#22), which owns keys crossing IPC.

## Consequences

- A release build refuses anything the page loads that the policy doesn't name. A UI change that loads something new has to update the policy and its test, and be checked in a release build.
- `CLAUDE.md` and `CONTRIBUTING.md` say so beside the allow-list rule.

## Hand checks

On a Release, on macOS (WKWebView) and Windows (WebView2), each in the disposable account of the rules of engagement:

1. Open Lanewise. The Welcome screen draws in the saved Theme with no flash of the other, and Settings → Theme switches it.
2. Open a repository, select a commit, and open a file's diff in both the Split view and the unified view. Each draws with its colours and highlighting.
3. Open a repository with a merge left in conflict, such as E1's `conflict-merge` fixture. The Three-way view and the Resolution editor draw with their line numbers and marks.
4. With Settings → "Pictures from GitHub" on, a repository with a GitHub remote shows authors' pictures.
5. Open a Host page Tab, go Back and Forward, and close it. Copy diagnostics, open the folder dialog, zoom with Ctrl or Cmd and + or -, and ask for a Suggestion with a throwaway key. Each works as before.
6. If anything in steps 1 to 5 doesn't draw or work, attach the webview's console (Safari's Develop menu for macOS, `edge://inspect` for Windows, on a debug build) and look for a message naming `Content-Security-Policy`.
