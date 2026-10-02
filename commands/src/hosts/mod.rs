//! Host Integrations (PRD §9.1, §9.4): what Lanewise does for one kind of
//! Host beyond plain Git remotes. Each is a [`HostIntegration`]. The
//! [`GenericHostIntegration`] serves every Host at Tier 1, where Git does all
//! the signing in. The rest serve their Hosts at Tier 2, with guided sign-in
//! and repository browsing for clone: the [`GitHubHostIntegration`] GitHub.com
//! and the GitHub Enterprise Server Hosts the user added in Settings, the
//! [`GitLabHostIntegration`] GitLab.com, the [`BitbucketHostIntegration`]
//! Bitbucket Cloud and the [`AzureDevOpsHostIntegration`] Azure DevOps
//! Services (ADR 0037). New Host Integrations plug in here, without changing
//! the core.
//!
//! Signing in asks the user's own credential helpers for the Host's
//! credential, through `git credential fill` (ADR 0016), so Git Credential
//! Manager does the browser sign-in and SSO. Lanewise never sees a password.
//! The token it gives is used for the call it was asked for, and not kept.

mod answer;
mod azure_devops;
mod bitbucket;
mod generic;
mod github;
mod gitlab;
mod listing;
#[cfg(test)]
mod stand_in;

use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use lanewise_core::{
    ConfiguredRemote, Credential, CredentialError, Credentials, GitError, ManageRemotes as _,
    Repository, remote_host, remote_path,
};
use serde::{Deserialize, Serialize};

use crate::Command;
use crate::page::{Page, PageRequest};
use crate::repository::RepositoryError;
use crate::working_tree::system_git;

pub use azure_devops::AzureDevOpsHostIntegration;
pub use bitbucket::BitbucketHostIntegration;
pub use generic::GenericHostIntegration;
pub use github::GitHubHostIntegration;
pub use gitlab::GitLabHostIntegration;

/// Lanewise's support for one kind of Host: the PRD's `IHostIntegration`
/// (§9.4). It detects the Hosts it serves from their remotes' URLs, at
/// Tier 2 signs in to them and lists the repositories there to clone, and
/// at Tier 3 reads their Pull Requests (ADR 0040).
// TODO: merge requests on GitLab, Pull Requests on Bitbucket and Azure
// DevOps, and CI status, at Tier 3 (PRD §9.1, post-launch).
#[doc(alias = "IHostIntegration")]
pub trait HostIntegration: Send + Sync {
    /// Which Host Integration this is.
    fn kind(&self) -> IntegrationKind;

    /// How deep it goes: 1 for plain Git, 2 with guided sign-in and
    /// repository browsing, 3 with pull or merge requests and CI status.
    fn tier(&self) -> u8;

    /// The Host this serves `name` as, from a remote's URL, such as
    /// `github.com` for `ssh.github.com` or `dev.azure.com` for
    /// `ssh.dev.azure.com`, or `None` if it doesn't serve it.
    /// `name` is lower case, with no port.
    fn serves(&self, name: &str) -> Option<String>;

    /// Signs in to `host`, a Host [`serves`](Self::serves) gave, and says
    /// who as. With `again`, the credential helpers forget the credential
    /// they have for it first, and sign in afresh.
    fn sign_in(&self, host: &str, again: bool) -> Result<SignedIn, HostError>;

    /// The repositories on `host` that the signed-in user can clone, one
    /// page at a time, those matching `query` if it isn't blank.
    fn repositories(
        &self,
        host: &str,
        query: &str,
        page: &PageRequest,
    ) -> Result<RepositoryList, HostError>;

    /// Who owns the repositories the signed-in user can list, to filter
    /// them by: the user, then their organizations. Empty where the Host
    /// Integration doesn't say.
    fn owners(&self, _host: &str) -> Result<Vec<String>, HostError> {
        Ok(Vec::new())
    }

    /// The web page of the repository at `path` on `host`, such as
    /// `https://github.com/adrianeyre/lanewise` for `adrianeyre/lanewise`,
    /// where `path` is the path in a remote's URL, as
    /// [`remote_path`] reads it.
    fn web_page(&self, host: &str, path: &str) -> String {
        format!("https://{host}/{path}")
    }

    /// The open Pull Requests of the repository at `path` on `host`, as
    /// [`web_page`](Self::web_page) takes it, newest first. Unless
    /// `interactive`, the user is never asked to sign in: only a credential
    /// the helpers already have is used, and without one, the Host is asked
    /// as nobody, as it can be for a public repository.
    fn pull_requests(
        &self,
        host: &str,
        _path: &str,
        _interactive: bool,
    ) -> Result<Vec<PullRequest>, HostError> {
        Err(HostError::NotOffered {
            host: host.into(),
            tier: self.tier(),
        })
    }
}

