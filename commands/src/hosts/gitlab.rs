//! The GitLab Host Integration: Tier 2, for GitLab.com (PRD §9.1). It signs
//! in with the token the user's credential helper has for the Host, such as
//! Git Credential Manager's, so there's no second sign-in, and lists the
//! projects the user is a member of through GitLab's REST API (ADR 0016,
//! ADR 0037).

use std::sync::Arc;

use lanewise_core::{Credential, Credentials};
use serde::Deserialize;

use super::answer::{Answer, bearer, encoded};
use super::listing::{Fetched, Place, list, words};
use super::{
    HostError, HostIntegration, HostRepository, IntegrationKind, RepositoryList, SignedIn,
};
use crate::page::PageRequest;

/// How many projects each request to GitLab asks for: the most it gives.
const GITLAB_PAGE: usize = 100;

/// The scope a token needs to list the user's projects. `read_user` is
/// enough to sign in, but not to list them.
const READ_API: &str = "read_api";

/// The fewest letters GitLab searches for. A shorter word is only searched
/// for in Rust.
const SHORTEST_SEARCH: usize = 3;

/// Serves GitLab.com at Tier 2.
pub struct GitLabHostIntegration {
    credentials: Arc<dyn Credentials + Send + Sync>,
    /// Where GitLab's API is, instead of its own.
    api_base: Option<String>,
}

impl GitLabHostIntegration {
    /// GitLab.com, signing in with what `credentials` gives.
    pub fn new(credentials: Arc<dyn Credentials + Send + Sync>) -> Self {
        Self {
            credentials,
            api_base: None,
        }
    }

    /// The same, sending its API calls to `api_base` instead, such as a
    /// test's stand-in for GitLab's API at `http://127.0.0.1:8080`.
    pub fn with_api_base(mut self, api_base: impl Into<String>) -> Self {
        self.api_base = Some(api_base.into());
        self
    }

    /// Where GitLab.com's REST API is.
    fn api(&self) -> String {
        match &self.api_base {
            Some(base) => base.trim_end_matches('/').to_owned(),
            None => "https://gitlab.com/api/v4".into(),
        }
    }

    fn fill(&self, host: &str) -> Result<Credential, HostError> {
        self.credentials
            .fill(host)
            .map_err(|error| HostError::from_credential(host, error))
    }

    /// Asks GitLab's API for `path`, with `credential`'s token, which GitLab
    /// takes as a bearer token whether it's an OAuth app's or a personal
    /// access token. A token GitLab refuses is rejected, so the helpers
    /// forget it.
    fn get(&self, host: &str, credential: &Credential, path: &str) -> Result<Answer, HostError> {
        let answer = Answer::get(
            host,
            &format!("{}{path}", self.api()),
            &[
                ("Accept", "application/json"),
                ("Authorization", &bearer(credential.secret())),
            ],
        )?;
        if answer.status == 401 {
            // Best done, not needed: a helper that can't forget it asks again.
            let _ = self.credentials.reject(credential);
            return Err(HostError::TokenRefused { host: host.into() });
        }
        if !answer.ok() {
            return Err(refusal(host, &answer));
        }
        Ok(answer)
    }
}

impl HostIntegration for GitLabHostIntegration {
    fn kind(&self) -> IntegrationKind {
        IntegrationKind::GitLab
    }

    fn tier(&self) -> u8 {
        2
    }

    fn serves(&self, name: &str) -> Option<String> {
        (name == "gitlab.com" || name == "altssh.gitlab.com").then(|| "gitlab.com".into())
    }

    fn sign_in(&self, host: &str, again: bool) -> Result<SignedIn, HostError> {
        if again {
            // Every credential the helpers have for the Host, whoever's.
            let _ = self.credentials.reject(&Credential::new(host, None, ""));
        }
        let credential = self.fill(host)?;
        let user: User = self
            .get(host, &credential, "/user")?
            .json(host, "GitLab's signed-in user")?;
        // So a helper that keeps a credential only once it has worked, as
        // Git Credential Manager does, keeps it. Best done, not needed.
        let _ = self.credentials.approve(&credential);
        Ok(SignedIn {
            host: host.into(),
            login: user.username,
            name: user.name.filter(|name| !name.trim().is_empty()),
            // GitLab doesn't say which scopes an OAuth app's token has. One
            // without `read_api` is refused when it lists projects.
            missing_scopes: Vec::new(),
        })
    }

