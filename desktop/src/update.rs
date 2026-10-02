//! Updates (ADR 0030): the installed Desktop App asks the latest Release's
//! `latest.json` whether there is a newer version, and installs its package
//! only once the user says so. Adapted from soundcheck's (its ADR 0011).
//!
//! Tauri's updater does the work, and installs nothing that isn't signed by
//! the Update key for the version announced. The key's public half is
//! `plugins.updater.pubkey` in `tauri.conf.json`, empty until the maintainer
//! makes the key; until then, and in any copy the updater couldn't replace,
//! the app says why it doesn't update itself rather than failing to.
//!
//! The UI calls these commands, not the plugin's own: the window's
//! capability doesn't grant those, so the page can't point the updater
//! anywhere else. A failure is logged by its kind, never its message, which
//! can hold the URL asked (ADR 0028).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::Serialize;
use serde_json::Value;
use tauri::utils::config::{BundleType, PluginConfig};
use tauri::{AppHandle, Runtime, State};
use tauri_plugin_updater::{Error, Update, UpdaterExt};

/// Why this copy doesn't update itself, when it doesn't.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Off {
    /// The updater has no public key yet: the maintainer hasn't made the Update key.
    NoKey,
    /// Run with `pnpm desktop:dev`, which an Update would replace with a Release.
    Development,
    /// Not installed from a Release's installer, such as a binary built from
    /// source, which the updater couldn't replace.
    NotInstalled,
}

/// Whether a copy with `pubkey`, built in debug or not, and installed from
/// `bundle`, can update itself; if not, why. A Release has the Mac app, in a
/// disk image, and an NSIS installer for Windows (ADR 0029), so only those
/// update. Tauri tells an app on macOS by where it runs, since it is always
/// in a `.app`.
pub fn availability(pubkey: &str, debug: bool, bundle: Option<BundleType>) -> Result<(), Off> {
    if pubkey.trim().is_empty() {
        return Err(Off::NoKey);
    }
    if debug {
        return Err(Off::Development);
    }
    match bundle {
        Some(BundleType::Nsis | BundleType::App) => Ok(()),
        _ => Err(Off::NotInstalled),
    }
}

/// The public key in the updater's config, or "" when there is none.
pub fn pubkey(plugins: &PluginConfig) -> &str {
    plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("pubkey"))
        .and_then(Value::as_str)
        .unwrap_or("")
}

fn this_copy<R: Runtime>(app: &AppHandle<R>) -> Result<(), Off> {
    availability(
        pubkey(&app.config().plugins),
        cfg!(debug_assertions),
        tauri::utils::platform::bundle_type(),
    )
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// The version running.
    pub version: String,
    /// Why it doesn't update itself, or None when it does.
    pub off: Option<Off>,
}

/// A newer version, as its Release announces it.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub version: String,
    /// When it was released, as RFC 3339, if the Release says.
    pub date: Option<String>,
    /// What's new in it, if the Release says.
    pub notes: Option<String>,
}

impl Found {
    /// From what the updater read: the version, the notes, and the whole of
    /// `latest.json`, whose date is kept as it was written.
    pub fn new(version: &str, notes: Option<&str>, manifest: &Value) -> Self {
        let text = |value: Option<&str>| {
            value
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(String::from)
        };
        Found {
            version: version.to_owned(),
            date: text(manifest.get("pub_date").and_then(Value::as_str)),
            notes: text(notes),
        }
    }
}

/// The kind of an updater failure, which is what the Logs and the UI are
/// told: never its message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    /// GitHub couldn't be reached, or had no `latest.json`.
    Network,
    /// The package isn't signed by the Update key for the version announced.
    Signature,
    /// The Release has no package for this OS and architecture.
    Platform,
    /// It downloaded but couldn't be installed.
    Install,
}

impl Failure {
    pub fn of(error: &Error) -> Self {
        match error {
            Error::Reqwest(_) | Error::Network(_) | Error::ReleaseNotFound | Error::Http(_) => {
                Failure::Network
            }
            Error::Minisign(_)
            | Error::Base64(_)
            | Error::SignatureUtf8(_)
            | Error::SignedVersionMismatch { .. }
            | Error::MissingSignedVersion => Failure::Signature,
            Error::TargetNotFound(_)
            | Error::TargetsNotFound(_)
            | Error::UnsupportedArch
            | Error::UnsupportedOs => Failure::Platform,
            _ => Failure::Install,
        }
    }

