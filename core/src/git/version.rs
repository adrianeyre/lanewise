//! Git's version, and the oldest one Lanewise supports.

use std::fmt;

/// A Git release's version: `2.47.3`. Versions order by major, then minor,
/// then patch.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct GitVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

/// The oldest Git Lanewise supports (ADR 0002, PRD §9.3).
pub const MINIMUM_VERSION: GitVersion = GitVersion {
    major: 2,
    minor: 40,
    patch: 0,
};

impl GitVersion {
    /// The version in `git --version`'s output on any platform, such as
    /// `git version 2.47.3`, `git version 2.51.0.windows.1` or
    /// `git version 2.39.5 (Apple Git-154)`. A missing patch number is 0.
    pub fn parse(reported: &str) -> Option<Self> {
        let version = reported.trim().strip_prefix("git version ")?;
        let mut parts = version.split(['.', ' ', '-']);
        let major = parts.next()?.parse().ok()?;
        let minor = parts.next()?.parse().ok()?;
        let patch = parts
            .next()
            .and_then(|patch| patch.parse().ok())
            .unwrap_or(0);
        Some(Self {
            major,
            minor,
            patch,
        })
    }

    /// Whether Lanewise supports this version: [`MINIMUM_VERSION`] or later.
    pub fn is_supported(self) -> bool {
        self >= MINIMUM_VERSION
    }
}

impl fmt::Display for GitVersion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

#[cfg(test)]
mod tests {
    use super::{GitVersion, MINIMUM_VERSION};

    fn version(major: u32, minor: u32, patch: u32) -> GitVersion {
        GitVersion {
            major,
            minor,
            patch,
        }
    }

    #[test]
    fn reads_the_version_git_reports_on_each_platform() {
        assert_eq!(
            GitVersion::parse("git version 2.47.3"),
            Some(version(2, 47, 3))
        );
        assert_eq!(
            GitVersion::parse("git version 2.51.0.windows.1\n"),
            Some(version(2, 51, 0))
        );
        assert_eq!(
            GitVersion::parse("git version 2.39.5 (Apple Git-154)"),
            Some(version(2, 39, 5))
        );
        assert_eq!(
            GitVersion::parse("git version 2.52.0-rc1"),
            Some(version(2, 52, 0))
        );
        assert_eq!(GitVersion::parse("git version 3.0"), Some(version(3, 0, 0)));
    }

    #[test]
    fn reads_nothing_from_output_that_is_not_a_version() {
        for reported in [
            "",
            "git: command not found",
            "git version two",
            "git version 2",
            "xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools)",
        ] {
            assert_eq!(GitVersion::parse(reported), None, "{reported}");
        }
    }

    #[test]
    fn supports_2_40_and_later() {
        assert_eq!(MINIMUM_VERSION, version(2, 40, 0));
        assert!(!version(2, 39, 5).is_supported());
        assert!(!version(1, 99, 0).is_supported());
        assert!(version(2, 40, 0).is_supported());
        assert!(version(2, 100, 0).is_supported());
        assert!(version(3, 0, 0).is_supported());
    }

    #[test]
    fn shows_as_major_minor_patch() {
        assert_eq!(version(2, 39, 5).to_string(), "2.39.5");
    }
}
