//! What can be done at a commit from the Commit graph (ADR 0034): tagging
//! it and deleting its tags, cherry-picking and reverting it, and resetting
//! the current branch to it. Each runs through the `git` CLI (ADR 0002), so
//! the refs, reflogs, messages and hooks are Git's own. A cherry-pick or
//! revert that stops on conflicts is left in progress, for the Conflicts
//! page to resolve (ADR 0017).

use std::fs;

use gix::state::InProgress;

use crate::git::{Git, GitError};
use crate::history::HistoryError;
use crate::status::{ReadStatus, StatusError};
use crate::{CommitId, Repository};

/// Tags, cherry-picks, reverts and resets.
pub trait CommitActions {
    /// Makes the tag `name` at `commit`: annotated, with `message`, if it
    /// has one, and lightweight otherwise, as `git tag` does.
    fn create_tag(
        &self,
        git: &Git,
        name: &str,
        commit: CommitId,
        message: Option<&str>,
    ) -> Result<(), CommitActionError>;

    /// Deletes the tag `name`, as `git tag --delete` does.
    fn delete_tag(&self, git: &Git, name: &str) -> Result<(), CommitActionError>;

    /// Renames the tag `from` to `to`, at the same commit. An annotated
    /// tag keeps its message, tagger and date, in a tag object made again
    /// with its new name; a signature on it is dropped, as it would no
    /// longer hold. Both refs change together, or neither does.
    fn rename_tag(&self, git: &Git, from: &str, to: &str) -> Result<(), CommitActionError>;

    /// Gives `commit` the message `message`, as `git rebase` does when it
    /// rewords a commit, without touching the working tree: the commit is
    /// made again with the new message, and so is every commit after it on
    /// each local branch that has it, and a detached `HEAD` that has it,
    /// with their trees, authors, committers and dates as they were. Every
    /// branch moves together, or none does. Remote-tracking branches and
    /// tags stay where they were. Signatures are dropped, as they would no
    /// longer hold.
    fn reword(
        &self,
        git: &Git,
        commit: CommitId,
        message: &str,
    ) -> Result<Reworded, CommitActionError>;

    /// Applies the change `commit` made to the current branch, as a new
    /// commit with its message, as `git cherry-pick` does. A merge is
    /// picked against its first parent.
    fn cherry_pick(&self, git: &Git, commit: CommitId) -> Result<Picked, CommitActionError>;

    /// Undoes the change `commit` made, in a new commit, as `git revert`
    /// does, with Git's own message. A merge is reverted against its first
    /// parent.
    fn revert(&self, git: &Git, commit: CommitId) -> Result<Picked, CommitActionError>;

    /// What resetting the current branch, or a detached `HEAD`, to
    /// `commit` would do: the commits it would leave that nothing else has.
    fn preview_reset(&self, git: &Git, commit: CommitId)
    -> Result<ResetPreview, CommitActionError>;

    /// Resets the current branch, or a detached `HEAD`, to `commit`, as
    /// `git reset` does in `mode`, but only if `HEAD` is still `head`, as
    /// the user was shown it: otherwise it fails as
    /// [`CommitActionError::HeadMoved`], and nothing changes.
    fn reset(
        &self,
        git: &Git,
        commit: CommitId,
        mode: ResetMode,
        head: CommitId,
    ) -> Result<(), CommitActionError>;
}

/// What a cherry-pick or revert did.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Picked {
    /// It made the new commit.
    Committed { commit: CommitId },
    /// It stopped with these files conflicted, sorted, and is in progress.
    Stopped { conflicts: Vec<String> },
}

/// What rewording a commit did.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reworded {
    /// The commit made again with the new message.
    pub commit: CommitId,
    /// The local branches moved, by their short names, sorted.
    pub branches: Vec<String>,
    /// Whether a detached `HEAD` moved.
    pub detached: bool,
}

/// How `git reset` moves the branch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResetMode {
    /// Moves the branch only: the changes since stay staged.
    Soft,
    /// Moves the branch and the index: the changes since stay in the
    /// working tree, unstaged.
    Mixed,
    /// Moves the branch, the index and the working tree: the changes since,
    /// and every uncommitted change, are lost.
    Hard,
}

