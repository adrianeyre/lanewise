//! The Bitbucket Host Integration: Tier 2, for Bitbucket Cloud, at
//! `bitbucket.org` (PRD §9.1). It signs in with the credential the user's
//! credential helper has for the Host, such as Git Credential Manager's
//! OAuth token, or an app password or API token, so there's no second
//! sign-in, and lists the repositories the user is a member of through
//! Bitbucket's REST API (ADR 0016, ADR 0037).

use std::cell::Cell;
use std::sync::Arc;

use lanewise_core::{Credential, Credentials};
use serde::Deserialize;

use super::answer::{Answer, basic, bearer, encoded, without_user};
use super::listing::{Fetched, Place, list, words};
use super::{
    HostError, HostIntegration, HostRepository, IntegrationKind, RepositoryList, SignedIn,
};
use crate::page::PageRequest;

/// How many repositories each request to Bitbucket asks for: the most it
/// gives.
const BITBUCKET_PAGE: usize = 100;

/// Serves Bitbucket Cloud at Tier 2.
pub struct BitbucketHostIntegration {
    credentials: Arc<dyn Credentials + Send + Sync>,
    /// Where Bitbucket's API is, instead of its own.
    api_base: Option<String>,
}

/// How a credential is sent: as an OAuth app's bearer token, such as Git
/// Credential Manager's, or with its username, as an app password or API
/// token is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Scheme {
    Bearer,
    Basic,
}

impl BitbucketHostIntegration {
    /// Bitbucket Cloud, signing in with what `credentials` gives.
    pub fn new(credentials: Arc<dyn Credentials + Send + Sync>) -> Self {
        Self {
            credentials,
            api_base: None,
        }
    }

    /// The same, sending its API calls to `api_base` instead, such as a
    /// test's stand-in for Bitbucket's API at `http://127.0.0.1:8080`.
    pub fn with_api_base(mut self, api_base: impl Into<String>) -> Self {
        self.api_base = Some(api_base.into());
        self
    }

    /// Where Bitbucket Cloud's REST API is.
    fn api(&self) -> String {
        match &self.api_base {
            Some(base) => base.trim_end_matches('/').to_owned(),
            None => "https://api.bitbucket.org/2.0".into(),
        }
    }

    fn fill(&self, host: &str) -> Result<Credential, HostError> {
        self.credentials
            .fill(host)
            .map_err(|error| HostError::from_credential(host, error))
    }

