//! A conflicted file's versions, as the Conflicts page's three-way view and
//! Resolution show them (PRD §7.7): its base, ours and theirs, from the
//! conflict stages Git left in the index, and the file as it is in the
//! working tree, with Git's conflict markers round each Conflict Hunk. A
//! Resolution is written to the working tree and marked resolved with
//! `git add` (ADR 0018). A file that can't be resolved as text, being
//! binary, or deleted or renamed away on one side, is resolved as a whole
//! instead: keeping one side's version, or deleting it, with what Git
//! reports about it, such as a rename the other side can't follow (ADR
//! 0019). With its versions come the subjects of the commits on each side,
//! which a Suggestion request sends (PRD §8.1).

use std::fs;
use std::io::ErrorKind;

use crate::git::{Cancel, Git};
use crate::history::{HistoryError, text};
use crate::operation::{OperationError, OperationKind, Operations as _};
use crate::{CommitId, Repository};

/// How far into a file Git looks for a NUL to call it binary, as
/// `buffer_is_binary` does.
const BINARY_PROBE: usize = 8000;

/// Reads a conflicted file's versions, and resolves it.
pub trait Conflicts {
    /// The versions of the conflicted file at `path`: its base, ours and
    /// theirs from the index's conflict stages, and the working tree's.
    fn read_conflict(&self, git: &Git, path: &str) -> Result<ConflictedFile, OperationError>;

    /// Writes `content` to the conflicted file at `path` in the working
    /// tree, as its Resolution, and marks it resolved with `git add`.
    fn resolve_conflict(&self, git: &Git, path: &str, content: &str) -> Result<(), OperationError>;

    /// Resolves the conflicted file at `path` as a whole: keeping one side's
    /// version of it, exactly as it is in the index, in the working tree
    /// too, or deleting it from both. Either way it's marked resolved, and
    /// Git's resolve-undo record keeps its conflict stages.
    fn resolve_whole_file(
        &self,
        git: &Git,
        path: &str,
        choice: WholeFileChoice,
    ) -> Result<(), OperationError>;
}

/// A side of a conflicted file: Ours or Theirs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConflictSide {
    Ours,
    Theirs,
}

/// What a conflicted file resolved as a whole becomes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WholeFileChoice {
    /// That side's version of it.
    Keep(ConflictSide),
    /// No file at all.
    Delete,
}

/// A conflicted file's versions. Each is `None` where there is none: no
/// base for a file added on both sides, no ours or theirs for a file one
/// side deleted, and no working tree file once it's been removed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConflictedFile {
    pub base: Option<ConflictVersion>,
    pub ours: Option<ConflictVersion>,
    pub theirs: Option<ConflictVersion>,
    pub working: Option<ConflictVersion>,
    /// What Git reports about the file, other than that its contents
    /// conflict: a rename one side made that the other deleted, say.
    pub reports: Vec<ConflictReport>,
    /// The subject of the commit on Ours: `HEAD`'s, where there is one.
    pub ours_subject: Option<String>,
    /// The subject of the commit on Theirs: the commit being merged, where
    /// there's one, the commit being replayed, or the stash, where Lanewise
    /// applied it and so knows which it is.
    pub theirs_subject: Option<String>,
}

/// One thing Git reports about a merge, as `git merge-tree` gives it: a
/// conflict other than in a file's contents, or something it did, such as
/// moving a file into a folder the other side renamed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConflictReport {
    /// What kind it is, as Git names it: `rename/delete`, say, from
    /// `CONFLICT (rename/delete)`, or the whole of an informational one's
    /// name.
    pub kind: String,
    /// What Git says, with the two sides named Ours and Theirs.
    pub message: String,
    /// The files it's about, the first being the one it's reported for.
    pub paths: Vec<String>,
}

/// One version of a conflicted file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ConflictVersion {
    /// Its text, as UTF-8.
    Text(String),
    /// It isn't text that can be shown and edited: it has a NUL in its
    /// first 8000 bytes, as Git decides a file is binary, isn't UTF-8, or is
    /// a symbolic link or submodule.
    NotText,
}

