//! Paging: how a command that could return a lot of data returns it.
//!
//! Large repositories must never cross the IPC boundary in bulk (ADR 0001,
//! PRD §10.3), so any command whose result grows with the repository (file
//! status, history, branches, a diff's files) pages from the start, even
//! where it computes everything at once, as file status does. What is costly
//! is carrying it to the UI and drawing it.
//!
//! # The pattern
//!
//! - The request has a [`PageRequest`], `page`, which may be left out. The
//!   response is a [`Page`] of the command's items.
//! - The first call sends no `cursor`. Each [`Page`] has up to `limit` items
//!   and a `nextCursor`, which is `null` on the last page. To read on, the UI
//!   sends the same request again with that cursor.
//! - A cursor is opaque. The UI hands back the one it was given, and never
//!   builds, reads or keeps one past the list it came with. Only the command
//!   that made it reads it.
//! - Cursors name the last item sent, not how many were sent (keyset, not
//!   offset paging). If the list changes between calls, the next page still
//!   starts straight after that item, so nothing already shown repeats and
//!   nothing after it is skipped. A command's items therefore come in a fixed
//!   order with a unique key, and [`page_by_key`] does the rest.
//! - `limit` is how many items the UI wants, [`DEFAULT_LIMIT`] if it doesn't
//!   say, and never more than [`MAX_LIMIT`]. A page may have fewer, and only
//!   the last page's `nextCursor` is `null`.
//! - A cursor the command can't read fails with the command's own
//!   `invalidCursor` error. The UI starts again from the first page.
//!
//! A list whose order isn't its keys' order, such as the history's, pages
//! with [`page_by_position`] instead. Its cursor still names the last item
//! sent, and if that item has left the list, the cursor is invalid.
//!
//! On the TypeScript side, `Page` and `PageRequest` in
//! `app/src/commands/api.ts` mirror these.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

/// How many items a page has when the request doesn't say.
pub const DEFAULT_LIMIT: u32 = 200;

/// The most items a page ever has, however many the request asks for.
pub const MAX_LIMIT: u32 = 1000;

/// Which page a paged command should return.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageRequest {
    /// Where to carry on from: the `nextCursor` of the page before, or
    /// nothing for the first page.
    #[serde(default)]
    pub cursor: Option<Cursor>,
    /// How many items the page may have. See [`PageRequest::limit`].
    #[serde(default)]
    pub limit: Option<u32>,
}

impl PageRequest {
    /// The number of items to return: the one asked for, between 1 and
    /// [`MAX_LIMIT`], or [`DEFAULT_LIMIT`].
    pub fn limit(&self) -> usize {
        self.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT) as usize
    }
}

/// One page of a command's items.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    /// What to send for the next page, or `None` on the last.
    pub next_cursor: Option<Cursor>,
}

impl<T> Page<T> {
    /// The same page with each item turned into `U`, such as a core type into
    /// the command's own.
    pub fn map<U>(self, f: impl FnMut(T) -> U) -> Page<U> {
        Page {
            items: self.items.into_iter().map(f).collect(),
            next_cursor: self.next_cursor,
        }
    }
}

/// An opaque place in a paged list. Only the command that made it reads it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Cursor(String);

impl Cursor {
    /// A cursor naming `key`, for a command that pages its own way, as a
    /// Host's API does.
    pub(crate) fn naming(key: &impl Serialize) -> Self {
        Self(serde_json::to_string(key).expect("a page key serializes"))
    }

    /// The key a cursor from [`Cursor::naming`] names.
    pub(crate) fn named<K: DeserializeOwned>(&self) -> Result<K, InvalidCursor> {
        serde_json::from_str(&self.0).map_err(|_| InvalidCursor)
    }
}

/// A cursor that isn't one the command made, or is from another list.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InvalidCursor;

/// The page of `items` that `request` asks for. `items` must be in order of
/// `key`, and no two may share a key.
pub fn page_by_key<T, K>(
    items: Vec<T>,
    request: &PageRequest,
    key: impl Fn(&T) -> K,
) -> Result<Page<T>, InvalidCursor>
where
    K: Ord + Serialize + DeserializeOwned,
{
    let start = match &request.cursor {
        None => 0,
        Some(Cursor(cursor)) => {
            let after: K = serde_json::from_str(cursor).map_err(|_| InvalidCursor)?;
            items.partition_point(|item| key(item) <= after)
        }
    };
    let limit = request.limit();
    let more = items.len() > start + limit;
    let items: Vec<T> = items.into_iter().skip(start).take(limit).collect();
    let next_cursor = match items.last() {
        Some(last) if more => Some(Cursor(
            serde_json::to_string(&key(last)).expect("a page key serializes"),
        )),
        _ => None,
    };
    Ok(Page { items, next_cursor })
}

