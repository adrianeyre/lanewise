//! The Generic Host Integration: Tier 1, for every Host (PRD §9.1). Git
//! clones, fetches, pulls and pushes over HTTPS or SSH, signing in with the
//! user's own credential helpers and SSH setup, and Lanewise adds nothing.

use super::{HostError, HostIntegration, IntegrationKind, RepositoryList, SignedIn};
use crate::page::PageRequest;

/// Serves every Host, at Tier 1: plain Git, with no sign-in of its own and
/// no repositories to browse.
#[derive(Clone, Copy, Debug, Default)]
pub struct GenericHostIntegration;

impl HostIntegration for GenericHostIntegration {
    fn kind(&self) -> IntegrationKind {
        IntegrationKind::Generic
    }

    fn tier(&self) -> u8 {
        1
    }

    fn serves(&self, name: &str) -> Option<String> {
        Some(name.to_owned())
    }

    fn sign_in(&self, host: &str, _again: bool) -> Result<SignedIn, HostError> {
        Err(self.not_offered(host))
    }

    fn repositories(
        &self,
        host: &str,
        _query: &str,
        _page: &PageRequest,
    ) -> Result<RepositoryList, HostError> {
        Err(self.not_offered(host))
    }
}

impl GenericHostIntegration {
    fn not_offered(&self, host: &str) -> HostError {
        HostError::NotOffered {
            host: host.into(),
            tier: self.tier(),
        }
    }
}
