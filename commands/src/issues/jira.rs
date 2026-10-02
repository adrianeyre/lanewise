//! Jira Cloud: a site such as `your-team.atlassian.net`, signed in to with
//! the user's email and an API token by HTTP Basic authentication. Its
//! Issues are the open ones assigned to the user, from `search/jql`.

use serde::Deserialize;

use super::{Answer, Apis, Issue, IssueTrackerError, JiraAccount, base64, valid_url};
use crate::page::{Cursor, Page, PageRequest};

/// The most issues Jira gives in one page with their fields.
const JIRA_PAGE: usize = 100;

/// The longest search Lanewise sends Jira.
const MAX_SEARCH: usize = 100;

/// The Jira Cloud site `input` names, as its host name: a pasted
/// `https://your-team.atlassian.net/jira/…` is taken as
/// `your-team.atlassian.net`.
pub(super) fn site(input: &str) -> Result<String, IssueTrackerError> {
    let lower = input.trim().to_ascii_lowercase();
    let rest = lower
        .strip_prefix("https://")
        .or_else(|| lower.strip_prefix("http://"))
        .unwrap_or(&lower);
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let label = |label: &str| {
        (1..=63).contains(&label.len())
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    };
    match host.strip_suffix(".atlassian.net") {
        Some(name) if host.len() <= 253 && name.split('.').all(label) => Ok(host.into()),
        _ => Err(IssueTrackerError::InvalidSite),
    }
}

fn authorization(account: &JiraAccount) -> String {
    let pair = format!("{}:{}", account.email, account.token.expose());
    format!("Basic {}", base64(pair.as_bytes()))
}

fn get(
    account: &JiraAccount,
    apis: &Apis,
    path: &str,
    query: &[(&str, &str)],
) -> Result<Answer, IssueTrackerError> {
    let authorization = authorization(account);
    let secrets = [account.token.expose(), authorization.as_str()];
    let url = format!("{}{path}", apis.jira(&account.site));
    let answer = Answer::get(&url, query, &authorization, &secrets)?;
    if answer.ok() {
        Ok(answer)
    } else {
        Err(answer.refusal(&secrets))
    }
}

/// Who `account` signs in as, from `/myself`: the check made before it's kept.
pub(super) fn who(account: &JiraAccount, apis: &Apis) -> Result<String, IssueTrackerError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Myself {
        display_name: Option<String>,
        email_address: Option<String>,
    }
    let myself: Myself = get(account, apis, "/rest/api/3/myself", &[])?.read("Jira")?;
    Ok(myself
        .display_name
        .filter(|name| !name.trim().is_empty())
        .or(myself.email_address)
        .unwrap_or_else(|| account.email.clone()))
}

/// The JQL for the user's open Issues, most recently changed first, with
/// `query`'s words in their text. What the user typed is only ever inside
/// a JQL string, with every character JQL or its text search would read as
/// an operator left out, so it can't change what's asked.
pub(super) fn jql(query: &str) -> String {
    let words: String = query
        .chars()
        .map(|c| {
            if c.is_control() || "\"\\'+-&|!(){}[]^~*?:/%".contains(c) {
                ' '
            } else {
                c
            }
        })
        .collect();
    let words: Vec<&str> = words.split_whitespace().collect();
    let mut search: String = words.join(" ").chars().take(MAX_SEARCH).collect();
    search = search.trim_end().to_owned();
    let mut jql = String::from("assignee = currentUser() AND statusCategory != Done");
    if !search.is_empty() {
        jql.push_str(&format!(" AND text ~ \"{search}\""));
    }
    jql.push_str(" ORDER BY updated DESC");
    jql
}