/// Which Host Integration serves a Host.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum IntegrationKind {
    /// Plain Git, over HTTPS or SSH, for any Host.
    Generic,
    /// GitHub.com, or a GitHub Enterprise Server.
    #[serde(rename = "github")]
    GitHub,
    /// GitLab.com.
    GitLab,
    /// Bitbucket Cloud.
    Bitbucket,
    /// Azure DevOps Services.
    AzureDevOps,
}

/// The Host Integrations, in the order they're asked whether they serve a
/// Host: the [`GenericHostIntegration`] last, since it serves every one.
pub struct HostIntegrations {
    integrations: Vec<Box<dyn HostIntegration>>,
}

impl HostIntegrations {
    /// These `integrations`, with the [`GenericHostIntegration`] after them.
    pub fn new(integrations: Vec<Box<dyn HostIntegration>>) -> Self {
        let mut integrations = integrations;
        integrations.push(Box::new(GenericHostIntegration));
        Self { integrations }
    }

    /// Lanewise's own: GitHub, for GitHub.com and each of `enterprise_hosts`,
    /// GitLab.com, Bitbucket Cloud and Azure DevOps Services, each signing in
    /// through the system `git`'s credential helpers.
    // TODO: self-managed GitLab, Bitbucket Data Center and Azure DevOps
    // Server, each added in Settings as a GitHub Enterprise Server is.
    pub fn system(enterprise_hosts: &[String]) -> Result<Self, HostError> {
        let enterprise_hosts = enterprise_hosts
            .iter()
            .map(|host| host_name(host))
            .collect::<Result<_, _>>()?;
        let credentials = Arc::new(SystemCredentials);
        Ok(Self::new(vec![
            Box::new(GitHubHostIntegration::new(
                enterprise_hosts,
                credentials.clone(),
            )),
            Box::new(GitLabHostIntegration::new(credentials.clone())),
            Box::new(BitbucketHostIntegration::new(credentials.clone())),
            Box::new(AzureDevOpsHostIntegration::new(credentials)),
        ]))
    }

    /// The Host the remote at `url` is on, and the Host Integration that
    /// serves it. A local path, or a `file://` URL, is on no Host, and only
    /// the [`GenericHostIntegration`] serves it.
    pub fn detect(&self, url: &str) -> (Option<String>, &dyn HostIntegration) {
        match remote_host(url.trim()) {
            Some(name) => {
                let (host, integration) = self.serving(&name.to_ascii_lowercase());
                (Some(host), integration)
            }
            None => (None, self.generic()),
        }
    }

    /// The Host Integration that serves `host`, with or without its port,
    /// and the Host it serves it as.
    fn find(&self, host: &str) -> Result<(String, &dyn HostIntegration), HostError> {
        let host = host_name(host)?;
        let (name, _) = host.split_once(':').unwrap_or((&host, ""));
        let (served, integration) = self.serving(name);
        // A port is the user's to give, as the Host was added.
        Ok((if host.contains(':') { host } else { served }, integration))
    }

    fn serving(&self, name: &str) -> (String, &dyn HostIntegration) {
        self.integrations
            .iter()
            .find_map(|integration| {
                integration
                    .serves(name)
                    .map(|host| (host, integration.as_ref()))
            })
            .unwrap_or_else(|| (name.to_owned(), self.generic()))
    }

    /// Where the repository with `remotes` is on its Host: from the
    /// `origin` remote's URL, or else the first remote's that has one. `None`
    /// if that's a local path, or has no path after its Host.
    fn locate(&self, remotes: &[ConfiguredRemote]) -> Option<OnHost<'_>> {
        let origin = remotes
            .iter()
            .find(|remote| remote.name == "origin" && remote.url.is_some());
        let url = origin
            .or_else(|| remotes.iter().find(|remote| remote.url.is_some()))?
            .url
            .as_deref()?
            .trim();
        let (host, integration) = self.detect(url);
        Some(OnHost {
            host: host?,
            integration,
            path: remote_path(url)?,
        })
    }

    fn generic(&self) -> &dyn HostIntegration {
        self.integrations
            .last()
            .expect("the Generic Host Integration is always last")
            .as_ref()
    }
}

/// Where a repository is on its Host, from one of its remotes' URLs.
struct OnHost<'a> {
    host: String,
    integration: &'a dyn HostIntegration,
    /// The path in the remote's URL, such as `adrianeyre/lanewise`.
    path: String,
}

impl OnHost<'_> {
    fn web(&self) -> RepositoryWeb {
        RepositoryWeb {
            url: self.integration.web_page(&self.host, &self.path),
            host: self.host.clone(),
            integration: self.integration.kind(),
        }
    }
}

