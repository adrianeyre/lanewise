//! Stashes (PRD §7.5): listing them, read from `refs/stash`'s reflog with
//! `gix`, and making, applying, popping and dropping them through the `git`
//! CLI (ADR 0002), so `git stash`'s own rules and messages hold. An apply or
//! pop that conflicts leaves a stash apply in progress, an In-Progress
//! Operation (ADR 0011). Git keeps no record of one, so Lanewise writes its
//! own when an apply it ran stops, for the Conflicts page to continue or
//! abort it by (ADR 0017).

use std::fs;
use std::path::PathBuf;

use crate::diff::ReadDiff;
use crate::git::{Git, GitError};
use crate::history::{HistoryError, seconds, text};
use crate::status::StatusError;
use crate::{ChangedFile, CommitId, CommitSummary, FileDiff, ReadHistory, Repository};

/// The ref whose reflog lists the stashes, newest last.
const STASH_REF: &str = "refs/stash";

/// Makes, lists and uses stashes.
pub trait Stashes {
    /// The stashes, newest first, as `git stash list` has them.
    fn read_stashes(&self) -> Result<Vec<Stash>, StashError>;

    /// Stashes the uncommitted changes with `git stash push`, under
    /// `message` if there is one, and with the untracked files too if
    /// `include_untracked`. Gives the new stash, or fails as
    /// [`StashError::NothingToStash`] if Git found nothing to put aside.
    fn create_stash(
        &self,
        git: &Git,
        message: Option<&str>,
        include_untracked: bool,
    ) -> Result<Stash, StashError>;

    /// Applies the stash `stash` with `git stash apply`, keeping it.
    fn apply_stash(&self, git: &Git, stash: CommitId) -> Result<Applied, StashError>;

    /// Applies the stash `stash` with `git stash pop`, dropping it if it
    /// applied without conflicts. Git keeps it if it conflicted.
    fn pop_stash(&self, git: &Git, stash: CommitId) -> Result<Applied, StashError>;

    /// Drops the stash `stash` with `git stash drop`.
    fn drop_stash(&self, git: &Git, stash: CommitId) -> Result<(), StashError>;

    /// The files the stash `stash` changed, each once, by path, as
    /// `git stash show --include-untracked` lists them: its changes against
    /// the commit it was made on, then its untracked files, added.
    fn read_stash_changes(&self, stash: CommitId) -> Result<Vec<ChangedFile>, StashError>;

    /// How the stash `stash` changed the file at `path`, as
    /// [`read_stash_changes`](Self::read_stash_changes) lists it. `from` is
    /// where a renamed file was. A diff of more than `limit` lines is only
    /// counted, not read.
    fn read_stash_diff(
        &self,
        stash: CommitId,
        path: &str,
        from: Option<&str>,
        limit: usize,
    ) -> Result<FileDiff, StashError>;

    /// The stash apply in progress, if an apply or pop stopped with
    /// conflicts. Git leaves nothing behind to say one did, so it's taken to
    /// be one when files are conflicted and no merge, rebase, cherry-pick,
    /// revert or `git am` is in progress (ADR 0011), or when Lanewise's own
    /// record of one says its files are being resolved still (ADR 0017).
    fn stash_apply_in_progress(&self) -> Result<Option<StashApplyInProgress>, StashError>;
}

/// A stash.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Stash {
    /// The stash's own commit, which stays the same as newer stashes are
    /// made and older ones dropped, unlike its `stash@{n}`.
    pub id: CommitId,
    /// Its `n` in `stash@{n}`: 0 for the newest.
    pub index: usize,
    /// The message it was made with, or `None` if it was made without one,
    /// when Git names it after the commit it was made on instead.
    pub message: Option<String>,
    /// The branch it was made on, or `None` if `HEAD` was detached.
    pub branch: Option<String>,
    /// The commit it was made on.
    pub base: CommitSummary,
    /// When it was made, in seconds since the epoch.
    pub time: i64,
    /// Whether it has untracked files too.
    pub untracked: bool,
}

/// What applying or popping a stash did.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Applied {
    /// It applied without conflicts. A popped stash is dropped.
    Applied,
    /// Git stopped with conflicts in `conflicts`, sorted, leaving a stash
    /// apply in progress. A popped stash is kept. `messages` is what Git
    /// wrote to stderr; it lists the conflicts itself elsewhere.
    Stopped {
        conflicts: Vec<String>,
        messages: String,
    },
}