impl ConflictVersion {
    fn from_bytes(bytes: Vec<u8>) -> Self {
        if bytes.iter().take(BINARY_PROBE).any(|&byte| byte == 0) {
            return Self::NotText;
        }
        String::from_utf8(bytes).map_or(Self::NotText, Self::Text)
    }
}

/// Modes Git gives a symbolic link and a submodule in the index.
const SYMLINK: &str = "120000";
const SUBMODULE: &str = "160000";

impl Conflicts for Repository {
    fn read_conflict(&self, git: &Git, path: &str) -> Result<ConflictedFile, OperationError> {
        let mut file = ConflictedFile {
            base: None,
            ours: None,
            theirs: None,
            working: None,
            reports: Vec::new(),
            ours_subject: None,
            theirs_subject: None,
        };
        let stages = self.stages(git, path)?;
        if stages.is_empty() {
            return Err(OperationError::NotConflicted { path: path.into() });
        }
        for stage in stages {
            let version = if stage.mode == SYMLINK || stage.mode == SUBMODULE {
                ConflictVersion::NotText
            } else {
                ConflictVersion::from_bytes(self.blob(&stage.id)?)
            };
            match stage.number {
                1 => file.base = Some(version),
                2 => file.ours = Some(version),
                3 => file.theirs = Some(version),
                _ => {}
            }
        }
        let on_disk = self.root().join(path);
        file.working = match fs::symlink_metadata(&on_disk) {
            Err(error) if error.kind() == ErrorKind::NotFound => None,
            Ok(metadata) if !metadata.is_file() => Some(ConflictVersion::NotText),
            _ => Some(ConflictVersion::from_bytes(
                fs::read(&on_disk).map_err(|error| unreadable(path, error))?,
            )),
        };
        file.reports = self.reports(git, path);
        let head = self.gix.head_id().ok().map(|id| CommitId(id.detach()));
        file.ours_subject = head.and_then(|id| self.subject(id));
        file.theirs_subject = self.theirs_commit().and_then(|id| self.subject(id));
        Ok(file)
    }

    fn resolve_conflict(&self, git: &Git, path: &str, content: &str) -> Result<(), OperationError> {
        // Only a conflicted file is written, so only a file Git tracks, in
        // the working tree, and never through a symbolic link out of it.
        if !self.conflicts()?.iter().any(|conflict| conflict == path) {
            return Err(OperationError::NotConflicted { path: path.into() });
        }
        let on_disk = self.root().join(path);
        match fs::symlink_metadata(&on_disk) {
            Ok(metadata) if !metadata.is_file() => {
                return Err(OperationError::NotText { path: path.into() });
            }
            Err(error) if error.kind() != ErrorKind::NotFound => {
                return Err(unreadable(path, error));
            }
            _ => {}
        }
        if let Some(folder) = on_disk.parent() {
            fs::create_dir_all(folder).map_err(|error| unreadable(path, error))?;
        }
        fs::write(&on_disk, content).map_err(|error| unreadable(path, error))?;
        self.mark_resolved(git, &[path.to_owned()])
    }

    fn resolve_whole_file(
        &self,
        git: &Git,
        path: &str,
        choice: WholeFileChoice,
    ) -> Result<(), OperationError> {
        let stages = self.stages(git, path)?;
        if stages.is_empty() {
            return Err(OperationError::NotConflicted { path: path.into() });
        }
        let WholeFileChoice::Keep(side) = choice else {
            // `git rm` takes the file from the index and the working tree,
            // recording its conflict stages as resolve-undo.
            git.command(["rm", "--quiet", "--force", "--", path])
                .current_dir(self.root())
                .env("GIT_LITERAL_PATHSPECS", "1")
                .output()?;
            return Ok(());
        };
        let number = match side {
            ConflictSide::Ours => 2,
            ConflictSide::Theirs => 3,
        };
        let Some(kept) = stages.iter().find(|stage| stage.number == number) else {
            return Err(OperationError::NoVersion {
                path: path.into(),
                side,
            });
        };
        // The side's own entry, at stage 0, takes the place of the conflict
        // stages, which Git records as resolve-undo, as `git add` would.
        // Kept exactly, it's the same blob and mode, even for a symbolic
        // link or submodule, and `git checkout` then writes it out, as Git
        // writes any file, never through a symbolic link.
        git.command(["update-index", "-z", "--index-info"])
            .current_dir(self.root())
            .input(format!("{} {} 0\t{path}\0", kept.mode, kept.id))
            .output()?;
        git.command(["checkout", "--", path])
            .current_dir(self.root())
            .env("GIT_LITERAL_PATHSPECS", "1")
            .output()?;
        Ok(())
    }
}

