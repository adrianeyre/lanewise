//! Tauri's updater takes the `latest.json` that
//! `app/scripts/release/updater.ts manifest` writes, finds this platform's
//! update package in it, and takes nothing whose signature isn't by the
//! Update key for the version announced (ADR 0030).
//!
//! The `latest.json` served is the script's own, for stand-in packages
//! signed by a throwaway key for version 1.2.3 (in
//! `app/scripts/release/fixtures/updater/`, whose test checks the script
//! still writes it), with its URLs pointed at this machine. The updater
//! checks and downloads the package but never installs it: that, and
//! restarting into it, are hand checks (ADR 0030). Debug builds let the
//! updater use plain http, which a release build refuses.
//!
//! The page can't call the plugin's own commands, which would let it point
//! the updater at another address: only the app's `update_*` commands.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::thread;

use serde_json::json;
use tauri::WebviewWindowBuilder;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{INVOKE_KEY, get_ipc_response, mock_builder};
use tauri::webview::InvokeRequest;
use tauri_plugin_updater::UpdaterExt;

const FIXTURES: &str = "../app/scripts/release/fixtures/updater";
const THROWAWAY: &str = include_str!("../../app/scripts/release/fixtures/updater/throwaway.pub");
const OTHER: &str = include_str!("../../app/scripts/release/fixtures/updater/other-throwaway.pub");
const LATEST: &str = include_str!("../../app/scripts/release/fixtures/updater/latest.json");
/// Where the script's `latest.json` says the packages are.
const RELEASE: &str = "https://github.com/adrianeyre/lanewise/releases/download/v1.2.3";

/// The app's context. `generate_context!` embeds the Mac app's Info.plist
/// under one symbol, so a test binary may expand it only once.
fn context() -> tauri::Context<tauri::test::MockRuntime> {
    tauri::generate_context!()
}

/// Serves `latest.json`, announcing `version`, and the packages it names,
/// from this machine until the test ends; the address.
fn serve(version: &str) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let manifest = LATEST.replace(RELEASE, &address).replace(
        "\"version\": \"1.2.3\"",
        &format!("\"version\": \"{version}\""),
    );
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut request = String::new();
            let mut reader = BufReader::new(&stream);
            reader.read_line(&mut request).unwrap_or_default();
            // The rest of the request, up to the blank line.
            let mut line = String::new();
            while reader.read_line(&mut line).is_ok_and(|read| read > 2) {
                line.clear();
            }
            let path = request.split(' ').nth(1).unwrap_or("/");
            let body = if path == "/latest.json" {
                manifest.clone().into_bytes()
            } else {
                let file = path.trim_start_matches('/');
                std::fs::read(format!("{}/{FIXTURES}/{file}", env!("CARGO_MANIFEST_DIR")))
                    .unwrap_or_default()
            };
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(&body);
        }
    });
    address
}

/// What the update package for `target` is, from the fixtures.
fn package(target: &str) -> Vec<u8> {
    let file = if target.starts_with("windows") {
        "Lanewise_1.2.3_x64-setup.exe"
    } else {
        "Lanewise_1.2.3_universal.app.tar.gz"
    };
    std::fs::read(format!("{}/{FIXTURES}/{file}", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

/// Checks for an Update as a copy of this app at `running`, with the
/// committed updater config and built with `pubkey`, would as `target`, with
/// `announced` the latest Release; what the check found and, if it found
/// one, what downloaded or why not.
fn check_and_download(
    pubkey: &str,
    running: &str,
    announced: &str,
    target: &str,
) -> Option<(String, Result<Vec<u8>, String>)> {
    let address = serve(announced);
    let mut context = context();
    context.package_info_mut().version = running.parse().unwrap();
    let app = mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().pubkey(pubkey).build())
        .build(context)
        .expect("the app builds");
    let updater = app
        .updater_builder()
        .target(target)
        .endpoints(vec![format!("{address}/latest.json").parse().unwrap()])
        .unwrap()
        .build()
        .unwrap();
    tauri::async_runtime::block_on(async {
        let update = updater.check().await.expect("the check succeeds")?;
        let downloaded = update
            .download(|_, _| {}, || {})
            .await
            .map_err(|error| error.to_string());
        Some((update.version.clone(), downloaded))
    })
}

#[test]
fn a_package_signed_by_the_update_key_for_the_version_announced_downloads() {
    for target in [
        "windows-x86_64-nsis",
        "windows-x86_64",
        "darwin-aarch64-app",
        "darwin-x86_64-app",
    ] {
        let (found, downloaded) =
            check_and_download(THROWAWAY, "1.0.0", "1.2.3", target).expect("an Update");
        assert_eq!(found, "1.2.3", "{target}");
        assert_eq!(downloaded, Ok(package(target)), "{target}");
    }
}

#[test]
fn the_version_running_is_no_update() {
    assert_eq!(
        check_and_download(THROWAWAY, "1.2.3", "1.2.3", "windows-x86_64-nsis"),
        None
    );
}

#[test]
fn a_package_signed_by_another_key_is_turned_away() {
    let (_, downloaded) =
        check_and_download(OTHER, "1.0.0", "1.2.3", "darwin-aarch64-app").expect("an Update");
    assert!(
        downloaded
            .as_ref()
            .is_err_and(|error| error.contains("different key")),
        "{downloaded:?}"
    );
}

#[test]
fn a_package_signed_for_another_version_is_turned_away() {
    let (found, downloaded) =
        check_and_download(THROWAWAY, "1.0.0", "1.2.4", "windows-x86_64-nsis").expect("an Update");
    assert_eq!(found, "1.2.4");
    assert!(
        downloaded
            .as_ref()
            .is_err_and(|error| error.contains("signed for version 1.2.3")),
        "requireSignedVersion lets it through: {downloaded:?}"
    );
}

#[test]
fn the_page_cant_call_the_updaters_own_commands() {
    let app = mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context())
        .expect("the app builds");
    let window = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("the main window opens");
    for cmd in [
        "plugin:updater|check",
        "plugin:updater|download_and_install",
    ] {
        let request = InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: if cfg!(windows) {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            }
            .parse()
            .unwrap(),
            body: InvokeBody::Json(json!({ "headers": [] })),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        };
        let refused = get_ipc_response(&window, request).unwrap_err().to_string();
        assert!(refused.contains("not allowed"), "{cmd}: {refused}");
    }
}