/// A stash apply Git stopped partway, with conflicts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StashApplyInProgress {
    /// The files still conflicted, sorted.
    pub conflicts: Vec<String>,
}

/// Why a stash wasn't made, applied, popped, dropped or read.
#[derive(Debug, thiserror::Error)]
pub enum StashError {
    /// There's no stash with this commit: it was dropped, or never was one.
    #[error("there's no stash {stash}")]
    NotFound { stash: String },
    /// `HEAD` has no commits yet, so there's nothing to stash against.
    #[error("there are no commits to stash changes against yet")]
    NoCommits,
    /// There were no uncommitted changes to stash.
    #[error("there are no uncommitted changes to stash")]
    NothingToStash,
    /// An In-Progress Operation has to be finished or aborted first.
    #[error("a merge, rebase or stash apply is in progress")]
    InProgress,
    /// Applying the stash would overwrite uncommitted changes to `paths`,
    /// sorted.
    #[error("applying the stash would overwrite uncommitted changes")]
    WouldOverwrite { paths: Vec<String> },
    /// The status couldn't be read.
    #[error(transparent)]
    Status(#[from] StatusError),
    /// The repository couldn't be read.
    #[error(transparent)]
    History(#[from] HistoryError),
    /// `git` failed, and said why.
    #[error(transparent)]
    Git(#[from] GitError),
}

/// How a stash is applied.
#[derive(Clone, Copy)]
enum Apply {
    Apply,
    Pop,
}

impl Stashes for Repository {
    fn read_stashes(&self) -> Result<Vec<Stash>, StashError> {
        let Some(reference) = self
            .gix
            .try_find_reference(STASH_REF)
            .map_err(HistoryError::from_gix)?
        else {
            return Ok(Vec::new());
        };
        let mut log = reference.log_iter();
        let Some(lines) = log.all().map_err(HistoryError::from_gix)? else {
            return Ok(Vec::new());
        };
        let mut found = Vec::new();
        for line in lines {
            let line = line.map_err(HistoryError::from_gix)?;
            found.push((
                CommitId(line.new_oid()),
                text(line.message),
                seconds(line.signature)?,
            ));
        }
        found
            .into_iter()
            .rev()
            .enumerate()
            .map(|(index, (id, message, time))| self.stash(id, index, &message, time))
            .collect()
    }

    fn create_stash(
        &self,
        git: &Git,
        message: Option<&str>,
        include_untracked: bool,
    ) -> Result<Stash, StashError> {
        if self.gix.head().is_ok_and(|head| head.is_unborn()) {
            return Err(StashError::NoCommits);
        }
        if self.in_progress()? {
            return Err(StashError::InProgress);
        }
        let before = self.newest_stash()?;
        let mut args = vec!["stash", "push", "--quiet"];
        if include_untracked {
            args.push("--include-untracked");
        }
        if let Some(message) = message {
            args.extend(["--message", message]);
        }
        git.command(args).current_dir(self.root()).output()?;
        // `git stash push` succeeds with nothing to stash, and stashes
        // nothing: the newest stash is still the one before.
        match self.read_stashes()?.into_iter().next() {
            Some(stash) if Some(stash.id) != before => Ok(stash),
            _ => Err(StashError::NothingToStash),
        }
    }

    fn apply_stash(&self, git: &Git, stash: CommitId) -> Result<Applied, StashError> {
        self.apply(git, stash, Apply::Apply)
    }

    fn pop_stash(&self, git: &Git, stash: CommitId) -> Result<Applied, StashError> {
        self.apply(git, stash, Apply::Pop)
    }

    fn drop_stash(&self, git: &Git, stash: CommitId) -> Result<(), StashError> {
        let found = self.find_stash(stash)?;
        let name = format!("stash@{{{}}}", found.index);
        git.command(["stash", "drop", "--quiet", name.as_str()])
            .current_dir(self.root())
            .output()?;
        Ok(())
    }

    fn read_stash_changes(&self, stash: CommitId) -> Result<Vec<ChangedFile>, StashError> {
        self.find_stash(stash)?;
        // Against its first parent, the commit it was made on.
        let mut files = self.read_changes(stash)?;
        if let Some(untracked) = self.untracked_commit(stash)? {
            // A commit of its own, with no parents, so every file is added.
            files.extend(self.read_changes(untracked)?);
        }
        files.sort_by(|a, b| a.path.cmp(&b.path));
        files.dedup_by(|a, b| a.path == b.path);
        Ok(files)
    }

    fn read_stash_diff(
        &self,
        stash: CommitId,
        path: &str,
        from: Option<&str>,
        limit: usize,
    ) -> Result<FileDiff, StashError> {
        self.find_stash(stash)?;
        match self.read_commit_diff(stash, path, from, limit) {
            Err(HistoryError::FileNotFound { .. }) => match self.untracked_commit(stash)? {
                Some(untracked) => match self.read_commit_diff(untracked, path, None, limit) {
                    // Named after the stash, not its commit of untracked files.
                    Err(HistoryError::FileNotFound { path, .. }) => {
                        Err(HistoryError::FileNotFound {
                            commit: stash.to_string(),
                            path,
                        }
                        .into())
                    }
                    read => Ok(read?),
                },
                None => Err(HistoryError::FileNotFound {
                    commit: stash.to_string(),
                    path: path.to_owned(),
                }
                .into()),
            },
            read => Ok(read?),
        }
    }

    fn stash_apply_in_progress(&self) -> Result<Option<StashApplyInProgress>, StashError> {
        if self.gix.state().is_some() {
            return Ok(None);
        }
        let conflicts = self.conflicts()?;
        if conflicts.is_empty() && self.apply_record(&conflicts)?.is_none() {
            return Ok(None);
        }
        Ok(Some(StashApplyInProgress { conflicts }))
    }
}

impl Repository {
    /// The stash `id`, at `stash@{index}`, from its reflog `message`.
    fn stash(
        &self,
        id: CommitId,
        index: usize,
        message: &str,
        time: i64,
    ) -> Result<Stash, StashError> {
        let commit = self.commit(id)?;
        let mut parents = commit.parent_ids().map(|parent| CommitId(parent.detach()));
        let Some(base) = parents.next() else {
            return Err(HistoryError::Unreadable {
                message: format!("stash {id} has no parents, so it isn't one"),
            }
            .into());
        };
        // The second parent is the index, the third the untracked files.
        let untracked = parents.nth(1).is_some();
        let base = self
            .read_summaries(&[base])?
            .into_iter()
            .next()
            .ok_or_else(|| HistoryError::CommitNotFound {
                commit: base.to_string(),
            })?;
        let (message, branch) = described(message);
        Ok(Stash {
            id,
            index,
            message,
            branch,
            base,
            time,
            untracked,
        })
    }

    /// The stash with commit `id`, if it's still one.
    pub(crate) fn find_stash(&self, id: CommitId) -> Result<Stash, StashError> {
        self.read_stashes()?
            .into_iter()
            .find(|stash| stash.id == id)
            .ok_or_else(|| StashError::NotFound {
                stash: id.to_string(),
            })
    }

    /// The newest stash's commit, if there is a stash.
    fn newest_stash(&self) -> Result<Option<CommitId>, StashError> {
        let reference = self
            .gix
            .try_find_reference(STASH_REF)
            .map_err(HistoryError::from_gix)?;
        match reference {
            Some(mut reference) => {
                let id = reference.peel_to_id().map_err(HistoryError::from_gix)?;
                Ok(Some(CommitId(id.detach())))
            }
            None => Ok(None),
        }
    }

    /// The stash's commit of untracked files, its third parent, if it has
    /// one.
    pub(crate) fn untracked_commit(&self, stash: CommitId) -> Result<Option<CommitId>, StashError> {
        Ok(self
            .commit(stash)?
            .parent_ids()
            .nth(2)
            .map(|parent| CommitId(parent.detach())))
    }

    /// Whether an In-Progress Operation would stop a stash being made or
    /// applied: Git has a merge, rebase or the like in progress, or files
    /// are conflicted, as a stash apply that stopped leaves them.
    fn in_progress(&self) -> Result<bool, StashError> {
        if self.gix.state().is_some() {
            return Ok(true);
        }
        let conflicts = self.conflicts()?;
        Ok(!conflicts.is_empty() || self.apply_record(&conflicts)?.is_some())
    }

    fn apply(&self, git: &Git, id: CommitId, how: Apply) -> Result<Applied, StashError> {
        let stash = self.find_stash(id)?;
        if self.in_progress()? {
            return Err(StashError::InProgress);
        }
        // What's staged now, for aborting the apply if it stops: `git stash
        // apply` merges into the index, and keeps no copy of it.
        let head = CommitId(self.gix.head_id().map_err(HistoryError::from_gix)?.detach());
        let index = git
            .command(["write-tree"])
            .current_dir(self.root())
            .output()?
            .stdout_text()
            .trim()
            .to_owned();
        let name = format!("stash@{{{}}}", stash.index);
        let command = match how {
            Apply::Apply => "apply",
            Apply::Pop => "pop",
        };
        let ran = git
            .command(["stash", command, "--quiet", name.as_str()])
            .current_dir(self.root())
            .output();
        let conflicts = self.conflicts()?;
        if !conflicts.is_empty() {
            let messages = match ran {
                Ok(output) => output.messages,
                Err(GitError::Failed { message, .. }) => message,
                Err(error) => error.to_string(),
            };
            let record = ApplyRecord {
                head,
                applied: Some(RecordedApply {
                    stash: id,
                    pop: matches!(how, Apply::Pop),
                    index,
                }),
            };
            self.write_apply_record(&record)?;
            return Ok(Applied::Stopped {
                conflicts,
                messages,
            });
        }
        if let Err(error) = ran {
            // Nothing is read from Git's message, which changes with its
            // language and version.
            let base = stash.base.id.to_string();
            let paths = self.overwritten_by(git, &[base.as_str(), &id.to_string()])?;
            if paths.is_empty() {
                return Err(error.into());
            }
            return Err(StashError::WouldOverwrite { paths });
        }
        Ok(Applied::Applied)
    }
}

/// Lanewise's record of a stash apply in progress, kept in the Git
/// directory while its files are resolved (ADR 0017).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ApplyRecord {
    /// `HEAD` when the apply stopped: the record is stale once it moves.
    pub(crate) head: CommitId,
    /// The apply as Lanewise ran it, or `None` for one it found stopped,
    /// started elsewhere, whose stash and index before it aren't known.
    pub(crate) applied: Option<RecordedApply>,
}

/// A stash apply Lanewise ran, and what was staged before it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RecordedApply {
    pub(crate) stash: CommitId,
    /// Whether it was a pop, whose stash is dropped once it's continued.
    pub(crate) pop: bool,
    /// The tree `git write-tree` wrote of the index before the apply.
    pub(crate) index: String,
}

impl Repository {
    fn apply_record_path(&self) -> PathBuf {
        self.gix.git_dir().join("lanewise").join("stash-apply")
    }

