//! The `git` the tests run is one Lanewise supports.

mod support;

use lanewise_core::{Git, MINIMUM_VERSION};

#[test]
fn the_git_on_path_is_at_least_the_minimum() {
    let output = support::git().arg("--version").output().expect("git runs");
    assert!(output.status.success());

    let version = Git::new("git").version().expect("git says its version");
    assert!(version >= MINIMUM_VERSION, "{version}");
}
