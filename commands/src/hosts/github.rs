//! The GitHub Host Integration: Tier 2, for GitHub.com and each GitHub
//! Enterprise Server the user added in Settings (PRD §9.1). It signs in with
//! the token the user's credential helper has for the Host, such as Git
//! Credential Manager's, so there's no second sign-in, and lists the
//! repositories the user can clone through GitHub's REST API (ADR 0016).
//! It reads a repository's open Pull Requests there too, the first of
//! Tier 3 (ADR 0040).

use std::sync::Arc;

use lanewise_core::{Credential, Credentials};
use serde::Deserialize;

use super::answer::{Answer, bearer, encoded};
use super::listing::{Fetched, Place, list, words};
use super::{
    HostError, HostIntegration, HostRepository, IntegrationKind, PullRequest, PullRequestHead,
    RepositoryList, SignedIn,
};
use crate::page::PageRequest;

/// How many repositories each request to GitHub asks for: the most it gives.
const GITHUB_PAGE: usize = 100;

/// The most open Pull Requests read of a repository: five of GitHub's pages.
const PULL_REQUESTS_READ: usize = 500;

/// The scope a classic token or OAuth app, such as Git Credential Manager,
/// needs to list private repositories.
const REPO_SCOPE: &str = "repo";

/// Serves GitHub.com, and the GitHub Enterprise Servers the user added, at
/// Tier 2.
pub struct GitHubHostIntegration {
    /// The GitHub Enterprise Server Hosts, by name, with a port if they
    /// were added with one.
    enterprise_hosts: Vec<String>,
    credentials: Arc<dyn Credentials + Send + Sync>,
    /// Where every Host's API is, instead of its own.
    api_base: Option<String>,
}

impl GitHubHostIntegration {
    /// GitHub.com and each of `enterprise_hosts`, signing in with what
    /// `credentials` gives.
    pub fn new(
        enterprise_hosts: Vec<String>,
        credentials: Arc<dyn Credentials + Send + Sync>,
    ) -> Self {
        Self {
            enterprise_hosts,
            credentials,
            api_base: None,
        }
    }

    /// The same, sending every Host's API calls to `api_base` instead of its
    /// own, such as a test's stand-in for GitHub's API at
    /// `http://127.0.0.1:8080`.
    pub fn with_api_base(mut self, api_base: impl Into<String>) -> Self {
        self.api_base = Some(api_base.into());
        self
    }

    /// Where `host`'s REST API is: `api.github.com` for GitHub.com, and
    /// `/api/v3` on a GitHub Enterprise Server.
    fn api(&self, host: &str) -> String {
        match &self.api_base {
            Some(base) => base.trim_end_matches('/').to_owned(),
            None if host == "github.com" => "https://api.github.com".into(),
            None => format!("https://{host}/api/v3"),
        }
    }

    fn fill(&self, host: &str) -> Result<Credential, HostError> {
        self.credentials
            .fill(host)
            .map_err(|error| HostError::from_credential(host, error))
    }

    /// Asks `host`'s API for `path`, with `credential`'s token. A token the
    /// Host refuses is rejected, so the helpers forget it.
    fn get(&self, host: &str, credential: &Credential, path: &str) -> Result<Answer, HostError> {
        let answer = Answer::github(
            host,
            &format!("{}{path}", self.api(host)),
            Some(credential.secret()),
        )?;
        if answer.status == 401 {
            // Best done, not needed: a helper that can't forget it asks again.
            let _ = self.credentials.reject(credential);
            return Err(HostError::TokenRefused { host: host.into() });
        }
        Ok(answer)
    }

    /// Asks `host`'s API for `path` with `credential`'s token, or as nobody
    /// without one.
    fn get_as(
        &self,
        host: &str,
        credential: Option<&Credential>,
        path: &str,
    ) -> Result<Answer, HostError> {
        match credential {
            Some(credential) => self.get(host, credential, path),
            None => Answer::github(host, &format!("{}{path}", self.api(host)), None),
        }
    }
}

impl HostIntegration for GitHubHostIntegration {
    fn kind(&self) -> IntegrationKind {
        IntegrationKind::GitHub
    }

    fn tier(&self) -> u8 {
        2
    }

    fn serves(&self, name: &str) -> Option<String> {
        if name == "github.com" || name == "ssh.github.com" {
            return Some("github.com".into());
        }
        self.enterprise_hosts
            .iter()
            .find(|host| host.split(':').next() == Some(name))
            .cloned()
    }