/// The web page of the repository `repository` is a clone of, on its Host,
/// from its remotes, as `openRepository` gives it. `None` if it has no
/// remote on a Host, or its remotes can't be read. GitHub Enterprise Servers
/// aren't known here, so theirs is a Generic Host's.
pub(crate) fn repository_web(repository: &Repository) -> Option<RepositoryWeb> {
    let integrations = HostIntegrations::system(&[]).ok()?;
    let remotes = repository.read_remotes().ok()?;
    integrations.locate(&remotes).map(|on_host| on_host.web())
}

/// `host` as a Host's name, lower case, with a port if it has one, such as
/// `ghe.example.com:8443`.
pub(crate) fn host_name(host: &str) -> Result<String, HostError> {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    let (name, port) = host.split_once(':').unwrap_or((&host, ""));
    let named = !name.is_empty()
        && name.split('.').all(|label| {
            !label.is_empty() && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        });
    let ported = host.contains(':') == !port.is_empty()
        && port.chars().all(|c| c.is_ascii_digit())
        && port.parse::<u16>().is_ok_and(|port| port > 0) == !port.is_empty();
    if named && ported {
        Ok(host)
    } else {
        Err(HostError::InvalidHost { host })
    }
}

/// `detectHost`: which Host the remote at `url` is on, and which Host
/// Integration serves it, from its URL alone. Nothing is sent to the Host.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DetectHost {
    /// A remote's URL, HTTPS or SSH, as Git takes it.
    pub url: String,
    /// The GitHub Enterprise Server Hosts the user added in Settings, by
    /// name, with a port if they gave one, such as `ghe.example.com`.
    #[serde(default)]
    pub enterprise_hosts: Vec<String>,
}

/// The Host a remote is on.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedHost {
    /// The Host, such as `github.com`, or `null` for a local path.
    pub host: Option<String>,
    pub integration: IntegrationKind,
    /// The Host Integration's Tier: 1 or 2.
    pub tier: u8,
}

/// `signInToHost`: signs in to a Tier 2 Host with the credential the user's
/// credential helpers have for it, through `git credential fill`. Git
/// Credential Manager signs the user in in their browser first if it has
/// none, and the answer waits until it has.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignInToHost {
    /// The Host, as `detectHost` names it, such as `github.com`.
    pub host: String,
    #[serde(default)]
    pub enterprise_hosts: Vec<String>,
    /// Forget the credential the helpers have for the Host first, such as a
    /// token that lacks a scope, and sign in afresh.
    #[serde(default)]
    pub again: bool,
}

/// Who a Host signed in.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedIn {
    pub host: String,
    /// The user's name on the Host, such as `octocat`.
    pub login: String,
    /// Their full name, if they gave the Host one.
    pub name: Option<String>,
    /// The scopes the token lacks for all the Host Integration does, such as
    /// `repo` for private repositories. Empty where the Host doesn't say
    /// what a token has, as for GitHub's fine-grained tokens.
    pub missing_scopes: Vec<String>,
}

/// `hostRepositories`: the repositories on a signed-in Tier 2 Host that the
/// user can clone: their own, their organizations' and those they
/// collaborate on, by name, a page at a time. With a `query`, only those
/// whose name or description has every word of it. A page with fewer items
/// than asked for may still have a `nextCursor`, when there are more
/// repositories still to look through.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostRepositories {
    pub host: String,
    #[serde(default)]
    pub enterprise_hosts: Vec<String>,
    #[serde(default)]
    pub query: String,
    /// Only the repositories this user or organization owns, if it's named.
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub page: PageRequest,
}

/// `hostOwners`: who owns the repositories the signed-in user can list on
/// `host`, to filter `hostRepositories` by: the user, then their
/// organizations, such as GitHub's.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostOwners {
    pub host: String,
    #[serde(default)]
    pub enterprise_hosts: Vec<String>,
}

/// Who owns the repositories a user can list on a Host.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryOwners {
    /// The user first, then their organizations, sorted; empty where the Host doesn't say.
    pub owners: Vec<String>,
}

/// A page of a Host's repositories.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryList {
    #[serde(flatten)]
    pub page: Page<HostRepository>,
    /// The scopes the token lacks to list them all, such as `repo`, without
    /// which only public repositories are listed.
    pub missing_scopes: Vec<String>,
    /// Some organizations' repositories were left out, because they use
    /// SAML SSO, and the token hasn't been authorized for it.
    pub sso_left_out: bool,
}

/// One repository on a Host, to clone.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostRepository {
    /// Its owner and name, such as `adrianeyre/lanewise`, or on Azure
    /// DevOps its organization, project and name, such as
    /// `fabrikam/Web/lanewise`.
    pub full_name: String,
    pub description: Option<String>,
    pub private: bool,
    pub fork: bool,
    pub archived: bool,
    /// Its HTTPS URL, to clone with the credential helper.
    pub clone_url: String,
    /// Its SSH URL, to clone with an SSH key.
    pub ssh_url: Option<String>,
}

