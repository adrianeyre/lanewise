//! The In-Progress Operation (PRD §7.7): a merge, rebase, stash apply,
//! cherry-pick or revert Git stopped partway, as the Conflicts page shows it, with the files still
//! conflicted and those marked resolved. Continuing, skipping and aborting
//! it, and marking its files resolved or not, all run through the `git` CLI
//! (ADR 0002), so Git's own hooks, messages and rules hold (ADR 0017).

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use gix::state::InProgress;

use crate::conflict::ConflictSide;
use crate::git::{Git, GitError};
use crate::history::HistoryError;
use crate::stage::{NUL, PATHS_ON_STDIN, run_with_paths};
use crate::stash::{ApplyRecord, RecordedApply};
use crate::status::StatusError;
use crate::{CommitId, Repository, StageError};

/// Reads, continues, skips and aborts the In-Progress Operation.
pub trait Operations {
    /// The In-Progress Operation, if Git stopped a merge, rebase, stash
    /// apply, cherry-pick or revert partway. A `git am` isn't one yet.
    fn read_operation(&self, git: &Git) -> Result<Option<InProgressOperation>, OperationError>;

    /// Continues the In-Progress Operation once no file is conflicted: a
    /// merge commits, with Git's own message; a rebase replays its next
    /// commits, and may stop again at one that conflicts; a stash apply
    /// leaves its changes as a clean apply would have, and a pop drops its
    /// stash. Gives the operation as it is after, or `None` if it finished.
    fn continue_operation(&self, git: &Git) -> Result<Option<InProgressOperation>, OperationError>;

    /// Skips the commit a rebase, cherry-pick or revert stopped at, with
    /// `git rebase --skip`, `git cherry-pick --skip` or `git revert --skip`,
    /// and goes on with the rest. Gives the operation as it is after, or
    /// `None` if it finished.
    fn skip_commit(&self, git: &Git) -> Result<Option<InProgressOperation>, OperationError>;

    /// Aborts the In-Progress Operation, putting the branch, index and
    /// working tree back as they were before it: with `git merge --abort`,
    /// `git rebase --abort`, or, for a stash apply Lanewise started, by
    /// putting back what it recorded was staged. A stash apply started
    /// elsewhere is undone with `git reset --merge`, which unstages what was
    /// staged before it too, and leaves its untracked files.
    fn abort_operation(&self, git: &Git) -> Result<(), OperationError>;

    /// Marks the files at `paths` resolved, as they are in the working
    /// tree, with `git add`.
    fn mark_resolved(&self, git: &Git, paths: &[String]) -> Result<(), OperationError>;

    /// Marks the files at `paths`, resolved before, conflicted again, with
    /// `git update-index --unresolve`, keeping them as they are in the
    /// working tree.
    fn mark_unresolved(&self, git: &Git, paths: &[String]) -> Result<(), OperationError>;
}

/// A merge, rebase or stash apply Git stopped partway.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InProgressOperation {
    pub kind: OperationKind,
    /// The files still conflicted, sorted.
    pub conflicts: Vec<String>,
    /// The files that were conflicted and are marked resolved, sorted.
    pub resolved: Vec<String>,
}

/// Which operation is in progress.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OperationKind {
    /// A merge, of the commits in `MERGE_HEAD`.
    Merge { merging: Vec<CommitId> },
    /// A rebase of `branch`, or of a detached `HEAD`, onto `onto`, at commit
    /// `step` of `steps`, as in "commit 3 of 7", if Git says.
    Rebase {
        branch: Option<String>,
        onto: Option<CommitId>,
        step: Option<usize>,
        steps: Option<usize>,
    },
    /// A stash apply, or a pop if `pop`, of `stash`, or of a stash not
    /// known if it was started outside Lanewise, when `pop` is `false`.
    StashApply { stash: Option<CommitId>, pop: bool },
    /// A cherry-pick of `commit`, as `CHERRY_PICK_HEAD` has it, or `None`
    /// if Git doesn't say.
    CherryPick { commit: Option<CommitId> },
    /// A revert of `commit`, as `REVERT_HEAD` has it, or `None` if Git
    /// doesn't say.
    Revert { commit: Option<CommitId> },
}

