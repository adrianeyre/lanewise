//! Checking the Git Setup, which the UI does on start (PRD §9.3).

use std::path::PathBuf;

use lanewise_core::{CredentialManager, GitSetup, MINIMUM_VERSION, SystemGit};
use serde::{Deserialize, Serialize};

use crate::Command;

/// `checkGitSetup`: finds the system `git`, checks it is 2.40 or later, and
/// checks that Git Credential Manager is one of its credential helpers. The
/// UI sends it on start and again for "Check again".
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CheckGitSetup {}

/// What `checkGitSetup` found.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckedGitSetup {
    /// Whether everything Lanewise needs is there: a supported `git`, with
    /// Git Credential Manager.
    pub complete: bool,
    /// The operating system of the machine that runs `git`, for guidance on
    /// what to install. In Web Mode, that's the server's, not the browser's.
    pub operating_system: OperatingSystem,
    /// The oldest Git Lanewise supports: `2.40.0`.
    pub minimum_version: String,
    pub git: GitFound,
    pub credential_manager: CredentialManagerFound,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OperatingSystem {
    Windows,
    Macos,
    Linux,
    Other,
}

impl OperatingSystem {
    /// The operating system this is running on.
    pub fn current() -> Self {
        match std::env::consts::OS {
            "windows" => Self::Windows,
            "macos" => Self::Macos,
            "linux" => Self::Linux,
            _ => Self::Other,
        }
    }
}

/// The `git` Lanewise found, if any.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GitFound {
    /// A `git` Lanewise supports, which it runs.
    Supported {
        path: PathBuf,
        version: String,
    },
    /// Every `git` found is older than the minimum; this is the first.
    TooOld {
        path: PathBuf,
        version: String,
    },
    /// A `git` was found but didn't run, or didn't say its version.
    Unusable {
        path: PathBuf,
        message: String,
    },
    Missing,
}

/// Whether Git Credential Manager is one of Git's credential helpers.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CredentialManagerFound {
    /// It is, as this `credential.helper` value.
    Configured { helper: String },
    /// It isn't. These are the credential helpers Git has instead, if any.
    NotConfigured { helpers: Vec<String> },
    /// There was no `git` to ask.
    Unchecked,
    /// `git` couldn't say.
    Unreadable { message: String },
}

/// `checkGitSetup` never fails: whatever it finds, it says.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum CheckGitSetupError {}

impl From<GitSetup> for CheckedGitSetup {
    fn from(setup: GitSetup) -> Self {
        let complete = setup.is_complete();
        let git = match setup.git {
            SystemGit::Supported { path, version } => GitFound::Supported {
                path,
                version: version.to_string(),
            },
            SystemGit::TooOld { path, version } => GitFound::TooOld {
                path,
                version: version.to_string(),
            },
            SystemGit::Unusable { path, message } => GitFound::Unusable { path, message },
            SystemGit::Missing => GitFound::Missing,
        };
        let credential_manager = match setup.credential_manager {
            CredentialManager::Configured { helper } => {
                CredentialManagerFound::Configured { helper }
            }
            CredentialManager::NotConfigured { helpers } => {
                CredentialManagerFound::NotConfigured { helpers }
            }
            CredentialManager::Unchecked => CredentialManagerFound::Unchecked,
            CredentialManager::Unreadable { message } => {
                CredentialManagerFound::Unreadable { message }
            }
        };
        Self {
            complete,
            operating_system: OperatingSystem::current(),
            minimum_version: MINIMUM_VERSION.to_string(),
            git,
            credential_manager,
        }
    }
}

// TODO: the commands that run `git` (committing first, PRD §7.3, M3) run the
// one this check found, rather than finding it again for each command.
impl Command for CheckGitSetup {
    const NAME: &'static str = "checkGitSetup";
    type Response = CheckedGitSetup;
    type Error = CheckGitSetupError;

    fn run(self) -> Result<CheckedGitSetup, CheckGitSetupError> {
        let setup = lanewise_core::check_git_setup();
        log::info!("{}", described(&setup));
        Ok(setup.into())
    }
}