/// What a reset would do.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResetPreview {
    /// The branch it moves, or `None` with `HEAD` detached.
    pub branch: Option<String>,
    /// `HEAD` now, to pass back to reset.
    pub head: CommitId,
    /// The commits, newest first, that the branch has now and would leave,
    /// which no other branch, remote-tracking branch or tag has.
    pub lost: Vec<CommitId>,
    /// Whether there are uncommitted changes, which a hard reset loses.
    pub uncommitted: bool,
}

/// Why a tag, cherry-pick, revert or reset didn't happen.
#[derive(Debug, thiserror::Error)]
pub enum CommitActionError {
    /// Git doesn't allow `name` as a tag name.
    #[error("'{name}' isn't a valid tag name")]
    InvalidTagName { name: String },
    #[error("a tag named '{name}' already exists")]
    TagExists { name: String },
    #[error("there's no tag named '{name}'")]
    TagNotFound { name: String },
    /// A merge, rebase, stash apply, cherry-pick or revert is in progress,
    /// so a cherry-pick or revert can't start.
    #[error("another operation is in progress")]
    OperationInProgress,
    /// No local branch, and no detached `HEAD`, has the commit to reword.
    #[error("no local branch has the commit")]
    NotOnLocalBranch,
    /// A commit's message can't be empty.
    #[error("the message is empty")]
    EmptyMessage,
    /// `HEAD` isn't where it was when the reset was previewed.
    #[error("HEAD has moved since the reset was shown")]
    HeadMoved,
    /// The repository has no commits yet, so there's no `HEAD` to move.
    #[error("the repository has no commits yet")]
    NoCommits,
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

impl CommitActions for Repository {
    fn create_tag(
        &self,
        git: &Git,
        name: &str,
        commit: CommitId,
        message: Option<&str>,
    ) -> Result<(), CommitActionError> {
        let full = self.valid_tag_ref(git, name)?;
        if self.tag_exists(&full)? {
            return Err(CommitActionError::TagExists { name: name.into() });
        }
        let commit = commit.to_string();
        let mut args = vec!["tag"];
        // The message goes on stdin, so no editor opens and nothing in it is read as an option.
        if message.is_some() {
            args.extend(["--annotate", "--file=-"]);
        }
        args.extend(["--", name, commit.as_str()]);
        let mut command = git.command(args).current_dir(self.root());
        if let Some(message) = message {
            command = command.input(message.as_bytes().to_vec());
        }
        command.output()?;
        Ok(())
    }

    fn delete_tag(&self, git: &Git, name: &str) -> Result<(), CommitActionError> {
        if name.starts_with('-') || !self.tag_exists(&format!("refs/tags/{name}"))? {
            return Err(CommitActionError::TagNotFound { name: name.into() });
        }
        git.command(["tag", "--delete", "--", name])
            .current_dir(self.root())
            .output()?;
        Ok(())
    }

    fn rename_tag(&self, git: &Git, from: &str, to: &str) -> Result<(), CommitActionError> {
        let old_ref = format!("refs/tags/{from}");
        if from.starts_with('-') || !self.tag_exists(&old_ref)? {
            return Err(CommitActionError::TagNotFound { name: from.into() });
        }
        let new_ref = self.valid_tag_ref(git, to)?;
        if self.tag_exists(&new_ref)? {
            return Err(CommitActionError::TagExists { name: to.into() });
        }
        let old = git
            .command([
                "rev-parse",
                "--verify",
                "--end-of-options",
                old_ref.as_str(),
            ])
            .current_dir(self.root())
            .output()?
            .stdout_text()
            .trim()
            .to_owned();
        let kind = git
            .command(["cat-file", "-t", old.as_str()])
            .current_dir(self.root())
            .output()?
            .stdout_text();
        let new = if kind.trim() == "tag" {
            let raw = git
                .command(["cat-file", "tag", old.as_str()])
                .current_dir(self.root())
                .output()?
                .stdout;
            git.command(["mktag"])
                .current_dir(self.root())
                .input(renamed_tag_object(&raw, to))
                .output()?
                .stdout_text()
                .trim()
                .to_owned()
        } else {
            old.clone()
        };
        // One transaction: the new name is made only if it's still free,
        // and the old one goes only if it's still where it was.
        let message = format!("Lanewise: rename tag {from} to {to}");
        git.command(["update-ref", "-m", message.as_str(), "--stdin"])
            .current_dir(self.root())
            .input(format!("create {new_ref} {new}\ndelete {old_ref} {old}\n"))
            .output()?;
        Ok(())
    }