/// Why the In-Progress Operation wasn't read, continued, skipped or aborted,
/// or its files marked.
#[derive(Debug, thiserror::Error)]
pub enum OperationError {
    /// There's no In-Progress Operation.
    #[error("there's no merge, rebase, stash apply, cherry-pick or revert in progress")]
    NotInProgress,
    /// Files are conflicted still, and have to be marked resolved first.
    #[error("files are still conflicted")]
    Unresolved { conflicts: Vec<String> },
    /// Only a rebase, cherry-pick or revert has commits to skip.
    #[error("there's no rebase, cherry-pick or revert in progress")]
    NotRebasing,
    /// The file isn't conflicted: it never was, or it's been marked
    /// resolved.
    #[error("'{path}' isn't conflicted")]
    NotConflicted { path: String },
    /// The file isn't one whose text can be written as a Resolution: it's a
    /// symbolic link or a folder in the working tree.
    #[error("'{path}' isn't a text file")]
    NotText { path: String },
    /// The side has no version of the file to keep: it deleted it, or
    /// renamed it away.
    #[error("'{path}' has no version on that side")]
    NoVersion { path: String, side: ConflictSide },
    /// The file couldn't be read or written in the working tree.
    #[error("'{path}' couldn't be read or written: {message}")]
    File { path: String, message: String },
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

impl From<StageError> for OperationError {
    fn from(error: StageError) -> Self {
        match error {
            StageError::Status(error) => Self::Status(error),
            StageError::Git(error) => Self::Git(error),
        }
    }
}

/// The In-Progress Operation's kind, with Lanewise's record of a stash
/// apply.
pub(crate) struct Found {
    pub(crate) kind: OperationKind,
    pub(crate) record: Option<ApplyRecord>,
}

impl Operations for Repository {
    fn read_operation(&self, git: &Git) -> Result<Option<InProgressOperation>, OperationError> {
        let conflicts = self.conflicts()?;
        let Some(found) = self.find_operation(&conflicts)? else {
            return Ok(None);
        };
        let resolved = self.resolved(git, &conflicts)?;
        Ok(Some(InProgressOperation {
            kind: found.kind,
            conflicts,
            resolved,
        }))
    }

    fn continue_operation(&self, git: &Git) -> Result<Option<InProgressOperation>, OperationError> {
        let conflicts = self.conflicts()?;
        let found = self
            .find_operation(&conflicts)?
            .ok_or(OperationError::NotInProgress)?;
        if !conflicts.is_empty() {
            return Err(OperationError::Unresolved { conflicts });
        }
        match found.kind {
            OperationKind::Merge { .. } => {
                // Git's own merge message, as `git merge` would have written.
                git.command(["commit", "--no-edit"])
                    .current_dir(self.root())
                    .env("GIT_EDITOR", ":")
                    .output()?;
                self.read_operation(git)
            }
            OperationKind::Rebase { step, .. } => {
                self.go_on_rebasing(git, step, &["rebase", "--continue"])
            }
            OperationKind::StashApply { .. } => {
                if let Some(applied) = found.record.and_then(|record| record.applied) {
                    self.finish_apply(git, &applied)?;
                }
                self.remove_apply_record()?;
                Ok(None)
            }
            OperationKind::CherryPick { .. } => {
                self.go_on_picking(git, &["cherry-pick", "--continue"])
            }
            OperationKind::Revert { .. } => self.go_on_picking(git, &["revert", "--continue"]),
        }
    }

