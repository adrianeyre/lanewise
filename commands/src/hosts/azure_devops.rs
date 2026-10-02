//! The Azure DevOps Host Integration: Tier 2, for Azure DevOps Services, at
//! `dev.azure.com` and each organization's older `{org}.visualstudio.com`
//! (PRD §9.1). It signs in with the credential the user's credential helper
//! has for the Host, such as Git Credential Manager's Microsoft Entra token
//! or a personal access token, so there's no second sign-in, and lists the
//! repositories in each of the user's organizations through Azure DevOps's
//! REST API (ADR 0016, ADR 0037).

use std::sync::Arc;

use lanewise_core::{Credential, Credentials};
use serde::Deserialize;

use super::answer::{Answer, basic, bearer, encoded, without_user};
use super::listing::{Fetched, Place, list, words};
use super::{
    HostError, HostIntegration, HostRepository, IntegrationKind, RepositoryList, SignedIn,
};
use crate::page::{Page, PageRequest};

/// The version of Azure DevOps's REST API that's asked for.
const API_VERSION: &str = "api-version=7.1";

/// Serves Azure DevOps Services at Tier 2.
pub struct AzureDevOpsHostIntegration {
    credentials: Arc<dyn Credentials + Send + Sync>,
    /// Where every one of Azure DevOps's APIs is, instead of its own.
    api_base: Option<String>,
}

impl AzureDevOpsHostIntegration {
    /// Azure DevOps Services, signing in with what `credentials` gives.
    pub fn new(credentials: Arc<dyn Credentials + Send + Sync>) -> Self {
        Self {
            credentials,
            api_base: None,
        }
    }

    /// The same, sending all its API calls to `api_base` instead, such as a
    /// test's stand-in for Azure DevOps's APIs at `http://127.0.0.1:8080`.
    pub fn with_api_base(mut self, api_base: impl Into<String>) -> Self {
        self.api_base = Some(api_base.into());
        self
    }

    fn base(&self) -> Option<String> {
        self.api_base
            .as_deref()
            .map(|base| base.trim_end_matches('/').to_owned())
    }

    /// Where the user's profile and organizations are: Azure DevOps's
    /// profile service, whichever Host the user signs in to.
    fn profiles_api(&self) -> String {
        self.base()
            .unwrap_or_else(|| "https://app.vssps.visualstudio.com".into())
    }

    /// Where the list of `organization`'s repositories on `host` is.
    fn repositories_url(&self, host: &str, organization: &str) -> String {
        let organization = encoded(organization);
        match self.base() {
            Some(base) => format!("{base}/{organization}/_apis/git/repositories?{API_VERSION}"),
            None if host == "dev.azure.com" => {
                format!("https://dev.azure.com/{organization}/_apis/git/repositories?{API_VERSION}")
            }
            None => format!("https://{host}/_apis/git/repositories?{API_VERSION}"),
        }
    }

    fn fill(&self, host: &str) -> Result<Credential, HostError> {
        self.credentials
            .fill(host)
            .map_err(|error| HostError::from_credential(host, error))
    }

    /// Asks Azure DevOps for `url`, with `credential`. A credential it
    /// refuses is rejected, so the helpers forget it: Azure DevOps refuses
    /// one with a 401, or with a 203 and its sign-in page in place of JSON.
    fn get(&self, host: &str, credential: &Credential, url: &str) -> Result<Answer, HostError> {
        let answer = Answer::get(
            host,
            url,
            &[
                ("Accept", "application/json"),
                ("Authorization", &authorization(credential.secret())),
            ],
        )?;
        let signing_in = answer.ok() && answer.body.trim_start().starts_with('<');
        if answer.status == 401 || answer.status == 203 || signing_in {
            // Best done, not needed: a helper that can't forget it asks again.
            let _ = self.credentials.reject(credential);
            return Err(HostError::TokenRefused { host: host.into() });
        }
        if !answer.ok() {
            return Err(refusal(host, &answer));
        }
        Ok(answer)
    }