    /// GitLab's `/projects` of which the user is a member, by path. GitLab
    /// searches for the longest word of `query`, in each project's name,
    /// path, namespace and description, and Rust for every word, as it does
    /// for GitHub.
    fn repositories(
        &self,
        host: &str,
        query: &str,
        page: &PageRequest,
    ) -> Result<RepositoryList, HostError> {
        let place = Place::asked(page, 1u32)?;
        let credential = self.fill(host)?;
        let words = words(query);
        let search = words
            .iter()
            .filter(|word| word.chars().count() >= SHORTEST_SEARCH)
            .max_by_key(|word| word.chars().count())
            .map(|word| format!("&search={}&search_namespaces=true", encoded(word)))
            .unwrap_or_default();
        let page = list(place, page.limit(), &words, |&number| {
            let answer = self.get(
                host,
                &credential,
                &format!(
                    "/projects?membership=true&order_by=path&sort=asc&per_page={GITLAB_PAGE}&page={number}{search}"
                ),
            )?;
            let projects: Vec<Project> = answer.json(host, "GitLab's list of projects")?;
            // `X-Next-Page` is empty on the last page. GitLab leaves it out
            // of a very long list, where only a short page is the last.
            let next = match answer.header("x-next-page") {
                Some(next) => next.trim().parse().ok(),
                None => (projects.len() == GITLAB_PAGE).then_some(number + 1),
            };
            Ok(Fetched {
                repositories: projects.into_iter().map(Into::into).collect(),
                next,
            })
        })?;
        Ok(RepositoryList {
            page,
            missing_scopes: Vec::new(),
            sso_left_out: false,
        })
    }
}

/// Why GitLab didn't answer as asked, other than refusing the token.
fn refusal(host: &str, answer: &Answer) -> HostError {
    let host = host.to_owned();
    if answer.status == 429 {
        return HostError::RateLimited {
            host,
            resets_at: answer.resets_at("ratelimit-reset"),
        };
    }
    let insufficient = answer
        .header("www-authenticate")
        .is_some_and(|said| said.contains("insufficient_scope"))
        || answer.body.contains("insufficient_scope");
    if answer.status == 403 && insufficient {
        return HostError::MissingScope {
            host,
            needed: vec![READ_API.into()],
        };
    }
    HostError::HostFailed {
        host,
        status: answer.status,
        message: answer.said(),
    }
}

/// The signed-in user, as GitLab's `/user` gives them.
#[derive(Deserialize)]
struct User {
    username: String,
    name: Option<String>,
}

/// A project, as GitLab's `/projects` gives it.
#[derive(Deserialize)]
struct Project {
    path_with_namespace: String,
    description: Option<String>,
    /// `public`, `internal` or `private`.
    visibility: Option<String>,
    /// Only there for a fork, and only if the user can see what it forks.
    forked_from_project: Option<serde_json::Value>,
    #[serde(default)]
    archived: bool,
    http_url_to_repo: String,
    ssh_url_to_repo: Option<String>,
}

