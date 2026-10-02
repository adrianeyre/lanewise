//! Host pages: a page on a Host, such as a repository or a Pull Request on
//! GitHub, shown in a Tab of Lanewise's own (ADR 0042). The Hosts refuse to
//! be framed, so each is a native child webview of the main window, laid
//! over the Tab's place in the page, which the UI measures and sends here as
//! it moves. A Host page is a remote page: no capability names its webview,
//! so it can't reach Lanewise's commands, and it only ever goes to `https`
//! pages. A link it opens in a new window becomes a new Tab.

use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{
    Emitter, EventTarget, LogicalPosition, LogicalSize, Manager, Runtime, State, Url, Webview,
    WebviewBuilder, WebviewUrl, Window,
};

/// The event the UI hears each Host page's news by.
pub const EVENT: &str = "host-page";

/// The page the main window's webview shows the UI in.
const MAIN: &str = "main";

/// Where a Host page's key press asks to go back to Lanewise: never loaded,
/// since `.invalid` can't be a real host, only seen by the navigation
/// handler. `focus` hands focus back to the Tab; `close` closes it.
const ASK: &str = "lanewise.invalid";

/// Run on every page a Host page loads, before the page's own scripts: F6
/// hands focus back to Lanewise, so the keyboard is never trapped in the
/// page, and Ctrl or Cmd+W closes its Tab, as in a browser. The page can't
/// call Lanewise, so it asks by starting a navigation that's refused.
const KEYS: &str = r#"
window.addEventListener("keydown", (event) => {
  const close = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "w";
  if (event.key !== "F6" && !close) return;
  event.preventDefault();
  event.stopPropagation();
  window.location.href = "https://lanewise.invalid/" + (close ? "close" : "focus");
}, true);
"#;

/// Where a Host page is, in the main window, in CSS pixels as the UI measures them.
#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// The page's own width, `innerWidth`, in the same CSS pixels: with the
    /// main webview's width, how zoomed the UI is, as Ctrl or Cmd and + or
    /// - zoom it, which the page can't read itself.
    pub viewport: f64,
}

impl Bounds {
    /// Where the Host page goes, in the window's logical pixels, with the UI
    /// `logical_width` wide in them.
    fn placed(&self, logical_width: f64) -> (LogicalPosition<f64>, LogicalSize<f64>) {
        let zoom = if self.viewport > 0.0 && logical_width > 0.0 {
            logical_width / self.viewport
        } else {
            1.0
        };
        (
            LogicalPosition::new(self.x * zoom, self.y * zoom),
            LogicalSize::new((self.width * zoom).max(1.0), (self.height * zoom).max(1.0)),
        )
    }
}

/// `bounds` in `window`'s logical pixels, as the main webview's width says the UI is zoomed.
fn place<R: Runtime>(
    window: &Window<R>,
    bounds: &Bounds,
) -> (LogicalPosition<f64>, LogicalSize<f64>) {
    let width = window
        .get_webview(MAIN)
        .and_then(|main| main.size().ok())
        .zip(window.scale_factor().ok())
        .map_or(0.0, |(size, scale)| f64::from(size.width) / scale);
    bounds.placed(width)
}

/// What a Host page tells the UI.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum HostPageNews {
    /// It started loading `url`, or finished.
    Loading { page: u32, url: String, done: bool },
    /// Its page's title changed.
    Title { page: u32, title: String },
    /// It asked to open `url` in a new window: the UI opens it in a new Tab.
    NewTab { page: u32, url: String },
    /// Its F6 asked to hand focus back to its Tab.
    Focus { page: u32 },
    /// Its Ctrl or Cmd+W asked to close its Tab.
    Close { page: u32 },
}

/// The label of Host page `page`'s webview.
fn label(page: u32) -> String {
    format!("host-page-{page}")
}