/// `setup` as it's logged: versions and kinds, never a path or a
/// credential helper's command, which could hold a secret.
fn described(setup: &GitSetup) -> String {
    let git = match &setup.git {
        SystemGit::Supported { version, .. } => format!("git {version}"),
        SystemGit::TooOld { version, .. } => format!("git {version}, too old"),
        SystemGit::Unusable { .. } => "a git that didn't run".into(),
        SystemGit::Missing => "no git".into(),
    };
    let credential_manager = match setup.credential_manager {
        CredentialManager::Configured { .. } => "a credential helper",
        CredentialManager::NotConfigured { .. } => "not a credential helper",
        CredentialManager::Unchecked => "unchecked",
        CredentialManager::Unreadable { .. } => "unreadable",
    };
    format!("Git Setup: {git}, with Git Credential Manager {credential_manager}")
}

#[cfg(test)]
mod tests {
    use lanewise_core::GitVersion;
    use serde_json::json;

    use super::*;

    #[test]
    fn the_request_is_an_empty_object() {
        assert_eq!(
            serde_json::from_value::<CheckGitSetup>(json!({})).unwrap(),
            CheckGitSetup {}
        );
        assert!(serde_json::from_value::<CheckGitSetup>(json!({ "force": true })).is_err());
    }

    #[test]
    fn a_setup_travels_tagged_by_kind_with_versions_as_text() {
        let setup = CheckedGitSetup::from(GitSetup {
            git: SystemGit::TooOld {
                path: "/usr/bin/git".into(),
                version: GitVersion {
                    major: 2,
                    minor: 39,
                    patch: 5,
                },
            },
            credential_manager: CredentialManager::NotConfigured {
                helpers: vec!["osxkeychain".into()],
            },
        });

        let mut json = serde_json::to_value(setup).unwrap();
        let operating_system = json
            .as_object_mut()
            .unwrap()
            .remove("operatingSystem")
            .unwrap();

        assert_eq!(
            json,
            json!({
                "complete": false,
                "minimumVersion": "2.40.0",
                "git": { "kind": "tooOld", "path": "/usr/bin/git", "version": "2.39.5" },
                "credentialManager": { "kind": "notConfigured", "helpers": ["osxkeychain"] }
            })
        );
        assert_eq!(
            operating_system,
            serde_json::to_value(OperatingSystem::current()).unwrap()
        );
    }

    #[test]
    fn a_complete_setup_says_so() {
        let setup = CheckedGitSetup::from(GitSetup {
            git: SystemGit::Supported {
                path: "C:/Program Files/Git/cmd/git.exe".into(),
                version: GitVersion {
                    major: 2,
                    minor: 56,
                    patch: 0,
                },
            },
            credential_manager: CredentialManager::Configured {
                helper: "manager".into(),
            },
        });

        assert!(setup.complete);
        assert_eq!(
            serde_json::to_value(&setup.credential_manager).unwrap(),
            json!({ "kind": "configured", "helper": "manager" })
        );
        assert_eq!(
            serde_json::to_value(GitFound::Missing).unwrap(),
            json!({ "kind": "missing" })
        );
    }

    #[test]
    fn a_setup_is_logged_without_paths_or_helpers() {
        let setup = GitSetup {
            git: SystemGit::Supported {
                path: "/Users/ada/bin/git".into(),
                version: GitVersion {
                    major: 2,
                    minor: 56,
                    patch: 0,
                },
            },
            credential_manager: CredentialManager::NotConfigured {
                helpers: vec!["!f() { echo password=hunter2; }; f".into()],
            },
        };

        assert_eq!(
            described(&setup),
            "Git Setup: git 2.56.0, with Git Credential Manager not a credential helper"
        );
    }

    #[test]
    fn operating_systems_travel_in_camel_case() {
        assert_eq!(
            serde_json::to_value([
                OperatingSystem::Windows,
                OperatingSystem::Macos,
                OperatingSystem::Linux,
                OperatingSystem::Other
            ])
            .unwrap(),
            json!(["windows", "macos", "linux", "other"])
        );
    }
}
