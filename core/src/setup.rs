//! The Git Setup check Lanewise makes on start (PRD §9.3): is there a `git`
//! it can run, is it 2.40 or later, and is Git Credential Manager its
//! credential helper?

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::git::{Git, GitError, GitOutput, GitVersion};

/// What the Git Setup check found.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GitSetup {
    pub git: SystemGit,
    pub credential_manager: CredentialManager,
}

impl GitSetup {
    /// Whether everything Lanewise needs is there.
    pub fn is_complete(&self) -> bool {
        matches!(self.git, SystemGit::Supported { .. })
            && matches!(
                self.credential_manager,
                CredentialManager::Configured { .. }
            )
    }
}

/// The `git` Lanewise found, if any.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SystemGit {
    /// A `git` Lanewise supports: the first found that is 2.40 or later.
    Supported { path: PathBuf, version: GitVersion },
    /// Every `git` found is older than 2.40. This is the first of them.
    TooOld { path: PathBuf, version: GitVersion },
    /// A `git` was found but didn't run, or didn't say its version: Apple's
    /// placeholder `git` without the Command Line Tools, say.
    Unusable { path: PathBuf, message: String },
    /// No `git` was found.
    Missing,
}

impl SystemGit {
    /// The `git` to run, if one ran: a supported one, or a too-old one,
    /// which can still say what its credential helper is.
    pub fn runnable(&self) -> Option<Git> {
        match self {
            Self::Supported { path, .. } | Self::TooOld { path, .. } => Some(Git::new(path)),
            Self::Unusable { .. } | Self::Missing => None,
        }
    }
}

/// Whether Git Credential Manager is one of Git's credential helpers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CredentialManager {
    /// It is, as `helper`: a `credential.helper` value, such as `manager`.
    Configured { helper: String },
    /// It isn't. `helpers` are the credential helpers Git has instead, if any.
    NotConfigured { helpers: Vec<String> },
    /// There's no `git` to ask.
    Unchecked,
    /// `git` couldn't say.
    Unreadable { message: String },
}

/// Where to look for `git`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GitSearch {
    /// A `PATH`, searched first, in order.
    pub path: Option<OsString>,
    /// Places Git is often installed, searched after `path`.
    pub well_known: Vec<PathBuf>,
}

impl GitSearch {
    /// This machine's `PATH`, then the platform's usual places for Git. An
    /// app started from the macOS Finder or Dock gets only a minimal `PATH`,
    /// without Homebrew's folders, so those are always searched too.
    pub fn system() -> Self {
        Self {
            path: std::env::var_os("PATH"),
            well_known: well_known_places(),
        }
    }

    /// Each `git` program found, in the order to try them: those on `path`
    /// (only its absolute folders, so never one in whatever folder Lanewise
    /// was started in), then those in `well_known`, each once.
    pub fn candidates(&self) -> Vec<PathBuf> {
        let on_path = self
            .path
            .iter()
            .flat_map(std::env::split_paths)
            .filter(|folder| folder.is_absolute())
            .map(|folder| folder.join(PROGRAM));
        let mut found: Vec<PathBuf> = Vec::new();
        let mut seen: Vec<PathBuf> = Vec::new();
        for candidate in on_path.chain(self.well_known.iter().cloned()) {
            if !candidate.is_file() {
                continue;
            }
            let identity = candidate
                .canonicalize()
                .unwrap_or_else(|_| candidate.clone());
            if !seen.contains(&identity) {
                seen.push(identity);
                found.push(candidate);
            }
        }
        if cfg!(target_os = "macos") {
            // Without the Command Line Tools, running Apple's `/usr/bin/git`
            // asks the user to install them, so a Homebrew Git is tried first.
            found.sort_by_key(|candidate| candidate == Path::new("/usr/bin/git"));
        }
        found
    }
}

#[cfg(windows)]
const PROGRAM: &str = "git.exe";
#[cfg(not(windows))]
const PROGRAM: &str = "git";

fn well_known_places() -> Vec<PathBuf> {
    if cfg!(windows) {
        // Git for Windows, installed for everyone or for one user.
        [
            ("ProgramFiles", r"Git\cmd\git.exe"),
            ("ProgramW6432", r"Git\cmd\git.exe"),
            ("LOCALAPPDATA", r"Programs\Git\cmd\git.exe"),
        ]
        .into_iter()
        .filter_map(|(folder, git)| Some(PathBuf::from(std::env::var_os(folder)?).join(git)))
        .collect()
    } else if cfg!(target_os = "macos") {
        // Homebrew on Apple silicon, then on Intel, then Apple's own.
        [
            "/opt/homebrew/bin/git",
            "/usr/local/bin/git",
            "/usr/bin/git",
        ]
        .map(PathBuf::from)
        .into()
    } else {
        ["/usr/bin/git", "/usr/local/bin/git"]
            .map(PathBuf::from)
            .into()
    }
}

/// Checks this machine's Git Setup, searching [`GitSearch::system`].
pub fn check_git_setup() -> GitSetup {
    check_git_setup_in(&GitSearch::system())
}