    fn sign_in(&self, host: &str, again: bool) -> Result<SignedIn, HostError> {
        if again {
            // Every credential the helpers have for the Host, whoever's.
            let _ = self.credentials.reject(&Credential::new(host, None, ""));
        }
        let credential = self.fill(host)?;
        let answer = self.get(host, &credential, "/user")?;
        if answer.status == 404 {
            return Err(HostError::NotGitHub { host: host.into() });
        }
        if !answer.ok() {
            return Err(answer.refusal(host));
        }
        let user: User = serde_json::from_str(&answer.body)
            .map_err(|_| HostError::NotGitHub { host: host.into() })?;
        // So a helper that keeps a credential only once it has worked, as
        // Git Credential Manager does, keeps it. Best done, not needed.
        let _ = self.credentials.approve(&credential);
        Ok(SignedIn {
            host: host.into(),
            login: user.login,
            name: user.name.filter(|name| !name.trim().is_empty()),
            missing_scopes: answer.missing_scopes(),
        })
    }

    fn repositories(
        &self,
        host: &str,
        query: &str,
        page: &PageRequest,
    ) -> Result<RepositoryList, HostError> {
        let place = Place::asked(page, 1u32)?;
        let credential = self.fill(host)?;
        let mut missing_scopes = None;
        let mut sso_left_out = false;
        let page = list(place, page.limit(), &words(query), |&number| {
            let answer = self.get(
                host,
                &credential,
                &format!(
                    "/user/repos?affiliation=owner,collaborator,organization_member&sort=full_name&direction=asc&per_page={GITHUB_PAGE}&page={number}"
                ),
            )?;
            if !answer.ok() {
                return Err(answer.refusal(host));
            }
            missing_scopes.get_or_insert_with(|| answer.missing_scopes());
            sso_left_out |= answer.sso_left_out();
            let repositories: Vec<Repository> =
                answer.json(host, "GitHub's list of repositories")?;
            Ok(Fetched {
                repositories: repositories.into_iter().map(Into::into).collect(),
                next: answer.has_next_page().then_some(number + 1),
            })
        })?;
        Ok(RepositoryList {
            page,
            missing_scopes: missing_scopes.unwrap_or_default(),
            sso_left_out,
        })
    }

    fn owners(&self, host: &str) -> Result<Vec<String>, HostError> {
        let credential = self.fill(host)?;
        let answer = self.get(host, &credential, "/user")?;
        if !answer.ok() {
            return Err(answer.refusal(host));
        }
        let user: User = answer.json(host, "GitHub's user")?;
        // Without `read:org`, GitHub may not list them: the user's own are still there to filter by.
        let answer = self.get(
            host,
            &credential,
            &format!("/user/orgs?per_page={GITHUB_PAGE}"),
        )?;
        let mut organizations: Vec<String> = if answer.ok() {
            answer
                .json::<Vec<Account>>(host, "GitHub's list of organizations")?
                .into_iter()
                .map(|organization| organization.login)
                .collect()
        } else {
            Vec::new()
        };
        organizations.sort_by_key(|login| login.to_lowercase());
        Ok(std::iter::once(user.login).chain(organizations).collect())
    }

    fn pull_requests(
        &self,
        host: &str,
        path: &str,
        interactive: bool,
    ) -> Result<Vec<PullRequest>, HostError> {
        let not_a_repository = || HostError::HostFailed {
            host: host.into(),
            status: 404,
            message: format!("'{path}' isn't a GitHub repository's owner and name"),
        };
        let (owner, name) = path.split_once('/').ok_or_else(not_a_repository)?;
        if owner.is_empty() || name.is_empty() || name.contains('/') {
            return Err(not_a_repository());
        }
        let credential = if interactive {
            Some(self.fill(host)?)
        } else {
            // With none the helpers have already, a public repository's are
            // still there to read.
            self.credentials.fill_quietly(host).ok()
        };
        let mut pull_requests = Vec::new();
        let mut number = 1;
        loop {
            let answer = self.get_as(
                host,
                credential.as_ref(),
                &format!(
                    "/repos/{}/{}/pulls?state=open&per_page={GITHUB_PAGE}&page={number}",
                    encoded(owner),
                    encoded(name)
                ),
            )?;
            if credential.is_none() && matches!(answer.status, 401 | 404) {
                // A private repository is hidden from nobody as not there.
                return Err(HostError::NoCredential {
                    host: host.into(),
                    message: answer.said(),
                });
            }
            if !answer.ok() {
                return Err(answer.refusal(host));
            }
            let pulls: Vec<Pull> = answer.json(host, "GitHub's list of pull requests")?;
            pull_requests.extend(pulls.into_iter().map(PullRequest::from));
            if !answer.has_next_page() || pull_requests.len() >= PULL_REQUESTS_READ {
                break;
            }
            number += 1;
        }
        pull_requests.truncate(PULL_REQUESTS_READ);
        if let Some(credential) = &credential {
            // Best done, not needed, as for signing in.
            let _ = self.credentials.approve(credential);
        }
        Ok(pull_requests)
    }
}

