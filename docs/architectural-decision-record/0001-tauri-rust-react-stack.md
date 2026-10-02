# Tauri 2, a Rust core and a React/TypeScript UI

Lanewise is a Tauri 2 app with its Git core and graph layout in Rust and its UI in React and TypeScript, the same stack as soundcheck. We first chose Avalonia on .NET 10 and reversed that before any code was written. The same stack as soundcheck means its solved problems carry over: ad-hoc macOS signing, the Windows installer, self-update from GitHub Releases, semantic-release, CI and the Sandcastle agent image. CodeMirror 6's merge view is a stronger base for the diff and three-way conflict views, our signature feature, than AvaloniaEdit. The whole stack tests headless in the Linux sandbox agents work in.

## Consequences

- There is an IPC boundary. Large repositories must never cross it in bulk: Rust computes the graph layout and returns only the visible window, and commands page their results.
- There are three webviews: WebView2 on Windows, WKWebView on macOS and WebKitGTK on Linux/CI. Rendering is checked by hand on real machines.
