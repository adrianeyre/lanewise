//! Keeping credentials out of what Lanewise shows. A URL can carry them, as
//! `https://name:token@github.com/…`, in a remote's config or an argument,
//! and Git can repeat it in what it writes.

use std::borrow::Cow;

/// What stands in for a URL's credentials once they're hidden.
pub const HIDDEN_CREDENTIALS: &str = "***";

/// `text` with the credentials in each URL in it hidden: everything before
/// the `@` in `https://name:token@github.com/…` becomes
/// [`HIDDEN_CREDENTIALS`], since a token is as often the name as the
/// password. An SSH URL keeps its user, as in `ssh://git@github.com/…`,
/// which names the account to sign in as rather than a secret, unless it
/// has a password too. Text with no credentials in it comes back as it is.
pub fn hide_credentials(text: &str) -> Cow<'_, str> {
    let mut hidden = String::new();
    // How much of `text` is in `hidden` already.
    let mut copied = 0;
    let mut from = 0;
    while let Some(found) = text[from..].find("://") {
        let separator = from + found;
        let authority = separator + "://".len();
        let scheme_start = text[..separator]
            .char_indices()
            .rev()
            .take_while(|&(_, c)| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
            .last()
            .map_or(separator, |(at, _)| at);
        let scheme = &text[scheme_start..separator];
        // Where the host ends: at its path, or, in a message, the quote or
        // space around the URL.
        let authority_end = text[authority..]
            .find(|c: char| {
                c.is_whitespace() || matches!(c, '/' | '?' | '#' | '\'' | '"' | '`' | '<' | '>')
            })
            .map_or(text.len(), |end| authority + end);
        if let Some(user_end) = text[authority..authority_end].rfind('@') {
            let user = &text[authority..authority + user_end];
            let ssh = scheme.eq_ignore_ascii_case("ssh")
                || scheme.to_ascii_lowercase().contains("+ssh")
                || scheme.to_ascii_lowercase().starts_with("ssh+");
            if !scheme.is_empty()
                && !user.is_empty()
                && user != HIDDEN_CREDENTIALS
                && (!ssh || user.contains(':'))
            {
                hidden.push_str(&text[copied..authority]);
                hidden.push_str(HIDDEN_CREDENTIALS);
                copied = authority + user_end;
            }
        }
        from = authority_end.max(authority);
    }
    if copied == 0 {
        Cow::Borrowed(text)
    } else {
        hidden.push_str(&text[copied..]);
        Cow::Owned(hidden)
    }
}

#[cfg(test)]
mod tests {
    use super::hide_credentials;

    #[test]
    fn hides_the_name_and_password_or_token_in_a_url() {
        for (text, shown) in [
            (
                "https://adrianeyre:ghp_notARealToken@github.com/adrianeyre/lanewise.git",
                "https://***@github.com/adrianeyre/lanewise.git",
            ),
            (
                "https://ghp_notARealToken@github.com/adrianeyre/lanewise.git",
                "https://***@github.com/adrianeyre/lanewise.git",
            ),
            (
                "http://oauth2:glpat-notARealToken@gitlab.example.com:8080",
                "http://***@gitlab.example.com:8080",
            ),
            // An `@` in the password, as Git reads it, up to the last one.
            (
                "https://me:p@ss@example.com/a.git",
                "https://***@example.com/a.git",
            ),
            (
                "ssh://git:secret@github.com/adrianeyre/lanewise.git",
                "ssh://***@github.com/adrianeyre/lanewise.git",
            ),
        ] {
            assert_eq!(hide_credentials(text), shown);
        }
    }

    #[test]
    fn hides_them_wherever_a_url_is_in_a_message() {
        assert_eq!(
            hide_credentials(
                "fatal: unable to access 'https://me:token@example.com/a.git/': error\n\
                 and again at https://other:token@example.org"
            ),
            "fatal: unable to access 'https://***@example.com/a.git/': error\n\
             and again at https://***@example.org"
        );
        assert_eq!(
            hide_credentials("git clone -- https://ä:token@example.com/a.git ä"),
            "git clone -- https://***@example.com/a.git ä"
        );
    }

    #[test]
    fn leaves_an_ssh_user_an_email_and_a_url_with_no_credentials() {
        for text in [
            "ssh://git@github.com/adrianeyre/lanewise.git",
            "git+ssh://git@github.com/adrianeyre/lanewise.git",
            "git@github.com:adrianeyre/lanewise.git",
            "git@github.com: Permission denied (publickey).",
            "Ada Lovelace <ada@example.com>",
            "https://github.com/adrianeyre/lanewise.git",
            "https://github.com/adrianeyre/lanewise/commit/a@b",
            "https://***@github.com/adrianeyre/lanewise.git",
            "://@",
            "",
        ] {
            assert_eq!(hide_credentials(text), text);
        }
    }
}