/// One of a conflicted file's conflict stages in the index.
struct Stage {
    mode: String,
    id: String,
    /// 1 for the Base, 2 for Ours and 3 for Theirs.
    number: u8,
}

/// What `git merge-tree` reports as it merges, which says nothing about a
/// file that Git's conflict markers don't already.
const UNREPORTED: [&str; 2] = ["Auto-merging", "CONFLICT (contents)"];

impl Repository {
    /// The conflict stages of the file at `path`, none if it isn't
    /// conflicted.
    fn stages(&self, git: &Git, path: &str) -> Result<Vec<Stage>, OperationError> {
        // `<mode> <id> <stage>\t<path>`, a line for each stage the file has.
        let listed = git
            .command(["ls-files", "--unmerged", "-z", "--", path])
            .current_dir(self.root())
            .env("GIT_LITERAL_PATHSPECS", "1")
            .output()?
            .stdout_text();
        let mut stages = Vec::new();
        for line in listed.split('\0') {
            let Some((entry, listed_path)) = line.split_once('\t') else {
                continue;
            };
            if listed_path != path {
                continue;
            }
            let mut fields = entry.split(' ');
            let (Some(mode), Some(id), Some(Ok(number))) =
                (fields.next(), fields.next(), fields.next().map(str::parse))
            else {
                continue;
            };
            stages.push(Stage {
                mode: mode.to_owned(),
                id: id.to_owned(),
                number,
            });
        }
        Ok(stages)
    }

    /// What Git reports about the file at `path`, found by merging the
    /// In-Progress Operation's two sides again with `git merge-tree`, since
    /// Git keeps nothing of what it said as it stopped. There are none for
    /// an operation whose sides aren't known, such as an octopus merge, or
    /// a stash apply started elsewhere, or if Git can't merge them again.
    fn reports(&self, git: &Git, path: &str) -> Vec<ConflictReport> {
        let Some((base, ours, theirs)) = self.sides() else {
            return Vec::new();
        };
        let mut args = vec![
            "merge-tree".to_owned(),
            "--write-tree".to_owned(),
            "--name-only".to_owned(),
            "-z".to_owned(),
        ];
        if let Some(base) = base {
            args.push(format!("--merge-base={base}"));
        }
        args.extend([ours.clone(), theirs.clone()]);
        // It exits with 1 when the merge conflicts, as it does here.
        let Ok(ended) = git
            .command(args)
            .current_dir(self.root())
            .run_to_end(&Cancel::new(), |_| {})
        else {
            return Vec::new();
        };
        if !matches!(ended.code, Some(0 | 1)) {
            return Vec::new();
        }
        let named = |message: &str| message.replace(&ours, "Ours").replace(&theirs, "Theirs");
        merge_tree_reports(&ended.output.stdout_text())
            .into_iter()
            .filter(|report| report.paths.iter().any(|listed| listed == path))
            .map(|report| ConflictReport {
                message: named(&report.message),
                ..report
            })
            .collect()
    }

