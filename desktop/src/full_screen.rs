//! The window's title bar, with its close, minimise and zoom buttons, kept
//! in full screen on macOS. AppKit hides the title bar of a window in full
//! screen until the pointer reaches the top of the screen, as it asks for
//! `NSApplicationPresentationAutoHideToolbar`; Lanewise asks for the same
//! options without it, as Safari's "Always Show Toolbar in Full Screen" does,
//! so the buttons stay where they always are. The menu bar and the Dock
//! still hide.

use tauri::{Runtime, Window};

/// Keeps `window`'s title bar shown, if it is in full screen. Called as the
/// window resizes, which it does as it goes into full screen.
pub fn keep_title_bar<R: Runtime>(window: &Window<R>) {
    if !cfg!(target_os = "macos") || !window.is_fullscreen().unwrap_or(false) {
        return;
    }
    // AppKit's presentation options are only ever changed on the main thread.
    let _ = window.run_on_main_thread(show_title_bar);
}

#[cfg(target_os = "macos")]
fn show_title_bar() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSApplicationPresentationOptions as Options};

    let Some(main_thread) = MainThreadMarker::new() else {
        return;
    };
    let app = NSApplication::sharedApplication(main_thread);
    let options = app.presentationOptions();
    if let Some(kept) = without_hidden_title_bar(options.bits()) {
        app.setPresentationOptions(Options::from_bits_retain(kept));
    }
}

#[cfg(not(target_os = "macos"))]
fn show_title_bar() {}

#[cfg(any(target_os = "macos", test))]
/// `NSApplicationPresentationFullScreen`.
const FULL_SCREEN: usize = 1 << 10;
#[cfg(any(target_os = "macos", test))]
/// `NSApplicationPresentationAutoHideToolbar`.
const AUTO_HIDE_TOOLBAR: usize = 1 << 11;

#[cfg(any(target_os = "macos", test))]
/// The presentation options `options` with the title bar shown, if they're
/// full screen's and hide it: without `AutoHideToolbar`, which AppKit allows
/// with any options it is in, as it only ever needs `AutoHideMenuBar` beside it.
fn without_hidden_title_bar(options: usize) -> Option<usize> {
    let hides = options & FULL_SCREEN != 0 && options & AUTO_HIDE_TOOLBAR != 0;
    hides.then_some(options & !AUTO_HIDE_TOOLBAR)
}

#[cfg(test)]
mod tests {
    use super::{AUTO_HIDE_TOOLBAR, FULL_SCREEN, without_hidden_title_bar};

    /// `NSApplicationPresentationAutoHideDock`.
    const AUTO_HIDE_DOCK: usize = 1 << 0;
    /// `NSApplicationPresentationAutoHideMenuBar`.
    const AUTO_HIDE_MENU_BAR: usize = 1 << 2;

    #[test]
    fn full_screen_keeps_the_title_bar_and_still_hides_the_menu_bar_and_the_dock() {
        let proposed = FULL_SCREEN | AUTO_HIDE_TOOLBAR | AUTO_HIDE_MENU_BAR | AUTO_HIDE_DOCK;

        assert_eq!(
            without_hidden_title_bar(proposed),
            Some(FULL_SCREEN | AUTO_HIDE_MENU_BAR | AUTO_HIDE_DOCK)
        );
    }

    #[test]
    fn options_that_already_show_the_title_bar_or_arent_full_screens_are_left_alone() {
        let shown = FULL_SCREEN | AUTO_HIDE_MENU_BAR | AUTO_HIDE_DOCK;

        assert_eq!(without_hidden_title_bar(shown), None);
        assert_eq!(
            without_hidden_title_bar(AUTO_HIDE_MENU_BAR | AUTO_HIDE_DOCK),
            None
        );
        assert_eq!(without_hidden_title_bar(0), None);
    }
}

#[cfg(all(test, target_os = "macos"))]
mod appkit {
    use objc2_app_kit::NSApplicationPresentationOptions as Options;

    use super::{AUTO_HIDE_TOOLBAR, FULL_SCREEN};

    #[test]
    fn the_options_are_appkits() {
        assert_eq!(Options::FullScreen.bits(), FULL_SCREEN);
        assert_eq!(Options::AutoHideToolbar.bits(), AUTO_HIDE_TOOLBAR);
    }
}