    fn profile(&self, host: &str, credential: &Credential) -> Result<Profile, HostError> {
        self.get(
            host,
            credential,
            &format!(
                "{}/_apis/profile/profiles/me?{API_VERSION}",
                self.profiles_api()
            ),
        )?
        .json(host, "Azure DevOps's signed-in user")
    }

    /// The organizations whose repositories are listed for `host`: the one
    /// a `{org}.visualstudio.com` Host is, or each the user is a member of,
    /// by name.
    fn organizations(&self, host: &str, credential: &Credential) -> Result<Vec<String>, HostError> {
        if let Some(organization) = visual_studio_organization(host) {
            return Ok(vec![organization.to_owned()]);
        }
        let profile = self.profile(host, credential)?;
        let accounts: Listed<Account> = self
            .get(
                host,
                credential,
                &format!(
                    "{}/_apis/accounts?memberId={}&{API_VERSION}",
                    self.profiles_api(),
                    encoded(&profile.id)
                ),
            )?
            .json(host, "Azure DevOps's list of organizations")?;
        let mut organizations: Vec<String> = accounts
            .value
            .into_iter()
            .map(|account| account.account_name)
            .collect();
        organizations.sort_by_key(|name| name.to_lowercase());
        Ok(organizations)
    }
}

/// The organization a `{org}.visualstudio.com` Host is, if it's one.
fn visual_studio_organization(host: &str) -> Option<&str> {
    host.strip_suffix(".visualstudio.com")
        .filter(|organization| !organization.is_empty() && !organization.contains('.'))
        .filter(|&organization| organization != "vs-ssh")
}

/// How Azure DevOps takes `token`: a Microsoft Entra token, such as Git
/// Credential Manager's, as a bearer token, and a personal access token
/// with HTTP Basic authentication, with no username.
fn authorization(token: &str) -> String {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() == 3 && token.starts_with("eyJ") && parts.iter().all(|part| !part.is_empty()) {
        bearer(token)
    } else {
        basic("", token)
    }
}

impl HostIntegration for AzureDevOpsHostIntegration {
    fn kind(&self) -> IntegrationKind {
        IntegrationKind::AzureDevOps
    }

    fn tier(&self) -> u8 {
        2
    }

    fn serves(&self, name: &str) -> Option<String> {
        match name {
            "dev.azure.com" | "ssh.dev.azure.com" | "vs-ssh.visualstudio.com" => {
                Some("dev.azure.com".into())
            }
            _ => visual_studio_organization(name).map(|_| name.to_owned()),
        }
    }

    /// SSH's `v3/{organization}/{project}/{repository}` is on the web at
    /// `{organization}/{project}/_git/{repository}`, as HTTPS has it already.
    fn web_page(&self, host: &str, path: &str) -> String {
        match path
            .strip_prefix("v3/")
            .map(|rest| rest.splitn(3, '/').collect::<Vec<_>>())
        {
            Some(parts) if parts.len() == 3 => {
                format!("https://{host}/{}/{}/_git/{}", parts[0], parts[1], parts[2])
            }
            _ => format!("https://{host}/{path}"),
        }
    }

    fn sign_in(&self, host: &str, again: bool) -> Result<SignedIn, HostError> {
        if again {
            // Every credential the helpers have for the Host, whoever's.
            let _ = self.credentials.reject(&Credential::new(host, None, ""));
        }
        let credential = self.fill(host)?;
        let profile = self.profile(host, &credential)?;
        // So a helper that keeps a credential only once it has worked, as
        // Git Credential Manager does, keeps it. Best done, not needed.
        let _ = self.credentials.approve(&credential);
        let login = [profile.email_address, profile.public_alias]
            .into_iter()
            .flatten()
            .find(|login| !login.trim().is_empty())
            .unwrap_or(profile.id);
        Ok(SignedIn {
            host: host.into(),
            login,
            name: profile.display_name.filter(|name| !name.trim().is_empty()),
            // Azure DevOps doesn't say what a token may do until it refuses.
            missing_scopes: Vec::new(),
        })
    }

