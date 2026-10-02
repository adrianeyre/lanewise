//! Trello: signed in to with an API key and a token, sent in the
//! `Authorization` header Trello takes them in, so neither is ever in a
//! URL. Its Issues are the open cards the user is a member of, which Trello
//! gives all at once: they're searched and paged here.

use serde::Deserialize;

use super::{Answer, Apis, Issue, IssueTrackerError, TrelloAccount, valid_url, words};
use crate::page::{Page, PageRequest, page_by_position};

/// Whether `secret` could be a Trello key or token, so it can go in the
/// header as it is.
fn plain(secret: &str) -> bool {
    secret
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
}

fn get(
    account: &TrelloAccount,
    apis: &Apis,
    path: &str,
    query: &[(&str, &str)],
) -> Result<Answer, IssueTrackerError> {
    let (key, token) = (account.key.expose(), account.token.expose());
    if !plain(key) || !plain(token) {
        return Err(IssueTrackerError::TokenRefused);
    }
    let authorization = format!("OAuth oauth_consumer_key=\"{key}\", oauth_token=\"{token}\"");
    let secrets = [key, token];
    let answer = Answer::get(
        &format!("{}{path}", apis.trello),
        query,
        &authorization,
        &secrets,
    )?;
    if answer.ok() {
        Ok(answer)
    } else {
        Err(answer.refusal(&secrets))
    }
}