    fn reword(
        &self,
        git: &Git,
        commit: CommitId,
        message: &str,
    ) -> Result<Reworded, CommitActionError> {
        if message.trim().is_empty() {
            return Err(CommitActionError::EmptyMessage);
        }
        if self.gix.state().is_some() {
            return Err(CommitActionError::OperationInProgress);
        }
        let target = commit.to_string();
        let run = |args: &[&str]| -> Result<String, GitError> {
            Ok(git
                .command(args)
                .current_dir(self.root())
                .output()?
                .stdout_text())
        };
        // The local branches that have the commit, with their tips.
        let branches: Vec<(String, String)> = run(&[
            "for-each-ref",
            "--contains",
            target.as_str(),
            "--format=%(objectname) %(refname)",
            "refs/heads",
        ])?
        .lines()
        .filter_map(|line| line.split_once(' '))
        .map(|(tip, name)| (name.to_owned(), tip.to_owned()))
        .collect();
        let detached_head = match self.current_branch()? {
            Some(_) => None,
            None => {
                let head = self.head_commit()?;
                let has = git
                    .command(["merge-base", "--is-ancestor", target.as_str(), "HEAD"])
                    .current_dir(self.root())
                    .output()
                    .is_ok();
                has.then(|| head.to_string())
            }
        };
        if branches.is_empty() && detached_head.is_none() {
            return Err(CommitActionError::NotOnLocalBranch);
        }

        // The commit, then every commit after it on those tips, parents first.
        let not = format!("^{target}");
        let mut args = vec![
            "rev-list",
            "--topo-order",
            "--reverse",
            "--ancestry-path",
            not.as_str(),
        ];
        args.extend(branches.iter().map(|(_, tip)| tip.as_str()));
        if let Some(head) = &detached_head {
            args.push(head.as_str());
        }
        let after = run(&args)?;
        let order: Vec<&str> = std::iter::once(target.as_str())
            .chain(after.lines())
            .collect();
        let raw = git
            .command(["cat-file", "--batch"])
            .current_dir(self.root())
            .input(order.join("\n") + "\n")
            .output()?
            .stdout;
        let objects = batch_objects(&raw);

        let mut made: std::collections::HashMap<String, String> = std::collections::HashMap::new();
        for (index, id) in order.iter().enumerate() {
            let object = objects.get(*id).ok_or_else(|| GitError::Failed {
                command: "git cat-file --batch".into(),
                code: None,
                message: format!("commit {id} couldn't be read"),
            })?;
            let rewritten = rewritten_commit(object, &made, (index == 0).then_some(message));
            let written = git
                .command(["hash-object", "-t", "commit", "-w", "--stdin"])
                .current_dir(self.root())
                .input(rewritten)
                .output()?
                .stdout_text()
                .trim()
                .to_owned();
            made.insert((*id).to_owned(), written);
        }

        let moved = |old: &str| made.get(old).cloned().unwrap_or_else(|| old.to_owned());
        let mut updates = String::new();
        for (name, tip) in &branches {
            updates.push_str(&format!("update {name} {} {tip}\n", moved(tip)));
        }
        if let Some(head) = &detached_head {
            updates.push_str(&format!("update HEAD {} {head}\n", moved(head)));
        }
        let reflog = format!("Lanewise: edit the message of {}", &target[..7]);
        git.command(["update-ref", "--no-deref", "-m", reflog.as_str(), "--stdin"])
            .current_dir(self.root())
            .input(updates)
            .output()?;

        let mut names: Vec<String> = branches
            .iter()
            .map(|(name, _)| name.trim_start_matches("refs/heads/").to_owned())
            .collect();
        names.sort();
        Ok(Reworded {
            commit: CommitId::parse(&moved(&target)).ok_or(CommitActionError::NoCommits)?,
            branches: names,
            detached: detached_head.is_some(),
        })
    }

    fn cherry_pick(&self, git: &Git, commit: CommitId) -> Result<Picked, CommitActionError> {
        self.pick(git, commit, "cherry-pick")
    }

    fn revert(&self, git: &Git, commit: CommitId) -> Result<Picked, CommitActionError> {
        self.pick(git, commit, "revert")
    }