/// A Pull Request, as GitHub's `/repos/{owner}/{repo}/pulls` gives it.
#[derive(Deserialize)]
struct Pull {
    number: u64,
    title: String,
    html_url: String,
    user: Option<Account>,
    #[serde(default)]
    draft: bool,
    head: Head,
    base: Head,
    updated_at: Option<String>,
}

/// One end of a Pull Request, as GitHub gives it.
#[derive(Deserialize)]
struct Head {
    #[serde(rename = "ref")]
    branch: String,
    sha: String,
    /// `null` once the repository, such as a fork, is deleted.
    repo: Option<RepositoryName>,
}

#[derive(Deserialize)]
struct RepositoryName {
    full_name: String,
}

impl From<Pull> for PullRequest {
    fn from(pull: Pull) -> Self {
        Self {
            number: pull.number,
            title: pull.title,
            url: pull.html_url,
            author: pull.user.map(|user| user.login),
            draft: pull.draft,
            head: PullRequestHead {
                branch: pull.head.branch,
                commit: pull.head.sha,
                repository: pull.head.repo.map(|repo| repo.full_name),
            },
            base: pull.base.branch,
            updated_at: pull.updated_at,
        }
    }
}

/// An account by its login, such as one of the user's organizations, as
/// GitHub's `/user/orgs` gives it, or a Pull Request's author.
#[derive(Deserialize)]
struct Account {
    login: String,
}

/// The signed-in user, as GitHub's `/user` gives them.
#[derive(Deserialize)]
struct User {
    login: String,
    name: Option<String>,
}

/// A repository, as GitHub's `/user/repos` gives it.
#[derive(Deserialize)]
struct Repository {
    full_name: String,
    description: Option<String>,
    #[serde(default)]
    private: bool,
    #[serde(default)]
    fork: bool,
    #[serde(default)]
    archived: bool,
    clone_url: String,
    ssh_url: Option<String>,
}

impl From<Repository> for HostRepository {
    fn from(repository: Repository) -> Self {
        Self {
            full_name: repository.full_name,
            description: repository
                .description
                .filter(|text| !text.trim().is_empty()),
            private: repository.private,
            fork: repository.fork,
            archived: repository.archived,
            clone_url: repository.clone_url,
            ssh_url: repository.ssh_url,
        }
    }
}

/// What only GitHub's API answers with.
impl Answer {
    /// Asks `url`, on `host`'s REST API, with `token`, or as nobody
    /// without one.
    fn github(host: &str, url: &str, token: Option<&str>) -> Result<Self, HostError> {
        let authorization = token.map(bearer);
        let mut headers = vec![
            ("Accept", "application/vnd.github+json"),
            ("X-GitHub-Api-Version", "2022-11-28"),
        ];
        if let Some(authorization) = &authorization {
            headers.push(("Authorization", authorization));
        }
        Answer::get(host, url, &headers)
    }

    /// A comma-separated list of scopes in the header `name`, if it's there.
    fn scopes(&self, name: &str) -> Option<Vec<String>> {
        self.header(name).map(|scopes| {
            scopes
                .split(',')
                .map(str::trim)
                .filter(|scope| !scope.is_empty())
                .map(str::to_owned)
                .collect()
        })
    }

    /// The scopes the token lacks for everything the Host Integration does.
    /// GitHub only says what a classic token or an OAuth app's has.
    fn missing_scopes(&self) -> Vec<String> {
        match self.scopes("x-oauth-scopes") {
            Some(scopes) if !scopes.iter().any(|scope| scope == REPO_SCOPE) => {
                vec![REPO_SCOPE.into()]
            }
            _ => Vec::new(),
        }
    }

    /// Whether GitHub left some organizations' repositories out, for their
    /// SAML SSO.
    fn sso_left_out(&self) -> bool {
        self.header("x-github-sso")
            .is_some_and(|sso| sso.starts_with("partial-results"))
    }

    fn has_next_page(&self) -> bool {
        self.header("link")
            .is_some_and(|link| link.split(',').any(|each| each.contains("rel=\"next\"")))
    }

