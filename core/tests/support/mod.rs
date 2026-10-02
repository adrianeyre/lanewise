//! What the core's integration tests share. Tests that need Git run the
//! system `git` on `PATH`, as Lanewise itself does (ADR 0002): the sandbox
//! image's, or the CI runner's.

use std::process::Command;
use std::sync::OnceLock;

use lanewise_core::{Git, MINIMUM_VERSION};

/// A `git` command, having checked once per test binary, with the core's own
/// version check, that the `git` on `PATH` runs and is at least
/// [`MINIMUM_VERSION`]. Panics, saying which `git` and why, if not, so a
/// runner with an old Git fails clearly rather than in whatever test first
/// trips over it.
pub fn git() -> Command {
    static CHECKED: OnceLock<()> = OnceLock::new();
    CHECKED.get_or_init(|| match Git::new("git").version() {
        Ok(version) if version.is_supported() => {}
        Ok(version) => panic!(
            "these tests need git {MINIMUM_VERSION} or later (ADR 0002), but the git on PATH is {version}"
        ),
        Err(error) => panic!(
            "these tests need git {MINIMUM_VERSION} or later on PATH (ADR 0002), and it didn't say its version: {error}"
        ),
    });
    Command::new("git")
}