/// The page `request` asks for of a list of `len` items in their own order,
/// as positions in the list. `key(position)` is the unique key of the item
/// there, and `find(key)` the position of the item with that key, if it's
/// still in the list.
pub fn page_by_position<K>(
    len: usize,
    request: &PageRequest,
    key: impl Fn(usize) -> K,
    find: impl Fn(&K) -> Option<usize>,
) -> Result<Page<usize>, InvalidCursor>
where
    K: Serialize + DeserializeOwned,
{
    let start = match &request.cursor {
        None => 0,
        Some(Cursor(cursor)) => {
            let after: K = serde_json::from_str(cursor).map_err(|_| InvalidCursor)?;
            find(&after).ok_or(InvalidCursor)? + 1
        }
    };
    let end = len.min(start.saturating_add(request.limit()));
    let items: Vec<usize> = (start.min(end)..end).collect();
    let next_cursor = (end < len && end > start)
        .then(|| Cursor(serde_json::to_string(&key(end - 1)).expect("a page key serializes")));
    Ok(Page { items, next_cursor })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(cursor: Option<Cursor>, limit: Option<u32>) -> PageRequest {
        PageRequest { cursor, limit }
    }

    fn numbers(count: u32) -> Vec<u32> {
        (0..count).collect()
    }

    /// Every item, reading page after page from the first.
    fn read_all(items: &[u32], limit: u32) -> Vec<Vec<u32>> {
        let mut pages = Vec::new();
        let mut cursor = None;
        loop {
            let page = page_by_key(items.to_vec(), &request(cursor, Some(limit)), |n| *n)
                .expect("the cursor is valid");
            pages.push(page.items);
            match page.next_cursor {
                Some(next) => cursor = Some(next),
                None => return pages,
            }
        }
    }

    #[test]
    fn reads_every_item_once_page_by_page() {
        assert_eq!(
            read_all(&numbers(7), 3),
            vec![vec![0, 1, 2], vec![3, 4, 5], vec![6]]
        );
        assert_eq!(read_all(&numbers(6), 3), vec![vec![0, 1, 2], vec![3, 4, 5]]);
    }

    #[test]
    fn an_empty_list_is_one_empty_last_page() {
        assert_eq!(read_all(&[], 3), vec![Vec::<u32>::new()]);
    }

    #[test]
    fn a_short_list_is_one_last_page() {
        let page = page_by_key(numbers(3), &PageRequest::default(), |n| *n).unwrap();

        assert_eq!(page.items, vec![0, 1, 2]);
        assert_eq!(page.next_cursor, None);
    }

    #[test]
    fn carries_on_after_the_last_item_sent_even_when_the_list_changes() {
        let first = page_by_key(vec![10, 20, 30, 40], &request(None, Some(2)), |n| *n).unwrap();
        assert_eq!(first.items, vec![10, 20]);

        // 20, the last item sent, is gone, and 15 and 25 have arrived.
        let changed = vec![10, 15, 25, 30, 40];
        let next = page_by_key(changed, &request(first.next_cursor, Some(2)), |n| *n).unwrap();

        assert_eq!(next.items, vec![25, 30]);
    }

    #[test]
    fn limits_pages_to_between_one_and_the_maximum() {
        assert_eq!(request(None, None).limit(), DEFAULT_LIMIT as usize);
        assert_eq!(request(None, Some(0)).limit(), 1);
        assert_eq!(request(None, Some(5)).limit(), 5);
        assert_eq!(request(None, Some(u32::MAX)).limit(), MAX_LIMIT as usize);
    }

    #[test]
    fn a_cursor_the_command_did_not_make_is_invalid() {
        let forged = request(Some(Cursor("not a key".into())), None);

        assert_eq!(page_by_key(numbers(3), &forged, |n| *n), Err(InvalidCursor));
    }

    /// Every position, reading `items` page after page by position.
    fn read_all_by_position(items: &[&str], limit: u32) -> Vec<Vec<usize>> {
        let mut pages = Vec::new();
        let mut cursor = None;
        loop {
            let page = page_by_position(
                items.len(),
                &request(cursor, Some(limit)),
                |position| items[position].to_owned(),
                |key: &String| items.iter().position(|item| item == key),
            )
            .expect("the cursor is valid");
            pages.push(page.items);
            match page.next_cursor {
                Some(next) => cursor = Some(next),
                None => return pages,
            }
        }
    }

    #[test]
    fn pages_a_list_in_its_own_order_by_position() {
        assert_eq!(
            read_all_by_position(&["c", "a", "b", "e", "d"], 2),
            vec![vec![0, 1], vec![2, 3], vec![4]]
        );
        assert_eq!(read_all_by_position(&["c", "a"], 2), vec![vec![0, 1]]);
        assert_eq!(read_all_by_position(&[], 2), vec![Vec::<usize>::new()]);
    }

    #[test]
    fn a_position_cursor_carries_on_after_its_item_or_is_invalid_once_it_has_gone() {
        let first = page_by_position(
            3,
            &request(None, Some(1)),
            |position| ["c", "a", "b"][position].to_owned(),
            |_: &String| None,
        )
        .unwrap();
        assert_eq!(first.next_cursor, Some(Cursor("\"c\"".into())));

        // "x" has arrived before "c".
        let moved = ["x", "c", "a", "b"];
        let next = page_by_position(
            moved.len(),
            &request(first.next_cursor.clone(), Some(1)),
            |position| moved[position].to_owned(),
            |key: &String| moved.iter().position(|item| item == key),
        )
        .unwrap();
        assert_eq!(next.items, vec![2]);

        let gone = page_by_position(
            2,
            &request(first.next_cursor, Some(1)),
            |position| ["a", "b"][position].to_owned(),
            |key: &String| ["a", "b"].iter().position(|item| item == key),
        );
        assert_eq!(gone, Err(InvalidCursor));
    }

    #[test]
    fn pages_travel_as_camel_case_json() {
        let page = page_by_key(numbers(3), &request(None, Some(2)), |n| *n).unwrap();

        assert_eq!(
            serde_json::to_value(page).unwrap(),
            serde_json::json!({ "items": [0, 1], "nextCursor": "1" })
        );
        assert_eq!(
            serde_json::from_value::<PageRequest>(serde_json::json!({ "cursor": "1", "limit": 2 }))
                .unwrap(),
            request(Some(Cursor("1".into())), Some(2))
        );
        assert_eq!(
            serde_json::from_value::<PageRequest>(serde_json::json!({})).unwrap(),
            PageRequest::default()
        );
    }
}