    fn skip_commit(&self, git: &Git) -> Result<Option<InProgressOperation>, OperationError> {
        if let Some(progress) = self.rebase_progress() {
            return self.go_on_rebasing(git, progress.step, &["rebase", "--skip"]);
        }
        let conflicts = self.conflicts()?;
        match self.find_operation(&conflicts)?.map(|found| found.kind) {
            Some(OperationKind::CherryPick { .. }) => {
                self.go_on_picking(git, &["cherry-pick", "--skip"])
            }
            Some(OperationKind::Revert { .. }) => self.go_on_picking(git, &["revert", "--skip"]),
            _ => Err(OperationError::NotRebasing),
        }
    }

    fn abort_operation(&self, git: &Git) -> Result<(), OperationError> {
        let conflicts = self.conflicts()?;
        let found = self
            .find_operation(&conflicts)?
            .ok_or(OperationError::NotInProgress)?;
        let args: &[&str] = match found.kind {
            OperationKind::Merge { .. } => &["merge", "--abort"],
            OperationKind::Rebase { .. } => &["rebase", "--abort"],
            OperationKind::CherryPick { .. } => &["cherry-pick", "--abort"],
            OperationKind::Revert { .. } => &["revert", "--abort"],
            OperationKind::StashApply { .. } => {
                match found.record.and_then(|record| record.applied) {
                    Some(applied) => self.undo_apply(git, &applied)?,
                    None => {
                        git.command(["reset", "--merge"])
                            .current_dir(self.root())
                            .output()?;
                    }
                }
                self.remove_apply_record()?;
                return Ok(());
            }
        };
        git.command(args).current_dir(self.root()).output()?;
        Ok(())
    }

    fn mark_resolved(&self, git: &Git, paths: &[String]) -> Result<(), OperationError> {
        let conflicts = self.conflicts()?;
        let found = self
            .find_operation(&conflicts)?
            .ok_or(OperationError::NotInProgress)?;
        if matches!(found.kind, OperationKind::StashApply { .. }) && found.record.is_none() {
            // A stash apply started elsewhere is known only by its
            // conflicts, so it's recorded before the last of them goes.
            let head = self.gix.head_id().map_err(HistoryError::from_gix)?;
            self.write_apply_record(&ApplyRecord {
                head: CommitId(head.detach()),
                applied: None,
            })?;
        }
        run_with_paths(git.command(["add", PATHS_ON_STDIN, NUL]), self, paths)?;
        Ok(())
    }

    fn mark_unresolved(&self, git: &Git, paths: &[String]) -> Result<(), OperationError> {
        let conflicts = self.conflicts()?;
        self.find_operation(&conflicts)?
            .ok_or(OperationError::NotInProgress)?;
        // `git update-index` reads no paths from its stdin to unresolve, so
        // they're given on the command line, a few at a time, well within
        // what Windows allows one.
        let mut batch: Vec<&str> = Vec::new();
        let mut length = 0;
        for path in paths {
            batch.push(path);
            length += path.len() + 1;
            if length > 8_000 {
                self.unresolve(git, &batch)?;
                batch.clear();
                length = 0;
            }
        }
        if !batch.is_empty() {
            self.unresolve(git, &batch)?;
        }
        Ok(())
    }
}

impl Repository {
    /// Which operation is in progress, given the files conflicted now: a
    /// merge, then a rebase, then a stash apply.
    pub(crate) fn find_operation(
        &self,
        conflicts: &[String],
    ) -> Result<Option<Found>, OperationError> {
        if self.merging() {
            return Ok(Some(Found {
                kind: OperationKind::Merge {
                    merging: self.merge_heads(),
                },
                record: None,
            }));
        }
        if let Some(progress) = self.rebase_progress() {
            return Ok(Some(Found {
                kind: OperationKind::Rebase {
                    branch: progress.branch,
                    onto: progress.onto,
                    step: progress.step,
                    steps: progress.steps,
                },
                record: None,
            }));
        }
        match self.gix.state() {
            Some(InProgress::CherryPick | InProgress::CherryPickSequence) => {
                return Ok(Some(Found {
                    kind: OperationKind::CherryPick {
                        commit: self.picking("CHERRY_PICK_HEAD"),
                    },
                    record: None,
                }));
            }
            Some(InProgress::Revert | InProgress::RevertSequence) => {
                return Ok(Some(Found {
                    kind: OperationKind::Revert {
                        commit: self.picking("REVERT_HEAD"),
                    },
                    record: None,
                }));
            }
            _ => {}
        }
        if self.gix.state().is_some() {
            return Ok(None);
        }
        let record = self.apply_record(conflicts)?;
        if conflicts.is_empty() && record.is_none() {
            return Ok(None);
        }
        let applied = record.as_ref().and_then(|record| record.applied.as_ref());
        Ok(Some(Found {
            kind: OperationKind::StashApply {
                stash: applied.map(|applied| applied.stash),
                pop: applied.is_some_and(|applied| applied.pop),
            },
            record,
        }))
    }

