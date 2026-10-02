//! Writing one hunk of a working tree diff as a patch that `git apply`
//! reads, to stage or unstage just that hunk.

use crate::diff::FoundHunk;
use crate::{FileMode, LineKind};

/// Which way a patch takes a hunk.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Direction {
    /// From the diff's old side to its new: staging a hunk of the unstaged
    /// diff, into the index.
    Forwards,
    /// From the diff's new side back to its old: unstaging a hunk of the
    /// staged diff, out of the index.
    Backwards,
}

/// `hunk` of the file at `path` as a patch in `direction`, on its own: its
/// hunk header numbers the lines after it as if no other hunk were applied,
/// which is so, since only this one is. Each line is written as its bytes,
/// carriage return and all, so the patch is the file's own lines, whatever
/// their line endings or encoding.
pub(crate) fn hunk_patch(path: &str, hunk: &FoundHunk, direction: Direction) -> Vec<u8> {
    let forwards = direction == Direction::Forwards;
    let ((before, before_start, before_lines), (after, _, after_lines)) = {
        let old = (hunk.old, hunk.old_start, hunk.old_lines);
        let new = (hunk.new, hunk.new_start, hunk.new_lines);
        if forwards { (old, new) } else { (new, old) }
    };
    // The hunk's first line is where it was, before and after. A side with
    // no lines starts at the line before, as `git diff` numbers it.
    let first = if before_lines == 0 {
        before_start + 1
    } else {
        before_start
    };
    let after_start = if after_lines == 0 { first - 1 } else { first };

    let mut patch = Vec::new();
    let a = quoted("a/", path);
    let b = quoted("b/", path);
    patch.extend_from_slice(format!("diff --git {a} {b}\n").as_bytes());
    match (before, after) {
        (None, Some(mode)) => {
            patch.extend_from_slice(format!("new file mode {}\n", octal(mode)).as_bytes());
        }
        (Some(mode), None) => {
            patch.extend_from_slice(format!("deleted file mode {}\n", octal(mode)).as_bytes());
        }
        // A mode that changed is left as it is in the index: it's staged
        // with the whole file, not with a hunk.
        _ => {}
    }
    let side = |present: bool, name: &str| {
        if present {
            name.to_owned()
        } else {
            "/dev/null".to_owned()
        }
    };
    patch.extend_from_slice(
        format!(
            "--- {}\n+++ {}\n@@ -{before_start},{before_lines} +{after_start},{after_lines} @@\n",
            side(before.is_some(), &a),
            side(after.is_some(), &b),
        )
        .as_bytes(),
    );
    for (kind, line) in &hunk.lines {
        patch.push(match (kind, forwards) {
            (LineKind::Context, _) => b' ',
            (LineKind::Added, true) | (LineKind::Removed, false) => b'+',
            (LineKind::Removed, true) | (LineKind::Added, false) => b'-',
        });
        patch.extend_from_slice(line);
        if !line.ends_with(b"\n") {
            patch.extend_from_slice(b"\n\\ No newline at end of file\n");
        }
    }
    patch
}

/// A file's mode as a patch writes it.
fn octal(mode: FileMode) -> &'static str {
    match mode {
        FileMode::File => "100644",
        FileMode::Executable => "100755",
        FileMode::Symlink => "120000",
        FileMode::Submodule => "160000",
    }
}

/// `prefix` and `path` as a patch names a file: as they are, or, if the path
/// has a quote, a backslash, a control character or a byte outside ASCII,
/// in double quotes with those escaped, as `git diff` writes it, so `git
/// apply` reads the name back as it was.
fn quoted(prefix: &str, path: &str) -> String {
    let plain = |byte: u8| (0x20..0x7f).contains(&byte) && byte != b'"' && byte != b'\\';
    if path.bytes().all(plain) {
        return format!("{prefix}{path}");
    }
    let mut quoted = format!("\"{prefix}");
    for byte in path.bytes() {
        match byte {
            b'"' => quoted.push_str("\\\""),
            b'\\' => quoted.push_str("\\\\"),
            b'\t' => quoted.push_str("\\t"),
            b'\n' => quoted.push_str("\\n"),
            b'\r' => quoted.push_str("\\r"),
            byte if plain(byte) => quoted.push(char::from(byte)),
            byte => quoted.push_str(&format!("\\{byte:03o}")),
        }
    }
    quoted.push('"');
    quoted
}