    /// Why GitHub didn't answer as asked.
    fn refusal(&self, host: &str) -> HostError {
        let host = host.to_owned();
        let message = self.said();
        if let Some(sso) = self.header("x-github-sso")
            && sso.starts_with("required")
        {
            let url = sso
                .split(';')
                .find_map(|part| part.trim().strip_prefix("url="))
                .map(str::to_owned);
            return HostError::SsoNotAuthorized { host, url };
        }
        if self.status == 429
            || (self.status == 403 && self.header("x-ratelimit-remaining") == Some("0"))
        {
            let resets_at = self
                .header("x-ratelimit-reset")
                .and_then(|reset| reset.parse().ok());
            return HostError::RateLimited { host, resets_at };
        }
        if self.status == 403 {
            let needed = self.scopes("x-accepted-oauth-scopes").unwrap_or_default();
            if !needed.is_empty() || message.contains("Resource not accessible by") {
                return HostError::MissingScope { host, needed };
            }
        }
        HostError::HostFailed {
            host,
            status: self.status,
            message,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::super::stand_in::{Asked, Helper, Reply, parameter, reply, serve};
    use super::*;
    use crate::page::Cursor;

    /// A stand-in for GitHub's API, answering each request with `answer`,
    /// given its path.
    fn github(answer: impl Fn(&str) -> Reply + Send + 'static) -> (String, Asked) {
        serve(move |path, _| answer(path))
    }

    fn integration(helper: &Arc<Helper>, api: &str) -> GitHubHostIntegration {
        GitHubHostIntegration::new(vec!["ghe.example.com".into()], Arc::clone(helper) as _)
            .with_api_base(api)
    }

    fn octocat(scopes: Option<&str>) -> impl Fn(&str) -> Reply + Send + 'static {
        let scopes = scopes.map(str::to_owned);
        move |_| Reply {
            status: 200,
            headers: scopes
                .iter()
                .map(|scopes| ("X-OAuth-Scopes", scopes.clone()))
                .collect(),
            body: json!({ "login": "octocat", "name": "The Octocat" }).to_string(),
        }
    }

    #[test]
    fn finds_each_host_s_api() {
        let integration = GitHubHostIntegration::new(vec![], Helper::holding("token") as _);

        assert_eq!(integration.api("github.com"), "https://api.github.com");
        assert_eq!(
            integration.api("ghe.example.com:8443"),
            "https://ghe.example.com:8443/api/v3"
        );
    }

    #[test]
    fn signs_in_with_the_helper_s_token_and_tells_it_the_host_took_it() {
        let (api, asked) = github(octocat(Some("repo, gist, workflow")));
        let helper = Helper::holding("gho_from_gcm");

        let signed_in = integration(&helper, &api).sign_in("github.com", false);

        assert_eq!(
            signed_in,
            Ok(SignedIn {
                host: "github.com".into(),
                login: "octocat".into(),
                name: Some("The Octocat".into()),
                missing_scopes: vec![],
            })
        );
        assert_eq!(
            *asked.lock().unwrap(),
            [("/user".to_owned(), Some("Bearer gho_from_gcm".to_owned()))]
        );
        assert_eq!(helper.told(), ["fill github.com", "approve gho_from_gcm"]);
    }

    #[test]
    fn says_which_scope_a_token_lacks_where_github_says_what_it_has() {
        let helper = Helper::holding("ghp_classic");
        let (api, _) = github(octocat(Some("gist, read:org")));
        assert_eq!(
            integration(&helper, &api)
                .sign_in("github.com", false)
                .unwrap()
                .missing_scopes,
            ["repo"]
        );
        // A fine-grained token's permissions aren't said.
        let (api, _) = github(octocat(None));
        assert_eq!(
            integration(&helper, &api)
                .sign_in("github.com", false)
                .unwrap()
                .missing_scopes,
            Vec::<String>::new()
        );
    }

    #[test]
    fn a_refused_token_is_forgotten() {
        let (api, _) = github(|_| reply(401, &[], json!({ "message": "Bad credentials" })));
        let helper = Helper::holding("gho_revoked");

        assert_eq!(
            integration(&helper, &api).sign_in("github.com", false),
            Err(HostError::TokenRefused {
                host: "github.com".into()
            })
        );
        assert_eq!(helper.told(), ["fill github.com", "reject gho_revoked"]);
    }

    #[test]
    fn signing_in_again_forgets_the_helper_s_credential_first() {
        let (api, _) = github(octocat(Some("repo")));
        let helper = Helper::holding("gho_old");

        let signed_in = integration(&helper, &api).sign_in("github.com", true);

        // The helper had nothing more to give, as when the user cancels
        // Git Credential Manager's sign-in.
        assert!(
            matches!(signed_in, Err(HostError::NoCredential { ref host, .. }) if host == "github.com"),
            "{signed_in:?}"
        );
        assert_eq!(helper.told(), ["reject ", "fill github.com"]);
    }

    #[test]
    fn without_a_credential_nothing_is_sent_to_github() {
        let (api, asked) = github(octocat(Some("repo")));
        let helper = Arc::new(Helper::default());

        let signed_in = integration(&helper, &api).sign_in("github.com", false);

        assert_eq!(
            signed_in,
            Err(HostError::NoCredential {
                host: "github.com".into(),
                message: "fatal: could not read Username for 'https://github.com': terminal prompts disabled".into()
            })
        );
        assert!(asked.lock().unwrap().is_empty());
    }

    #[test]
    fn a_host_whose_api_is_not_there_is_not_github() {
        let (api, _) = github(|_| reply(404, &[], json!({ "message": "Not Found" })));
        let helper = Helper::holding("token");

        assert_eq!(
            integration(&helper, &api).sign_in("ghe.example.com", false),
            Err(HostError::NotGitHub {
                host: "ghe.example.com".into()
            })
        );
        assert_eq!(helper.told(), ["fill ghe.example.com"]);
    }

    #[test]
    fn an_unreachable_host_says_why() {
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let helper = Helper::holding("token");

        let signed_in =
            integration(&helper, &format!("http://127.0.0.1:{port}")).sign_in("github.com", false);

        assert!(
            matches!(&signed_in, Err(HostError::Unreachable { host, message }) if host == "github.com" && !message.contains("token")),
            "{signed_in:?}"
        );
    }

    /// A GitHub with `count` repositories, `lanewise-000` on, of which every
    /// seventh has "graph" in its description, a page of 100 at a time.
    fn listing(
        count: usize,
        headers: &'static [(&'static str, &'static str)],
    ) -> impl Fn(&str) -> Reply + Send + 'static {
        move |path| {
            let page: usize = path
                .split(['?', '&'])
                .find_map(|part| part.strip_prefix("page="))
                .and_then(|page| page.parse().ok())
                .unwrap_or(1);
            let start = (page - 1) * GITHUB_PAGE;
            let repositories: Vec<Value> = (start..count.min(start + GITHUB_PAGE))
                .map(|n| {
                    json!({
                        "full_name": format!("octocat/lanewise-{n:03}"),
                        "description": if n % 7 == 0 { "A commit graph" } else { "" },
                        "private": n % 2 == 0,
                        "fork": false,
                        "archived": false,
                        "clone_url": format!("https://github.com/octocat/lanewise-{n:03}.git"),
                        "ssh_url": format!("git@github.com:octocat/lanewise-{n:03}.git"),
                    })
                })
                .collect();
            let mut headers: Vec<(&'static str, String)> = headers
                .iter()
                .map(|(name, value)| (*name, (*value).to_owned()))
                .collect();
            if start + GITHUB_PAGE < count {
                headers.push((
                    "Link",
                    format!(
                        "<https://api.github.com/user/repos?page={}>; rel=\"next\"",
                        page + 1
                    ),
                ));
            }
            Reply {
                status: 200,
                headers,
                body: Value::Array(repositories).to_string(),
            }
        }
    }

    /// Every page of `query`'s repositories, `limit` at a time, by name.
    fn read_all(integration: &GitHubHostIntegration, query: &str, limit: u32) -> Vec<Vec<String>> {
        let mut pages = Vec::new();
        let mut cursor = None;
        loop {
            let list = integration
                .repositories(
                    "github.com",
                    query,
                    &PageRequest {
                        cursor,
                        limit: Some(limit),
                    },
                )
                .expect("a page of repositories");
            pages.push(
                list.page
                    .items
                    .into_iter()
                    .map(|item| item.full_name)
                    .collect(),
            );
            match list.page.next_cursor {
                Some(next) => cursor = Some(next),
                None => return pages,
            }
        }
    }

    #[test]
    fn lists_the_user_s_and_their_organizations_repositories_page_by_page() {
        let (api, asked) = github(listing(250, &[("X-OAuth-Scopes", "repo")]));
        let helper = Helper::holding("gho_from_gcm");
        let integration = integration(&helper, &api);

        let pages = read_all(&integration, "", 60);

        assert_eq!(
            pages.iter().map(Vec::len).collect::<Vec<_>>(),
            [60, 60, 60, 60, 10]
        );
        let names: Vec<String> = pages.concat();
        let expected: Vec<String> = (0..250)
            .map(|n| format!("octocat/lanewise-{n:03}"))
            .collect();
        assert_eq!(names, expected);
        {
            let asked = asked.lock().unwrap();
            assert!(asked[0].0.starts_with(
                "/user/repos?affiliation=owner,collaborator,organization_member&sort=full_name&direction=asc&per_page=100&page=1"
            ), "{asked:?}");
            assert!(
                asked
                    .iter()
                    .all(|(_, authorization)| authorization.as_deref()
                        == Some("Bearer gho_from_gcm"))
            );
        }

        let list = integration
            .repositories(
                "github.com",
                "",
                &PageRequest {
                    cursor: None,
                    limit: Some(1),
                },
            )
            .unwrap();
        assert_eq!(
            serde_json::to_value(&list.page.items[0]).unwrap(),
            json!({
                "fullName": "octocat/lanewise-000",
                "description": "A commit graph",
                "private": true,
                "fork": false,
                "archived": false,
                "cloneUrl": "https://github.com/octocat/lanewise-000.git",
                "sshUrl": "git@github.com:octocat/lanewise-000.git"
            })
        );
        assert!(list.missing_scopes.is_empty());
        assert!(!list.sso_left_out);
    }

    #[test]
    fn owners_are_the_user_then_their_organizations_and_filter_the_repositories() {
        let (api, asked) = github(|path| {
            match path {
            "/user" => Reply {
                status: 200,
                headers: Vec::new(),
                body: json!({ "login": "octocat", "name": null }).to_string(),
            },
            _ if path.starts_with("/user/orgs") => Reply {
                status: 200,
                headers: Vec::new(),
                body: json!([{ "login": "zeta" }, { "login": "Acme" }]).to_string(),
            },
            _ => Reply {
                status: 200,
                headers: Vec::new(),
                body: json!([
                    { "full_name": "Acme/rocket", "clone_url": "https://github.com/Acme/rocket.git" },
                    { "full_name": "octocat/acme-notes", "clone_url": "https://github.com/octocat/acme-notes.git" },
                    { "full_name": "zeta/tools", "clone_url": "https://github.com/zeta/tools.git" },
                ])
                .to_string(),
            },
        }
        });
        let helper = Helper::holding("token");
        let integration = integration(&helper, &api);

        assert_eq!(
            integration.owners("github.com").unwrap(),
            ["octocat", "Acme", "zeta"]
        );
        assert!(
            asked.lock().unwrap()[1]
                .0
                .starts_with("/user/orgs?per_page=100")
        );
        assert_eq!(read_all(&integration, "owner:acme", 10), [["Acme/rocket"]]);
        assert_eq!(
            read_all(&integration, "acme", 10),
            [["Acme/rocket", "octocat/acme-notes"]]
        );
    }

    #[test]
    fn without_its_organizations_the_user_is_still_an_owner() {
        let (api, _) = github(|path| match path {
            "/user" => Reply {
                status: 200,
                headers: Vec::new(),
                body: json!({ "login": "octocat" }).to_string(),
            },
            _ => reply(403, &[], json!({ "message": "Forbidden" })),
        });
        let helper = Helper::holding("token");

        assert_eq!(
            integration(&helper, &api).owners("github.com").unwrap(),
            ["octocat"]
        );
    }

    #[test]
    fn searches_names_and_descriptions_for_every_word() {
        let (api, _) = github(listing(250, &[]));
        let helper = Helper::holding("token");
        let integration = integration(&helper, &api);

        let found = read_all(&integration, "  GRAPH commit ", 10).concat();
        assert_eq!(
            found,
            (0..250)
                .filter(|n| n % 7 == 0)
                .map(|n| format!("octocat/lanewise-{n:03}"))
                .collect::<Vec<_>>()
        );
        assert_eq!(read_all(&integration, "lanewise-12", 50).concat().len(), 10);
    }

    #[test]
    fn a_long_search_answers_with_what_it_has_and_a_cursor_to_look_further() {
        let (api, asked) = github(listing(1200, &[]));
        let helper = Helper::holding("token");

        let pages = read_all(&integration(&helper, &api), "nothing like this", 50);

        assert_eq!(pages, [Vec::<String>::new(), Vec::new()]);
        assert_eq!(asked.lock().unwrap().len(), 12);
    }

    #[test]
    fn says_what_the_token_lacks_and_what_sso_left_out() {
        let (api, _) = github(listing(
            3,
            &[
                ("X-OAuth-Scopes", "public_repo"),
                (
                    "X-GitHub-SSO",
                    "partial-results; organizations=21955855,20582480",
                ),
            ],
        ));
        let helper = Helper::holding("token");

        let list = integration(&helper, &api)
            .repositories("github.com", "", &PageRequest::default())
            .unwrap();

        assert_eq!(list.missing_scopes, ["repo"]);
        assert!(list.sso_left_out);
    }

    #[test]
    fn a_cursor_from_elsewhere_is_invalid() {
        let (api, _) = github(listing(3, &[]));
        let helper = Helper::holding("token");
        let integration = integration(&helper, &api);

        for cursor in [
            Cursor::naming(&"not a place"),
            Cursor::naming(&Place {
                page: 1,
                after: Some("octocat/gone".into()),
            }),
        ] {
            assert_eq!(
                integration.repositories(
                    "github.com",
                    "",
                    &PageRequest {
                        cursor: Some(cursor),
                        limit: None
                    }
                ),
                Err(HostError::InvalidCursor)
            );
        }
    }

    fn refused(reply: fn(&str) -> Reply) -> HostError {
        let (api, _) = github(reply);
        integration(&Helper::holding("token"), &api)
            .repositories("github.com", "", &PageRequest::default())
            .unwrap_err()
    }

    #[test]
    fn tells_github_s_refusals_apart() {
        let host = || "github.com".to_owned();
        assert_eq!(
            refused(|_| reply(
                403,
                &[
                    ("X-Accepted-OAuth-Scopes", "repo"),
                    ("X-OAuth-Scopes", "gist")
                ],
                json!({ "message": "Must have admin rights to Repository." })
            )),
            HostError::MissingScope {
                host: host(),
                needed: vec!["repo".into()]
            }
        );
        assert_eq!(
            refused(|_| reply(
                403,
                &[],
                json!({ "message": "Resource not accessible by personal access token" })
            )),
            HostError::MissingScope {
                host: host(),
                needed: vec![]
            }
        );
        assert_eq!(
            refused(|_| reply(
                403,
                &[(
                    "X-GitHub-SSO",
                    "required; url=https://github.com/orgs/axa-ch/sso?authorization_request=A1"
                )],
                json!({ "message": "Resource protected by organization SAML enforcement." })
            )),
            HostError::SsoNotAuthorized {
                host: host(),
                url: Some("https://github.com/orgs/axa-ch/sso?authorization_request=A1".into())
            }
        );
        assert_eq!(
            refused(|_| reply(
                403,
                &[
                    ("X-RateLimit-Remaining", "0"),
                    ("X-RateLimit-Reset", "1700000000")
                ],
                json!({ "message": "API rate limit exceeded" })
            )),
            HostError::RateLimited {
                host: host(),
                resets_at: Some(1_700_000_000)
            }
        );
        assert_eq!(
            refused(|_| reply(502, &[], json!({ "message": "Server Error" }))),
            HostError::HostFailed {
                host: host(),
                status: 502,
                message: "Server Error".into()
            }
        );
        assert_eq!(
            refused(|_| reply(401, &[], json!({ "message": "Bad credentials" }))),
            HostError::TokenRefused { host: host() }
        );
    }

    /// A stand-in for GitHub's list of `count` open Pull Requests, the
    /// newest first, a page at a time, with `Link` headers as GitHub's.
    fn pulls(count: u64) -> impl Fn(&str) -> Reply + Send + 'static {
        move |path| {
            let page: u64 = parameter(path, "page").unwrap().parse().unwrap();
            let per_page: u64 = parameter(path, "per_page").unwrap().parse().unwrap();
            let first = (page - 1) * per_page;
            let items: Vec<Value> = (first..count.min(first + per_page))
                .map(|n| {
                    let number = count - n;
                    json!({
                        "number": number,
                        "title": format!("Change {number}"),
                        "html_url": format!("https://github.com/adrianeyre/lanewise/pull/{number}"),
                        "user": { "login": "octocat" },
                        "draft": number.is_multiple_of(2),
                        "head": {
                            "ref": format!("feature/{number}"),
                            "sha": format!("{number:040}"),
                            "repo": { "full_name": "octocat/lanewise" }
                        },
                        "base": { "ref": "main", "sha": "0".repeat(40), "repo": null },
                        "updated_at": "2026-09-30T12:00:00Z"
                    })
                })
                .collect();
            let headers: Vec<(&'static str, &str)> = if first + per_page < count {
                vec![("Link", "<https://api.github.com/next>; rel=\"next\"")]
            } else {
                vec![]
            };
            reply(200, &headers, Value::Array(items))
        }
    }