    /// Lanewise's record of the stash apply in progress, given the files
    /// conflicted now, if it's still one: no merge, rebase or the like is in
    /// progress, `HEAD` hasn't moved, a popped stash hasn't been dropped,
    /// and files are conflicted still, or were resolved in the index, which
    /// keeps a note of them until a commit, checkout or hard reset. A stale
    /// record is removed.
    pub(crate) fn apply_record(
        &self,
        conflicts: &[String],
    ) -> Result<Option<ApplyRecord>, HistoryError> {
        let path = self.apply_record_path();
        let Ok(text) = fs::read_to_string(&path) else {
            return Ok(None);
        };
        let record = parse_record(&text);
        let head = self.gix.head_id().ok().map(|id| CommitId(id.detach()));
        let resolving = !conflicts.is_empty() || {
            let index = self.gix.index_or_empty().map_err(HistoryError::from_gix)?;
            index.resolve_undo().is_some_and(|paths| !paths.is_empty())
        };
        let kept = |record: &ApplyRecord| match &record.applied {
            Some(applied) if applied.pop => self.find_stash(applied.stash).is_ok(),
            _ => true,
        };
        match record {
            Some(record)
                if self.gix.state().is_none()
                    && head == Some(record.head)
                    && resolving
                    && kept(&record) =>
            {
                Ok(Some(record))
            }
            _ => {
                self.remove_apply_record()?;
                Ok(None)
            }
        }
    }