/// The web page of a repository on its Host.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryWeb {
    /// Such as `https://github.com/adrianeyre/lanewise`.
    pub url: String,
    /// The Host, as `detectHost` names it, such as `github.com`.
    pub host: String,
    pub integration: IntegrationKind,
}

/// `pullRequests`: the open Pull Requests of the repository on its Host,
/// newest first, from its `origin` remote, or else its first remote with a
/// URL. Unless `interactive`, as when a Widget loads on its own, the user is
/// never asked to sign in: only a credential their helpers already have is
/// used, and without one, the Host is asked as nobody, which it answers for
/// a public repository. With `interactive`, the helpers sign in as for
/// `signInToHost`. Only GitHub's Host Integration offers them yet.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PullRequests {
    /// The repository's `root`, as `openRepository` gave it.
    pub repository: PathBuf,
    #[serde(default)]
    pub enterprise_hosts: Vec<String>,
    #[serde(default)]
    pub interactive: bool,
}

/// A repository's open Pull Requests, and the Host they're on.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryPullRequests {
    pub host: String,
    pub integration: IntegrationKind,
    /// Newest first.
    pub pull_requests: Vec<PullRequest>,
}

/// One open Pull Request.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    /// Its web page.
    pub url: String,
    /// Who opened it, by their name on the Host, if the Host still has them.
    pub author: Option<String>,
    pub draft: bool,
    /// The branch it asks to merge.
    pub head: PullRequestHead,
    /// The branch it asks to merge into, such as `main`.
    pub base: String,
    /// When it last changed, as the Host gave it, such as
    /// `2026-09-30T12:00:00Z`.
    pub updated_at: Option<String>,
}

/// The branch a Pull Request asks to merge.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestHead {
    /// Its name, in the repository it's in.
    pub branch: String,
    /// Its tip's full ID, to mark it in the Commit graph.
    pub commit: String,
    /// The repository it's in, such as a fork's `octocat/lanewise`, or
    /// `null` if that has been deleted.
    pub repository: Option<String>,
}

/// Why a Host Integration couldn't sign in, list repositories or read Pull
/// Requests.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum HostError {
    /// There's no supported `git` to run: `checkGitSetup` says why.
    GitUnavailable,
    /// `host` isn't a Host's name, with a port if it has one.
    InvalidHost { host: String },
    /// The Host's Host Integration doesn't offer this: at Tier 1, Git signs
    /// in to it on its own, and it has no repositories to browse, and below
    /// Tier 3, or for a Host whose Pull Requests aren't read yet, there are
    /// no Pull Requests.
    NotOffered { host: String, tier: u8 },
    /// No credential helper gave a credential for the Host: none is set up,
    /// or the user cancelled its sign-in. `message` is what Git said.
    NoCredential { host: String, message: String },
    /// The Host refused the credential the helpers gave, so they were told
    /// to forget it. Signing in again asks for a new one.
    TokenRefused { host: String },
    /// The token lacks a scope, or a permission, that's needed. `needed` is
    /// the scopes the Host asked for, if it said.
    MissingScope { host: String, needed: Vec<String> },
    /// An organization's SAML SSO hasn't authorized the token. `url` is
    /// where to authorize it, if the Host gave one.
    SsoNotAuthorized { host: String, url: Option<String> },
    /// The Host has had too many requests from this user for now. It takes
    /// more after `resetsAt`, in seconds since 1970, if it said when.
    RateLimited {
        host: String,
        resets_at: Option<u64>,
    },
    /// The Host, at the address it was added with, isn't a GitHub
    /// Enterprise Server: its API isn't there.
    NotGitHub { host: String },
    /// The Host couldn't be reached, such as for want of a network, or
    /// because its certificate isn't trusted. `message` says why.
    Unreachable { host: String, message: String },
    /// The Host answered with an error. `message` is what it said.
    HostFailed {
        host: String,
        status: u16,
        message: String,
    },
    /// A cursor this command didn't make, or from a list that has changed.
    /// Start again from the first page.
    InvalidCursor,
}

/// Why `pullRequests` failed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PullRequestsError {
    /// None of the repository's remotes is on a Host: it has none, or
    /// they're local paths.
    NoHost,
    /// Travels as the [`HostError`] itself.
    #[serde(untagged)]
    Host(HostError),
    /// Travels as the [`RepositoryError`] itself: the repository didn't
    /// open or read.
    #[serde(untagged)]
    Repository(RepositoryError),
}

impl From<HostError> for PullRequestsError {
    fn from(error: HostError) -> Self {
        Self::Host(error)
    }
}

impl From<RepositoryError> for PullRequestsError {
    fn from(error: RepositoryError) -> Self {
        Self::Repository(error)
    }
}