    #[test]
    fn reads_the_open_pull_requests_newest_first_page_by_page() {
        let (api, asked) = github(pulls(150));
        let helper = Helper::holding("gho_from_gcm");

        let pull_requests = integration(&helper, &api)
            .pull_requests("github.com", "adrianeyre/lanewise", false)
            .expect("the pull requests");

        assert_eq!(pull_requests.len(), 150);
        assert_eq!(pull_requests[0].number, 150);
        assert_eq!(pull_requests[149].number, 1);
        assert_eq!(
            serde_json::to_value(&pull_requests[0]).unwrap(),
            json!({
                "number": 150,
                "title": "Change 150",
                "url": "https://github.com/adrianeyre/lanewise/pull/150",
                "author": "octocat",
                "draft": true,
                "head": {
                    "branch": "feature/150",
                    "commit": format!("{:040}", 150),
                    "repository": "octocat/lanewise"
                },
                "base": "main",
                "updatedAt": "2026-09-30T12:00:00Z"
            })
        );
        let asked = asked.lock().unwrap();
        assert_eq!(
            asked
                .iter()
                .map(|(path, _)| path.as_str())
                .collect::<Vec<_>>(),
            [
                "/repos/adrianeyre/lanewise/pulls?state=open&per_page=100&page=1",
                "/repos/adrianeyre/lanewise/pulls?state=open&per_page=100&page=2",
            ]
        );
        assert!(
            asked
                .iter()
                .all(|(_, authorization)| authorization.as_deref() == Some("Bearer gho_from_gcm"))
        );
        // Asked quietly, so no sign-in starts on its own.
        assert_eq!(
            helper.told(),
            ["fill quietly github.com", "approve gho_from_gcm"]
        );
    }