    pub(crate) fn write_apply_record(&self, record: &ApplyRecord) -> Result<(), HistoryError> {
        let mut text = format!("head {}\n", record.head);
        if let Some(applied) = &record.applied {
            text.push_str(&format!(
                "stash {}\npop {}\nindex {}\n",
                applied.stash, applied.pop, applied.index
            ));
        }
        let path = self.apply_record_path();
        let written = path
            .parent()
            .map_or(Ok(()), fs::create_dir_all)
            .and_then(|()| fs::write(&path, text));
        written.map_err(|error| HistoryError::Unreadable {
            message: format!("couldn't write '{}': {error}", path.display()),
        })
    }

    pub(crate) fn remove_apply_record(&self) -> Result<(), HistoryError> {
        let path = self.apply_record_path();
        match fs::remove_file(&path) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                Err(HistoryError::Unreadable {
                    message: format!("couldn't remove '{}': {error}", path.display()),
                })
            }
            _ => Ok(()),
        }
    }
}

/// A record as [`Repository::write_apply_record`] writes it, or `None` if
/// it isn't one.
fn parse_record(text: &str) -> Option<ApplyRecord> {
    let field = |name: &str| {
        text.lines()
            .find_map(|line| line.strip_prefix(name)?.strip_prefix(' '))
    };
    let head = CommitId::parse(field("head")?)?;
    let applied = match (field("stash"), field("pop"), field("index")) {
        (Some(stash), Some(pop), Some(index)) => Some(RecordedApply {
            stash: CommitId::parse(stash)?,
            pop: pop == "true",
            index: index.to_owned(),
        }),
        _ => None,
    };
    Some(ApplyRecord { head, applied })
}