impl HostError {
    /// Why there was no credential for `host`.
    fn from_credential(host: &str, error: CredentialError) -> Self {
        match error {
            CredentialError::InvalidHost { host } => Self::InvalidHost { host },
            CredentialError::NoCredential { message } => Self::NoCredential {
                host: host.into(),
                message,
            },
            CredentialError::Git(GitError::NotFound { .. } | GitError::NotStarted { .. }) => {
                Self::GitUnavailable
            }
            CredentialError::Git(error) => Self::NoCredential {
                host: host.into(),
                message: error.to_string(),
            },
        }
    }
}

impl Command for DetectHost {
    const NAME: &'static str = "detectHost";
    type Response = DetectedHost;
    type Error = HostError;

    fn run(self) -> Result<DetectedHost, HostError> {
        let integrations = HostIntegrations::system(&self.enterprise_hosts)?;
        let (host, integration) = integrations.detect(&self.url);
        Ok(DetectedHost {
            host,
            integration: integration.kind(),
            tier: integration.tier(),
        })
    }
}

impl Command for SignInToHost {
    const NAME: &'static str = "signInToHost";
    type Response = SignedIn;
    type Error = HostError;

    fn run(self) -> Result<SignedIn, HostError> {
        let integrations = HostIntegrations::system(&self.enterprise_hosts)?;
        let (host, integration) = integrations.find(&self.host)?;
        integration.sign_in(&host, self.again)
    }
}

impl Command for HostRepositories {
    const NAME: &'static str = "hostRepositories";
    type Response = RepositoryList;
    type Error = HostError;

    fn run(self) -> Result<RepositoryList, HostError> {
        let integrations = HostIntegrations::system(&self.enterprise_hosts)?;
        let (host, integration) = integrations.find(&self.host)?;
        let query = match self.owner.as_deref().map(str::trim) {
            Some(owner) if !owner.is_empty() => format!("owner:{owner} {}", self.query),
            _ => self.query,
        };
        integration.repositories(&host, &query, &self.page)
    }
}

impl Command for HostOwners {
    const NAME: &'static str = "hostOwners";
    type Response = RepositoryOwners;
    type Error = HostError;

    fn run(self) -> Result<RepositoryOwners, HostError> {
        let integrations = HostIntegrations::system(&self.enterprise_hosts)?;
        let (host, integration) = integrations.find(&self.host)?;
        Ok(RepositoryOwners {
            owners: integration.owners(&host)?,
        })
    }
}

impl Command for PullRequests {
    const NAME: &'static str = "pullRequests";
    type Response = RepositoryPullRequests;
    type Error = PullRequestsError;

    fn run(self) -> Result<RepositoryPullRequests, PullRequestsError> {
        let repository = Repository::open(&self.repository).map_err(RepositoryError::from)?;
        let integrations = HostIntegrations::system(&self.enterprise_hosts)?;
        let remotes = repository
            .read_remotes()
            .map_err(|error| RepositoryError::Unreadable {
                path: repository.root().to_path_buf(),
                message: error.to_string(),
            })?;
        let on_host = integrations
            .locate(&remotes)
            .ok_or(PullRequestsError::NoHost)?;
        let pull_requests =
            on_host
                .integration
                .pull_requests(&on_host.host, &on_host.path, self.interactive)?;
        Ok(RepositoryPullRequests {
            integration: on_host.integration.kind(),
            host: on_host.host,
            pull_requests,
        })
    }
}

/// The credential helpers of the system `git`, as `checkGitSetup` finds it.
struct SystemCredentials;

impl SystemCredentials {
    fn git() -> Result<lanewise_core::Git, CredentialError> {
        system_git().ok_or(CredentialError::Git(GitError::NotFound {
            program: "git".into(),
        }))
    }
}

impl Credentials for SystemCredentials {
    fn fill(&self, host: &str) -> Result<Credential, CredentialError> {
        Self::git()?.fill(host)
    }

    fn fill_quietly(&self, host: &str) -> Result<Credential, CredentialError> {
        Self::git()?.fill_quietly(host)
    }

    fn approve(&self, credential: &Credential) -> Result<(), CredentialError> {
        Self::git()?.approve(credential)
    }

    fn reject(&self, credential: &Credential) -> Result<(), CredentialError> {
        Self::git()?.reject(credential)
    }
}

/// How long a Host's API has to answer, before it's taken as unreachable.
const API_TIMEOUT: Duration = Duration::from_secs(30);