/// Who `account` signs in as, from `/1/members/me`: the check made before
/// it's kept.
pub(super) fn who(account: &TrelloAccount, apis: &Apis) -> Result<String, IssueTrackerError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Member {
        full_name: Option<String>,
        username: Option<String>,
    }
    let member: Member = get(
        account,
        apis,
        "/1/members/me",
        &[("fields", "fullName,username")],
    )?
    .read("Trello")?;
    Ok(member
        .full_name
        .filter(|name| !name.trim().is_empty())
        .or(member.username)
        .unwrap_or_else(|| "Trello".into()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Card {
    id: String,
    #[serde(default)]
    name: String,
    id_short: Option<u64>,
    short_url: Option<String>,
    date_last_activity: Option<String>,
}

impl Card {
    fn key(&self) -> Option<String> {
        self.id_short.map(|number| format!("#{number}"))
    }

    fn matches(&self, words: &[String]) -> bool {
        let name = self.name.to_lowercase();
        let key = self.key().unwrap_or_default();
        words
            .iter()
            .all(|word| name.contains(word.as_str()) || key == *word)
    }
}

/// A page of the user's open cards, most recently active first, with every
/// word of `query` in their names. The cursor names the last card sent.
pub(super) fn issues(
    account: &TrelloAccount,
    apis: &Apis,
    query: &str,
    page: &PageRequest,
) -> Result<Page<Issue>, IssueTrackerError> {
    let cards: Vec<Card> = get(
        account,
        apis,
        "/1/members/me/cards",
        &[
            ("filter", "open"),
            ("fields", "name,idShort,shortUrl,dateLastActivity"),
        ],
    )?
    .read("Trello")?;
    let words = words(query);
    let mut cards: Vec<Card> = cards
        .into_iter()
        .filter(|card| card.short_url.as_deref().is_some_and(valid_url) && card.matches(&words))
        .collect();
    cards.sort_by(|a, b| {
        b.date_last_activity
            .cmp(&a.date_last_activity)
            .then_with(|| a.id.cmp(&b.id))
    });
    let positions = page_by_position(
        cards.len(),
        page,
        |position| cards[position].id.clone(),
        |id: &String| cards.iter().position(|card| card.id == *id),
    )
    .map_err(|_| IssueTrackerError::InvalidCursor)?;
    let mut cards: Vec<Option<Card>> = cards.into_iter().map(Some).collect();
    Ok(positions.map(|position| {
        let card = cards[position].take().expect("each position once");
        Issue {
            key: card.key(),
            id: card.id,
            title: card.name,
            status: None,
            url: card.short_url.expect("kept only with one"),
            updated: card.date_last_activity,
        }
    }))
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::super::tests::{
        MemoryAccountStore, Reply, apis, nowhere, query_value, reply, request, stand_in,
    };
    use super::super::{IssueTrackerAccount, Issues, SaveIssueTrackerAccount};
    use super::*;

    const AUTHORIZATION: &str =
        "OAuth oauth_consumer_key=\"trello-key\", oauth_token=\"trello-token\"";

    /// A Trello with `count` open cards, `Card 0` on, card n last active on
    /// day n, so the newest is the last.
    fn trello(count: usize) -> impl Fn(&str) -> Reply + Send + 'static {
        move |path| {
            if path.starts_with("/1/members/me/cards") {
                let cards: Vec<Value> = (0..count)
                    .map(|n| {
                        json!({
                            "id": format!("card{n:02}"),
                            "name": if n % 2 == 0 { format!("Card {n}: draw lanes") } else { format!("Card {n}") },
                            "idShort": n + 1,
                            "shortUrl": format!("https://trello.com/c/short{n}"),
                            "dateLastActivity": format!("2026-09-{:02}T10:00:00.000Z", n + 1),
                        })
                    })
                    .collect();
                reply(200, Value::Array(cards))
            } else if path.starts_with("/1/members/me") {
                reply(
                    200,
                    json!({ "fullName": "Grace Hopper", "username": "grace" }),
                )
            } else {
                reply(404, json!("not found"))
            }
        }
    }

    fn save(store: &MemoryAccountStore, base: &str) -> Result<String, IssueTrackerError> {
        request::<SaveIssueTrackerAccount>(json!({
            "tracker": "trello", "key": " trello-key ", "token": "trello-token\n",
        }))
        .run_in(store, &apis(base))
        .map(|signed_in| signed_in.name)
    }

    fn read_all(
        store: &MemoryAccountStore,
        base: &str,
        query: &str,
        limit: u32,
    ) -> Vec<Vec<String>> {
        let mut pages = Vec::new();
        let mut cursor: Option<Value> = None;
        loop {
            let page = request::<Issues>(json!({
                "tracker": "trello", "query": query, "page": { "cursor": cursor, "limit": limit },
            }))
            .run_in(store, &apis(base))
            .unwrap();
            pages.push(page.items.into_iter().map(|issue| issue.title).collect());
            match page.next_cursor {
                Some(next) => cursor = Some(serde_json::to_value(next).unwrap()),
                None => return pages,
            }
        }
    }

    #[test]
    fn saving_checks_the_key_and_token_with_trello_in_its_header_never_its_url() {
        let (base, asked) = stand_in(trello(0));
        let store = MemoryAccountStore::default();

        assert_eq!(save(&store, &base).as_deref(), Ok("Grace Hopper"));

        let asked = asked.lock().unwrap();
        assert_eq!(asked.len(), 1);
        assert!(asked[0].path.starts_with("/1/members/me?"));
        assert!(!asked[0].path.contains("trello-key") && !asked[0].path.contains("trello-token"));
        assert_eq!(asked[0].authorization.as_deref(), Some(AUTHORIZATION));
        let kept: Value = serde_json::from_str(&store.kept.borrow()["trello"]).unwrap();
        assert_eq!(
            kept,
            json!({ "key": "trello-key", "token": "trello-token", "name": "Grace Hopper" })
        );
        assert_eq!(
            serde_json::to_value(
                request::<IssueTrackerAccount>(json!({ "tracker": "trello" }))
                    .run_in(&store)
                    .unwrap()
            )
            .unwrap(),
            json!({ "site": null, "email": null, "name": "Grace Hopper" })
        );
    }

    #[test]
    fn a_refused_key_or_token_is_not_kept() {
        let (base, _) = stand_in(|_| Reply {
            status: 401,
            headers: Vec::new(),
            body: "invalid token".into(),
        });
        let store = MemoryAccountStore::default();

        assert_eq!(save(&store, &base), Err(IssueTrackerError::TokenRefused));
        assert!(store.kept.borrow().is_empty());
    }

    #[test]
    fn nothing_is_sent_without_a_key_or_with_one_that_isnt_trellos() {
        let (base, asked) = stand_in(trello(0));
        let store = MemoryAccountStore::default();

        let missing =
            request::<SaveIssueTrackerAccount>(json!({ "tracker": "trello", "token": "t" }))
                .run_in(&store, &apis(&base));
        assert_eq!(
            missing,
            Err(IssueTrackerError::MissingField {
                field: "key".into()
            })
        );
        let odd = request::<SaveIssueTrackerAccount>(json!({
            "tracker": "trello", "key": "a\", oauth_token=\"b", "token": "t",
        }))
        .run_in(&store, &apis(&base));
        assert_eq!(odd, Err(IssueTrackerError::TokenRefused));
        assert!(asked.lock().unwrap().is_empty());
    }

    #[test]
    fn an_unreachable_trello_says_why_without_the_secrets() {
        let store = MemoryAccountStore::default();

        let saved = save(&store, &nowhere());

        assert!(
            matches!(&saved, Err(IssueTrackerError::Unreachable { message })
                if !message.contains("trello-key") && !message.contains("trello-token")),
            "{saved:?}"
        );
    }

    #[test]
    fn lists_open_cards_newest_first_page_by_page() {
        let (base, asked) = stand_in(trello(5));
        let store = MemoryAccountStore::default();
        save(&store, &base).unwrap();

        assert_eq!(
            read_all(&store, &base, "", 2),
            vec![
                vec!["Card 4: draw lanes", "Card 3"],
                vec!["Card 2: draw lanes", "Card 1"],
                vec!["Card 0: draw lanes"],
            ]
        );
        let asked = asked.lock().unwrap();
        let listing = &asked[1].path;
        assert!(listing.starts_with("/1/members/me/cards?"));
        assert_eq!(query_value(listing, "filter").as_deref(), Some("open"));
        assert_eq!(
            query_value(listing, "fields").as_deref(),
            Some("name,idShort,shortUrl,dateLastActivity")
        );
        assert!(
            asked
                .iter()
                .all(|asked| asked.authorization.as_deref() == Some(AUTHORIZATION))
        );
    }

    #[test]
    fn a_card_is_an_issue_keyed_by_its_number_on_its_board() {
        let (base, _) = stand_in(trello(1));
        let store = MemoryAccountStore::default();
        save(&store, &base).unwrap();

        let page = request::<Issues>(json!({ "tracker": "trello" }))
            .run_in(&store, &apis(&base))
            .unwrap();

        assert_eq!(
            serde_json::to_value(&page.items[0]).unwrap(),
            json!({
                "id": "card00",
                "key": "#1",
                "title": "Card 0: draw lanes",
                "status": null,
                "url": "https://trello.com/c/short0",
                "updated": "2026-09-01T10:00:00.000Z",
            })
        );
    }

    #[test]
    fn searches_every_word_of_a_cards_name_or_its_number() {
        let (base, _) = stand_in(trello(6));
        let store = MemoryAccountStore::default();
        save(&store, &base).unwrap();

        assert_eq!(
            read_all(&store, &base, "LANES draw", 10),
            vec![vec![
                "Card 4: draw lanes",
                "Card 2: draw lanes",
                "Card 0: draw lanes"
            ]]
        );
        assert_eq!(read_all(&store, &base, "#2", 10), vec![vec!["Card 1"]]);
        assert_eq!(
            read_all(&store, &base, "nothing", 10),
            vec![Vec::<String>::new()]
        );
    }

    #[test]
    fn a_card_without_an_https_link_is_left_out() {
        let (base, _) = stand_in(|path| {
            if path.starts_with("/1/members/me/cards") {
                reply(
                    200,
                    json!([
                        { "id": "a", "name": "Kept", "shortUrl": "https://trello.com/c/a" },
                        { "id": "b", "name": "Plain", "shortUrl": "http://trello.com/c/b" },
                        { "id": "c", "name": "Script", "shortUrl": "javascript:alert(1)" },
                        { "id": "d", "name": "None" },
                    ]),
                )
            } else {
                reply(200, json!({ "username": "grace" }))
            }
        });
        let store = MemoryAccountStore::default();
        assert_eq!(save(&store, &base).as_deref(), Ok("grace"));

        assert_eq!(read_all(&store, &base, "", 10), vec![vec!["Kept"]]);
    }

    #[test]
    fn a_cursor_whose_card_has_gone_or_from_elsewhere_is_invalid() {
        let (base, _) = stand_in(trello(3));
        let store = MemoryAccountStore::default();
        save(&store, &base).unwrap();

        for cursor in ["not json", "\"gone\""] {
            assert_eq!(
                request::<Issues>(json!({ "tracker": "trello", "page": { "cursor": cursor } }))
                    .run_in(&store, &apis(&base)),
                Err(IssueTrackerError::InvalidCursor),
                "{cursor}"
            );
        }
    }

    #[test]
    fn trellos_refusals_are_told_apart() {
        for (status, expected) in [
            (401, IssueTrackerError::TokenRefused),
            (429, IssueTrackerError::RateLimited),
            (
                500,
                IssueTrackerError::TrackerFailed {
                    status: 500,
                    message: "Trello broke".into(),
                },
            ),
        ] {
            let (base, _) = stand_in(move |path| {
                if path.starts_with("/1/members/me/cards") {
                    Reply {
                        status,
                        headers: Vec::new(),
                        body: "Trello broke".into(),
                    }
                } else {
                    reply(200, json!({ "fullName": "Grace" }))
                }
            });
            let store = MemoryAccountStore::default();
            save(&store, &base).unwrap();

            assert_eq!(
                request::<Issues>(json!({ "tracker": "trello" })).run_in(&store, &apis(&base)),
                Err(expected)
            );
        }
    }
}
