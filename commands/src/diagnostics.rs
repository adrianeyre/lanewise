//! The UI's own log lines, and Copy diagnostics (PRD §11): what Lanewise
//! runs on, and its latest log lines, for a bug report the user sends
//! themselves.

use std::path::PathBuf;

use lanewise_core::{CredentialManager, SystemGit};
use log::Level;
use serde::{Deserialize, Serialize};

use crate::Command;
use crate::logs::{self, UI_TARGET};

/// How many of the latest log lines Copy diagnostics takes.
pub const RECENT_LOG_LINES: usize = 50;

/// `writeLog`: adds a line from the UI to Lanewise's logs, which hide
/// whatever in it looks like a credential. The UI never sends a file's
/// contents, a prompt or an API key in one.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WriteLog {
    pub level: LogLevel,
    pub message: String,
}

/// How much a log line matters.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LogLevel {
    Error,
    Warn,
    Info,
}

impl From<LogLevel> for Level {
    fn from(level: LogLevel) -> Self {
        match level {
            LogLevel::Error => Level::Error,
            LogLevel::Warn => Level::Warn,
            LogLevel::Info => Level::Info,
        }
    }
}

/// `writeLog` never fails: a line that can't be written is let go.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum WriteLogError {}

impl Command for WriteLog {
    const NAME: &'static str = "writeLog";
    type Response = ();
    type Error = WriteLogError;

    fn run(self) -> Result<(), WriteLogError> {
        log::log!(target: UI_TARGET, self.level.into(), "{}", self.message);
        Ok(())
    }
}

/// `diagnostics`: what Copy diagnostics copies, from the core: the
/// operating system, the Git and Git Credential Manager versions, and the
/// latest log lines.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReadDiagnostics {}

/// What Lanewise runs on, and what it logged last. Nothing here names a
/// path but the log folder, which the UI shows and doesn't copy.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    /// The operating system, its version and the processor's architecture,
    /// such as `Mac OS 15.6.1 (aarch64)`. In Web Mode, the server's.
    pub operating_system: String,
    pub git: DiagnosedGit,
    pub credential_manager: DiagnosedCredentialManager,
    /// Where the logs are, if they were started.
    pub log_folder: Option<PathBuf>,
    /// The latest [`RECENT_LOG_LINES`] log lines, oldest first.
    pub recent_log_lines: Vec<String>,
}

/// The `git` the Git Setup check found, by its version alone.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DiagnosedGit {
    Supported {
        version: String,
    },
    TooOld {
        version: String,
    },
    /// A `git` was found but didn't run, or didn't say its version.
    Unusable,
    Missing,
}

/// Git Credential Manager: its version, if Git can run it, and whether it's
/// one of Git's credential helpers.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosedCredentialManager {
    pub version: Option<String>,
    pub configured: bool,
}

/// `diagnostics` never fails: whatever it can't find, it says so.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum DiagnosticsError {}

impl Command for ReadDiagnostics {
    const NAME: &'static str = "diagnostics";
    type Response = Diagnostics;
    type Error = DiagnosticsError;

    fn run(self) -> Result<Diagnostics, DiagnosticsError> {
        let setup = lanewise_core::check_git_setup();
        let version = setup
            .git
            .runnable()
            .and_then(|git| lanewise_core::credential_manager_version(&git));
        let log_folder = logs::folder().map(PathBuf::from);
        Ok(Diagnostics {
            operating_system: operating_system(),
            git: diagnosed_git(&setup.git),
            credential_manager: DiagnosedCredentialManager {
                version,
                configured: matches!(
                    setup.credential_manager,
                    CredentialManager::Configured { .. }
                ),
            },
            recent_log_lines: log_folder
                .as_deref()
                .map(|folder| logs::recent_lines(folder, RECENT_LOG_LINES))
                .unwrap_or_default(),
            log_folder,
        })
    }
}

fn operating_system() -> String {
    let info = os_info::get();
    format!(
        "{} {} ({})",
        info.os_type(),
        info.version(),
        std::env::consts::ARCH
    )
}

fn diagnosed_git(git: &SystemGit) -> DiagnosedGit {
    match git {
        SystemGit::Supported { version, .. } => DiagnosedGit::Supported {
            version: version.to_string(),
        },
        SystemGit::TooOld { version, .. } => DiagnosedGit::TooOld {
            version: version.to_string(),
        },
        SystemGit::Unusable { .. } => DiagnosedGit::Unusable,
        SystemGit::Missing => DiagnosedGit::Missing,
    }
}

#[cfg(test)]
mod tests {
    use lanewise_core::GitVersion;
    use serde_json::json;

    use super::*;

    #[test]
    fn a_log_line_is_a_level_and_a_message() {
        assert_eq!(
            serde_json::from_value::<WriteLog>(json!({ "level": "warn", "message": "slow" }))
                .unwrap(),
            WriteLog {
                level: LogLevel::Warn,
                message: "slow".into()
            }
        );
        assert!(
            serde_json::from_value::<WriteLog>(json!({ "level": "trace", "message": "" })).is_err()
        );
        assert_eq!(Level::from(LogLevel::Error), Level::Error);
    }

    #[test]
    fn git_is_diagnosed_by_its_version_without_its_path() {
        let version = GitVersion {
            major: 2,
            minor: 39,
            patch: 5,
        };

        assert_eq!(
            serde_json::to_value(diagnosed_git(&SystemGit::TooOld {
                path: "/Users/ada/bin/git".into(),
                version
            }))
            .unwrap(),
            json!({ "kind": "tooOld", "version": "2.39.5" })
        );
        assert_eq!(
            serde_json::to_value(diagnosed_git(&SystemGit::Unusable {
                path: "/usr/bin/git".into(),
                message: "no Command Line Tools".into()
            }))
            .unwrap(),
            json!({ "kind": "unusable" })
        );
    }

    #[test]
    fn diagnostics_travel_in_camel_case() {
        let diagnostics = ReadDiagnostics {}.run().unwrap();
        let json = serde_json::to_value(&diagnostics).unwrap();

        assert!(
            diagnostics
                .operating_system
                .ends_with(&format!("({})", std::env::consts::ARCH))
        );
        let mut keys: Vec<&String> = json.as_object().unwrap().keys().collect();
        keys.sort();
        assert_eq!(
            keys,
            [
                "credentialManager",
                "git",
                "logFolder",
                "operatingSystem",
                "recentLogLines"
            ]
        );
        assert!(json["credentialManager"]["configured"].is_boolean());
    }
}