    #[test]
    fn reads_at_most_five_pages_of_pull_requests() {
        let (api, asked) = github(pulls(700));
        let helper = Helper::holding("token");

        let pull_requests = integration(&helper, &api)
            .pull_requests("github.com", "adrianeyre/lanewise", false)
            .unwrap();

        assert_eq!(pull_requests.len(), PULL_REQUESTS_READ);
        assert_eq!(asked.lock().unwrap().len(), 5);
    }

    #[test]
    fn without_a_credential_a_public_repository_s_are_read_as_nobody() {
        let (api, asked) = github(pulls(1));
        let helper = Arc::new(Helper::default());

        let pull_requests = integration(&helper, &api)
            .pull_requests("github.com", "adrianeyre/lanewise", false)
            .unwrap();

        assert_eq!(pull_requests.len(), 1);
        assert_eq!(asked.lock().unwrap()[0].1, None);
        assert_eq!(helper.told(), ["fill quietly github.com"]);
    }

    #[test]
    fn a_private_repository_hidden_from_nobody_needs_a_credential() {
        for status in [404, 401] {
            let (api, _) = github(move |_| reply(status, &[], json!({ "message": "Not Found" })));
            let helper = Arc::new(Helper::default());

            assert_eq!(
                integration(&helper, &api).pull_requests("github.com", "octocat/secret", false),
                Err(HostError::NoCredential {
                    host: "github.com".into(),
                    message: "Not Found".into()
                })
            );
        }
    }