    /// Its name in the Logs.
    pub fn kind(self) -> &'static str {
        match self {
            Failure::Network => "network",
            Failure::Signature => "signature",
            Failure::Platform => "platform",
            Failure::Install => "install",
        }
    }

    /// What the UI says about it, checking or installing.
    pub fn describe(self, installing: bool) -> String {
        let doing = if installing {
            "install the Update"
        } else {
            "check for an Update"
        };
        match self {
            Failure::Network => {
                format!("Lanewise couldn't reach GitHub to {doing}. Try again later.")
            }
            Failure::Signature => format!(
                "Lanewise didn't {doing}: it isn't signed by Lanewise's Update key for the version it says, so it wasn't trusted."
            ),
            Failure::Platform => {
                format!("Lanewise couldn't {doing}: the latest Release has none for this computer.")
            }
            Failure::Install => format!("Lanewise couldn't {doing}. Try again later."),
        }
    }
}

/// Logs `command`'s failure by its kind, and says it for the UI.
fn failed(command: &str, error: &Error, installing: bool) -> String {
    let failure = Failure::of(error);
    log::warn!("{command} failed: {}", failure.kind());
    failure.describe(installing)
}

/// How much of the package has downloaded, which the UI polls.
#[derive(Debug, Default)]
pub struct Progress {
    downloaded: AtomicU64,
    /// The package's size, 0 until known.
    total: AtomicU64,
}

impl Progress {
    pub fn reset(&self) {
        self.downloaded.store(0, Ordering::Relaxed);
        self.total.store(0, Ordering::Relaxed);
    }

    /// Another `len` bytes have arrived, of `total` if the server said.
    pub fn chunk(&self, len: usize, total: Option<u64>) {
        self.downloaded.fetch_add(len as u64, Ordering::Relaxed);
        if let Some(total) = total {
            self.total.store(total, Ordering::Relaxed);
        }
    }

    /// 0 to 1; 0 while the size isn't known.
    pub fn fraction(&self) -> f32 {
        let total = self.total.load(Ordering::Relaxed);
        if total == 0 {
            return 0.0;
        }
        (self.downloaded.load(Ordering::Relaxed) as f64 / total as f64).min(1.0) as f32
    }
}

/// What the update commands share.
#[derive(Default)]
pub struct Updates {
    /// What the last check found, until it is installed.
    found: Mutex<Option<Update>>,
    progress: Progress,
}

impl Updates {
    fn found(&self) -> MutexGuard<'_, Option<Update>> {
        self.found.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

fn describe(off: Off) -> String {
    match off {
        Off::NoKey => "This copy of Lanewise has no Update key, so it can't update itself.",
        Off::Development => "Lanewise run from source with pnpm desktop:dev doesn't update itself.",
        Off::NotInstalled => {
            "This copy of Lanewise wasn't installed from a Release, so it can't update itself."
        }
    }
    .into()
}

/// The version running, and whether it updates itself.
#[tauri::command]
pub fn update_status<R: Runtime>(app: AppHandle<R>) -> Status {
    Status {
        version: app.package_info().version.to_string(),
        off: this_copy(&app).err(),
    }
}

/// Asks the latest Release whether there is a newer version; None if not.
#[tauri::command]
pub async fn update_check<R: Runtime>(
    app: AppHandle<R>,
    updates: State<'_, Updates>,
) -> Result<Option<Found>, String> {
    this_copy(&app).map_err(describe)?;
    check(&app, &updates).await
}

/// The check itself, for any copy: the tests' mock app is none a Release installed.
pub async fn check<R: Runtime>(
    app: &AppHandle<R>,
    updates: &Updates,
) -> Result<Option<Found>, String> {
    let checked = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(error) => Err(error),
    };
    let update = checked.map_err(|error| failed("update_check", &error, false))?;
    let found = update
        .as_ref()
        .map(|update| Found::new(&update.version, update.body.as_deref(), &update.raw_json));
    *updates.found() = update;
    Ok(found)
}

/// Downloads the Update the last check found, checks its signature, installs
/// it and restarts into it. On Windows the installer closes the app and
/// starts it again itself. The UI asks first that no In-Progress Operation,
/// fetch, pull, push or clone is running, since this ends them.
#[tauri::command]
pub async fn update_install<R: Runtime>(
    app: AppHandle<R>,
    updates: State<'_, Updates>,
) -> Result<(), String> {
    let Some(update) = updates.found().take() else {
        return Err("There is no Update to install: check for one first.".into());
    };
    updates.progress.reset();
    let installed = update
        .download_and_install(|len, total| updates.progress.chunk(len, total), || {})
        .await;
    if let Err(error) = installed {
        *updates.found() = Some(update);
        return Err(failed("update_install", &error, true));
    }
    log::info!("update_install installed {}", update.version);
    app.restart()
}