#[cfg(test)]
mod tests {
    use super::*;

    fn found(
        old: Option<FileMode>,
        new: Option<FileMode>,
        lines: &[(LineKind, &str)],
    ) -> FoundHunk {
        let count = |kind| lines.iter().filter(|(k, _)| *k == kind).count() as u32;
        let context = count(LineKind::Context);
        FoundHunk {
            old,
            new,
            old_start: if old.is_some() { 4 } else { 0 },
            old_lines: context + count(LineKind::Removed),
            new_start: if old.is_some() { 9 } else { 1 },
            new_lines: context + count(LineKind::Added),
            lines: lines
                .iter()
                .map(|(kind, line)| (*kind, line.as_bytes().to_vec()))
                .collect(),
        }
    }

    fn text(patch: Vec<u8>) -> String {
        String::from_utf8(patch).unwrap()
    }

    #[test]
    fn a_hunk_is_numbered_from_where_it_starts_before() {
        let hunk = found(
            Some(FileMode::File),
            Some(FileMode::File),
            &[
                (LineKind::Context, "a\r\n"),
                (LineKind::Removed, "b\r\n"),
                (LineKind::Added, "c\r\n"),
                (LineKind::Added, "d"),
            ],
        );

        assert_eq!(
            text(hunk_patch("src/lib.rs", &hunk, Direction::Forwards)),
            "diff --git a/src/lib.rs b/src/lib.rs\n\
             --- a/src/lib.rs\n\
             +++ b/src/lib.rs\n\
             @@ -4,2 +4,3 @@\n \
             a\r\n\
             -b\r\n\
             +c\r\n\
             +d\n\
             \\ No newline at end of file\n"
        );
    }

    #[test]
    fn backwards_a_hunk_swaps_its_sides_and_starts_where_it_was_after() {
        let hunk = found(
            Some(FileMode::File),
            Some(FileMode::File),
            &[(LineKind::Removed, "b\n"), (LineKind::Added, "c\n")],
        );

        assert_eq!(
            text(hunk_patch("a.txt", &hunk, Direction::Backwards)),
            "diff --git a/a.txt b/a.txt\n\
             --- a/a.txt\n\
             +++ b/a.txt\n\
             @@ -9,1 +9,1 @@\n\
             +b\n\
             -c\n"
        );
    }

    #[test]
    fn a_side_with_no_lines_starts_at_the_line_before() {
        let added = found(
            None,
            Some(FileMode::Executable),
            &[(LineKind::Added, "x\n")],
        );
        assert_eq!(
            text(hunk_patch("run.sh", &added, Direction::Forwards)),
            "diff --git a/run.sh b/run.sh\n\
             new file mode 100755\n\
             --- /dev/null\n\
             +++ b/run.sh\n\
             @@ -0,0 +1,1 @@\n\
             +x\n"
        );
        // Unstaged, a file that was new leaves the index.
        assert_eq!(
            text(hunk_patch("run.sh", &added, Direction::Backwards)),
            "diff --git a/run.sh b/run.sh\n\
             deleted file mode 100755\n\
             --- a/run.sh\n\
             +++ /dev/null\n\
             @@ -1,1 +0,0 @@\n\
             -x\n"
        );
    }

    #[test]
    fn a_name_git_would_quote_is_quoted() {
        assert_eq!(quoted("a/", "plain name.txt"), "a/plain name.txt");
        assert_eq!(
            quoted("b/", "tab\there \"q\" back\\slash café"),
            "\"b/tab\\there \\\"q\\\" back\\\\slash caf\\303\\251\""
        );
    }
}