/// Checks the Git Setup that `search` finds: runs `git --version` on each
/// `git` found until one is supported, then asks that `git` for its
/// credential helpers.
pub fn check_git_setup_in(search: &GitSearch) -> GitSetup {
    let git = choose(&search.candidates(), Git::version);
    let credential_manager = match git.runnable() {
        Some(git) => credential_manager(&git),
        None => CredentialManager::Unchecked,
    };
    GitSetup {
        git,
        credential_manager,
    }
}

/// The first of `candidates` that `version_of` says is supported, or else
/// the best reason none is: a too-old `git` over one that didn't run.
fn choose(
    candidates: &[PathBuf],
    version_of: impl Fn(&Git) -> Result<GitVersion, GitError>,
) -> SystemGit {
    let mut too_old = None;
    let mut unusable = None;
    for path in candidates {
        match version_of(&Git::new(path)) {
            Ok(version) if version.is_supported() => {
                return SystemGit::Supported {
                    path: path.clone(),
                    version,
                };
            }
            Ok(version) => {
                too_old.get_or_insert_with(|| SystemGit::TooOld {
                    path: path.clone(),
                    version,
                });
            }
            Err(error) => {
                unusable.get_or_insert_with(|| SystemGit::Unusable {
                    path: path.clone(),
                    message: error.to_string(),
                });
            }
        }
    }
    too_old.or(unusable).unwrap_or(SystemGit::Missing)
}

/// Asks `git` for its credential helpers: `credential.helper`, and any
/// `credential.<url>.helper` for particular Hosts.
fn credential_manager(git: &Git) -> CredentialManager {
    let output = git
        .command([
            "config",
            "--null",
            "--get-regexp",
            r"^credential\.(.*\.)?helper$",
        ])
        // Outside any repository, so only the system and global settings
        // are read, as they would be for a clone.
        .current_dir(std::env::temp_dir())
        .output();
    match output {
        Ok(output) => credential_manager_in(&output.stdout),
        // `git config` exits with 1 when no setting matches.
        Err(GitError::Failed { code: Some(1), .. }) => {
            CredentialManager::NotConfigured { helpers: vec![] }
        }
        Err(error) => CredentialManager::Unreadable {
            message: error.to_string(),
        },
    }
}

/// Git Credential Manager's version, as `git credential-manager --version`
/// says it, such as `2.6.1+b2b8e0d`: Git finds the program as it does to run
/// it as a credential helper, with its own programs or on `PATH`. `None` if
/// there's none, or it didn't say.
pub fn credential_manager_version(git: &Git) -> Option<String> {
    version_said(
        git.command(["credential-manager", "--version"])
            .current_dir(std::env::temp_dir())
            .output(),
    )
}

/// The first line a `--version` wrote, if it succeeded and wrote one.
fn version_said(output: Result<GitOutput, GitError>) -> Option<String> {
    let said = output.ok()?.stdout_text();
    let line = said.lines().next()?.trim();
    (!line.is_empty()).then(|| line.to_owned())
}

/// Reads `git config --null --get-regexp`'s output: each setting as its name,
/// a newline and its value, ended by a NUL. An empty value clears the helpers
/// set before it under the same name, as it does for Git.
fn credential_manager_in(config: &[u8]) -> CredentialManager {
    let config = String::from_utf8_lossy(config);
    let mut settings: Vec<(&str, Vec<&str>)> = Vec::new();
    for setting in config.split('\0').filter(|setting| !setting.is_empty()) {
        let (name, value) = setting.split_once('\n').unwrap_or((setting, ""));
        let index = match settings.iter().position(|(seen, _)| *seen == name) {
            Some(index) => index,
            None => {
                settings.push((name, Vec::new()));
                settings.len() - 1
            }
        };
        let helpers = &mut settings[index].1;
        if value.trim().is_empty() {
            helpers.clear();
        } else {
            helpers.push(value.trim());
        }
    }
    let helpers: Vec<&str> = settings
        .into_iter()
        .flat_map(|(_, helpers)| helpers)
        .collect();
    match helpers.iter().find(|helper| is_credential_manager(helper)) {
        Some(helper) => CredentialManager::Configured {
            helper: (*helper).to_owned(),
        },
        None => CredentialManager::NotConfigured {
            helpers: helpers.into_iter().map(str::to_owned).collect(),
        },
    }
}

