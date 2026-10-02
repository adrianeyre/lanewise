//! Fetching, pulling and pushing (PRD §7.6), all through the `git` CLI
//! (ADR 0002), so the user's own credential helpers and SSH configuration
//! sign in, and a pull merges or rebases as their Git config says unless the
//! user picks otherwise for that one pull. Each local branch's Upstream is
//! read with how far ahead and behind it is (ADR 0013).

use crate::git::{Cancel, Git, GitError, Progress};
use crate::history::HistoryError;
use crate::sign_in::SignInFailure;
use crate::status::StatusError;
use crate::{CommitId, Repository};

/// Fetches, pulls and pushes, and reads each branch's Upstream.
pub trait Remotes {
    /// Each local branch that has an Upstream, with it, sorted by the
    /// branch's name. A branch with none isn't listed.
    fn read_upstreams(&self, git: &Git) -> Result<Vec<Upstream>, RemoteError>;

    /// Fetches from every remote with `git fetch --all`, calling
    /// `on_progress` for each progress update Git reports.
    fn fetch(
        &self,
        git: &Git,
        cancel: &Cancel,
        on_progress: impl FnMut(Progress),
    ) -> Result<(), RemoteError>;

    /// Pulls the current branch's Upstream into it with `git pull`, merging
    /// or rebasing as `mode` says.
    fn pull(
        &self,
        git: &Git,
        mode: PullMode,
        cancel: &Cancel,
        on_progress: impl FnMut(Progress),
    ) -> Result<Pulled, RemoteError>;

    /// Pushes the current branch with `git push`: to its Upstream, or, with
    /// `set_upstream`, to that branch on that remote, which becomes its
    /// Upstream once the push is through. Git refuses a push that would lose
    /// commits the remote has, and nothing here forces one.
    fn push(
        &self,
        git: &Git,
        set_upstream: Option<&NewUpstream>,
        cancel: &Cancel,
        on_progress: impl FnMut(Progress),
    ) -> Result<Pushed, RemoteError>;

    /// Deletes `branch` on `remote` with `git push --delete`, and with it
    /// its remote-tracking branch here, such as `origin/topic`. A branch
    /// the remote has already lost only has its remote-tracking branch
    /// deleted. The remote can refuse, as for its default branch or one it
    /// protects, and says why.
    fn delete_remote_branch(
        &self,
        git: &Git,
        remote: &str,
        branch: &str,
        cancel: &Cancel,
    ) -> Result<RemoteBranchDeleted, RemoteError>;
}

/// What deleting a branch on a remote did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RemoteBranchDeleted {
    /// The remote deleted it.
    Deleted,
    /// The remote had no such branch any more: only its remote-tracking
    /// branch here was left, and that has gone too.
    AlreadyGone,
}

/// The branch a local branch pulls from and pushes to, which Git calls its
/// upstream, and how far apart the two are.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Upstream {
    /// The local branch's name.
    pub branch: String,
    /// The Upstream's shortened name, such as `origin/main`.
    pub name: String,
    /// Its full name, such as `refs/remotes/origin/main`.
    pub reference: String,
    /// The remote it's on, or `.` for a local branch.
    pub remote: String,
    /// The branch on the remote, such as `refs/heads/main`.
    pub remote_ref: String,
    /// How many commits the local branch has that the Upstream doesn't.
    pub ahead: usize,
    /// How many commits the Upstream has that the local branch doesn't.
    pub behind: usize,
    /// The Upstream isn't there any more, as when the branch on the remote
    /// was deleted and a fetch pruned it.
    pub gone: bool,
}

/// Where a push sends a branch that becomes its Upstream: `branch` on
/// `remote`, which can be a branch the remote has, or one the push makes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NewUpstream {
    /// The remote's name, such as `origin`.
    pub remote: String,
    /// The branch's name on the remote, such as `feature/graph`.
    pub branch: String,
}

/// How a pull brings the Upstream's commits in.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum PullMode {
    /// As the Git config says: `branch.<name>.rebase`, `pull.rebase` and
    /// `pull.ff`.
    #[default]
    Config,
    /// Merging, as `git pull --no-rebase`, a fast-forward if it can be.
    Merge,
    /// Rebasing the branch's own commits onto the Upstream.
    Rebase,
    /// Only if the branch can move straight to the Upstream.
    FastForwardOnly,
}