    /// Asks Bitbucket's API for `path`, with `credential`, sent as `scheme`
    /// says. A bearer token Bitbucket refuses is tried once more with its
    /// username, as an app password, and `scheme` keeps whichever worked. A
    /// credential Bitbucket refuses both ways is rejected, so the helpers
    /// forget it.
    fn get(
        &self,
        host: &str,
        credential: &Credential,
        scheme: &Cell<Scheme>,
        path: &str,
    ) -> Result<Answer, HostError> {
        let url = format!("{}{path}", self.api());
        let ask = |scheme: Scheme| {
            let authorization = match (scheme, credential.username()) {
                (Scheme::Basic, Some(username)) => basic(username, credential.secret()),
                _ => bearer(credential.secret()),
            };
            Answer::get(
                host,
                &url,
                &[
                    ("Accept", "application/json"),
                    ("Authorization", &authorization),
                ],
            )
        };
        let mut answer = ask(scheme.get())?;
        if answer.status == 401 && scheme.get() == Scheme::Bearer && credential.username().is_some()
        {
            answer = ask(Scheme::Basic)?;
            if answer.status != 401 {
                scheme.set(Scheme::Basic);
            }
        }
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

impl HostIntegration for BitbucketHostIntegration {
    fn kind(&self) -> IntegrationKind {
        IntegrationKind::Bitbucket
    }

    fn tier(&self) -> u8 {
        2
    }

    fn serves(&self, name: &str) -> Option<String> {
        (name == "bitbucket.org" || name == "altssh.bitbucket.org").then(|| "bitbucket.org".into())
    }

    fn sign_in(&self, host: &str, again: bool) -> Result<SignedIn, HostError> {
        if again {
            // Every credential the helpers have for the Host, whoever's.
            let _ = self.credentials.reject(&Credential::new(host, None, ""));
        }
        let credential = self.fill(host)?;
        let scheme = Cell::new(Scheme::Bearer);
        let user: User = self
            .get(host, &credential, &scheme, "/user")?
            .json(host, "Bitbucket's signed-in user")?;
        // So a helper that keeps a credential only once it has worked, as
        // Git Credential Manager does, keeps it. Best done, not needed.
        let _ = self.credentials.approve(&credential);
        let login = user
            .username
            .or(user.nickname)
            .filter(|login| !login.trim().is_empty())
            .ok_or_else(|| HostError::HostFailed {
                host: host.into(),
                status: 200,
                message: "Bitbucket gave no username for the signed-in user.".into(),
            })?;
        Ok(SignedIn {
            host: host.into(),
            login,
            name: user.display_name.filter(|name| !name.trim().is_empty()),
            missing_scopes: Vec::new(),
        })
    }

    /// Bitbucket's `/repositories` of which the user is a member, by full
    /// name. Bitbucket searches for every word of `query`, in each one's
    /// full name or description, and Rust does again, as it does for GitHub.
    fn repositories(
        &self,
        host: &str,
        query: &str,
        page: &PageRequest,
    ) -> Result<RepositoryList, HostError> {
        let place = Place::asked(page, "1".to_owned())?;
        let credential = self.fill(host)?;
        let scheme = Cell::new(Scheme::Bearer);
        let words = words(query);
        let search = if words.is_empty() {
            String::new()
        } else {
            let each: Vec<String> = words
                .iter()
                .map(|word| {
                    let word = word.replace('\\', "\\\\").replace('"', "\\\"");
                    format!("(full_name ~ \"{word}\" OR description ~ \"{word}\")")
                })
                .collect();
            format!("&q={}", encoded(&each.join(" AND ")))
        };
        let page = list(place, page.limit(), &words, |number| {
            let answer = self.get(
                host,
                &credential,
                &scheme,
                &format!(
                    "/repositories?role=member&pagelen={BITBUCKET_PAGE}&sort=full_name&page={}{search}",
                    encoded(number)
                ),
            )?;
            let listed: Listed = answer.json(host, "Bitbucket's list of repositories")?;
            Ok(Fetched {
                repositories: listed.values.into_iter().map(Into::into).collect(),
                next: listed.next.as_deref().and_then(next_page),
            })
        })?;
        Ok(RepositoryList {
            page,
            missing_scopes: Vec::new(),
            sso_left_out: false,
        })
    }
}

/// The page `next`, Bitbucket's URL for the next page, names. Only its page
/// is taken: the URL isn't followed, so the credential never goes anywhere
/// but Bitbucket's API.
fn next_page(next: &str) -> Option<String> {
    let (_, query) = next.split_once('?')?;
    query
        .split('&')
        .find_map(|part| part.strip_prefix("page="))
        .map(decoded)
        .filter(|page| !page.is_empty())
}

/// `text` with each `%` escape in it decoded, as a URL's query has it.
fn decoded(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let escape = (bytes[index] == b'%')
            .then(|| text.get(index + 1..index + 3))
            .flatten()
            .and_then(|hex| u8::from_str_radix(hex, 16).ok());
        match escape {
            Some(byte) => {
                decoded.push(byte);
                index += 3;
            }
            None => {
                decoded.push(bytes[index]);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

/// Why Bitbucket didn't answer as asked, other than refusing the
/// credential.
fn refusal(host: &str, answer: &Answer) -> HostError {
    let host = host.to_owned();
    if answer.status == 429 {
        return HostError::RateLimited {
            host,
            resets_at: answer.resets_at("x-ratelimit-reset"),
        };
    }
    if answer.status == 403 {
        let said: serde_json::Value = serde_json::from_str(&answer.body).unwrap_or_default();
        if let Some(required) = said["error"]["detail"]["required"].as_array() {
            let needed = required
                .iter()
                .filter_map(|scope| scope.as_str().map(str::to_owned))
                .collect();
            return HostError::MissingScope { host, needed };
        }
    }
    HostError::HostFailed {
        host,
        status: answer.status,
        message: answer.said(),
    }
}

/// The signed-in user, as Bitbucket's `/user` gives them.
#[derive(Deserialize)]
struct User {
    username: Option<String>,
    nickname: Option<String>,
    display_name: Option<String>,
}

/// A page of Bitbucket's repositories, and the URL of the next.
#[derive(Deserialize)]
struct Listed {
    #[serde(default)]
    values: Vec<Repository>,
    next: Option<String>,
}

/// A repository, as Bitbucket's `/repositories` gives it.
#[derive(Deserialize)]
struct Repository {
    full_name: String,
    description: Option<String>,
    #[serde(default)]
    is_private: bool,
    /// Only there for a fork.
    parent: Option<serde_json::Value>,
    #[serde(default)]
    links: Links,
}

#[derive(Default, Deserialize)]
struct Links {
    #[serde(default)]
    clone: Vec<Link>,
}

/// One of a repository's clone URLs, by `https` or `ssh`.
#[derive(Deserialize)]
struct Link {
    name: String,
    href: String,
}

impl Repository {
    fn clone_link(&self, name: &str) -> Option<&str> {
        self.links
            .clone
            .iter()
            .find(|link| link.name == name)
            .map(|link| link.href.as_str())
    }
}

impl From<Repository> for HostRepository {
    fn from(repository: Repository) -> Self {
        let clone_url = repository.clone_link("https").map_or_else(
            || format!("https://bitbucket.org/{}.git", repository.full_name),
            without_user,
        );
        let ssh_url = repository.clone_link("ssh").map(str::to_owned);
        Self {
            full_name: repository.full_name,
            description: repository
                .description
                .filter(|text| !text.trim().is_empty()),
            private: repository.is_private,
            fork: repository.parent.is_some_and(|parent| !parent.is_null()),
            // Bitbucket Cloud has no archived repositories.
            archived: false,
            clone_url,
            ssh_url,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::super::stand_in::{Helper, Reply, parameter, reply, serve};
    use super::*;
    use crate::page::Cursor;

    fn integration(helper: &Arc<Helper>, api: &str) -> BitbucketHostIntegration {
        BitbucketHostIntegration::new(Arc::clone(helper) as _).with_api_base(api)
    }

    fn user() -> Value {
        json!({
            "type": "user",
            "username": "octocat",
            "nickname": "octo",
            "display_name": "The Octocat",
            "account_id": "557058:1"
        })
    }

    /// A Bitbucket that takes `token` only as `accepted`, answering with `ok`.
    fn taking(
        accepted: &'static str,
        ok: impl Fn(&str) -> Reply + Send + 'static,
    ) -> impl Fn(&str, Option<&str>) -> Reply + Send + 'static {
        move |path, authorization| {
            if authorization == Some(accepted) {
                ok(path)
            } else {
                reply(
                    401,
                    &[],
                    json!({ "type": "error", "error": { "message": "Unauthorized" } }),
                )
            }
        }
    }

    #[test]
    fn serves_bitbucket_org_and_finds_its_api() {
        let integration = BitbucketHostIntegration::new(Helper::holding("token") as _);

        assert_eq!(
            integration.serves("bitbucket.org").as_deref(),
            Some("bitbucket.org")
        );
        assert_eq!(
            integration.serves("altssh.bitbucket.org").as_deref(),
            Some("bitbucket.org")
        );
        assert_eq!(integration.serves("bitbucket.example.com"), None);
        assert_eq!(integration.api(), "https://api.bitbucket.org/2.0");
    }

    #[test]
    fn signs_in_with_an_oauth_token_as_a_bearer_token() {
        let (api, asked) = serve(taking("Bearer from-gcm", |_| reply(200, &[], user())));
        let helper = Helper::holding("from-gcm");

        assert_eq!(
            integration(&helper, &api).sign_in("bitbucket.org", false),
            Ok(SignedIn {
                host: "bitbucket.org".into(),
                login: "octocat".into(),
                name: Some("The Octocat".into()),
                missing_scopes: vec![],
            })
        );
        assert_eq!(
            *asked.lock().unwrap(),
            [("/user".to_owned(), Some("Bearer from-gcm".to_owned()))]
        );
        assert_eq!(helper.told(), ["fill bitbucket.org", "approve from-gcm"]);
    }

    #[test]
    fn signs_in_with_an_app_password_and_its_username() {
        let accepted = "Basic b2N0b2NhdDphcHAtcGFzc3dvcmQ=";
        assert_eq!(basic("octocat", "app-password"), accepted);
        let (api, asked) = serve(taking(accepted, |path| {
            if path == "/user" {
                reply(200, &[], json!({ "nickname": "octo", "display_name": " " }))
            } else {
                reply(200, &[], json!({ "values": [] }))
            }
        }));
        let helper = Helper::holding("app-password");
        let integration = integration(&helper, &api);

        let signed_in = integration.sign_in("bitbucket.org", false).unwrap();
        assert_eq!((signed_in.login.as_str(), signed_in.name), ("octo", None));
        integration
            .repositories("bitbucket.org", "", &PageRequest::default())
            .unwrap();

        // Each call tries the bearer token first, then the app password.
        let asked: Vec<Option<String>> = asked
            .lock()
            .unwrap()
            .iter()
            .map(|(_, authorization)| authorization.clone())
            .collect();
        assert_eq!(
            asked,
            [
                Some("Bearer app-password".into()),
                Some(accepted.into()),
                Some("Bearer app-password".into()),
                Some(accepted.into()),
            ]
        );
        assert_eq!(
            helper.told(),
            [
                "fill bitbucket.org",
                "approve app-password",
                "fill bitbucket.org"
            ]
        );
    }

    #[test]
    fn a_credential_refused_both_ways_is_forgotten() {
        let (api, asked) = serve(taking("nothing", |_| reply(200, &[], user())));
        let helper = Helper::holding("revoked");

        assert_eq!(
            integration(&helper, &api).sign_in("bitbucket.org", false),
            Err(HostError::TokenRefused {
                host: "bitbucket.org".into()
            })
        );
        assert_eq!(asked.lock().unwrap().len(), 2);
        assert_eq!(helper.told(), ["fill bitbucket.org", "reject revoked"]);

        // With no username, there's no app password to try.
        let (api, asked) = serve(taking("nothing", |_| reply(200, &[], user())));
        let helper = Helper::holding_for(None, "revoked");
        assert!(
            integration(&helper, &api)
                .sign_in("bitbucket.org", false)
                .is_err()
        );
        assert_eq!(asked.lock().unwrap().len(), 1);
    }

    #[test]
    fn signing_in_again_forgets_the_helper_s_credential_first() {
        let (api, _) = serve(|_, _| reply(200, &[], user()));
        let helper = Helper::holding("old");

        let signed_in = integration(&helper, &api).sign_in("bitbucket.org", true);

        assert!(
            matches!(signed_in, Err(HostError::NoCredential { ref host, .. }) if host == "bitbucket.org"),
            "{signed_in:?}"
        );
        assert_eq!(helper.told(), ["reject ", "fill bitbucket.org"]);
    }

    /// A Bitbucket with `count` repositories, `lanewise-000` on, of which
    /// every seventh has "graph" in its description, a page of 100 at a
    /// time, whose `next` names a Host other than its own.
    fn repositories(count: usize) -> impl Fn(&str, Option<&str>) -> Reply + Send + 'static {
        move |path, _| {
            let page: usize = parameter(path, "page")
                .and_then(|page| page.parse().ok())
                .unwrap_or(1);
            let start = (page - 1) * BITBUCKET_PAGE;
            let values: Vec<Value> = (start..count.min(start + BITBUCKET_PAGE))
                .map(|n| {
                    json!({
                        "full_name": format!("team/lanewise-{n:03}"),
                        "description": if n % 7 == 0 { "A commit graph" } else { "" },
                        "is_private": n % 2 == 0,
                        "links": { "clone": [
                            { "name": "https", "href": format!("https://octocat@bitbucket.org/team/lanewise-{n:03}.git") },
                            { "name": "ssh", "href": format!("git@bitbucket.org:team/lanewise-{n:03}.git") }
                        ] }
                    })
                })
                .collect();
            let mut body = json!({ "pagelen": 100, "page": page, "values": values });
            if start + BITBUCKET_PAGE < count {
                body["next"] = json!(format!(
                    "https://elsewhere.example.com/2.0/repositories?role=member&pagelen=100&page={}",
                    page + 1
                ));
            }
            reply(200, &[], body)
        }
    }

    /// Every page of `query`'s repositories, `limit` at a time, by name.
    fn read_all(
        integration: &BitbucketHostIntegration,
        query: &str,
        limit: u32,
    ) -> Vec<Vec<String>> {
        let mut pages = Vec::new();
        let mut cursor = None;
        loop {
            let list = integration
                .repositories(
                    "bitbucket.org",
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
    fn lists_the_user_s_repositories_page_by_page_from_bitbucket_s_api_only() {
        let (api, asked) = serve(repositories(250));
        let helper = Helper::holding("from-gcm");
        let integration = integration(&helper, &api);

        let pages = read_all(&integration, "", 60);

        assert_eq!(
            pages.iter().map(Vec::len).collect::<Vec<_>>(),
            [60, 60, 60, 60, 10]
        );
        assert_eq!(
            pages.concat(),
            (0..250)
                .map(|n| format!("team/lanewise-{n:03}"))
                .collect::<Vec<_>>()
        );
        let asked = asked.lock().unwrap();
        // The `next` URL's Host was never asked: only its page was taken.
        assert!(
            asked.iter().all(|(path, authorization)| path
                .starts_with("/repositories?role=member&pagelen=100&sort=full_name&page=")
                && authorization.as_deref() == Some("Bearer from-gcm")),
            "{asked:?}"
        );
        assert!(asked.iter().any(|(path, _)| path.ends_with("&page=3")));
    }

    #[test]
    fn maps_each_repository_without_the_user_in_its_url() {
        let (api, _) = serve(repositories(2));
        let helper = Helper::holding("token");

        let items = integration(&helper, &api)
            .repositories("bitbucket.org", "", &PageRequest::default())
            .unwrap()
            .page
            .items;

        assert_eq!(
            serde_json::to_value(&items[..2]).unwrap(),
            json!([
                {
                    "fullName": "team/lanewise-000",
                    "description": "A commit graph",
                    "private": true,
                    "fork": false,
                    "archived": false,
                    "cloneUrl": "https://bitbucket.org/team/lanewise-000.git",
                    "sshUrl": "git@bitbucket.org:team/lanewise-000.git"
                },
                {
                    "fullName": "team/lanewise-001",
                    "description": null,
                    "private": false,
                    "fork": false,
                    "archived": false,
                    "cloneUrl": "https://bitbucket.org/team/lanewise-001.git",
                    "sshUrl": "git@bitbucket.org:team/lanewise-001.git"
                }
            ])
        );
        let fork: Repository = serde_json::from_value(json!({
            "full_name": "octocat/fork",
            "parent": { "full_name": "team/lanewise" }
        }))
        .unwrap();
        let fork = HostRepository::from(fork);
        assert!(fork.fork);
        assert_eq!(fork.clone_url, "https://bitbucket.org/octocat/fork.git");
        assert_eq!(fork.ssh_url, None);
    }

    #[test]
    fn searches_for_every_word_in_bitbucket_s_query_language() {
        let (api, asked) = serve(repositories(250));
        let helper = Helper::holding("token");
        let integration = integration(&helper, &api);

        let found = read_all(&integration, "  GRAPH commit ", 10).concat();

        assert_eq!(
            found,
            (0..250)
                .filter(|n| n % 7 == 0)
                .map(|n| format!("team/lanewise-{n:03}"))
                .collect::<Vec<_>>()
        );
        let q = r#"(full_name ~ "graph" OR description ~ "graph") AND (full_name ~ "commit" OR description ~ "commit")"#;
        assert!(
            asked.lock().unwrap()[0]
                .0
                .ends_with(&format!("&page=1&q={}", encoded(q)))
        );

        let (api, asked) = serve(repositories(1));
        read_all(&integration_at(&api), r#"say"&page=9"#, 10);
        assert!(asked.lock().unwrap()[0].0.ends_with(&encoded(
            r#"(full_name ~ "say\"&page=9" OR description ~ "say\"&page=9")"#
        )),);
    }

    fn integration_at(api: &str) -> BitbucketHostIntegration {
        integration(&Helper::holding("token"), api)
    }

    #[test]
    fn a_cursor_from_elsewhere_is_invalid() {
        let (api, _) = serve(repositories(3));
        let integration = integration_at(&api);

        for cursor in [
            Cursor::naming(&"not a place"),
            Cursor::naming(&Place {
                page: "1".to_owned(),
                after: Some("team/gone".into()),
            }),
        ] {
            assert_eq!(
                integration.repositories(
                    "bitbucket.org",
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

    #[test]
    fn takes_only_the_page_from_the_next_url() {
        assert_eq!(
            next_page("https://api.bitbucket.org/2.0/repositories?pagelen=100&page=2").as_deref(),
            Some("2")
        );
        assert_eq!(
            next_page("https://api.bitbucket.org/2.0/repositories?page=Ab%3D%3D&role=member")
                .as_deref(),
            Some("Ab==")
        );
        assert_eq!(
            next_page("https://api.bitbucket.org/2.0/repositories"),
            None
        );
        assert_eq!(next_page("https://elsewhere.example.com/?page="), None);
    }

    fn refused(answer: fn(&str, Option<&str>) -> Reply) -> HostError {
        let (api, _) = serve(answer);
        integration_at(&api)
            .repositories("bitbucket.org", "", &PageRequest::default())
            .unwrap_err()
    }

    #[test]
    fn tells_bitbucket_s_refusals_apart() {
        let host = || "bitbucket.org".to_owned();
        assert_eq!(
            refused(|_, _| reply(
                403,
                &[],
                json!({ "type": "error", "error": {
                    "message": "Your credentials lack one or more required privilege scopes.",
                    "detail": { "granted": ["account"], "required": ["repository"] }
                } })
            )),
            HostError::MissingScope {
                host: host(),
                needed: vec!["repository".into()]
            }
        );
        assert_eq!(
            refused(|_, _| reply(
                429,
                &[("X-RateLimit-Reset", "1700000000")],
                json!({ "type": "error" })
            )),
            HostError::RateLimited {
                host: host(),
                resets_at: Some(1_700_000_000)
            }
        );
        let before = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        assert!(matches!(
            refused(|_, _| reply(429, &[("Retry-After", "60")], json!({}))),
            HostError::RateLimited { resets_at: Some(at), .. } if at >= before + 60
        ));
        assert_eq!(
            refused(|_, _| reply(
                500,
                &[],
                json!({ "type": "error", "error": { "message": "Something went wrong" } })
            )),
            HostError::HostFailed {
                host: host(),
                status: 500,
                message: "Something went wrong".into()
            }
        );
        assert_eq!(
            refused(|_, _| reply(401, &[], json!({}))),
            HostError::TokenRefused { host: host() }
        );
    }
}