/// Whether a `credential.helper` value runs Git Credential Manager: by its
/// short name, `manager` (or the older `manager-core`), which Git runs as
/// `git-credential-manager`, or by a path or command naming that program.
fn is_credential_manager(helper: &str) -> bool {
    let helper = helper.to_ascii_lowercase();
    matches!(
        helper.split_whitespace().next(),
        Some("manager" | "manager-core")
    ) || helper.contains("git-credential-manager")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn version(major: u32, minor: u32, patch: u32) -> GitVersion {
        GitVersion {
            major,
            minor,
            patch,
        }
    }

    fn not_started(git: &Git) -> GitError {
        GitError::NotStarted {
            program: git.program().into(),
            message: "permission denied".into(),
        }
    }

    #[test]
    fn with_no_git_found_git_is_missing() {
        assert_eq!(choose(&[], |_| unreachable!()), SystemGit::Missing);
    }

    #[test]
    fn chooses_the_first_supported_git() {
        let candidates = [
            "/usr/bin/git",
            "/opt/homebrew/bin/git",
            "/usr/local/bin/git",
        ]
        .map(PathBuf::from);

        let chosen = choose(&candidates, |git| {
            Ok(match git.program().to_str() {
                Some("/usr/bin/git") => version(2, 39, 5),
                _ => version(2, 51, 0),
            })
        });

        assert_eq!(
            chosen,
            SystemGit::Supported {
                path: "/opt/homebrew/bin/git".into(),
                version: version(2, 51, 0)
            }
        );
    }

    #[test]
    fn an_old_git_is_too_old_even_if_another_did_not_run() {
        let candidates = ["/broken/git", "/usr/bin/git"].map(PathBuf::from);

        let chosen = choose(&candidates, |git| match git.program().to_str() {
            Some("/usr/bin/git") => Ok(version(2, 39, 5)),
            _ => Err(not_started(git)),
        });

        assert_eq!(
            chosen,
            SystemGit::TooOld {
                path: "/usr/bin/git".into(),
                version: version(2, 39, 5)
            }
        );
    }

    #[test]
    fn a_git_that_does_not_run_is_unusable_and_says_why() {
        let chosen = choose(&[PathBuf::from("/broken/git")], |git| Err(not_started(git)));

        assert_eq!(
            chosen,
            SystemGit::Unusable {
                path: "/broken/git".into(),
                message: "'/broken/git' could not be started: permission denied".into()
            }
        );
    }

    #[test]
    fn git_credential_manager_s_version_is_the_first_line_it_writes() {
        let wrote = |stdout: &str| {
            Ok(GitOutput {
                stdout: stdout.into(),
                messages: String::new(),
            })
        };

        assert_eq!(
            version_said(wrote("2.6.1+b2b8e0d0b8\n")),
            Some("2.6.1+b2b8e0d0b8".into())
        );
        assert_eq!(version_said(wrote("\n")), None);
        assert_eq!(
            version_said(Err(GitError::Failed {
                command: "git credential-manager --version".into(),
                code: Some(1),
                message: "git: 'credential-manager' is not a git command.".into(),
            })),
            None
        );
    }

    fn helpers(config: &str) -> CredentialManager {
        credential_manager_in(config.as_bytes())
    }

    #[test]
    fn finds_git_credential_manager_however_it_is_named() {
        for helper in [
            "manager",
            "manager-core",
            "/usr/local/share/gcm-core/git-credential-manager",
            "C:/Program\\ Files/Git/mingw64/bin/git-credential-manager.exe",
            "!/opt/homebrew/bin/git-credential-manager \"$@\"",
        ] {
            assert_eq!(
                helpers(&format!("credential.helper\n{helper}\0")),
                CredentialManager::Configured {
                    helper: helper.into()
                },
                "{helper}"
            );
        }
    }

    #[test]
    fn finds_git_credential_manager_set_for_one_host() {
        assert_eq!(
            helpers(
                "credential.helper\nosxkeychain\0credential.https://github.com.helper\nmanager\0"
            ),
            CredentialManager::Configured {
                helper: "manager".into()
            }
        );
    }

    #[test]
    fn other_helpers_are_not_git_credential_manager() {
        assert_eq!(
            helpers("credential.helper\nosxkeychain\0credential.helper\ncache --timeout=3600\0"),
            CredentialManager::NotConfigured {
                helpers: vec!["osxkeychain".into(), "cache --timeout=3600".into()]
            }
        );
        assert_eq!(
            helpers(""),
            CredentialManager::NotConfigured { helpers: vec![] }
        );
    }

    #[test]
    fn an_empty_helper_clears_the_ones_before_it() {
        assert_eq!(
            helpers("credential.helper\nmanager\0credential.helper\n\0credential.helper\nstore\0"),
            CredentialManager::NotConfigured {
                helpers: vec!["store".into()]
            }
        );
    }

    #[test]
    fn a_setup_is_complete_with_a_supported_git_and_git_credential_manager() {
        let supported = SystemGit::Supported {
            path: "/usr/bin/git".into(),
            version: version(2, 47, 3),
        };
        let configured = CredentialManager::Configured {
            helper: "manager".into(),
        };

        assert!(
            GitSetup {
                git: supported.clone(),
                credential_manager: configured.clone()
            }
            .is_complete()
        );
        assert!(
            !GitSetup {
                git: supported,
                credential_manager: CredentialManager::NotConfigured { helpers: vec![] }
            }
            .is_complete()
        );
        assert!(
            !GitSetup {
                git: SystemGit::TooOld {
                    path: "/usr/bin/git".into(),
                    version: version(2, 39, 5)
                },
                credential_manager: configured
            }
            .is_complete()
        );
    }
}