/// `url`, if a Host page may show it: `https`, and not the address its keys ask by.
fn https(url: &str) -> Result<Url, String> {
    let url = Url::parse(url).map_err(|_| "That isn't a web address.".to_owned())?;
    if url.scheme() != "https" || url.host_str() == Some(ASK) {
        return Err("Lanewise only shows https pages in a Tab.".into());
    }
    Ok(url)
}

/// Whether a Host page may go to `url`, telling the UI what it asked instead if it's its keys.
fn allowed<R: Runtime>(app: &tauri::AppHandle<R>, page: u32, url: &Url) -> bool {
    if url.scheme() == "https" && url.host_str() == Some(ASK) {
        let news = match url.path() {
            "/close" => HostPageNews::Close { page },
            _ => HostPageNews::Focus { page },
        };
        if matches!(news, HostPageNews::Focus { .. })
            && let Some(main) = app.get_webview(MAIN)
        {
            let _ = main.set_focus();
        }
        tell(app, news);
        return false;
    }
    // `about:blank` for a page's own frames; anything else not `https` never loads.
    url.scheme() == "https" || url.as_str() == "about:blank"
}

fn tell<R: Runtime>(app: &tauri::AppHandle<R>, news: HostPageNews) {
    // The UI may be gone, closing: nothing is lost if it doesn't hear.
    let _ = app.emit_to(EventTarget::webview(MAIN), EVENT, news);
}

fn find<R: Runtime>(window: &Window<R>, page: u32) -> Result<Webview<R>, String> {
    window
        .get_webview(&label(page))
        .ok_or_else(|| format!("There's no Host page {page}."))
}

/// Held while a Host page is looked for and made, so two opens of the same
/// page, such as the UI's effect run twice, never both make it: the second
/// finds the first's, and shows it.
#[derive(Default)]
pub struct Opening(Mutex<()>);

/// Moves Host page `open` to `position` and `size`, and shows it.
fn show_at<R: Runtime>(
    open: &Webview<R>,
    position: LogicalPosition<f64>,
    size: LogicalSize<f64>,
) -> Result<(), String> {
    open.set_position(position)
        .and_then(|()| open.set_size(size))
        .and_then(|()| open.show())
        .map_err(|error| error.to_string())
}

/// Opens Host page `page` at `url`, laid over `bounds`, or shows it there again if it's open.
#[tauri::command]
pub async fn host_page_open<R: Runtime>(
    window: Window<R>,
    opening: State<'_, Opening>,
    page: u32,
    url: String,
    bounds: Bounds,
) -> Result<(), String> {
    let (position, size) = place(&window, &bounds);
    // A poisoned lock guards nothing but this, so it's taken as it is.
    let _opening = opening.0.lock().unwrap_or_else(PoisonError::into_inner);
    if let Ok(open) = find(&window, page) {
        return show_at(&open, position, size);
    }
    let url = https(&url)?;
    let app = window.app_handle().clone();
    let (on_navigation, on_new_window, on_title, on_load) =
        (app.clone(), app.clone(), app.clone(), app.clone());
    let builder = WebviewBuilder::new(label(page), WebviewUrl::External(url))
        .initialization_script(KEYS)
        .on_navigation(move |url| allowed(&on_navigation, page, url))
        .on_new_window(move |url, _| {
            if url.scheme() == "https" {
                tell(
                    &on_new_window,
                    HostPageNews::NewTab {
                        page,
                        url: url.to_string(),
                    },
                );
            }
            NewWindowResponse::Deny
        })
        .on_document_title_changed(move |_, title| {
            tell(&on_title, HostPageNews::Title { page, title });
        })
        .on_page_load(move |_, payload| {
            tell(
                &on_load,
                HostPageNews::Loading {
                    page,
                    url: payload.url().to_string(),
                    done: payload.event() == PageLoadEvent::Finished,
                },
            );
        });
    match window.add_child(builder, position, size) {
        Ok(_) => Ok(()),
        // Made since it was looked for, elsewhere than here: it's shown.
        Err(error) => match find(&window, page) {
            Ok(open) => show_at(&open, position, size),
            Err(_) => Err(error.to_string()),
        },
    }
}