    /// The files marked resolved, and not conflicted again: those Git's
    /// resolve-undo record in the index lists, which `git add` adds a file
    /// to as it resolves it.
    fn resolved(&self, git: &Git, conflicts: &[String]) -> Result<Vec<String>, GitError> {
        let listed = git
            .command(["ls-files", "--resolve-undo", "-z"])
            .current_dir(self.root())
            .output()?
            .stdout_text();
        // A line for each stage the file had: `<mode> <id> <stage>\t<path>`.
        let paths: BTreeSet<&str> = listed
            .split('\0')
            .filter_map(|line| line.split_once('\t'))
            .map(|(_, path)| path)
            .filter(|path| !conflicts.iter().any(|conflict| conflict == path))
            .collect();
        Ok(paths.into_iter().map(str::to_owned).collect())
    }

    /// Runs `args`, `git rebase --continue` or `--skip`, from commit `step`,
    /// and gives the rebase as it is after. Git fails when it stops again at
    /// a commit that conflicts, which is the rebase going on, not failing;
    /// when it stays at the same commit, with nothing conflicted, what it
    /// said is why.
    fn go_on_rebasing(
        &self,
        git: &Git,
        step: Option<usize>,
        args: &[&str],
    ) -> Result<Option<InProgressOperation>, OperationError> {
        // Each commit keeps its own message, with no editor to change it in.
        let ran = git
            .command(args)
            .current_dir(self.root())
            .env("GIT_EDITOR", ":")
            .output();
        let after = self.read_operation(git)?;
        match (ran, after) {
            (Ok(_), after) => Ok(after),
            (Err(error), Some(after)) => match &after.kind {
                OperationKind::Rebase { step: now, .. }
                    if *now != step || !after.conflicts.is_empty() =>
                {
                    Ok(Some(after))
                }
                _ => Err(error.into()),
            },
            (Err(error), None) => Err(error.into()),
        }
    }

    /// Runs `args`, `git cherry-pick` or `git revert` with `--continue` or
    /// `--skip`, with each commit's own message and no editor, and gives
    /// the operation as it is after. Git fails when it stops again at a
    /// commit that conflicts, which is it going on, not failing.
    fn go_on_picking(
        &self,
        git: &Git,
        args: &[&str],
    ) -> Result<Option<InProgressOperation>, OperationError> {
        let ran = git
            .command(args)
            .current_dir(self.root())
            .env("GIT_EDITOR", ":")
            .output();
        let after = self.read_operation(git)?;
        match (ran, after) {
            (Ok(_), after) => Ok(after),
            (Err(_), Some(after)) if !after.conflicts.is_empty() => Ok(Some(after)),
            (Err(error), _) => Err(error.into()),
        }
    }

