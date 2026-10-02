//! The graph spike's canvas (issue #7, ADR 0005). Throwaway.
//!
//! One window, drawing the commit graph of `SPIKE_REPOSITORY` on a canvas
//! that only ever holds the rows on screen. Rust keeps the layout; the
//! webview asks for a window of rows at a time, over the same kind of IPC
//! call the command API uses: JSON in, a `serde_json::Value` out.
//!
//! Set by the environment (see `README.md`):
//!
//! - `SPIKE_REPOSITORY`: the repository to draw.
//! - `SPIKE_ORDER`, `SPIKE_STYLE`, `SPIKE_FORMAT`: `topo`, `straight-cut100`
//!   and `segments` unless set, as `bench` names them.
//! - `SPIKE_MODE`: `interactive` (the default), `bench`, which scrolls through
//!   scripted scenarios and writes frame times to `SPIKE_OUT`, or
//!   `screenshot`, which shows row `SPIKE_ROW` and saves the screen to
//!   `SPIKE_SCREENSHOT` with ImageMagick's `import`.

use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Serialize;
use serde_json::Value;
use spike_graph_layout::history::{self, History};
use spike_graph_layout::lanes::{Layout, Layouter, Style};
use spike_graph_layout::order::{self, Order, Ordered};
use spike_graph_layout::window::{Format, window};
use tauri::{AppHandle, State};

struct Loaded {
    repo: gix::ThreadSafeRepository,
    history: History,
    ordered: Ordered,
    layout: Layout,
    format: Format,
}

#[derive(Default)]
struct Shared(Mutex<Option<Arc<Loaded>>>);

fn env(name: &str, default: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| default.into())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    repository: String,
    order: String,
    style: String,
    format: String,
    mode: String,
    row: u32,
}

#[tauri::command]
fn config() -> Config {
    Config {
        repository: env("SPIKE_REPOSITORY", "."),
        order: env("SPIKE_ORDER", "topo"),
        style: env("SPIKE_STYLE", "straight-cut100"),
        format: env("SPIKE_FORMAT", "segments"),
        mode: env("SPIKE_MODE", "interactive"),
        row: env("SPIKE_ROW", "0").parse().unwrap_or(0),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Opened {
    rows: u32,
    load_ms: f64,
    order_ms: f64,
    layout_ms: f64,
}

/// Loads, orders and lays out the repository's whole history.
#[tauri::command]
async fn open(
    shared: State<'_, Shared>,
    repository: String,
    order: String,
    style: String,
    format: String,
) -> Result<Opened, String> {
    let order = Order::parse(&order).ok_or("no such order")?;
    let style = Style::parse(&style).ok_or("no such style")?;
    let format = Format::parse(&format).ok_or("no such format")?;
    let loaded = tauri::async_runtime::spawn_blocking(move || {
        let ms = |start: Instant| start.elapsed().as_secs_f64() * 1000.0;
        let start = Instant::now();
        let repo = gix::open(&repository).map_err(|e| e.to_string())?;
        let history = history::load(&repo, true).map_err(|e| e.to_string())?;
        let load_ms = ms(start);
        let start = Instant::now();
        let ordered = order::order(&history, order);
        let order_ms = ms(start);
        let start = Instant::now();
        let layout = Layouter::all(&ordered, style);
        let layout_ms = ms(start);
        let opened = Opened {
            rows: layout.rows() as u32,
            load_ms,
            order_ms,
            layout_ms,
        };
        let loaded = Loaded {
            repo: repo.into_sync(),
            history,
            ordered,
            layout,
            format,
        };
        Ok::<_, String>((opened, loaded))
    })
    .await
    .map_err(|e| e.to_string())??;
    *shared.0.lock().expect("not poisoned") = Some(Arc::new(loaded.1));
    Ok(loaded.0)
}

/// Rows `start..start + count`, as JSON the way the command API sends it.
#[tauri::command]
async fn rows(shared: State<'_, Shared>, start: u32, count: u32) -> Result<Value, String> {
    let loaded = shared
        .0
        .lock()
        .expect("not poisoned")
        .clone()
        .ok_or("nothing is open")?;
    tauri::async_runtime::spawn_blocking(move || {
        let repo = loaded.repo.to_thread_local();
        let window = window(
            &repo,
            &loaded.history,
            &loaded.ordered,
            &loaded.layout,
            loaded.format,
            start,
            count.min(1000),
        )
        .map_err(|e| e.to_string())?;
        serde_json::to_value(window).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The benchmark's results: written to `SPIKE_OUT`, and then the spike quits.
#[tauri::command]
fn report(app: AppHandle, text: String) -> Result<(), String> {
    match std::env::var("SPIKE_OUT") {
        Ok(path) => std::fs::write(path, &text).map_err(|e| e.to_string())?,
        Err(_) => println!("{text}"),
    }
    app.exit(0);
    Ok(())
}

/// Saves the whole screen to `SPIKE_SCREENSHOT`, and then the spike quits.
#[tauri::command]
fn screenshot(app: AppHandle) -> Result<(), String> {
    let path = std::env::var("SPIKE_SCREENSHOT").map_err(|_| "SPIKE_SCREENSHOT is not set")?;
    let status = std::process::Command::new("import")
        .args(["-window", "root", &path])
        .status()
        .map_err(|e| e.to_string())?;
    app.exit(if status.success() { 0 } else { 1 });
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(Shared::default())
        .invoke_handler(tauri::generate_handler![
            config, open, rows, report, screenshot
        ])
        .run(tauri::generate_context!())
        .expect("the spike's window failed to start");
}