impl From<Project> for HostRepository {
    fn from(project: Project) -> Self {
        Self {
            full_name: project.path_with_namespace,
            description: project.description.filter(|text| !text.trim().is_empty()),
            private: project.visibility.as_deref() != Some("public"),
            fork: project
                .forked_from_project
                .is_some_and(|parent| !parent.is_null()),
            archived: project.archived,
            clone_url: project.http_url_to_repo,
            ssh_url: project.ssh_url_to_repo,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::super::stand_in::{Helper, Reply, parameter, reply, serve};
    use super::*;
    use crate::page::Cursor;

    fn integration(helper: &Arc<Helper>, api: &str) -> GitLabHostIntegration {
        GitLabHostIntegration::new(Arc::clone(helper) as _).with_api_base(api)
    }

    fn user(_: &str, _: Option<&str>) -> Reply {
        reply(
            200,
            &[],
            json!({ "id": 1, "username": "octocat", "name": "The Octocat" }),
        )
    }

    #[test]
    fn serves_gitlab_com_and_finds_its_api() {
        let integration = GitLabHostIntegration::new(Helper::holding("token") as _);

        assert_eq!(
            integration.serves("gitlab.com").as_deref(),
            Some("gitlab.com")
        );
        assert_eq!(
            integration.serves("altssh.gitlab.com").as_deref(),
            Some("gitlab.com")
        );
        assert_eq!(integration.serves("gitlab.example.com"), None);
        assert_eq!(integration.api(), "https://gitlab.com/api/v4");
    }

    #[test]
    fn signs_in_with_the_helper_s_token_and_tells_it_the_host_took_it() {
        let (api, asked) = serve(user);
        let helper = Helper::holding("glpat-from-gcm");

        let signed_in = integration(&helper, &api).sign_in("gitlab.com", false);

        assert_eq!(
            signed_in,
            Ok(SignedIn {
                host: "gitlab.com".into(),
                login: "octocat".into(),
                name: Some("The Octocat".into()),
                missing_scopes: vec![],
            })
        );
        assert_eq!(
            *asked.lock().unwrap(),
            [("/user".to_owned(), Some("Bearer glpat-from-gcm".to_owned()))]
        );
        assert_eq!(helper.told(), ["fill gitlab.com", "approve glpat-from-gcm"]);
    }

    #[test]
    fn a_refused_token_is_forgotten() {
        let (api, _) = serve(|_, _| reply(401, &[], json!({ "message": "401 Unauthorized" })));
        let helper = Helper::holding("glpat-revoked");

        assert_eq!(
            integration(&helper, &api).sign_in("gitlab.com", false),
            Err(HostError::TokenRefused {
                host: "gitlab.com".into()
            })
        );
        assert_eq!(helper.told(), ["fill gitlab.com", "reject glpat-revoked"]);
    }

    #[test]
    fn signing_in_again_forgets_the_helper_s_credential_first() {
        let (api, asked) = serve(user);
        let helper = Helper::holding("glpat-old");

        let signed_in = integration(&helper, &api).sign_in("gitlab.com", true);

        assert!(
            matches!(signed_in, Err(HostError::NoCredential { ref host, .. }) if host == "gitlab.com"),
            "{signed_in:?}"
        );
        assert_eq!(helper.told(), ["reject ", "fill gitlab.com"]);
        assert!(asked.lock().unwrap().is_empty());
    }

    /// A GitLab with `count` projects, `lanewise-000` on, of which every
    /// seventh has "graph" in its description, a page of 100 at a time.
    /// With `next_page`, it says in `X-Next-Page` whether there's another.
    fn projects(count: usize, next_page: bool) -> impl Fn(&str, Option<&str>) -> Reply {
        move |path, _| {
            let page: usize = parameter(path, "page")
                .and_then(|page| page.parse().ok())
                .unwrap_or(1);
            let start = (page - 1) * GITLAB_PAGE;
            let projects: Vec<Value> = (start..count.min(start + GITLAB_PAGE))
                .map(|n| {
                    json!({
                        "id": n,
                        "path_with_namespace": format!("octocat/lanewise-{n:03}"),
                        "description": if n % 7 == 0 { Value::from("A commit graph") } else { Value::Null },
                        "visibility": (["private", "internal", "public"][n % 3]),
                        "archived": n == 1,
                        "http_url_to_repo": format!("https://gitlab.com/octocat/lanewise-{n:03}.git"),
                        "ssh_url_to_repo": format!("git@gitlab.com:octocat/lanewise-{n:03}.git"),
                    })
                })
                .collect();
            let next = if start + GITLAB_PAGE < count {
                (page + 1).to_string()
            } else {
                String::new()
            };
            Reply {
                status: 200,
                headers: if next_page {
                    vec![("X-Next-Page", next)]
                } else {
                    vec![]
                },
                body: Value::Array(projects).to_string(),
            }
        }
    }

    /// Every page of `query`'s projects, `limit` at a time, by name.
    fn read_all(integration: &GitLabHostIntegration, query: &str, limit: u32) -> Vec<Vec<String>> {
        let mut pages = Vec::new();
        let mut cursor = None;
        loop {
            let list = integration
                .repositories(
                    "gitlab.com",
                    query,
                    &PageRequest {
                        cursor,
                        limit: Some(limit),
                    },
                )
                .expect("a page of projects");
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
    fn lists_the_user_s_projects_page_by_page() {
        for next_page in [true, false] {
            let (api, asked) = serve(projects(250, next_page));
            let helper = Helper::holding("glpat");
            let integration = integration(&helper, &api);

            let pages = read_all(&integration, "", 60);

            assert_eq!(
                pages.iter().map(Vec::len).collect::<Vec<_>>(),
                [60, 60, 60, 60, 10]
            );
            assert_eq!(
                pages.concat(),
                (0..250)
                    .map(|n| format!("octocat/lanewise-{n:03}"))
                    .collect::<Vec<_>>()
            );
            let asked = asked.lock().unwrap();
            assert!(
                asked[0].0.starts_with(
                    "/projects?membership=true&order_by=path&sort=asc&per_page=100&page=1"
                ),
                "{asked:?}"
            );
            assert!(
                asked
                    .iter()
                    .all(|(_, authorization)| authorization.as_deref() == Some("Bearer glpat"))
            );
        }
    }

    #[test]
    fn maps_each_project_to_a_repository() {
        let (api, _) = serve(projects(3, true));
        let helper = Helper::holding("glpat");

        let items = integration(&helper, &api)
            .repositories("gitlab.com", "", &PageRequest::default())
            .unwrap()
            .page
            .items;

        assert_eq!(
            serde_json::to_value(&items).unwrap(),
            json!([
                {
                    "fullName": "octocat/lanewise-000",
                    "description": "A commit graph",
                    "private": true,
                    "fork": false,
                    "archived": false,
                    "cloneUrl": "https://gitlab.com/octocat/lanewise-000.git",
                    "sshUrl": "git@gitlab.com:octocat/lanewise-000.git"
                },
                {
                    "fullName": "octocat/lanewise-001",
                    "description": null,
                    "private": true,
                    "fork": false,
                    "archived": true,
                    "cloneUrl": "https://gitlab.com/octocat/lanewise-001.git",
                    "sshUrl": "git@gitlab.com:octocat/lanewise-001.git"
                },
                {
                    "fullName": "octocat/lanewise-002",
                    "description": null,
                    "private": false,
                    "fork": false,
                    "archived": false,
                    "cloneUrl": "https://gitlab.com/octocat/lanewise-002.git",
                    "sshUrl": "git@gitlab.com:octocat/lanewise-002.git"
                }
            ])
        );
        let fork: Project = serde_json::from_value(json!({
            "path_with_namespace": "octocat/fork",
            "forked_from_project": { "id": 7 },
            "http_url_to_repo": "https://gitlab.com/octocat/fork.git"
        }))
        .unwrap();
        let fork = HostRepository::from(fork);
        assert!(fork.fork && fork.private && fork.ssh_url.is_none());
    }

    #[test]
    fn searches_for_the_longest_word_and_matches_every_word() {
        let (api, asked) = serve(projects(250, true));
        let helper = Helper::holding("glpat");
        let integration = integration(&helper, &api);

        let found = read_all(&integration, "  GRAPH commit a ", 10).concat();

        assert_eq!(
            found,
            (0..250)
                .filter(|n| n % 7 == 0)
                .map(|n| format!("octocat/lanewise-{n:03}"))
                .collect::<Vec<_>>()
        );
        let asked = asked.lock().unwrap();
        assert!(
            asked
                .iter()
                .all(|(path, _)| path.ends_with("&search=commit&search_namespaces=true")),
            "{asked:?}"
        );
        drop(asked);

        let (api, asked) = serve(projects(3, true));
        let found = read_all(&integration_at(&api), "a&page=9 x", 10).concat();
        assert!(found.is_empty());
        assert!(
            asked.lock().unwrap()[0]
                .0
                .ends_with("&page=1&search=a%26page%3D9&search_namespaces=true")
        );
    }

    fn integration_at(api: &str) -> GitLabHostIntegration {
        integration(&Helper::holding("glpat"), api)
    }

    #[test]
    fn a_cursor_from_elsewhere_is_invalid() {
        let (api, _) = serve(projects(3, true));
        let integration = integration_at(&api);

        for cursor in [
            Cursor::naming(&"not a place"),
            Cursor::naming(&Place {
                page: 1,
                after: Some("octocat/gone".into()),
            }),
        ] {
            assert_eq!(
                integration.repositories(
                    "gitlab.com",
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

    fn refused(answer: fn(&str, Option<&str>) -> Reply) -> HostError {
        let (api, _) = serve(answer);
        integration_at(&api)
            .repositories("gitlab.com", "", &PageRequest::default())
            .unwrap_err()
    }

    #[test]
    fn tells_gitlab_s_refusals_apart() {
        let host = || "gitlab.com".to_owned();
        assert_eq!(
            refused(|_, _| reply(
                403,
                &[(
                    "WWW-Authenticate",
                    "Bearer realm=\"\", error=\"insufficient_scope\", error_description=\"The request requires higher privileges than provided by the access token.\", scope=\"api read_api\""
                )],
                json!({ "error": "insufficient_scope", "scope": "api read_api" })
            )),
            HostError::MissingScope {
                host: host(),
                needed: vec!["read_api".into()]
            }
        );
        assert_eq!(
            refused(|_, _| reply(
                429,
                &[("RateLimit-Reset", "1700000000")],
                json!({ "message": "Retry later" })
            )),
            HostError::RateLimited {
                host: host(),
                resets_at: Some(1_700_000_000)
            }
        );
        assert_eq!(
            refused(|_, _| reply(403, &[], json!({ "message": "403 Forbidden" }))),
            HostError::HostFailed {
                host: host(),
                status: 403,
                message: "403 Forbidden".into()
            }
        );
        assert_eq!(
            refused(|_, _| reply(401, &[], json!({ "message": "401 Unauthorized" }))),
            HostError::TokenRefused { host: host() }
        );
    }
}