/// Moves Host page `page` to `bounds`, as its Tab's place in the page moves or resizes.
#[tauri::command]
pub async fn host_page_bounds<R: Runtime>(
    window: Window<R>,
    page: u32,
    bounds: Bounds,
) -> Result<(), String> {
    let open = find(&window, page)?;
    let (position, size) = place(&window, &bounds);
    open.set_position(position)
        .and_then(|()| open.set_size(size))
        .map_err(|error| error.to_string())
}

/// Shows or hides Host page `page`: hidden while another Tab is, or a menu or dialog is open over it.
#[tauri::command]
pub async fn host_page_visible<R: Runtime>(
    window: Window<R>,
    page: u32,
    visible: bool,
) -> Result<(), String> {
    let open = find(&window, page)?;
    if visible { open.show() } else { open.hide() }.map_err(|error| error.to_string())
}

/// What a Host page's toolbar asks of it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Go {
    Back,
    Forward,
    Reload,
    /// Focus moves into the page, from its Tab.
    Focus,
}

/// Goes back or forward in Host page `page`'s history, loads it again, or focuses it.
#[tauri::command]
pub async fn host_page_go<R: Runtime>(window: Window<R>, page: u32, go: Go) -> Result<(), String> {
    let open = find(&window, page)?;
    match go {
        Go::Back => open.eval("history.back()"),
        Go::Forward => open.eval("history.forward()"),
        Go::Reload => open.reload(),
        Go::Focus => open.set_focus(),
    }
    .map_err(|error| error.to_string())
}

/// Closes Host page `page`, with its Tab. Nothing happens if it's closed already.
#[tauri::command]
pub async fn host_page_close<R: Runtime>(window: Window<R>, page: u32) -> Result<(), String> {
    match find(&window, page) {
        Ok(open) => open.close().map_err(|error| error.to_string()),
        Err(_) => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_host_page_only_shows_https() {
        assert!(https("https://github.com/adrianeyre/lanewise").is_ok());
        assert!(https("http://github.com/adrianeyre/lanewise").is_err());
        assert!(https("file:///etc/passwd").is_err());
        assert!(https("javascript:alert(1)").is_err());
        assert!(https("https://lanewise.invalid/focus").is_err());
        assert!(https("not a url").is_err());
    }

    #[test]
    fn bounds_are_in_the_uis_css_pixels_times_how_zoomed_it_is() {
        let bounds: Bounds = serde_json::from_value(
            json!({ "x": 10.0, "y": 20.0, "width": 300.0, "height": 0.0, "viewport": 800.0 }),
        )
        .unwrap();
        // 1200 logical pixels wide, showing 800 CSS pixels: zoomed to 150%.
        let (position, size) = bounds.placed(1200.0);
        assert_eq!(position, LogicalPosition::new(15.0, 30.0));
        // Never nothing: a webview can't be sized to 0.
        assert_eq!(size, LogicalSize::new(450.0, 1.0));
        // Unzoomed where the width isn't known.
        assert_eq!(bounds.placed(0.0).0, LogicalPosition::new(10.0, 20.0));
    }

    #[test]
    fn news_travels_tagged_by_kind() {
        assert_eq!(
            serde_json::to_value(HostPageNews::NewTab {
                page: 3,
                url: "https://github.com/".into()
            })
            .unwrap(),
            json!({ "kind": "newTab", "page": 3, "url": "https://github.com/" })
        );
        assert_eq!(
            serde_json::to_value(HostPageNews::Loading {
                page: 3,
                url: "https://github.com/".into(),
                done: true
            })
            .unwrap(),
            json!({ "kind": "loading", "page": 3, "url": "https://github.com/", "done": true })
        );
    }
}