    #[test]
    fn asked_interactively_the_helpers_may_sign_in() {
        let (api, _) = github(pulls(1));
        let helper = Helper::holding("gho_from_gcm");

        integration(&helper, &api)
            .pull_requests("github.com", "adrianeyre/lanewise", true)
            .unwrap();
        assert_eq!(helper.told(), ["fill github.com", "approve gho_from_gcm"]);

        // With none to give, it fails as signing in does, and GitHub isn't asked.
        let (api, asked) = github(pulls(1));
        let helper = Arc::new(Helper::default());
        assert!(matches!(
            integration(&helper, &api).pull_requests("github.com", "adrianeyre/lanewise", true),
            Err(HostError::NoCredential { .. })
        ));
        assert!(asked.lock().unwrap().is_empty());
    }

    #[test]
    fn pull_requests_are_refused_as_the_rest_are() {
        let helper = Helper::holding("token");
        let (api, _) = github(|_| {
            reply(
                403,
                &[
                    ("X-RateLimit-Remaining", "0"),
                    ("X-RateLimit-Reset", "1700000000"),
                ],
                json!({ "message": "API rate limit exceeded" }),
            )
        });
        assert_eq!(
            integration(&helper, &api).pull_requests("github.com", "adrianeyre/lanewise", false),
            Err(HostError::RateLimited {
                host: "github.com".into(),
                resets_at: Some(1_700_000_000)
            })
        );
        let (api, _) = github(|_| {
            reply(
                403,
                &[(
                    "X-GitHub-SSO",
                    "required; url=https://github.com/orgs/a/sso",
                )],
                json!({ "message": "Resource protected by organization SAML enforcement." }),
            )
        });
        assert_eq!(
            integration(&helper, &api).pull_requests("github.com", "a/lanewise", false),
            Err(HostError::SsoNotAuthorized {
                host: "github.com".into(),
                url: Some("https://github.com/orgs/a/sso".into())
            })
        );
        let (api, _) = github(|_| reply(401, &[], json!({ "message": "Bad credentials" })));
        assert_eq!(
            integration(&helper, &api).pull_requests("github.com", "a/lanewise", false),
            Err(HostError::TokenRefused {
                host: "github.com".into()
            })
        );
        assert!(helper.told().contains(&"reject token".to_owned()));
    }

    #[test]
    fn a_path_that_is_no_owner_and_name_is_not_asked_about() {
        let (api, asked) = github(pulls(1));
        let helper = Helper::holding("token");

        for path in ["lanewise", "a/b/c", "/lanewise"] {
            assert!(matches!(
                integration(&helper, &api).pull_requests("github.com", path, false),
                Err(HostError::HostFailed { status: 404, .. })
            ));
        }
        assert!(asked.lock().unwrap().is_empty());
    }
}