    fn preview_reset(
        &self,
        git: &Git,
        commit: CommitId,
    ) -> Result<ResetPreview, CommitActionError> {
        let head = self.head_commit()?;
        let branch = self.current_branch()?;
        let target = commit.to_string();
        let mut args = vec!["rev-list", "HEAD", "--not", target.as_str()];
        // What the other refs have isn't lost; the branch's own ref is left
        // out, as it moves. `--branches` matches it by its short name, which
        // can't hold the characters a pattern would read.
        let exclude = branch.as_ref().map(|name| format!("--exclude={name}"));
        if let Some(exclude) = &exclude {
            args.push(exclude.as_str());
        }
        args.extend(["--branches", "--remotes", "--tags"]);
        let output = git.command(args).current_dir(self.root()).output()?;
        let lost = output
            .stdout_text()
            .lines()
            .filter_map(CommitId::parse)
            .collect();
        Ok(ResetPreview {
            branch,
            head,
            lost,
            uncommitted: !self.read_status()?.is_empty(),
        })
    }

    fn reset(
        &self,
        git: &Git,
        commit: CommitId,
        mode: ResetMode,
        head: CommitId,
    ) -> Result<(), CommitActionError> {
        if self.head_commit()? != head {
            return Err(CommitActionError::HeadMoved);
        }
        let mode = match mode {
            ResetMode::Soft => "--soft",
            ResetMode::Mixed => "--mixed",
            ResetMode::Hard => "--hard",
        };
        let commit = commit.to_string();
        git.command(["reset", "--quiet", mode, commit.as_str()])
            .current_dir(self.root())
            .output()?;
        Ok(())
    }
}

impl Repository {
    /// `refs/tags/<name>`, if Git allows `name` as a tag's name.
    fn valid_tag_ref(&self, git: &Git, name: &str) -> Result<String, CommitActionError> {
        let full = format!("refs/tags/{name}");
        let valid = !name.starts_with('-')
            && git
                .command(["check-ref-format", full.as_str()])
                .current_dir(self.root())
                .output()
                .is_ok();
        if valid {
            Ok(full)
        } else {
            Err(CommitActionError::InvalidTagName { name: name.into() })
        }
    }

    /// Whether the tag ref `full`, `refs/tags/<name>`, is there.
    fn tag_exists(&self, full: &str) -> Result<bool, HistoryError> {
        Ok(self
            .gix
            .try_find_reference(full)
            .map_err(HistoryError::from_gix)?
            .is_some())
    }

    /// The commit `HEAD` is at.
    fn head_commit(&self) -> Result<CommitId, CommitActionError> {
        match self.gix.head_id() {
            Ok(id) => Ok(CommitId(id.detach())),
            Err(_) => Err(CommitActionError::NoCommits),
        }
    }

    /// Runs `git cherry-pick` or `git revert` of `commit`, with Git's own
    /// message and no editor. When Git fails and leaves the operation in
    /// progress, it stopped on conflicts, which is the pick going on, not
    /// failing.
    fn pick(&self, git: &Git, commit: CommitId, verb: &str) -> Result<Picked, CommitActionError> {
        if self.gix.state().is_some() || !self.conflicts()?.is_empty() {
            return Err(CommitActionError::OperationInProgress);
        }
        let id = commit.to_string();
        let merge = self.parent_count(commit)? > 1;
        let mut args = vec![verb];
        if verb == "revert" {
            args.push("--no-edit");
        }
        if merge {
            args.extend(["--mainline", "1"]);
        }
        args.push(id.as_str());
        let ran = git
            .command(args)
            .current_dir(self.root())
            .env("GIT_EDITOR", ":")
            .output();
        match ran {
            Ok(_) => Ok(Picked::Committed {
                commit: self.head_commit()?,
            }),
            Err(error) => {
                let stopped = matches!(
                    self.gix.state(),
                    Some(
                        InProgress::CherryPick
                            | InProgress::CherryPickSequence
                            | InProgress::Revert
                            | InProgress::RevertSequence
                    )
                );
                if stopped {
                    Ok(Picked::Stopped {
                        conflicts: self.conflicts()?,
                    })
                } else {
                    Err(error.into())
                }
            }
        }
    }

    /// How many parents `commit` has.
    fn parent_count(&self, commit: CommitId) -> Result<usize, HistoryError> {
        Ok(Repository::commit(self, commit)?.parent_ids().count())
    }