/// The message a stash was made with, if it was, and the branch it was made
/// on, from its reflog message: `On <branch>: <message>`, or
/// `WIP on <branch>: <commit> <summary>` without one, as `git stash` writes
/// them in every language. A branch name can't have a `:` in it. Anything
/// else, as `git stash store --message` can leave, is all message.
fn described(message: &str) -> (Option<String>, Option<String>) {
    let (named, rest) = if let Some(rest) = message.strip_prefix("WIP on ") {
        (false, rest)
    } else if let Some(rest) = message.strip_prefix("On ") {
        (true, rest)
    } else {
        return (Some(message.to_owned()), None);
    };
    let Some((branch, message)) = rest.split_once(": ") else {
        return (Some(message.to_owned()), None);
    };
    let branch = (branch != "(no branch)").then(|| branch.to_owned());
    (named.then(|| message.to_owned()), branch)
}

#[cfg(test)]
mod tests {
    use super::{ApplyRecord, RecordedApply, described, parse_record};
    use crate::CommitId;

    #[test]
    fn a_stash_apply_record_reads_back_as_it_was_written() {
        let id = |hex: &str| CommitId::parse(&hex.repeat(40)).unwrap();
        let text = format!(
            "head {}\nstash {}\npop true\nindex {}\n",
            "a".repeat(40),
            "b".repeat(40),
            "c".repeat(40)
        );
        assert_eq!(
            parse_record(&text),
            Some(ApplyRecord {
                head: id("a"),
                applied: Some(RecordedApply {
                    stash: id("b"),
                    pop: true,
                    index: "c".repeat(40),
                }),
            })
        );
        let found = format!("head {}\n", "a".repeat(40));
        assert_eq!(
            parse_record(&found),
            Some(ApplyRecord {
                head: id("a"),
                applied: None,
            })
        );
        assert_eq!(parse_record("not a record"), None);
    }

    #[test]
    fn a_stash_message_names_its_branch_and_any_message_it_was_made_with() {
        let cases = [
            ("On main: my changes", Some("my changes"), Some("main")),
            ("On main: a: b", Some("a: b"), Some("main")),
            (
                "WIP on feature/x: 1234567 Add a thing",
                None,
                Some("feature/x"),
            ),
            ("On (no branch): detached", Some("detached"), None),
            ("WIP on (no branch): 1234567 Add", None, None),
            ("stored by hand", Some("stored by hand"), None),
        ];
        for (message, expected, branch) in cases {
            let (found, on) = described(message);
            assert_eq!(found.as_deref(), expected, "{message}");
            assert_eq!(on.as_deref(), branch, "{message}");
        }
    }
}