    /// The repositories in each of the user's organizations, organization by
    /// organization, and by project and name in each. Azure DevOps lists an
    /// organization's repositories all at once, so each is one of the
    /// Host's pages, and Rust searches every word of `query`, as it does
    /// for GitHub.
    fn repositories(
        &self,
        host: &str,
        query: &str,
        page: &PageRequest,
    ) -> Result<RepositoryList, HostError> {
        let place = Place::asked(page, 0usize)?;
        let credential = self.fill(host)?;
        let organizations = self.organizations(host, &credential)?;
        let answered = |page| RepositoryList {
            page,
            missing_scopes: Vec::new(),
            sso_left_out: false,
        };
        if organizations.is_empty() && place.page == 0 && place.after.is_none() {
            return Ok(answered(Page {
                items: Vec::new(),
                next_cursor: None,
            }));
        }
        let page = list(place, page.limit(), &words(query), |&index| {
            let organization = organizations.get(index).ok_or(HostError::InvalidCursor)?;
            let repositories: Listed<Repository> = self
                .get(
                    host,
                    &credential,
                    &self.repositories_url(host, organization),
                )?
                .json(host, "Azure DevOps's list of repositories")?;
            let mut repositories: Vec<HostRepository> = repositories
                .value
                .into_iter()
                .filter_map(|repository| repository.into_host_repository(organization))
                .collect();
            repositories.sort_by_key(|repository| repository.full_name.to_lowercase());
            Ok(Fetched {
                repositories,
                next: (index + 1 < organizations.len()).then_some(index + 1),
            })
        })?;
        Ok(answered(page))
    }
}

/// Why Azure DevOps didn't answer as asked, other than refusing the
/// credential.
fn refusal(host: &str, answer: &Answer) -> HostError {
    let host = host.to_owned();
    match answer.status {
        429 => HostError::RateLimited {
            host,
            resets_at: answer.resets_at("x-ratelimit-reset"),
        },
        // Azure DevOps doesn't say which scope it wanted.
        403 => HostError::MissingScope {
            host,
            needed: Vec::new(),
        },
        status => HostError::HostFailed {
            host,
            status,
            message: answer.said(),
        },
    }
}

/// The signed-in user, as Azure DevOps's `profiles/me` gives them.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Profile {
    id: String,
    display_name: Option<String>,
    public_alias: Option<String>,
    email_address: Option<String>,
}

/// A list, as Azure DevOps gives one.
#[derive(Deserialize)]
struct Listed<T> {
    #[serde(default = "Vec::new")]
    value: Vec<T>,
}

/// An organization the user is a member of.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Account {
    account_name: String,
}

/// A repository, as Azure DevOps's `_apis/git/repositories` gives it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Repository {
    name: String,
    project: Project,
    remote_url: Option<String>,
    ssh_url: Option<String>,
    #[serde(default)]
    is_fork: bool,
    #[serde(default)]
    is_disabled: bool,
}

#[derive(Deserialize)]
struct Project {
    name: String,
    /// `private` or `public`.
    visibility: Option<String>,
}