    /// The commit a cherry-pick or revert in progress is picking, from
    /// `CHERRY_PICK_HEAD` or `REVERT_HEAD`: `None` if Git doesn't say.
    pub(crate) fn picking(&self, file: &str) -> Option<CommitId> {
        fs::read_to_string(self.gix.git_dir().join(file))
            .ok()
            .and_then(|text| text.lines().next().and_then(CommitId::parse))
    }
}

/// Whether `line` is the first line of a signature header, such as
/// `gpgsig`, which a commit or tag made again can't keep.
fn is_signature_header(line: &[u8]) -> bool {
    line.starts_with(b"gpgsig ") || line.starts_with(b"gpgsig-sha256 ")
}

/// A raw object's headers and message, split at the first blank line.
fn split_object(raw: &[u8]) -> (Vec<&[u8]>, &[u8]) {
    let mut headers = Vec::new();
    let mut rest = raw;
    while let Some(end) = rest.iter().position(|&byte| byte == b'\n') {
        let line = &rest[..end];
        rest = &rest[end + 1..];
        if line.is_empty() {
            return (headers, rest);
        }
        headers.push(line);
    }
    headers.push(rest);
    (headers, &[])
}

/// A raw object's headers, without its signature headers and the lines that continue them.
fn unsigned_headers<'a>(headers: &[&'a [u8]]) -> Vec<&'a [u8]> {
    let mut kept = Vec::new();
    let mut in_signature = false;
    for &line in headers {
        if line.starts_with(b" ") && in_signature {
            continue;
        }
        in_signature = is_signature_header(line);
        if !in_signature {
            kept.push(line);
        }
    }
    kept
}

/// The raw commit `raw` made again with its parents moved to the commits
/// `made` of them, if they were, without a signature, and with `message`
/// in place of its own if there is one.
fn rewritten_commit(
    raw: &[u8],
    made: &std::collections::HashMap<String, String>,
    message: Option<&str>,
) -> Vec<u8> {
    let (headers, body) = split_object(raw);
    let mut out = Vec::with_capacity(raw.len());
    for line in unsigned_headers(&headers) {
        // A new message is UTF-8, whatever the old one's encoding was.
        if message.is_some() && line.starts_with(b"encoding ") {
            continue;
        }
        match line.strip_prefix(b"parent ") {
            Some(parent) => {
                let parent = String::from_utf8_lossy(parent);
                let parent = made
                    .get(parent.as_ref())
                    .map_or(parent.as_ref(), String::as_str);
                out.extend_from_slice(b"parent ");
                out.extend_from_slice(parent.as_bytes());
            }
            None => out.extend_from_slice(line),
        }
        out.push(b'\n');
    }
    out.push(b'\n');
    match message {
        Some(message) => {
            out.extend_from_slice(message.trim_end().as_bytes());
            out.push(b'\n');
        }
        None => out.extend_from_slice(body),
    }
    out
}

/// The raw tag object `raw` made again as the tag `name`, without its signature.
fn renamed_tag_object(raw: &[u8], name: &str) -> Vec<u8> {
    let (headers, body) = split_object(raw);
    let mut out = Vec::with_capacity(raw.len());
    for line in unsigned_headers(&headers) {
        if line.starts_with(b"tag ") {
            out.extend_from_slice(b"tag ");
            out.extend_from_slice(name.as_bytes());
        } else {
            out.extend_from_slice(line);
        }
        out.push(b'\n');
    }
    out.push(b'\n');
    // A signature on a tag is at the end of its message.
    let text = String::from_utf8_lossy(body);
    let end = [
        "-----BEGIN PGP SIGNATURE-----",
        "-----BEGIN SSH SIGNATURE-----",
        "-----BEGIN SIGNED MESSAGE-----",
    ]
    .iter()
    .filter_map(|marker| text.find(marker))
    .min()
    .unwrap_or(text.len());
    out.extend_from_slice(text[..end].as_bytes());
    out
}

/// The objects `git cat-file --batch` wrote, by their IDs.
fn batch_objects(raw: &[u8]) -> std::collections::HashMap<String, Vec<u8>> {
    let mut objects = std::collections::HashMap::new();
    let mut rest = raw;
    while let Some(end) = rest.iter().position(|&byte| byte == b'\n') {
        let header = String::from_utf8_lossy(&rest[..end]).into_owned();
        rest = &rest[end + 1..];
        let mut fields = header.split(' ');
        let (Some(id), Some(_kind), Some(size)) = (fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        let Ok(size) = size.parse::<usize>() else {
            continue;
        };
        if rest.len() < size {
            break;
        }
        objects.insert(id.to_owned(), rest[..size].to_vec());
        rest = rest.get(size + 1..).unwrap_or(&[]);
    }
    objects
}