/// Whether `key` is a Jira issue key, such as `PROJ-12`.
fn valid_key(key: &str) -> bool {
    match key.rsplit_once('-') {
        Some((project, number)) => {
            project.starts_with(|c: char| c.is_ascii_alphabetic())
                && project
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
                && !number.is_empty()
                && number.bytes().all(|byte| byte.is_ascii_digit())
        }
        None => false,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Found {
    #[serde(default)]
    issues: Vec<FoundIssue>,
    next_page_token: Option<String>,
    is_last: Option<bool>,
}

#[derive(Deserialize)]
struct FoundIssue {
    id: String,
    key: String,
    #[serde(default)]
    fields: Fields,
}

#[derive(Default, Deserialize)]
struct Fields {
    summary: Option<String>,
    status: Option<Status>,
    updated: Option<String>,
}

#[derive(Deserialize)]
struct Status {
    name: Option<String>,
}

/// A page of the user's open Issues on `account`'s site. The cursor is
/// Jira's own `nextPageToken`.
pub(super) fn issues(
    account: &JiraAccount,
    apis: &Apis,
    query: &str,
    page: &PageRequest,
) -> Result<Page<Issue>, IssueTrackerError> {
    let token = match &page.cursor {
        None => None,
        Some(cursor) => Some(
            cursor
                .named::<String>()
                .map_err(|_| IssueTrackerError::InvalidCursor)?,
        ),
    };
    let jql = jql(query);
    let limit = page.limit().min(JIRA_PAGE).to_string();
    let mut asked = vec![
        ("jql", jql.as_str()),
        ("fields", "summary,status,updated"),
        ("maxResults", limit.as_str()),
    ];
    if let Some(token) = &token {
        asked.push(("nextPageToken", token));
    }
    let found: Found = get(account, apis, "/rest/api/3/search/jql", &asked)?.read("Jira")?;
    let items = found
        .issues
        .into_iter()
        .filter(|issue| valid_key(&issue.key))
        .filter_map(|issue| {
            let url = format!("https://{}/browse/{}", account.site, issue.key);
            valid_url(&url).then(|| Issue {
                id: issue.id,
                key: Some(issue.key),
                title: issue.fields.summary.unwrap_or_default(),
                status: issue.fields.status.and_then(|status| status.name),
                url,
                updated: issue.fields.updated,
            })
        })
        .collect();
    let next_cursor = match (found.is_last, found.next_page_token) {
        (Some(true), _) | (_, None) => None,
        (_, Some(token)) => Some(Cursor::naming(&token)),
    };
    Ok(Page { items, next_cursor })
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::super::tests::{
        MemoryAccountStore, Reply, apis, nowhere, query_value, reply, request, stand_in,
    };
    use super::super::{
        ForgetIssueTrackerAccount, IssueTrackerAccount, Issues, SaveIssueTrackerAccount,
    };
    use super::*;

    fn myself() -> impl Fn(&str) -> Reply + Send + 'static {
        |path| {
            if path.starts_with("/rest/api/3/myself") {
                reply(
                    200,
                    json!({ "displayName": "Ada Lovelace", "emailAddress": "ada@example.com" }),
                )
            } else {
                reply(404, json!({ "errorMessages": ["No such page."] }))
            }
        }
    }

    fn save(
        store: &MemoryAccountStore,
        base: &str,
        site: &str,
    ) -> Result<String, IssueTrackerError> {
        request::<SaveIssueTrackerAccount>(json!({
            "tracker": "jira",
            "site": site,
            "email": " ada@example.com ",
            "token": " jira-secret\n",
        }))
        .run_in(store, &apis(base))
        .map(|signed_in| signed_in.name)
    }

    #[test]
    fn a_site_is_a_jira_cloud_host_name_even_pasted_as_an_address() {
        for (input, expected) in [
            ("your-team.atlassian.net", "your-team.atlassian.net"),
            ("  Your-Team.Atlassian.net ", "your-team.atlassian.net"),
            (
                "https://your-team.atlassian.net/",
                "your-team.atlassian.net",
            ),
            (
                "https://your-team.atlassian.net/jira/software/projects/A/boards/1",
                "your-team.atlassian.net",
            ),
            ("team2.atlassian.net?x=1", "team2.atlassian.net"),
        ] {
            assert_eq!(site(input).as_deref(), Ok(expected), "{input}");
        }
        for input in [
            "",
            "atlassian.net",
            ".atlassian.net",
            "your-team.atlassian.net.evil.example",
            "evil.example/your-team.atlassian.net",
            "user@your-team.atlassian.net",
            "your-team.atlassian.net:8443",
            "-team.atlassian.net",
            "your team.atlassian.net",
            "jira.example.com",
        ] {
            assert_eq!(site(input), Err(IssueTrackerError::InvalidSite), "{input}");
        }
    }

    #[test]
    fn saving_checks_the_credentials_with_jira_first_and_keeps_them_in_the_store() {
        let (base, asked) = stand_in(myself());
        let store = MemoryAccountStore::default();

        let name = save(&store, &base, "https://lanewise.atlassian.net/");

        assert_eq!(name.as_deref(), Ok("Ada Lovelace"));
        let asked = asked.lock().unwrap();
        assert_eq!(asked.len(), 1);
        assert_eq!(asked[0].path, "/rest/api/3/myself");
        assert_eq!(
            asked[0].authorization.as_deref(),
            Some(format!("Basic {}", base64(b"ada@example.com:jira-secret")).as_str())
        );
        let kept: Value = serde_json::from_str(&store.kept.borrow()["jira"]).unwrap();
        assert_eq!(
            kept,
            json!({
                "site": "lanewise.atlassian.net",
                "email": "ada@example.com",
                "token": "jira-secret",
                "name": "Ada Lovelace",
            })
        );
        assert_eq!(
            serde_json::to_value(
                request::<IssueTrackerAccount>(json!({ "tracker": "jira" }))
                    .run_in(&store)
                    .unwrap()
            )
            .unwrap(),
            json!({ "site": "lanewise.atlassian.net", "email": "ada@example.com", "name": "Ada Lovelace" })
        );

        request::<ForgetIssueTrackerAccount>(json!({ "tracker": "jira" }))
            .run_in(&store)
            .unwrap();
        assert!(store.kept.borrow().is_empty());
    }

    #[test]
    fn a_refused_token_is_not_kept() {
        for status in [401, 403] {
            let (base, _) = stand_in(move |_| reply(status, json!({ "message": "Unauthorized" })));
            let store = MemoryAccountStore::default();

            assert_eq!(
                save(&store, &base, "lanewise.atlassian.net"),
                Err(IssueTrackerError::TokenRefused)
            );
            assert!(store.kept.borrow().is_empty());
        }
    }

    #[test]
    fn nothing_is_sent_for_a_site_that_isnt_jira_clouds_or_without_an_email_or_token() {
        let (base, asked) = stand_in(myself());
        let store = MemoryAccountStore::default();

        assert_eq!(
            save(&store, &base, "jira.example.com"),
            Err(IssueTrackerError::InvalidSite)
        );
        for (email, token, field) in [(" ", "t", "email"), ("a@b.c", "  ", "token")] {
            let saved = request::<SaveIssueTrackerAccount>(json!({
                "tracker": "jira", "site": "lanewise.atlassian.net", "email": email, "token": token,
            }))
            .run_in(&store, &apis(&base));
            assert_eq!(
                saved,
                Err(IssueTrackerError::MissingField {
                    field: field.into()
                })
            );
        }
        assert!(asked.lock().unwrap().is_empty());
        assert!(store.kept.borrow().is_empty());
    }

    #[test]
    fn the_token_goes_to_the_jira_site_alone_never_where_it_redirects() {
        let (elsewhere, asked_elsewhere) = stand_in(myself());
        let (base, asked) = stand_in(move |_| Reply {
            status: 302,
            headers: vec![("Location", format!("{elsewhere}/rest/api/3/myself"))],
            body: String::new(),
        });
        let store = MemoryAccountStore::default();

        let saved = save(&store, &base, "lanewise.atlassian.net");

        assert!(
            matches!(
                saved,
                Err(IssueTrackerError::TrackerFailed { status: 302, .. })
            ),
            "{saved:?}"
        );
        assert_eq!(asked.lock().unwrap().len(), 1);
        assert!(asked_elsewhere.lock().unwrap().is_empty());
        assert!(store.kept.borrow().is_empty());
    }

    #[test]
    fn an_unreachable_site_says_why_without_the_token() {
        let store = MemoryAccountStore::default();

        let saved = save(&store, &nowhere(), "lanewise.atlassian.net");

        assert!(
            matches!(&saved, Err(IssueTrackerError::Unreachable { message }) if !message.contains("jira-secret")),
            "{saved:?}"
        );
    }

    #[test]
    fn a_search_is_only_ever_words_inside_a_jql_string() {
        assert_eq!(
            jql("  "),
            "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC"
        );
        assert_eq!(
            jql("graph lanes"),
            "assignee = currentUser() AND statusCategory != Done AND text ~ \"graph lanes\" ORDER BY updated DESC"
        );
        assert_eq!(
            jql(r#"x" OR project = SECRET OR text ~ "y\"#),
            "assignee = currentUser() AND statusCategory != Done AND text ~ \"x OR project = SECRET OR text y\" ORDER BY updated DESC"
        );
        assert_eq!(
            jql("fix* (lanes) -graph\n\tnow"),
            "assignee = currentUser() AND statusCategory != Done AND text ~ \"fix lanes graph now\" ORDER BY updated DESC"
        );
        let long = jql(&"word ".repeat(100));
        assert!(
            long.contains(&format!("\"{}\"", "word ".repeat(20).trim_end())),
            "{long}"
        );
    }

    /// A Jira site with `count` open Issues, `LW-0` on, `limit` a page, its
    /// tokens naming where the next page starts.
    fn listing(count: usize) -> impl Fn(&str) -> Reply + Send + 'static {
        move |path| {
            if path.starts_with("/rest/api/3/myself") {
                return myself()(path);
            }
            let start: usize = query_value(path, "nextPageToken")
                .map(|token| token.trim_start_matches("from-").parse().unwrap())
                .unwrap_or(0);
            let limit: usize = query_value(path, "maxResults").unwrap().parse().unwrap();
            let end = count.min(start + limit);
            let issues: Vec<Value> = (start..end)
                .map(|n| {
                    json!({
                        "id": format!("{}", 10_000 + n),
                        "key": format!("LW-{n}"),
                        "self": format!("https://lanewise.atlassian.net/rest/api/3/issue/{}", 10_000 + n),
                        "fields": {
                            "summary": format!("Issue {n}"),
                            "status": { "name": "In Progress" },
                            "updated": "2026-09-01T10:00:00.000+0000",
                        },
                    })
                })
                .collect();
            let mut body = json!({ "issues": issues, "isLast": end == count });
            if end < count {
                body["nextPageToken"] = json!(format!("from-{end}"));
            }
            reply(200, body)
        }
    }

    #[test]
    fn lists_the_users_open_issues_page_by_page_with_jiras_tokens() {
        let (base, asked) = stand_in(listing(5));
        let store = MemoryAccountStore::default();
        save(&store, &base, "lanewise.atlassian.net").unwrap();

        let mut pages = Vec::new();
        let mut cursor = None;
        loop {
            let page = request::<Issues>(json!({
                "tracker": "jira", "query": "lanes", "page": { "cursor": cursor, "limit": 2 },
            }))
            .run_in(&store, &apis(&base))
            .unwrap();
            pages.push(page.items);
            match page.next_cursor {
                Some(next) => cursor = Some(serde_json::to_value(next).unwrap()),
                None => break,
            }
        }

        let keys: Vec<Vec<String>> = pages
            .iter()
            .map(|page| {
                page.iter()
                    .map(|issue| issue.key.clone().unwrap())
                    .collect()
            })
            .collect();
        assert_eq!(
            keys,
            vec![vec!["LW-0", "LW-1"], vec!["LW-2", "LW-3"], vec!["LW-4"]]
        );
        assert_eq!(
            serde_json::to_value(&pages[0][0]).unwrap(),
            json!({
                "id": "10000",
                "key": "LW-0",
                "title": "Issue 0",
                "status": "In Progress",
                "url": "https://lanewise.atlassian.net/browse/LW-0",
                "updated": "2026-09-01T10:00:00.000+0000",
            })
        );
        let asked = asked.lock().unwrap();
        let searches: Vec<&str> = asked[1..].iter().map(|asked| asked.path.as_str()).collect();
        assert!(
            searches
                .iter()
                .all(|path| path.starts_with("/rest/api/3/search/jql?"))
        );
        assert_eq!(
            query_value(searches[0], "jql").as_deref(),
            Some(jql("lanes").as_str())
        );
        assert_eq!(
            query_value(searches[0], "fields").as_deref(),
            Some("summary,status,updated")
        );
        assert_eq!(query_value(searches[0], "nextPageToken"), None);
        assert_eq!(
            query_value(searches[1], "nextPageToken").as_deref(),
            Some("from-2")
        );
        let basic = format!("Basic {}", base64(b"ada@example.com:jira-secret"));
        assert!(asked.iter().all(
            |asked| asked.authorization.as_deref() == Some(basic.as_str())
                && !asked.path.contains("jira-secret")
        ));
    }

    #[test]
    fn asks_jira_for_at_most_a_hundred_at_once() {
        let (base, asked) = stand_in(listing(0));
        let store = MemoryAccountStore::default();
        save(&store, &base, "lanewise.atlassian.net").unwrap();

        let page = request::<Issues>(json!({ "tracker": "jira", "page": { "limit": 1000 } }))
            .run_in(&store, &apis(&base))
            .unwrap();

        assert!(page.items.is_empty());
        assert_eq!(page.next_cursor, None);
        assert_eq!(
            query_value(&asked.lock().unwrap()[1].path, "maxResults").as_deref(),
            Some("100")
        );
    }

    #[test]
    fn an_issue_whose_key_isnt_jiras_is_left_out() {
        let (base, _) = stand_in(|path| {
            if path.starts_with("/rest/api/3/myself") {
                return reply(200, json!({ "displayName": "Ada" }));
            }
            reply(
                200,
                json!({ "issues": [
                    { "id": "1", "key": "LW-1", "fields": { "summary": "Kept" } },
                    { "id": "2", "key": "../../evil", "fields": { "summary": "Left out" } },
                    { "id": "3", "key": "LW-x", "fields": {} },
                ], "isLast": true }),
            )
        });
        let store = MemoryAccountStore::default();
        save(&store, &base, "lanewise.atlassian.net").unwrap();

        let page = request::<Issues>(json!({ "tracker": "jira" }))
            .run_in(&store, &apis(&base))
            .unwrap();

        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].status, None);
        assert_eq!(page.items[0].updated, None);
    }

    #[test]
    fn jiras_refusals_are_told_apart() {
        for (status, body, expected) in [
            (401, json!({}), IssueTrackerError::TokenRefused),
            (429, json!({}), IssueTrackerError::RateLimited),
            (
                400,
                json!({ "errorMessages": ["The JQL couldn't be read."] }),
                IssueTrackerError::TrackerFailed {
                    status: 400,
                    message: "The JQL couldn't be read.".into(),
                },
            ),
        ] {
            let body = body.clone();
            let (base, _) = stand_in(move |path| {
                if path.starts_with("/rest/api/3/myself") {
                    reply(200, json!({ "displayName": "Ada" }))
                } else {
                    reply(status, body.clone())
                }
            });
            let store = MemoryAccountStore::default();
            save(&store, &base, "lanewise.atlassian.net").unwrap();

            assert_eq!(
                request::<Issues>(json!({ "tracker": "jira" })).run_in(&store, &apis(&base)),
                Err(expected)
            );
        }
    }

    #[test]
    fn a_cursor_from_elsewhere_is_invalid() {
        let (base, _) = stand_in(listing(3));
        let store = MemoryAccountStore::default();
        save(&store, &base, "lanewise.atlassian.net").unwrap();

        assert_eq!(
            request::<Issues>(json!({ "tracker": "jira", "page": { "cursor": "not json" } }))
                .run_in(&store, &apis(&base)),
            Err(IssueTrackerError::InvalidCursor)
        );
    }

    #[test]
    fn an_answer_that_isnt_jiras_json_says_so() {
        let (base, _) = stand_in(|_| Reply {
            status: 200,
            headers: Vec::new(),
            body: "<html>Not Jira</html>".into(),
        });
        let store = MemoryAccountStore::default();

        assert!(matches!(
            save(&store, &base, "lanewise.atlassian.net"),
            Err(IssueTrackerError::TrackerFailed { status: 200, .. })
        ));
    }
}