/// What a pull did.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Pulled {
    /// There was nothing to bring in.
    UpToDate,
    /// The branch moved, taking in `commits` from the Upstream.
    Updated { commits: usize },
    /// Git stopped partway, leaving `operation` in progress: with conflicts
    /// in `conflicts`, sorted, or with none, as when a hook failed.
    /// `messages` is what Git wrote to stderr.
    Stopped {
        operation: StoppedOperation,
        conflicts: Vec<String>,
        messages: String,
    },
}

/// The In-Progress Operation a pull left.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StoppedOperation {
    Merge,
    Rebase,
}

/// What a push did.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Pushed {
    /// The Upstream had every commit already.
    UpToDate,
    /// The Upstream moved to the branch, taking `commits` from it, if that
    /// could be counted: not when the Upstream was gone. For a push that set
    /// the Upstream, `commits` are those none of the remote's
    /// remote-tracking branches had.
    Pushed { commits: Option<usize> },
}

/// Why a fetch, pull or push wasn't made, or the Upstreams weren't read.
#[derive(Debug, thiserror::Error)]
pub enum RemoteError {
    /// The repository has no remotes to fetch from.
    #[error("the repository has no remotes")]
    NoRemotes,
    /// The current branch has no commits yet.
    #[error("there are no commits to push yet")]
    NoCommits,
    /// `HEAD` is detached, so there's no branch to pull into or push.
    #[error("HEAD is detached, not on a branch")]
    Detached,
    /// `branch` has no Upstream to pull from or push to.
    #[error("the branch '{branch}' has no upstream")]
    NoUpstream { branch: String },
    /// There's no remote named `remote` to push to.
    #[error("there's no remote named '{remote}'")]
    RemoteNotFound { remote: String },
    /// Git doesn't allow `name` as the name of a branch on the remote.
    #[error("'{name}' isn't a valid branch name")]
    InvalidName { name: String },
    /// `branch`'s Upstream, `upstream`, isn't on the remote any more.
    #[error("the branch '{branch}' tracks '{upstream}', which is gone")]
    UpstreamGone { branch: String, upstream: String },
    /// An In-Progress Operation, or a conflict, has to be finished or
    /// aborted first.
    #[error("an operation is in progress, or a file is conflicted")]
    InProgress,
    /// The pull would overwrite uncommitted changes to `paths`, sorted.
    #[error("pulling would overwrite uncommitted changes")]
    WouldOverwrite { paths: Vec<String> },
    /// The branch and `upstream` have both moved on, and the Git config
    /// doesn't say whether to merge or rebase.
    #[error("the branch and '{upstream}' have diverged, and Git isn't set to merge or rebase")]
    NoPullMode { upstream: String },
    /// Only a fast-forward was allowed, and the branch and `upstream` have
    /// both moved on.
    #[error("the branch and '{upstream}' have diverged, so it can't fast-forward")]
    NotFastForward { upstream: String },
    /// The remote refused the push, since `upstream` has commits the branch
    /// doesn't: pulling them first brings them in.
    #[error("'{upstream}' has commits the branch doesn't")]
    Rejected { upstream: String },
    /// The user cancelled it.
    #[error("cancelled")]
    Cancelled,
    /// The status couldn't be read.
    #[error(transparent)]
    Status(#[from] StatusError),
    /// The repository couldn't be read.
    #[error(transparent)]
    History(#[from] HistoryError),
    /// Git couldn't sign in to the remote's Host, for the reason `failure`
    /// gives. `message` is what Git said.
    #[error("couldn't sign in: {failure}")]
    SignIn {
        failure: SignInFailure,
        message: String,
    },
    /// `git` failed, and said why.
    #[error(transparent)]
    Git(GitError),
}

impl From<GitError> for RemoteError {
    fn from(error: GitError) -> Self {
        match error {
            GitError::Cancelled { .. } => Self::Cancelled,
            GitError::Failed {
                command,
                code,
                message,
            } => match SignInFailure::recognise(&message) {
                Some(failure) => Self::SignIn { failure, message },
                None => Self::Git(GitError::Failed {
                    command,
                    code,
                    message,
                }),
            },
            error => Self::Git(error),
        }
    }
}

/// `git for-each-ref`'s fields for each branch, split by NULs, which no ref
/// name has.
const UPSTREAM_FORMAT: &str = "--format=%(refname)%00%(upstream)%00%(upstream:short)\
    %00%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream:track,nobracket)";

impl Remotes for Repository {
    fn read_upstreams(&self, git: &Git) -> Result<Vec<Upstream>, RemoteError> {
        let output = git
            .command(["for-each-ref", UPSTREAM_FORMAT, "refs/heads"])
            .current_dir(self.root())
            // How far apart the two are is in words, "ahead 2, behind 1",
            // which Git translates: in English they can be read.
            .env("LC_ALL", "C")
            .env("LANGUAGE", "")
            .output()?;
        let mut upstreams: Vec<Upstream> = output
            .stdout_text()
            .lines()
            .filter_map(parse_upstream)
            .collect();
        upstreams.sort_by(|a, b| a.branch.cmp(&b.branch));
        Ok(upstreams)
    }

    fn fetch(
        &self,
        git: &Git,
        cancel: &Cancel,
        on_progress: impl FnMut(Progress),
    ) -> Result<(), RemoteError> {
        if self.gix.remote_names().is_empty() {
            return Err(RemoteError::NoRemotes);
        }
        // Git's config says the rest, such as whether to prune.
        git.command(["fetch", "--all", "--progress"])
            .current_dir(self.root())
            .run(cancel, on_progress)?;
        Ok(())
    }

    fn pull(
        &self,
        git: &Git,
        mode: PullMode,
        cancel: &Cancel,
        on_progress: impl FnMut(Progress),
    ) -> Result<Pulled, RemoteError> {
        if self.gix.state().is_some() || !self.conflicts()?.is_empty() {
            return Err(RemoteError::InProgress);
        }
        let branch = self.current_branch()?.ok_or(RemoteError::Detached)?;
        // Checked for its being there only: `git pull` fetches the branch on
        // the remote, which may be back even if a fetch had pruned it.
        self.upstream_of(git, &branch)?
            .ok_or_else(|| RemoteError::NoUpstream {
                branch: branch.clone(),
            })?;
        let before = self.head();

        let pull_ff = self.config(git, "pull.ff", false)?;
        let only_fast_forward = pull_ff.as_deref() == Some("only");
        let mut args = vec!["pull", "--progress", "--no-edit"];
        match mode {
            PullMode::Config => {}
            // `pull.ff = only` wins over both otherwise, so `--ff` lifts it
            // for this one pull.
            PullMode::Merge => {
                args.push("--no-rebase");
                if only_fast_forward {
                    args.push("--ff");
                }
            }
            PullMode::Rebase => {
                args.push("--rebase");
                if only_fast_forward {
                    args.push("--ff");
                }
            }
            PullMode::FastForwardOnly => args.push("--ff-only"),
        }
        let ran = git
            .command(args)
            .current_dir(self.root())
            .run(cancel, on_progress);

        // Even a cancelled pull can have got as far as stopping.
        let operation = if self.merging() {
            Some(StoppedOperation::Merge)
        } else if self.rebasing() {
            Some(StoppedOperation::Rebase)
        } else {
            None
        };
        if let Some(operation) = operation {
            let messages = match ran {
                Ok(output) => output.messages,
                Err(GitError::Failed { message, .. }) => message,
                Err(GitError::Cancelled { .. }) => String::new(),
                Err(error) => error.to_string(),
            };
            return Ok(Pulled::Stopped {
                operation,
                conflicts: self.conflicts()?,
                messages,
            });
        }
        if let Err(error) = ran {
            if matches!(error, GitError::Cancelled { .. }) {
                return Err(RemoteError::Cancelled);
            }
            return Err(self.why_pull_failed(git, &branch, mode, pull_ff.as_deref(), error)?);
        }

        let after = self.head();
        if after == before {
            return Ok(Pulled::UpToDate);
        }
        let commits = match self.upstream_of(git, &branch)? {
            Some(upstream) if !upstream.gone => {
                self.count(git, &upstream.reference, before.as_ref())?
            }
            _ => 0,
        };
        Ok(Pulled::Updated { commits })
    }

    fn push(
        &self,
        git: &Git,
        set_upstream: Option<&NewUpstream>,
        cancel: &Cancel,
        on_progress: impl FnMut(Progress),
    ) -> Result<Pushed, RemoteError> {
        let branch = self.current_branch()?.ok_or(RemoteError::Detached)?;
        let upstream = match set_upstream {
            Some(new) => self.new_upstream(git, &branch, new)?,
            None => {
                let upstream =
                    self.upstream_of(git, &branch)?
                        .ok_or_else(|| RemoteError::NoUpstream {
                            branch: branch.clone(),
                        })?;
                if self.head().is_none() {
                    return Err(RemoteError::NoCommits);
                }
                let commits = (!upstream.gone).then_some(upstream.ahead);
                PushTarget {
                    remote: upstream.remote,
                    remote_ref: upstream.remote_ref,
                    name: upstream.name,
                    commits,
                }
            }
        };

        // Pushed to the Upstream by name, whatever `push.default` says, since
        // that's what the ahead and behind counts the user sees are against.
        let refspec = format!("refs/heads/{branch}:{}", upstream.remote_ref);
        let mut args = vec!["push", "--progress", "--porcelain"];
        if set_upstream.is_some() {
            // Set only once the remote has taken it, or had it already.
            args.push("--set-upstream");
        }
        args.extend(["--", upstream.remote.as_str(), refspec.as_str()]);
        let ended = git
            .command(args)
            .current_dir(self.root())
            .run_to_end(cancel, on_progress)?;

        // The porcelain lines are Git's own, never translated: a flag, the
        // refspec and a summary, such as `!	a:b	[rejected] (fetch first)`.
        let stdout = ended.output.stdout_text();
        let line = stdout.lines().find_map(|line| {
            let mut fields = line.splitn(3, '\t');
            let flag = fields.next()?;
            let refspec = fields.next()?;
            let summary = fields.next().unwrap_or_default();
            refspec
                .ends_with(&format!(":{}", upstream.remote_ref))
                .then_some((flag.to_owned(), summary.to_owned()))
        });
        match line {
            Some((flag, summary)) if flag == "!" => {
                if summary.contains("(non-fast-forward)") || summary.contains("(fetch first)") {
                    return Err(RemoteError::Rejected {
                        upstream: upstream.name,
                    });
                }
                // Refused for some other reason, as by a hook on the remote,
                // which the summary gives with Git's own messages.
                let messages = ended.output.messages;
                let message = if messages.is_empty() {
                    summary
                } else {
                    format!("{messages}\n{summary}")
                };
                Err(GitError::Failed {
                    command: ended.command,
                    code: ended.code,
                    message,
                }
                .into())
            }
            Some((flag, _)) if flag == "=" && ended.success => Ok(Pushed::UpToDate),
            _ => {
                ended.into_result()?;
                Ok(Pushed::Pushed {
                    commits: upstream.commits,
                })
            }
        }
    }

    fn delete_remote_branch(
        &self,
        git: &Git,
        remote: &str,
        branch: &str,
        cancel: &Cancel,
    ) -> Result<RemoteBranchDeleted, RemoteError> {
        if !self.has_remote(remote) {
            return Err(RemoteError::RemoteNotFound {
                remote: remote.into(),
            });
        }
        let remote_ref = format!("refs/heads/{branch}");
        let valid = !branch.is_empty()
            && !branch.starts_with('-')
            && branch != "HEAD"
            && git
                .command(["check-ref-format", remote_ref.as_str()])
                .current_dir(self.root())
                .output()
                .is_ok();
        if !valid {
            return Err(RemoteError::InvalidName {
                name: branch.into(),
            });
        }
        let refspec = format!(":{remote_ref}");
        let ended = git
            .command(["push", "--porcelain", "--", remote, refspec.as_str()])
            .current_dir(self.root())
            // Whether the remote had the branch is told from Git's words,
            // which it translates: in English they can be read.
            .env("LC_ALL", "C")
            .env("LANGUAGE", "")
            .run_to_end(cancel, |_| {})?;
        // A remote that had no such branch says so: an error from most
        // Hosts, a warning from a plain `git` remote.
        let messages = &ended.output.messages;
        let gone = if ended.success {
            messages.contains("non-existent ref")
        } else {
            messages.contains("remote ref does not exist")
        };
        if !ended.success && !gone {
            // Refused, as for a protected or the default branch, in the
            // porcelain summary and the remote's own messages.
            let stdout = ended.output.stdout_text();
            let summary = stdout
                .lines()
                .find_map(|line| {
                    let mut fields = line.splitn(3, '\t');
                    let flag = fields.next()?;
                    let named = fields.next()?;
                    (flag == "!" && named == refspec)
                        .then(|| fields.next().unwrap_or_default().to_owned())
                })
                .unwrap_or_default();
            let messages = ended.output.messages;
            let message = match (messages.is_empty(), summary.is_empty()) {
                (_, true) => messages,
                (true, false) => summary,
                (false, false) => format!("{messages}\n{summary}"),
            };
            return Err(GitError::Failed {
                command: ended.command,
                code: ended.code,
                message,
            }
            .into());
        }
        // Its remote-tracking branch goes too, if the push left it.
        let tracking = format!("refs/remotes/{remote}/{branch}");
        git.command(["update-ref", "-d", tracking.as_str()])
            .current_dir(self.root())
            .output()?;
        Ok(if gone {
            RemoteBranchDeleted::AlreadyGone
        } else {
            RemoteBranchDeleted::Deleted
        })
    }
}

/// Where a push goes.
struct PushTarget {
    remote: String,
    /// The branch on the remote, such as `refs/heads/main`.
    remote_ref: String,
    /// The Upstream's shortened name, such as `origin/main`.
    name: String,
    /// How many commits the push takes, if that can be told.
    commits: Option<usize>,
}

impl Repository {
    /// Where pushing `branch` to `new` goes, once it's checked it can.
    fn new_upstream(
        &self,
        git: &Git,
        branch: &str,
        new: &NewUpstream,
    ) -> Result<PushTarget, RemoteError> {
        if !self.has_remote(&new.remote) {
            return Err(RemoteError::RemoteNotFound {
                remote: new.remote.clone(),
            });
        }
        let remote_ref = format!("refs/heads/{}", new.branch);
        let valid = !new.branch.is_empty()
            && !new.branch.starts_with('-')
            && new.branch != "HEAD"
            && git
                .command(["check-ref-format", remote_ref.as_str()])
                .current_dir(self.root())
                .output()
                .is_ok();
        if !valid {
            return Err(RemoteError::InvalidName {
                name: new.branch.clone(),
            });
        }
        if self.head().is_none() {
            return Err(RemoteError::NoCommits);
        }
        // The commits none of the remote's remote-tracking branches has, as
        // far as the last fetch knows. Remote names can't hold the
        // characters a pattern would read.
        let local = format!("refs/heads/{branch}");
        let theirs = format!("--remotes={}", new.remote);
        let output = git
            .command([
                "rev-list",
                "--count",
                local.as_str(),
                "--not",
                theirs.as_str(),
            ])
            .current_dir(self.root())
            .output()?;
        Ok(PushTarget {
            remote: new.remote.clone(),
            name: format!("{}/{}", new.remote, new.branch),
            remote_ref,
            commits: output.stdout_text().trim().parse().ok(),
        })
    }

    /// `branch`'s Upstream, if it has one.
    fn upstream_of(&self, git: &Git, branch: &str) -> Result<Option<Upstream>, RemoteError> {
        Ok(self
            .read_upstreams(git)?
            .into_iter()
            .find(|upstream| upstream.branch == branch))
    }

    /// The commit `HEAD` is on, or `None` with no commits yet.
    fn head(&self) -> Option<CommitId> {
        self.gix.head_id().ok().map(|id| CommitId(id.detach()))
    }

    /// How many commits `tip` has that `since` doesn't, or all of them.
    fn count(&self, git: &Git, tip: &str, since: Option<&CommitId>) -> Result<usize, RemoteError> {
        let since = since.map(|id| format!("^{id}"));
        let mut args = vec!["rev-list", "--count", tip];
        args.extend(since.as_deref());
        let output = git.command(args).current_dir(self.root()).output()?;
        Ok(output.stdout_text().trim().parse().unwrap_or_default())
    }

    /// Why `git pull` failed, as far as can be told without reading its
    /// messages, which change with its language and version.
    fn why_pull_failed(
        &self,
        git: &Git,
        branch: &str,
        mode: PullMode,
        pull_ff: Option<&str>,
        error: GitError,
    ) -> Result<RemoteError, RemoteError> {
        // Its fetch couldn't sign in, so nothing about the Upstream is new.
        if SignInFailure::from_git(&error).is_some() {
            return Ok(error.into());
        }
        // Read again, since the pull fetched first.
        let Some(upstream) = self.upstream_of(git, branch)? else {
            return Ok(error.into());
        };
        if upstream.gone {
            return Ok(RemoteError::UpstreamGone {
                branch: branch.into(),
                upstream: upstream.name,
            });
        }
        if upstream.ahead > 0 && upstream.behind > 0 {
            let only_fast_forward = match mode {
                PullMode::FastForwardOnly => true,
                PullMode::Config => pull_ff == Some("only"),
                PullMode::Merge | PullMode::Rebase => false,
            };
            if only_fast_forward {
                return Ok(RemoteError::NotFastForward {
                    upstream: upstream.name,
                });
            }
            let rebase_key = format!("branch.{branch}.rebase");
            if mode == PullMode::Config
                && pull_ff.is_none()
                && self.config(git, &rebase_key, false)?.is_none()
                && self.config(git, "pull.rebase", false)?.is_none()
            {
                return Ok(RemoteError::NoPullMode {
                    upstream: upstream.name,
                });
            }
        }
        let incoming = format!("HEAD...{}", upstream.reference);
        let paths = self.overwritten_by(git, &[incoming.as_str()])?;
        if paths.is_empty() {
            return Ok(error.into());
        }
        Ok(RemoteError::WouldOverwrite { paths })
    }
}

/// One line of [`UPSTREAM_FORMAT`], or `None` for a branch with no Upstream.
fn parse_upstream(line: &str) -> Option<Upstream> {
    let mut fields = line.split('\0');
    let branch = fields.next()?.strip_prefix("refs/heads/")?.to_owned();
    let reference = fields.next()?.to_owned();
    let name = fields.next()?.to_owned();
    let remote = fields.next()?.to_owned();
    let remote_ref = fields.next()?.to_owned();
    let track = fields.next().unwrap_or_default();
    if reference.is_empty() {
        return None;
    }
    let mut upstream = Upstream {
        branch,
        name,
        reference,
        remote,
        remote_ref,
        ahead: 0,
        behind: 0,
        gone: false,
    };
    for part in track.split(", ") {
        let count = |prefix: &str| part.strip_prefix(prefix).and_then(|n| n.parse().ok());
        if part == "gone" {
            upstream.gone = true;
        } else if let Some(ahead) = count("ahead ") {
            upstream.ahead = ahead;
        } else if let Some(behind) = count("behind ") {
            upstream.behind = behind;
        }
    }
    Some(upstream)
}

#[cfg(test)]
mod tests {
    use super::parse_upstream;

    #[test]
    fn reads_how_far_ahead_and_behind_an_upstream_is() {
        let line = "refs/heads/main\0refs/remotes/origin/main\0origin/main\0origin\0\
            refs/heads/main\0ahead 2, behind 13";
        let upstream = parse_upstream(line).unwrap();
        assert_eq!(upstream.branch, "main");
        assert_eq!(upstream.name, "origin/main");
        assert_eq!(upstream.remote, "origin");
        assert_eq!(upstream.remote_ref, "refs/heads/main");
        assert_eq!(
            (upstream.ahead, upstream.behind, upstream.gone),
            (2, 13, false)
        );

        let behind = parse_upstream(&line.replace("ahead 2, behind 13", "behind 1")).unwrap();
        assert_eq!((behind.ahead, behind.behind), (0, 1));
        let even = parse_upstream(&line.replace("ahead 2, behind 13", "")).unwrap();
        assert_eq!((even.ahead, even.behind, even.gone), (0, 0, false));
        let gone = parse_upstream(&line.replace("ahead 2, behind 13", "gone")).unwrap();
        assert!(gone.gone);
    }

    #[test]
    fn skips_a_branch_with_no_upstream() {
        assert_eq!(parse_upstream("refs/heads/topic\0\0\0\0\0"), None);
    }
}