    /// The In-Progress Operation's two sides, as `git merge-tree` takes
    /// them, and the Base where it's to be given rather than found, each an
    /// object ID in hex: `HEAD` and the commit being merged; `HEAD` and the
    /// commit being replayed, from the one before it; or the index before a
    /// stash apply Lanewise ran and the stash, from the commit it was made
    /// on.
    fn sides(&self) -> Option<(Option<String>, String, String)> {
        let head = || self.gix.head_id().ok().map(|id| id.detach().to_string());
        let found = self.find_operation(&self.conflicts().ok()?).ok()??;
        match found.kind {
            OperationKind::Merge { merging } => match merging.as_slice() {
                [theirs] => Some((None, head()?, theirs.to_string())),
                _ => None,
            },
            OperationKind::Rebase { .. } => {
                let replayed = fs::read_to_string(self.gix.git_dir().join("REBASE_HEAD")).ok()?;
                let replayed = CommitId::parse(replayed.trim())?.to_string();
                Some((Some(format!("{replayed}^")), head()?, replayed))
            }
            OperationKind::StashApply { .. } => {
                let applied = found.record?.applied?;
                let stash = applied.stash.to_string();
                Some((Some(format!("{stash}^1")), applied.index, stash))
            }
            // A cherry-pick applies the commit's change: from its first parent to it.
            OperationKind::CherryPick { commit } => {
                let picked = commit?.to_string();
                Some((Some(format!("{picked}^1")), head()?, picked))
            }
            // A revert undoes it: from the commit back to its first parent.
            OperationKind::Revert { commit } => {
                let reverted = commit?.to_string();
                Some((Some(reverted.clone()), head()?, format!("{reverted}^1")))
            }
        }
    }

    /// The commit on the In-Progress Operation's Theirs side, where there's
    /// one known: the one commit being merged, the commit being replayed,
    /// the stash Lanewise applied, or the commit being cherry-picked or
    /// reverted.
    fn theirs_commit(&self) -> Option<CommitId> {
        let found = self.find_operation(&self.conflicts().ok()?).ok()??;
        match found.kind {
            OperationKind::Merge { merging } => match merging.as_slice() {
                [theirs] => Some(*theirs),
                _ => None,
            },
            OperationKind::Rebase { .. } => {
                let replayed = fs::read_to_string(self.gix.git_dir().join("REBASE_HEAD")).ok()?;
                CommitId::parse(replayed.trim())
            }
            OperationKind::StashApply { stash, .. } => stash,
            OperationKind::CherryPick { commit } | OperationKind::Revert { commit } => commit,
        }
    }

    /// The subject of the commit `id`: its message's first line.
    fn subject(&self, id: CommitId) -> Option<String> {
        let commit = self.commit(id).ok()?;
        let message = commit.message().ok()?;
        Some(text(message.summary().as_ref()))
    }

    /// The content of the blob `id` names, a hex object ID.
    fn blob(&self, id: &str) -> Result<Vec<u8>, HistoryError> {
        let unreadable = || HistoryError::Unreadable {
            message: format!("the conflict stage '{id}' couldn't be read"),
        };
        let id = gix::ObjectId::from_hex(id.as_bytes()).map_err(|_| unreadable())?;
        match self.gix.try_find_object(id) {
            Ok(Some(object)) if object.kind == gix::object::Kind::Blob => Ok(object.detach().data),
            Ok(_) => Err(unreadable()),
            Err(error) => Err(HistoryError::from_gix(error)),
        }
    }
}

/// The reports in what `git merge-tree --write-tree --name-only -z` wrote:
/// after the tree it wrote, and the files it left conflicted, an empty
/// line, then, for each report, how many files it's about, those files, its
/// kind and its message.
fn merge_tree_reports(written: &str) -> Vec<ConflictReport> {
    let mut fields = written.split('\0');
    for field in fields.by_ref() {
        if field.is_empty() {
            break;
        }
    }
    let mut reports = Vec::new();
    while let Some(Ok(count)) = fields.next().map(str::parse::<usize>) {
        let paths: Vec<String> = fields.by_ref().take(count).map(str::to_owned).collect();
        let (Some(kind), Some(message)) = (fields.next(), fields.next()) else {
            break;
        };
        if UNREPORTED.contains(&kind) {
            continue;
        }
        let kind = kind
            .strip_prefix("CONFLICT (")
            .and_then(|kind| kind.strip_suffix(')'))
            .unwrap_or(kind);
        reports.push(ConflictReport {
            kind: kind.to_owned(),
            message: message.trim_end().to_owned(),
            paths,
        });
    }
    reports
}

fn unreadable(path: &str, error: std::io::Error) -> OperationError {
    OperationError::File {
        path: path.into(),
        message: error.to_string(),
    }
}