    /// Leaves a stash apply's changes as `git stash apply` leaves them when
    /// it applies cleanly: each file the stash changed is staged as it was
    /// before the apply, but for files new to the index, which stay staged,
    /// and a popped stash is dropped.
    fn finish_apply(&self, git: &Git, applied: &RecordedApply) -> Result<(), OperationError> {
        let before: BTreeSet<String> = self.tree_paths(git, &applied.index)?.into_iter().collect();
        let paths: Vec<String> = self
            .stash_paths(git, applied.stash)?
            .into_iter()
            .filter(|path| before.contains(path))
            .collect();
        let source = format!("--source={}", applied.index);
        run_with_paths(
            git.command(["restore", source.as_str(), "--staged", PATHS_ON_STDIN, NUL]),
            self,
            &paths,
        )?;
        if applied.pop
            && let Ok(stash) = self.find_stash(applied.stash)
        {
            let name = format!("stash@{{{}}}", stash.index);
            git.command(["stash", "drop", "--quiet", name.as_str()])
                .current_dir(self.root())
                .output()?;
        }
        Ok(())
    }

    /// Undoes a stash apply Lanewise ran: each file the stash changed goes
    /// back, in the index and working tree, to what was staged before it,
    /// which `git stash apply` required the working tree to match, and the
    /// stash's untracked files it wrote are removed. Every other change,
    /// staged or not, stays.
    fn undo_apply(&self, git: &Git, applied: &RecordedApply) -> Result<(), OperationError> {
        let untracked = match self.untracked_commit(applied.stash) {
            Ok(Some(commit)) => self.tree_paths(git, &commit.to_string())?,
            _ => Vec::new(),
        };
        let index = self.gix.index_or_empty().map_err(HistoryError::from_gix)?;
        // Those the user has since added to the index are theirs to keep.
        let written: Vec<String> = untracked
            .into_iter()
            .filter(|path| index.entry_by_path(path.as_str().into()).is_none())
            .collect();
        drop(index);

        let paths = self.stash_paths(git, applied.stash)?;
        let source = format!("--source={}", applied.index);
        run_with_paths(
            git.command([
                "restore",
                source.as_str(),
                "--staged",
                "--worktree",
                PATHS_ON_STDIN,
                NUL,
            ]),
            self,
            &paths,
        )?;
        for path in written {
            remove_file(self.root(), &path)?;
        }
        Ok(())
    }

    /// The paths of the files the stash `stash` changed, against the commit
    /// it was made on, not counting its untracked files.
    fn stash_paths(&self, git: &Git, stash: CommitId) -> Result<Vec<String>, GitError> {
        let base = format!("{stash}^1");
        let stash = stash.to_string();
        let output = git
            .command([
                "diff",
                "--name-only",
                "-z",
                "--no-renames",
                base.as_str(),
                stash.as_str(),
            ])
            .current_dir(self.root())
            .output()?;
        Ok(nul_separated(&output.stdout_text()))
    }

    /// The paths of every file in the tree, or commit, `tree`.
    fn tree_paths(&self, git: &Git, tree: &str) -> Result<Vec<String>, GitError> {
        let output = git
            .command(["ls-tree", "-r", "-z", "--name-only", tree])
            .current_dir(self.root())
            .output()?;
        Ok(nul_separated(&output.stdout_text()))
    }

    fn unresolve(&self, git: &Git, paths: &[&str]) -> Result<(), GitError> {
        let mut args = vec!["update-index", "--unresolve", "--"];
        args.extend(paths);
        git.command(args).current_dir(self.root()).output()?;
        Ok(())
    }
}

fn nul_separated(text: &str) -> Vec<String> {
    text.split('\0')
        .filter(|path| !path.is_empty())
        .map(str::to_owned)
        .collect()
}

/// Removes the file at `path` in the working tree, if it's there, and the
/// folders it leaves empty.
fn remove_file(root: &Path, path: &str) -> Result<(), HistoryError> {
    let file = root.join(path);
    let unwritable = |error: std::io::Error| HistoryError::Unreadable {
        message: format!("couldn't remove '{}': {error}", file.display()),
    };
    match fs::remove_file(&file) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            return Err(unwritable(error));
        }
        _ => {}
    }
    let mut folder = file.parent();
    while let Some(dir) = folder {
        if dir == root || fs::remove_dir(dir).is_err() {
            break;
        }
        folder = dir.parent();
    }
    Ok(())
}