/// The HTTP client every Host Integration's API calls share. It trusts the
/// OS's certificates, so a GitHub Enterprise Server with a company's own
/// authority is trusted as the browser trusts it, and it takes the proxy
/// from `HTTPS_PROXY`. It never follows a redirect, which could carry the
/// token to another Host.
pub(crate) fn agent() -> ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT
        .get_or_init(|| {
            ureq::Agent::config_builder()
                .http_status_as_error(false)
                .max_redirects(0)
                .max_redirects_will_error(false)
                .timeout_global(Some(API_TIMEOUT))
                .user_agent(concat!("Lanewise/", env!("CARGO_PKG_VERSION")))
                .tls_config(
                    ureq::tls::TlsConfig::builder()
                        .root_certs(ureq::tls::RootCerts::PlatformVerifier)
                        .build(),
                )
                .build()
                .into()
        })
        .clone()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn integrations(enterprise: &[&str]) -> HostIntegrations {
        HostIntegrations::system(
            &enterprise
                .iter()
                .map(|&host| host.into())
                .collect::<Vec<_>>(),
        )
        .unwrap()
    }

    fn detected(integrations: &HostIntegrations, url: &str) -> (Option<String>, IntegrationKind) {
        let (host, integration) = integrations.detect(url);
        (host, integration.kind())
    }

    #[test]
    fn detects_github_from_its_remotes_urls() {
        let integrations = integrations(&[]);
        for url in [
            "https://github.com/adrianeyre/lanewise.git",
            "https://octocat:token@GitHub.com/adrianeyre/lanewise",
            "git@github.com:adrianeyre/lanewise.git",
            "ssh://git@ssh.github.com:443/adrianeyre/lanewise.git",
        ] {
            assert_eq!(
                detected(&integrations, url),
                (Some("github.com".into()), IntegrationKind::GitHub),
                "{url}"
            );
        }
    }

    #[test]
    fn detects_an_enterprise_server_only_once_it_is_added() {
        let url = "git@ghe.example.com:platform/lanewise.git";
        assert_eq!(
            detected(&integrations(&[]), url),
            (Some("ghe.example.com".into()), IntegrationKind::Generic)
        );
        let added = integrations(&["GHE.example.com:8443"]);
        assert_eq!(
            detected(&added, url),
            (Some("ghe.example.com:8443".into()), IntegrationKind::GitHub)
        );
        assert_eq!(
            detected(&added, "https://ghe.example.com:8443/platform/lanewise.git"),
            (Some("ghe.example.com:8443".into()), IntegrationKind::GitHub)
        );
    }

    #[test]
    fn detects_gitlab_bitbucket_and_azure_devops_from_their_remotes_urls() {
        let integrations = integrations(&[]);
        for (url, host, kind) in [
            (
                "https://gitlab.com/gitlab-org/gitlab.git",
                "gitlab.com",
                IntegrationKind::GitLab,
            ),
            (
                "git@gitlab.com:gitlab-org/gitlab.git",
                "gitlab.com",
                IntegrationKind::GitLab,
            ),
            (
                "ssh://git@altssh.gitlab.com:443/gitlab-org/gitlab.git",
                "gitlab.com",
                IntegrationKind::GitLab,
            ),
            (
                "https://octocat@bitbucket.org/team/lanewise.git",
                "bitbucket.org",
                IntegrationKind::Bitbucket,
            ),
            (
                "git@bitbucket.org:team/lanewise.git",
                "bitbucket.org",
                IntegrationKind::Bitbucket,
            ),
            (
                "https://fabrikam@dev.azure.com/fabrikam/Web/_git/lanewise",
                "dev.azure.com",
                IntegrationKind::AzureDevOps,
            ),
            (
                "git@ssh.dev.azure.com:v3/fabrikam/Web/lanewise",
                "dev.azure.com",
                IntegrationKind::AzureDevOps,
            ),
            (
                "fabrikam@vs-ssh.visualstudio.com:v3/fabrikam/Web/lanewise",
                "dev.azure.com",
                IntegrationKind::AzureDevOps,
            ),
            (
                "https://fabrikam.visualstudio.com/Web/_git/lanewise",
                "fabrikam.visualstudio.com",
                IntegrationKind::AzureDevOps,
            ),
        ] {
            assert_eq!(
                detected(&integrations, url),
                (Some(host.into()), kind),
                "{url}"
            );
        }
        let (_, integration) = integrations.find("dev.azure.com").unwrap();
        assert_eq!(integration.tier(), 2);
    }

    #[test]
    fn any_other_host_is_generic_and_a_local_path_is_on_none() {
        let integrations = integrations(&[]);
        assert_eq!(
            detected(
                &integrations,
                "https://git.example.com/platform/lanewise.git"
            ),
            (Some("git.example.com".into()), IntegrationKind::Generic)
        );
        assert_eq!(
            detected(
                &integrations,
                "https://gitlab.example.com/platform/lanewise.git"
            ),
            (Some("gitlab.example.com".into()), IntegrationKind::Generic)
        );
        assert_eq!(
            detected(&integrations, "https://github.com.example.com/lanewise.git"),
            (
                Some("github.com.example.com".into()),
                IntegrationKind::Generic
            )
        );
        for url in [
            "/work/lanewise",
            "file:///work/lanewise",
            "C:\\work\\lanewise",
        ] {
            assert_eq!(
                detected(&integrations, url),
                (None, IntegrationKind::Generic),
                "{url}"
            );
        }
    }

    #[test]
    fn a_generic_host_offers_no_sign_in_or_browsing() {
        let integrations = integrations(&[]);
        let (host, integration) = integrations.find("git.example.com").unwrap();

        assert_eq!(integration.tier(), 1);
        assert_eq!(
            integration.sign_in(&host, false),
            Err(HostError::NotOffered {
                host: "git.example.com".into(),
                tier: 1
            })
        );
        assert_eq!(
            integration.repositories(&host, "", &PageRequest::default()),
            Err(HostError::NotOffered {
                host: "git.example.com".into(),
                tier: 1
            })
        );
    }

    #[test]
    fn only_github_offers_pull_requests_yet() {
        let integrations = integrations(&[]);
        for (host, tier) in [
            ("git.example.com", 1),
            ("gitlab.com", 2),
            ("bitbucket.org", 2),
            ("dev.azure.com", 2),
        ] {
            let (host, integration) = integrations.find(host).unwrap();
            assert_eq!(
                integration.pull_requests(&host, "team/lanewise", false),
                Err(HostError::NotOffered {
                    host: host.clone(),
                    tier
                }),
                "{host}"
            );
        }
    }

    fn remote(name: &str, url: Option<&str>) -> ConfiguredRemote {
        ConfiguredRemote {
            name: name.into(),
            url: url.map(str::to_owned),
            push_url: None,
        }
    }

    /// The web page of a repository with `origin` at `url`.
    fn web(url: &str) -> Option<RepositoryWeb> {
        integrations(&[])
            .locate(&[remote("origin", Some(url))])
            .map(|on_host| on_host.web())
    }

    fn web_page(url: &str) -> Option<String> {
        web(url).map(|web| web.url)
    }

    #[test]
    fn a_repository_s_web_page_is_read_from_its_remote_s_url() {
        for url in [
            "https://github.com/adrianeyre/lanewise.git",
            "https://github.com/adrianeyre/lanewise/",
            "http://github.com/adrianeyre/lanewise",
            "https://octocat:gho_secret@github.com/adrianeyre/lanewise.git",
            "git@github.com:adrianeyre/lanewise.git",
            "ssh://git@github.com/adrianeyre/lanewise.git",
            "ssh://git@ssh.github.com:443/adrianeyre/lanewise.git",
        ] {
            assert_eq!(
                web(url),
                Some(RepositoryWeb {
                    url: "https://github.com/adrianeyre/lanewise".into(),
                    host: "github.com".into(),
                    integration: IntegrationKind::GitHub,
                }),
                "{url}"
            );
        }
        assert_eq!(
            web_page("git@gitlab.com:group/sub/lanewise.git").as_deref(),
            Some("https://gitlab.com/group/sub/lanewise")
        );
        assert_eq!(
            web("https://git.example.com:8443/team/lanewise.git"),
            Some(RepositoryWeb {
                url: "https://git.example.com/team/lanewise".into(),
                host: "git.example.com".into(),
                integration: IntegrationKind::Generic,
            })
        );
        // A GitHub Enterprise Server isn't known here, so it's a Generic Host.
        assert_eq!(
            web("git@ghe.example.com:team/lanewise.git").map(|web| web.integration),
            Some(IntegrationKind::Generic)
        );
    }

    #[test]
    fn an_azure_devops_repository_s_web_page_is_under_git() {
        for url in [
            "git@ssh.dev.azure.com:v3/fabrikam/Web/lanewise",
            "https://fabrikam@dev.azure.com/fabrikam/Web/_git/lanewise",
            "https://dev.azure.com/fabrikam/Web/_git/lanewise",
        ] {
            assert_eq!(
                web(url),
                Some(RepositoryWeb {
                    url: "https://dev.azure.com/fabrikam/Web/_git/lanewise".into(),
                    host: "dev.azure.com".into(),
                    integration: IntegrationKind::AzureDevOps,
                }),
                "{url}"
            );
        }
        assert_eq!(
            web_page("https://fabrikam.visualstudio.com/Web/_git/lanewise").as_deref(),
            Some("https://fabrikam.visualstudio.com/Web/_git/lanewise")
        );
    }

    #[test]
    fn a_repository_whose_remote_is_a_local_path_has_no_web_page() {
        for url in [
            "/home/me/lanewise",
            "../lanewise.git",
            "file:///home/me/lanewise.git",
            "C:\\work\\lanewise",
            "https://github.com/",
        ] {
            assert_eq!(web(url), None, "{url}");
        }
    }

    #[test]
    fn the_web_page_is_origin_s_or_else_the_first_remote_s_with_a_url() {
        let integrations = integrations(&[]);
        let located = |remotes: &[ConfiguredRemote]| {
            integrations
                .locate(remotes)
                .map(|on_host| on_host.web().url)
        };

        assert_eq!(
            located(&[
                remote("fork", Some("git@github.com:octocat/lanewise.git")),
                remote("origin", Some("git@github.com:adrianeyre/lanewise.git")),
            ])
            .as_deref(),
            Some("https://github.com/adrianeyre/lanewise")
        );
        assert_eq!(
            located(&[
                remote("empty", None),
                remote("fork", Some("git@github.com:octocat/lanewise.git")),
                remote("origin", None),
            ])
            .as_deref(),
            Some("https://github.com/octocat/lanewise")
        );
        assert_eq!(located(&[]), None);
    }

    #[test]
    fn a_pull_requests_request_may_leave_its_options_out() {
        assert_eq!(
            serde_json::from_value::<PullRequests>(json!({ "repository": "/work/lanewise" }))
                .unwrap(),
            PullRequests {
                repository: "/work/lanewise".into(),
                enterprise_hosts: vec![],
                interactive: false,
            }
        );
    }

    #[test]
    fn a_host_is_a_name_with_a_port_if_it_has_one() {
        for (host, name) in [
            ("github.com", "github.com"),
            (" GHE.Example.com. ", "ghe.example.com"),
            ("ghe.example.com:8443", "ghe.example.com:8443"),
            ("localhost", "localhost"),
        ] {
            assert_eq!(host_name(host).as_deref(), Ok(name), "{host}");
        }
        for host in [
            "",
            "https://github.com",
            "github.com/adrianeyre",
            "octocat@github.com",
            "ghe..example.com",
            "ghe.example.com:",
            "ghe.example.com:0",
            "ghe.example.com:99999",
            "github.com\nhost=example.com",
        ] {
            assert!(host_name(host).is_err(), "{host:?}");
        }
    }

    #[test]
    fn an_enterprise_host_that_is_no_host_is_refused() {
        assert_eq!(
            DetectHost {
                url: "https://github.com/adrianeyre/lanewise.git".into(),
                enterprise_hosts: vec!["https://ghe.example.com".into()],
            }
            .run(),
            Err(HostError::InvalidHost {
                host: "https://ghe.example.com".into()
            })
        );
    }

    #[test]
    fn detection_travels_as_camel_case() {
        assert_eq!(
            serde_json::to_value(
                DetectHost {
                    url: "git@github.com:adrianeyre/lanewise.git".into(),
                    enterprise_hosts: vec![],
                }
                .run()
                .unwrap()
            )
            .unwrap(),
            json!({ "host": "github.com", "integration": "github", "tier": 2 })
        );
        assert_eq!(
            serde_json::to_value(
                DetectHost {
                    url: "/work/lanewise".into(),
                    enterprise_hosts: vec![],
                }
                .run()
                .unwrap()
            )
            .unwrap(),
            json!({ "host": null, "integration": "generic", "tier": 1 })
        );
        for (kind, name) in [
            (IntegrationKind::GitLab, "gitLab"),
            (IntegrationKind::Bitbucket, "bitbucket"),
            (IntegrationKind::AzureDevOps, "azureDevOps"),
        ] {
            assert_eq!(serde_json::to_value(kind).unwrap(), json!(name));
        }
    }

    #[test]
    fn errors_travel_tagged_by_kind() {
        assert_eq!(
            serde_json::to_value(HostError::MissingScope {
                host: "github.com".into(),
                needed: vec!["repo".into()]
            })
            .unwrap(),
            json!({ "kind": "missingScope", "host": "github.com", "needed": ["repo"] })
        );
        assert_eq!(
            serde_json::to_value(HostError::RateLimited {
                host: "github.com".into(),
                resets_at: Some(1_700_000_000)
            })
            .unwrap(),
            json!({ "kind": "rateLimited", "host": "github.com", "resetsAt": 1_700_000_000 })
        );
        assert_eq!(
            serde_json::to_value(HostError::GitUnavailable).unwrap(),
            json!({ "kind": "gitUnavailable" })
        );
        assert_eq!(
            serde_json::to_value(PullRequestsError::NoHost).unwrap(),
            json!({ "kind": "noHost" })
        );
        assert_eq!(
            serde_json::to_value(PullRequestsError::Host(HostError::GitUnavailable)).unwrap(),
            json!({ "kind": "gitUnavailable" })
        );
        assert_eq!(
            serde_json::to_value(PullRequestsError::Repository(
                RepositoryError::NotARepository {
                    path: "/work".into()
                }
            ))
            .unwrap(),
            json!({ "kind": "notARepository", "path": "/work" })
        );
    }
}