/// How far the Update's download has got, 0 to 1.
#[tauri::command]
pub fn update_progress(updates: State<'_, Updates>) -> f32 {
    updates.progress.fraction()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const PUBKEY: &str = include_str!("../../app/scripts/release/fixtures/updater/throwaway.pub");

    #[test]
    fn a_copy_installed_from_a_release_with_the_key_updates_itself() {
        for bundle in [BundleType::Nsis, BundleType::App] {
            assert_eq!(
                availability(PUBKEY, false, Some(bundle.clone())),
                Ok(()),
                "{bundle:?}"
            );
        }
    }

    #[test]
    fn without_the_key_nothing_updates_itself() {
        assert_eq!(
            availability("", false, Some(BundleType::Nsis)),
            Err(Off::NoKey)
        );
        assert_eq!(
            availability(" \n", false, Some(BundleType::App)),
            Err(Off::NoKey)
        );
    }

    #[test]
    fn a_development_copy_doesnt_update_itself() {
        assert_eq!(
            availability(PUBKEY, true, Some(BundleType::Nsis)),
            Err(Off::Development)
        );
    }

    #[test]
    fn a_copy_not_installed_from_a_release_doesnt_either() {
        assert_eq!(availability(PUBKEY, false, None), Err(Off::NotInstalled));
        for bundle in [
            BundleType::Msi,
            BundleType::AppImage,
            BundleType::Deb,
            BundleType::Rpm,
        ] {
            assert_eq!(
                availability(PUBKEY, false, Some(bundle.clone())),
                Err(Off::NotInstalled),
                "{bundle:?}"
            );
        }
    }

    #[test]
    fn the_public_key_is_read_from_the_updaters_config() {
        let config = |value: Value| PluginConfig([("updater".to_owned(), value)].into());
        assert_eq!(pubkey(&config(json!({ "pubkey": PUBKEY }))), PUBKEY);
        assert_eq!(pubkey(&config(json!({}))), "");
        assert_eq!(pubkey(&Default::default()), "");
    }

    #[test]
    fn the_committed_config_is_the_updaters() {
        let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater = &config["plugins"]["updater"];
        assert!(
            updater["pubkey"].is_string(),
            "the plugin won't start without a pubkey, even an empty one"
        );
        assert_eq!(
            updater["endpoints"],
            json!(["https://github.com/adrianeyre/lanewise/releases/latest/download/latest.json"])
        );
        assert_eq!(updater["requireSignedVersion"], json!(true));
        // Update packages are made only when the build is given the key.
        assert_eq!(config["bundle"].get("createUpdaterArtifacts"), None);
    }

    #[test]
    fn what_a_release_announces_is_passed_on() {
        let manifest = json!({ "version": "1.2.3", "pub_date": "2026-09-29T12:00:00Z" });
        assert_eq!(
            Found::new("1.2.3", Some("Features\n"), &manifest),
            Found {
                version: "1.2.3".into(),
                date: Some("2026-09-29T12:00:00Z".into()),
                notes: Some("Features".into()),
            }
        );
        assert_eq!(
            Found::new("1.2.3", Some(""), &json!({})),
            Found {
                version: "1.2.3".into(),
                date: None,
                notes: None
            }
        );
    }

    #[test]
    fn progress_is_the_share_downloaded_once_the_size_is_known() {
        let progress = Progress::default();
        assert_eq!(progress.fraction(), 0.0);
        progress.chunk(100, None);
        assert_eq!(progress.fraction(), 0.0);
        progress.chunk(150, Some(1000));
        assert_eq!(progress.fraction(), 0.25);
        progress.chunk(2000, Some(1000));
        assert_eq!(progress.fraction(), 1.0);
        progress.reset();
        assert_eq!(progress.fraction(), 0.0);
    }

    #[test]
    fn a_failure_is_told_by_its_kind_never_its_message() {
        let mismatch = Error::SignedVersionMismatch {
            signed: "1.2.3".into(),
            announced: "9.9.9".into(),
        };
        assert_eq!(Failure::of(&mismatch), Failure::Signature);
        assert_eq!(Failure::of(&Error::ReleaseNotFound), Failure::Network);
        assert_eq!(
            Failure::of(&Error::TargetNotFound("darwin-aarch64".into())),
            Failure::Platform
        );
        assert_eq!(Failure::of(&Error::InvalidUpdaterFormat), Failure::Install);

        let said = failed("update_install", &mismatch, true);
        assert!(!said.contains("9.9.9"), "{said}");
        assert!(said.contains("Update key"), "{said}");
    }

    #[test]
    fn why_it_doesnt_update_is_told_to_the_ui_by_name() {
        assert_eq!(
            serde_json::to_value(Off::NotInstalled).unwrap(),
            json!("not-installed")
        );
        let status = Status {
            version: "1.0.0".into(),
            off: Some(Off::NoKey),
        };
        assert_eq!(
            serde_json::to_value(status).unwrap(),
            json!({ "version": "1.0.0", "off": "no-key" })
        );
    }
}