impl Repository {
    /// The repository, in `organization`, to clone, if it has an HTTPS URL
    /// to clone it at.
    fn into_host_repository(self, organization: &str) -> Option<HostRepository> {
        Some(HostRepository {
            full_name: format!("{organization}/{}/{}", self.project.name, self.name),
            description: None,
            private: self.project.visibility.as_deref() != Some("public"),
            fork: self.is_fork,
            archived: self.is_disabled,
            clone_url: without_user(&self.remote_url?),
            ssh_url: self.ssh_url,
        })
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::super::stand_in::{Helper, Reply, reply, serve};
    use super::*;
    use crate::page::Cursor;

    /// A Microsoft Entra token's shape, as Git Credential Manager gives one.
    const ENTRA_TOKEN: &str = "eyJ0eXAiOiJKV1QifQ.eyJzdWIiOiJvY3RvY2F0In0.c2lnbmF0dXJl";

    fn integration(helper: &Arc<Helper>, api: &str) -> AzureDevOpsHostIntegration {
        AzureDevOpsHostIntegration::new(Arc::clone(helper) as _).with_api_base(api)
    }

    fn profile() -> Value {
        json!({
            "id": "a1b2-c3",
            "displayName": "The Octocat",
            "publicAlias": "a1b2-c3",
            "emailAddress": "octocat@example.com"
        })
    }

    /// An Azure DevOps whose user is in `organizations`, each with `count`
    /// repositories in the project `Web`, `lanewise-000` on, of which every
    /// seventh has "graph" in its name.
    fn azure_devops(
        organizations: &'static [&'static str],
        count: usize,
    ) -> impl Fn(&str, Option<&str>) -> Reply + Send + 'static {
        move |path, _| {
            if path.starts_with("/_apis/profile/profiles/me?api-version=7.1") {
                return reply(200, &[], profile());
            }
            if path.starts_with("/_apis/accounts?memberId=a1b2-c3&api-version=7.1") {
                let value: Vec<Value> = organizations
                    .iter()
                    .rev()
                    .map(|name| json!({ "accountId": name, "accountName": name }))
                    .collect();
                return reply(200, &[], json!({ "count": value.len(), "value": value }));
            }
            let Some(organization) = path
                .strip_prefix('/')
                .and_then(|path| path.strip_suffix("/_apis/git/repositories?api-version=7.1"))
            else {
                return reply(404, &[], json!({ "message": "Not Found" }));
            };
            let value: Vec<Value> = (0..count)
                .rev()
                .map(|n| {
                    let name = if n % 7 == 0 {
                        format!("lanewise-{n:03}-graph")
                    } else {
                        format!("lanewise-{n:03}")
                    };
                    json!({
                        "id": n.to_string(),
                        "name": name,
                        "project": { "name": "Web", "visibility": if n % 2 == 0 { "private" } else { "public" } },
                        "remoteUrl": format!("https://{organization}@dev.azure.com/{organization}/Web/_git/{name}"),
                        "sshUrl": format!("git@ssh.dev.azure.com:v3/{organization}/Web/{name}"),
                        "isFork": n == 1,
                        "isDisabled": n == 2,
                    })
                })
                .collect();
            reply(200, &[], json!({ "count": value.len(), "value": value }))
        }
    }

    #[test]
    fn serves_azure_devops_and_each_organization_s_older_host() {
        let integration = AzureDevOpsHostIntegration::new(Helper::holding("token") as _);

        for (name, served) in [
            ("dev.azure.com", Some("dev.azure.com")),
            ("ssh.dev.azure.com", Some("dev.azure.com")),
            ("vs-ssh.visualstudio.com", Some("dev.azure.com")),
            (
                "fabrikam.visualstudio.com",
                Some("fabrikam.visualstudio.com"),
            ),
            ("app.vssps.visualstudio.com", None),
            ("visualstudio.com", None),
            ("azure.com", None),
        ] {
            assert_eq!(integration.serves(name).as_deref(), served, "{name}");
        }
        assert_eq!(
            integration.profiles_api(),
            "https://app.vssps.visualstudio.com"
        );
        assert_eq!(
            integration.repositories_url("dev.azure.com", "fabrikam"),
            "https://dev.azure.com/fabrikam/_apis/git/repositories?api-version=7.1"
        );
        assert_eq!(
            integration.repositories_url("fabrikam.visualstudio.com", "fabrikam"),
            "https://fabrikam.visualstudio.com/_apis/git/repositories?api-version=7.1"
        );
    }

    #[test]
    fn sends_an_entra_token_as_a_bearer_token_and_a_personal_access_token_as_basic() {
        assert_eq!(authorization(ENTRA_TOKEN), format!("Bearer {ENTRA_TOKEN}"));
        assert_eq!(authorization("pat"), "Basic OnBhdA==");
        assert_eq!(authorization("eyJ.not"), basic("", "eyJ.not"));
    }

    #[test]
    fn signs_in_with_the_helper_s_token_and_tells_it_the_host_took_it() {
        let (api, asked) = serve(azure_devops(&[], 0));
        let helper = Helper::holding(ENTRA_TOKEN);

        assert_eq!(
            integration(&helper, &api).sign_in("dev.azure.com", false),
            Ok(SignedIn {
                host: "dev.azure.com".into(),
                login: "octocat@example.com".into(),
                name: Some("The Octocat".into()),
                missing_scopes: vec![],
            })
        );
        assert_eq!(
            *asked.lock().unwrap(),
            [(
                "/_apis/profile/profiles/me?api-version=7.1".to_owned(),
                Some(format!("Bearer {ENTRA_TOKEN}"))
            )]
        );
        assert_eq!(
            helper.told(),
            [
                "fill dev.azure.com".to_owned(),
                format!("approve {ENTRA_TOKEN}")
            ]
        );
    }

    #[test]
    fn a_token_refused_with_a_401_or_a_sign_in_page_is_forgotten() {
        let refusals: [fn(&str, Option<&str>) -> Reply; 3] = [
            |_, _| reply(401, &[], json!({ "message": "TF400813" })),
            |_, _| Reply {
                status: 203,
                headers: vec![("Content-Type", "text/html".into())],
                body: "<!DOCTYPE html><html><title>Azure DevOps Services | Sign In</title></html>"
                    .into(),
            },
            |_, _| Reply {
                status: 200,
                headers: vec![("Content-Type", "text/html".into())],
                body: "<html>Sign In</html>".into(),
            },
        ];
        for refuse in refusals {
            let (api, _) = serve(refuse);
            let helper = Helper::holding("pat");

            assert_eq!(
                integration(&helper, &api).sign_in("dev.azure.com", false),
                Err(HostError::TokenRefused {
                    host: "dev.azure.com".into()
                })
            );
            assert_eq!(helper.told(), ["fill dev.azure.com", "reject pat"]);
        }
    }

    #[test]
    fn signing_in_again_forgets_the_helper_s_credential_first() {
        let (api, _) = serve(azure_devops(&[], 0));
        let helper = Helper::holding("pat");

        let signed_in = integration(&helper, &api).sign_in("dev.azure.com", true);

        assert!(
            matches!(signed_in, Err(HostError::NoCredential { ref host, .. }) if host == "dev.azure.com"),
            "{signed_in:?}"
        );
        assert_eq!(helper.told(), ["reject ", "fill dev.azure.com"]);
    }

    /// Every page of `query`'s repositories on `host`, `limit` at a time.
    fn read_all(
        integration: &AzureDevOpsHostIntegration,
        host: &str,
        query: &str,
        limit: u32,
    ) -> Vec<Vec<String>> {
        let mut pages = Vec::new();
        let mut cursor = None;
        loop {
            let list = integration
                .repositories(
                    host,
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

    fn names(organization: &str, count: usize) -> Vec<String> {
        (0..count)
            .map(|n| {
                if n % 7 == 0 {
                    format!("{organization}/Web/lanewise-{n:03}-graph")
                } else {
                    format!("{organization}/Web/lanewise-{n:03}")
                }
            })
            .collect()
    }

    #[test]
    fn lists_each_organization_s_repositories_page_by_page() {
        let (api, asked) = serve(azure_devops(&["contoso", "fabrikam"], 70));
        let helper = Helper::holding("pat");
        let integration = integration(&helper, &api);

        let pages = read_all(&integration, "dev.azure.com", "", 60);

        assert_eq!(pages.iter().map(Vec::len).collect::<Vec<_>>(), [60, 60, 20]);
        assert_eq!(
            pages.concat(),
            [names("contoso", 70), names("fabrikam", 70)].concat()
        );
        let asked = asked.lock().unwrap();
        assert!(
            asked
                .iter()
                .all(|(_, authorization)| authorization.as_deref() == Some("Basic OnBhdA=="))
        );
        assert!(
            asked
                .iter()
                .all(|(path, _)| path.starts_with("/_apis/profile/")
                    || path.starts_with("/_apis/accounts?")
                    || path.starts_with("/contoso/_apis/git/repositories?")
                    || path.starts_with("/fabrikam/_apis/git/repositories?"))
        );
    }

    #[test]
    fn an_organization_s_own_host_lists_only_its_repositories() {
        let (api, asked) = serve(azure_devops(&["contoso", "fabrikam"], 3));
        let helper = Helper::holding("pat");

        let found = read_all(
            &integration(&helper, &api),
            "fabrikam.visualstudio.com",
            "",
            50,
        );

        assert_eq!(found, [names("fabrikam", 3)]);
        assert_eq!(
            *asked.lock().unwrap(),
            [(
                "/fabrikam/_apis/git/repositories?api-version=7.1".to_owned(),
                Some("Basic OnBhdA==".to_owned())
            )]
        );
    }

    #[test]
    fn maps_each_repository_without_the_user_in_its_url() {
        let (api, _) = serve(azure_devops(&["fabrikam"], 3));
        let helper = Helper::holding("pat");

        let items = integration(&helper, &api)
            .repositories("dev.azure.com", "", &PageRequest::default())
            .unwrap()
            .page
            .items;

        assert_eq!(
            serde_json::to_value(&items).unwrap(),
            json!([
                {
                    "fullName": "fabrikam/Web/lanewise-000-graph",
                    "description": null,
                    "private": true,
                    "fork": false,
                    "archived": false,
                    "cloneUrl": "https://dev.azure.com/fabrikam/Web/_git/lanewise-000-graph",
                    "sshUrl": "git@ssh.dev.azure.com:v3/fabrikam/Web/lanewise-000-graph"
                },
                {
                    "fullName": "fabrikam/Web/lanewise-001",
                    "description": null,
                    "private": false,
                    "fork": true,
                    "archived": false,
                    "cloneUrl": "https://dev.azure.com/fabrikam/Web/_git/lanewise-001",
                    "sshUrl": "git@ssh.dev.azure.com:v3/fabrikam/Web/lanewise-001"
                },
                {
                    "fullName": "fabrikam/Web/lanewise-002",
                    "description": null,
                    "private": true,
                    "fork": false,
                    "archived": true,
                    "cloneUrl": "https://dev.azure.com/fabrikam/Web/_git/lanewise-002",
                    "sshUrl": "git@ssh.dev.azure.com:v3/fabrikam/Web/lanewise-002"
                }
            ])
        );
    }

    #[test]
    fn searches_every_word_across_the_organizations() {
        let (api, _) = serve(azure_devops(&["contoso", "fabrikam"], 70));
        let helper = Helper::holding("pat");
        let integration = integration(&helper, &api);

        let found = read_all(&integration, "dev.azure.com", " GRAPH fabrikam ", 5).concat();

        assert_eq!(
            found,
            names("fabrikam", 70)
                .into_iter()
                .filter(|name| name.ends_with("-graph"))
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn no_organizations_list_nothing_and_a_cursor_from_elsewhere_is_invalid() {
        let (api, _) = serve(azure_devops(&[], 0));
        let helper = Helper::holding("pat");
        let list = integration(&helper, &api)
            .repositories("dev.azure.com", "", &PageRequest::default())
            .unwrap();
        assert!(list.page.items.is_empty() && list.page.next_cursor.is_none());

        let (api, _) = serve(azure_devops(&["fabrikam"], 3));
        let integration = integration(&helper, &api);
        for cursor in [
            Cursor::naming(&"not a place"),
            Cursor::naming(&Place {
                page: 0,
                after: Some("fabrikam/Web/gone".into()),
            }),
            Cursor::naming(&Place::<usize> {
                page: 5,
                after: None,
            }),
        ] {
            assert_eq!(
                integration.repositories(
                    "dev.azure.com",
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
        integration(&Helper::holding("pat"), &api)
            .sign_in("dev.azure.com", false)
            .unwrap_err()
    }

    #[test]
    fn tells_azure_devops_s_refusals_apart() {
        let host = || "dev.azure.com".to_owned();
        assert_eq!(
            refused(|_, _| reply(403, &[], json!({ "message": "Access denied." }))),
            HostError::MissingScope {
                host: host(),
                needed: vec![]
            }
        );
        assert_eq!(
            refused(|_, _| reply(
                429,
                &[("X-RateLimit-Reset", "1700000000")],
                json!({ "message": "Request was blocked" })
            )),
            HostError::RateLimited {
                host: host(),
                resets_at: Some(1_700_000_000)
            }
        );
        assert_eq!(
            refused(|_, _| reply(503, &[], json!({ "message": "Service Unavailable" }))),
            HostError::HostFailed {
                host: host(),
                status: 503,
                message: "Service Unavailable".into()
            }
        );
    }
}
