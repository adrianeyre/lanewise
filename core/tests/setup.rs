//! The Git Setup check, against the real `git` and, on Unix, against
//! stand-ins for an old one and a broken one.

mod support;

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use lanewise_core::{
    CredentialManager, GitSearch, MINIMUM_VERSION, SystemGit, check_git_setup, check_git_setup_in,
};

/// A search of only these folders, as `PATH`.
fn search_path(folders: &[&Path]) -> GitSearch {
    GitSearch {
        path: Some(std::env::join_paths(folders).expect("a PATH")),
        well_known: vec![],
    }
}

/// Where the real `git` is.
fn real_git() -> PathBuf {
    support::git();
    GitSearch::system()
        .candidates()
        .into_iter()
        .next()
        .expect("the tests' git is found")
}

#[test]
fn finds_this_machine_s_git_and_asks_it_about_git_credential_manager() {
    support::git();

    let setup = check_git_setup();

    let SystemGit::Supported { path, version } = &setup.git else {
        panic!("expected the tests' git to be supported: {setup:?}");
    };
    assert!(path.is_absolute(), "{path:?}");
    assert!(*version >= MINIMUM_VERSION);
    assert!(
        matches!(
            setup.credential_manager,
            CredentialManager::Configured { .. } | CredentialManager::NotConfigured { .. }
        ),
        "{setup:?}"
    );
}

#[test]
fn with_no_git_to_find_git_is_missing_and_nothing_is_asked() {
    let empty = tempfile::tempdir().expect("a temporary folder");

    let setup = check_git_setup_in(&search_path(&[empty.path()]));

    assert_eq!(setup.git, SystemGit::Missing);
    assert_eq!(setup.credential_manager, CredentialManager::Unchecked);
    assert!(!setup.is_complete());
}

#[test]
fn with_no_path_at_all_git_is_found_in_a_well_known_place() {
    let git = real_git();

    let setup = check_git_setup_in(&GitSearch {
        path: None,
        well_known: vec![git.clone()],
    });

    assert!(
        matches!(&setup.git, SystemGit::Supported { path, .. } if *path == git),
        "{setup:?}"
    );
}

#[test]
fn a_relative_folder_on_path_is_never_searched() {
    let relative = OsString::from(".");

    let search = GitSearch {
        path: Some(relative),
        well_known: vec![],
    };

    assert_eq!(search.candidates(), Vec::<PathBuf>::new());
}

#[cfg(unix)]
mod stand_ins {
    use std::io::Write;
    use std::process::{Command, Stdio};

    use lanewise_core::GitVersion;
    use tempfile::TempDir;

    use super::*;

    /// A folder holding a `git` that runs `script`.
    ///
    /// A child `sh` writes it, so this process never holds it open for
    /// writing: a `git` another test starts meanwhile would inherit that
    /// until it `exec`s, and running the stand-in then fails with "Text file
    /// busy".
    fn fake_git(script: &str) -> TempDir {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let git = dir.path().join("git");
        let mut sh = Command::new("sh")
            .args(["-c", r#"cat > "$1" && chmod 755 "$1""#, "sh"])
            .arg(&git)
            .stdin(Stdio::piped())
            .spawn()
            .expect("sh starts");
        sh.stdin
            .take()
            .expect("sh's input")
            .write_all(format!("#!/bin/sh\n{script}\n").as_bytes())
            .unwrap();
        assert!(sh.wait().expect("sh finishes").success());
        dir
    }

    /// Apple's Git, which is older than 2.40, with no credential helpers.
    fn apple_git() -> TempDir {
        fake_git(
            r#"case "$1" in
  --version) echo "git version 2.39.5 (Apple Git-154)" ;;
  *) exit 1 ;;
esac"#,
        )
    }

    #[test]
    fn an_old_git_is_too_old_and_still_asked_about_its_credential_helpers() {
        let old = apple_git();

        let setup = check_git_setup_in(&search_path(&[old.path()]));

        assert_eq!(
            setup.git,
            SystemGit::TooOld {
                path: old.path().join("git"),
                version: GitVersion {
                    major: 2,
                    minor: 39,
                    patch: 5
                }
            }
        );
        assert_eq!(
            setup.credential_manager,
            CredentialManager::NotConfigured { helpers: vec![] }
        );
    }

    #[test]
    fn a_supported_git_later_on_path_is_chosen_over_an_old_one() {
        let old = apple_git();
        let git = real_git();

        let setup = check_git_setup_in(&search_path(&[old.path(), git.parent().unwrap()]));

        assert!(
            matches!(&setup.git, SystemGit::Supported { path, .. } if *path == git),
            "{setup:?}"
        );
    }

    #[test]
    fn a_git_that_does_not_say_its_version_is_unusable() {
        let placeholder = fake_git(
            r#"echo "xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools)" >&2
exit 1"#,
        );

        let setup = check_git_setup_in(&search_path(&[placeholder.path()]));

        assert_eq!(
            setup.git,
            SystemGit::Unusable {
                path: placeholder.path().join("git"),
                message: "`git --version` failed: xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools)".into()
            }
        );
        assert_eq!(setup.credential_manager, CredentialManager::Unchecked);
    }
}
