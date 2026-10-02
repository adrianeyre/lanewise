//! Listing a Host's repositories a page at a time, searched in Rust, for
//! the Tier 2 Host Integrations. Each Host's API pages its own way, so a
//! Host Integration only says how to fetch one of its pages, and what its
//! next page is, and [`list`] does the rest (ADR 0016).
//!
//! A search matches each word, ignoring case, in a repository's full name or
//! its description, and `owner:<name>` only the repositories `<name>` owns,
//! the first part of their full names. One call reads at most [`PAGES_SEARCHED`] of the Host's
//! pages. If its page doesn't fill up by then, it's answered short, even
//! empty, with a cursor to look further, so a search never makes one call
//! wait on dozens of requests.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use super::{HostError, HostRepository};
use crate::page::{Cursor, Page, PageRequest};

/// How many of a Host's pages one call looks through before answering with
/// what it has found, and a cursor to look further.
pub(super) const PAGES_SEARCHED: u32 = 10;

/// Where a list of a Host's repositories carries on from: after the
/// repository `after` on the Host's page `page`, or at its start. `P` is
/// how the Host names a page, such as its number.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct Place<P> {
    pub(super) page: P,
    pub(super) after: Option<String>,
}

impl<P: DeserializeOwned> Place<P> {
    /// Where `page` asks to carry on from: its cursor's place, or the start
    /// of the Host's `first` page.
    pub(super) fn asked(page: &PageRequest, first: P) -> Result<Self, HostError> {
        match &page.cursor {
            Some(cursor) => cursor.named().map_err(|_| HostError::InvalidCursor),
            None => Ok(Self {
                page: first,
                after: None,
            }),
        }
    }
}

/// One of a Host's pages of repositories, in the Host's order, and the page
/// after it, if there is one.
pub(super) struct Fetched<P> {
    pub(super) repositories: Vec<HostRepository>,
    pub(super) next: Option<P>,
}

/// The words of `query` to search for, lower case.
pub(super) fn words(query: &str) -> Vec<String> {
    query.split_whitespace().map(str::to_lowercase).collect()
}

/// Whether `repository`'s full name or description has every one of
/// `words`, which are lower case.
fn matches(repository: &HostRepository, words: &[String]) -> bool {
    let name = repository.full_name.to_lowercase();
    let description = repository
        .description
        .as_deref()
        .unwrap_or("")
        .to_lowercase();
    let owner = name.split('/').next().unwrap_or("");
    words.iter().all(|word| match word.strip_prefix("owner:") {
        Some(wanted) => owner == wanted,
        None => name.contains(word) || description.contains(word),
    })
}

/// Up to `limit` of the repositories that match `words`, from `place` on,
/// fetching each of the Host's pages with `fetch`, and the cursor for the
/// rest. A cursor whose repository has gone from its page is invalid.
pub(super) fn list<P: Clone + Serialize>(
    mut place: Place<P>,
    limit: usize,
    words: &[String],
    mut fetch: impl FnMut(&P) -> Result<Fetched<P>, HostError>,
) -> Result<Page<HostRepository>, HostError> {
    let mut items = Vec::new();
    let mut searched = 0;
    let next = loop {
        let Fetched { repositories, next } = fetch(&place.page)?;
        let start = match &place.after {
            None => 0,
            Some(after) => {
                repositories
                    .iter()
                    .position(|repository| &repository.full_name == after)
                    .ok_or(HostError::InvalidCursor)?
                    + 1
            }
        };
        let count = repositories.len();
        let mut filled = None;
        for (index, repository) in repositories.into_iter().enumerate().skip(start) {
            if !matches(&repository, words) {
                continue;
            }
            let name = repository.full_name.clone();
            items.push(repository);
            if items.len() == limit {
                filled = Some((index, name));
                break;
            }
        }
        searched += 1;
        if let Some((index, name)) = filled {
            break (index + 1 < count || next.is_some()).then(|| Place {
                page: place.page.clone(),
                after: Some(name),
            });
        }
        let Some(page) = next else {
            break None;
        };
        place = Place { page, after: None };
        if searched == PAGES_SEARCHED {
            break Some(place);
        }
    };
    Ok(Page {
        items,
        next_cursor: next.map(|place| Cursor::naming(&place)),
    })
}
