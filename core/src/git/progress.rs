//! Reading the progress lines `git` writes to stderr.

/// One progress update from `git`, such as
/// `Receiving objects:  45% (450/1000), 1.20 MiB | 2.00 MiB/s`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Progress {
    /// What Git is doing, in its words (and its language): `Receiving objects`.
    pub phase: String,
    /// Whether the remote reported it, rather than the local `git`.
    pub remote: bool,
    /// How far through the phase it is: objects received, say.
    pub done: u64,
    /// How many there are to do, if Git knows.
    pub total: Option<u64>,
    /// Git's own percentage, when it gives one.
    pub percent: Option<u8>,
    /// Whether this is the phase's last update, which ends `, done.`.
    pub finished: bool,
}

impl Progress {
    /// Reads one line of `git`'s stderr as progress, or `None` if it's
    /// something else, such as a `fatal:` message. The phase is translated
    /// but the shape of the line isn't, so this reads any language.
    pub fn parse(line: &str) -> Option<Self> {
        let line = line.trim();
        let (remote, line) = match line.strip_prefix("remote: ") {
            Some(rest) => (true, rest.trim_start()),
            None => (false, line),
        };
        let (phase, rest) = line.split_once(": ")?;
        if phase.is_empty() || ["fatal", "error", "warning", "hint"].contains(&phase) {
            return None;
        }
        let rest = rest.trim_start();
        let (count, after) = leading_number(rest)?;

        let (done, total, percent) = match after.strip_prefix('%') {
            // `45% (450/1000)`
            Some(after) => {
                let counts = after.trim_start().strip_prefix('(')?;
                let (done, counts) = leading_number(counts)?;
                let (total, counts) = leading_number(counts.strip_prefix('/')?)?;
                counts.strip_prefix(')')?;
                (done, Some(total), Some(u8::try_from(count).ok()?))
            }
            // `1234`, or `1234, done.`
            None => (count, None, None),
        };
        Some(Self {
            phase: phase.to_owned(),
            remote,
            done,
            total,
            percent,
            finished: rest.ends_with("done."),
        })
    }
}

/// The number `text` starts with, and what follows it.
fn leading_number(text: &str) -> Option<(u64, &str)> {
    let end = text
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(text.len());
    let number = text[..end].parse().ok()?;
    Some((number, &text[end..]))
}

#[cfg(test)]
mod tests {
    use super::Progress;

    fn progress(phase: &str, done: u64, total: Option<u64>, percent: Option<u8>) -> Progress {
        Progress {
            phase: phase.into(),
            remote: false,
            done,
            total,
            percent,
            finished: false,
        }
    }

    #[test]
    fn reads_a_phase_with_a_percentage_and_counts() {
        assert_eq!(
            Progress::parse("Receiving objects:  45% (450/1000), 1.20 MiB | 2.00 MiB/s"),
            Some(progress("Receiving objects", 450, Some(1000), Some(45)))
        );
    }

    #[test]
    fn reads_a_phase_with_only_a_count() {
        assert_eq!(
            Progress::parse("Enumerating objects: 1234"),
            Some(progress("Enumerating objects", 1234, None, None))
        );
    }

    #[test]
    fn reads_the_remote_s_progress_and_a_finished_phase() {
        assert_eq!(
            Progress::parse("remote: Counting objects: 100% (5/5), done."),
            Some(Progress {
                remote: true,
                finished: true,
                ..progress("Counting objects", 5, Some(5), Some(100))
            })
        );
        assert_eq!(
            Progress::parse("Receiving objects: 100% (3/3), 1.02 KiB | 1.02 MiB/s, done."),
            Some(Progress {
                finished: true,
                ..progress("Receiving objects", 3, Some(3), Some(100))
            })
        );
    }

    #[test]
    fn reads_a_translated_phase() {
        assert_eq!(
            Progress::parse("Réception d'objets:  12% (12/100)"),
            Some(progress("Réception d'objets", 12, Some(100), Some(12)))
        );
    }

    #[test]
    fn reads_nothing_from_lines_that_are_not_progress() {
        for line in [
            "",
            "Cloning into 'lanewise'...",
            "fatal: repository 'https://github.com/adrianeyre/lanewise.git/' not found",
            "error: 2 files would be overwritten",
            "remote: Total 3 (delta 0), reused 0 (delta 0), pack-reused 0",
            "hint: Waiting for your editor to close the file...",
            "Receiving objects: 45% (450",
        ] {
            assert_eq!(Progress::parse(line), None, "{line}");
        }
    }
}
