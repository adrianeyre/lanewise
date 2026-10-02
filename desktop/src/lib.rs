//! The Lanewise Desktop App: a Tauri 2 window showing the React UI in `app/`
//! (ADR 0001), carrying the command API over Tauri IPC (ADR 0003).

use lanewise_commands::{Reply, logs};
use serde_json::Value;
use tauri::{App, Builder, Manager, Runtime};

pub mod host_pages;
pub mod update;

/// The app's configuration from `tauri.conf.json`, with the UI's assets.
fn context() -> tauri::Context {
    tauri::generate_context!()
}

/// Everything the app adds to Tauri: the native dialogs the UI opens, links
/// opened in the user's browser, text copied to the clipboard, HTTP requests
/// to Model Providers made from Rust, so CORS never applies (ADR 0020),
/// Updates from the latest Release (ADR 0030), the one IPC command that
/// carries the whole command API, and the Desktop App's own Update and Host
/// page commands, which aren't the command API's: Web Mode has no Updates,
/// and opens Host pages in the browser (ADR 0042).
fn app<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    builder
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(update::Updates::default())
        .manage(host_pages::Opening::default())
        .invoke_handler(tauri::generate_handler![
            call,
            update::update_status,
            update::update_check,
            update::update_install,
            update::update_progress,
            host_pages::host_page_open,
            host_pages::host_page_bounds,
            host_pages::host_page_visible,
            host_pages::host_page_go,
            host_pages::host_page_close
        ])
}

/// Runs the command API's command `name` with `request`. Every command
/// travels through here: the UI's Tauri client in `app/src/platform/tauri.ts`
/// invokes `call`, and nothing else. It runs on a blocking thread, not the
/// main one, so a slow command never freezes the window.
#[tauri::command]
async fn call(name: String, request: Value) -> Reply {
    let command = name.clone();
    tauri::async_runtime::spawn_blocking(move || lanewise_commands::call(&command, request))
        .await
        .unwrap_or_else(|error| Reply::internal(format!("{name} stopped: {error}")))
}

/// Starts Lanewise's logs in the OS's log folder for the app: in
/// `~/Library/Logs/com.adrianeyre.lanewise` on macOS and
/// `%LOCALAPPDATA%\com.adrianeyre.lanewise\logs` on Windows. Lanewise runs
/// without them if they can't be started.
fn start_logs<R: Runtime>(app: &App<R>) {
    let Ok(folder) = app.path().app_log_dir() else {
        return;
    };
    if let Err(error) = logs::start(&folder) {
        eprintln!("Lanewise's logs couldn't be started: {error}");
        return;
    }
    log::info!(
        "Lanewise {} started on {} ({})",
        app.package_info().version,
        std::env::consts::OS,
        std::env::consts::ARCH
    );
}

/// Opens the main window, with the logs started, and runs until it closes.
pub fn run() {
    app(Builder::default())
        .setup(|app| {
            start_logs(app);
            Ok(())
        })
        .run(context())
        .expect("the Lanewise window failed to start");
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{INVOKE_KEY, mock_builder, mock_context, noop_assets};
    use tauri::webview::InvokeRequest;

    use super::{app, context};

    #[test]
    fn the_main_window_is_titled_lanewise() {
        let context = context();
        let windows = &context.config().app.windows;

        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].label, "main");
        assert_eq!(windows[0].title, "Lanewise");
    }

    /// What the UI gets back for invoking `cmd` with `body`, through the IPC
    /// of a mock window, with the app's own plugin config, which the updater
    /// won't start without.
    fn invoke(cmd: &str, body: Value) -> Result<Value, Value> {
        let url = if cfg!(windows) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        };
        invoke_from(url, cmd, body)
    }

    /// What a page at `url` gets back for invoking `cmd` with `body`, as `invoke` does for Lanewise's own.
    fn invoke_from(url: &str, cmd: &str, body: Value) -> Result<Value, Value> {
        ask(&mock_window(), url, cmd, body)
    }

    /// A mock app's main window, with the app's own plugin config, which the updater won't start without.
    fn mock_window() -> tauri::WebviewWindow<tauri::test::MockRuntime> {
        let mut mock = mock_context(noop_assets());
        mock.config_mut().plugins = context().config().plugins.clone();
        let app = app(mock_builder()).build(mock).expect("the app builds");
        tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("the window opens")
    }

    /// What a page at `url` in `window` gets back for invoking `cmd` with `body`.
    fn ask(
        window: &tauri::WebviewWindow<tauri::test::MockRuntime>,
        url: &str,
        cmd: &str,
        body: Value,
    ) -> Result<Value, Value> {
        tauri::test::get_ipc_response(
            window,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: url.parse().expect("a URL"),
                body: InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.into(),
            },
        )
        .map(|response| response.deserialize().expect("the reply is JSON"))
    }

    #[test]
    fn a_host_page_opened_twice_is_shown_by_the_second_open() {
        let window = mock_window();
        let url = if cfg!(windows) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        };
        let open = json!({
            "page": 5,
            "url": "https://github.com/adrianeyre/lanewise/pull/42",
            "bounds": { "x": 0, "y": 40, "width": 800, "height": 600, "viewport": 800 }
        });
        // As React's effects run twice, or a Tab is shown again while it opens. The mock
        // runtime makes a webview at once, so this shows both answer, not the race itself.
        let replies = std::thread::scope(|scope| {
            let both =
                [0, 1].map(|_| scope.spawn(|| ask(&window, url, "host_page_open", open.clone())));
            both.map(|each| each.join().expect("it answers"))
        });
        assert_eq!(replies, [Ok(Value::Null), Ok(Value::Null)]);
        // And again, once it's open: shown where it was.
        assert_eq!(
            ask(&window, url, "host_page_open", open.clone()),
            Ok(Value::Null)
        );
        assert_eq!(
            ask(&window, url, "host_page_close", json!({ "page": 5 })),
            Ok(Value::Null)
        );
    }

    #[test]
    fn carries_a_command_and_its_reply_over_ipc() {
        let folder = std::env::temp_dir();

        let reply = invoke(
            "call",
            json!({ "name": "openRepository", "request": { "folder": folder } }),
        )
        .expect("call always replies");

        // The request's field is `path`, so the command API itself, not
        // Tauri, turned this one down.
        assert_eq!(reply["outcome"], "rejected");
        assert_eq!(reply["rejection"]["kind"], "invalidRequest");
        assert_eq!(reply["rejection"]["name"], "openRepository");
    }

    #[test]
    fn carries_nothing_but_call() {
        // Commands are names `call` carries, never IPC commands of their own:
        // only the Desktop App's Update commands are.
        assert_eq!(
            invoke("openRepository", json!({ "path": "." })),
            Err(json!("Command openRepository not found"))
        );
    }

    #[test]
    fn a_remote_page_such_as_a_host_page_reaches_no_command() {
        for cmd in ["call", "host_page_close", "update_status"] {
            let refused = invoke_from("https://github.com", cmd, json!({ "page": 1 }));
            assert!(
                refused.is_err(),
                "{cmd} answered a remote page: {refused:?}"
            );
        }
        // Closing a Host page that isn't open does nothing, from Lanewise's own page.
        assert_eq!(
            invoke("host_page_close", json!({ "page": 1 })),
            Ok(Value::Null)
        );
    }

    #[test]
    fn tells_the_ui_its_version_and_why_it_doesnt_update_itself() {
        // The mock app is built with no updater key and wasn't installed
        // from a Release, so it says the first of those.
        let status = invoke("update_status", json!({})).expect("update_status replies");
        // The mock context's version.
        assert_eq!(status["version"], json!("0.1.0"));
        assert!(status["off"].is_string(), "{status}");
    }

    #[test]
    fn has_no_update_to_install_before_one_is_found() {
        assert_eq!(
            invoke("update_install", json!({})),
            Err(json!("There is no Update to install: check for one first."))
        );
    }

    #[test]
    fn a_copy_that_doesnt_update_itself_checks_for_nothing() {
        let said = invoke("update_check", json!({})).expect_err("it doesn't check");
        assert!(
            said.as_str()
                .is_some_and(|said| said.contains("update itself")),
            "{said}"
        );
    }
}
