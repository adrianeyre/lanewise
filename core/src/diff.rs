//! A file's diff, read with `gix` (ADR 0002): its unified diff, or what it
//! is instead when there are no lines to show, such as a binary file.

use gix::bstr::ByteSlice;
use gix::diff::blob::unified_diff::{ConsumeHunk, ContextSize, DiffLineKind, HunkHeader};
use gix::diff::blob::{
    InternedInput, ResourceKind, UnifiedDiff, diff_with_slider_heuristics,
    pipeline::{Mode, WorktreeRoots},
    platform::prepare_diff::Operation,
    platform::resource::Data,
};
use gix::object::tree::EntryKind;

use crate::history::text;
use crate::{CommitId, HistoryError, Repository};

/// How many unchanged lines a hunk shows around its changes, as `git diff`
/// does by default.
const CONTEXT: u32 = 3;

/// Reads how a file changed.
pub trait ReadDiff {
    /// How `commit` changed the file at `path`, against its first parent, as
    /// `commitChanges` lists it, or against nothing for the first commit.
    /// `from` is where a renamed or copied file was in the parent. A diff of
    /// more than `limit` lines is only counted, not read.
    fn read_commit_diff(
        &self,
        commit: CommitId,
        path: &str,
        from: Option<&str>,
        limit: usize,
    ) -> Result<FileDiff, HistoryError>;

    /// How the file at `path` changed in the working tree, as the status
    /// lists it. `staged` is its staged change, from `HEAD` (or nothing,
    /// with no commits yet) to the index, where `from` is where a renamed
    /// file was in `HEAD`. Otherwise it's its unstaged change, from the
    /// index (or nothing, for an untracked file) to the working tree, read
    /// through its filters as `git diff` reads it. A diff of more than
    /// `limit` lines is only counted, not read.
    fn read_working_tree_diff(
        &self,
        path: &str,
        from: Option<&str>,
        staged: bool,
        limit: usize,
    ) -> Result<FileDiff, HistoryError>;
}

/// How one file changed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileDiff {
    /// The file before, or `None` if it was added.
    pub old: Option<DiffSide>,
    /// The file after, or `None` if it was deleted.
    pub new: Option<DiffSide>,
    pub content: DiffContent,
}

/// One side of a [`FileDiff`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiffSide {
    /// From the top folder, with `/` between folders.
    pub path: String,
    pub mode: FileMode,
}

/// What kind of file a tree entry is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileMode {
    File,
    Executable,
    Symlink,
    /// A submodule, whose content is one of its commits.
    Submodule,
}

/// What changed in a file's content.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DiffContent {
    /// Its lines changed in these hunks, or, with none, didn't change at all,
    /// as when a file was only renamed or made executable.
    Text { hunks: Vec<Hunk> },
    /// It's more than the limit asked for: `lines` long, adding `added`
    /// lines and removing `removed`.
    TooLarge {
        lines: usize,
        added: usize,
        removed: usize,
    },
    /// One side is binary, by its content or its Git attributes, or is over
    /// `core.bigFileThreshold`. The sizes are in bytes, `None` for a side
    /// that isn't there.
    Binary {
        old_size: Option<u64>,
        new_size: Option<u64>,
    },
    /// A submodule's commit changed. `None` for a side that isn't a submodule.
    Submodule {
        old: Option<CommitId>,
        new: Option<CommitId>,
    },
}

/// A run of changed lines, with the unchanged lines around them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hunk {
    /// The first line's number in the old file, from 1, or 0 if the hunk
    /// has no old lines.
    pub old_start: u32,
    pub old_lines: u32,
    /// The first line's number in the new file, as `old_start` is.
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

/// A line of a [`Hunk`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiffLine {
    pub kind: LineKind,
    /// Without its line ending, converted to UTF-8. A carriage return before
    /// the newline stays.
    pub text: String,
    /// Whether it's the file's last line, with no newline after it.
    pub no_newline: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineKind {
    /// In both the old file and the new.
    Context,
    Added,
    Removed,
}

impl ReadDiff for Repository {
    fn read_commit_diff(
        &self,
        commit: CommitId,
        path: &str,
        from: Option<&str>,
        limit: usize,
    ) -> Result<FileDiff, HistoryError> {
        let found = self.commit(commit)?;
        let tree = found.tree().map_err(HistoryError::from_gix)?;
        let parent = match found.parent_ids().next() {
            Some(parent) => Some(
                self.commit(CommitId(parent.detach()))?
                    .tree()
                    .map_err(HistoryError::from_gix)?,
            ),
            None => None,
        };
        let new = entry(&tree, path)?;
        let old = match &parent {
            Some(parent) => entry(parent, from.unwrap_or(path))?,
            None => None,
        };
        if old.is_none() && new.is_none() {
            return Err(HistoryError::FileNotFound {
                commit: commit.to_string(),
                path: path.to_owned(),
            });
        }
        let old_path = from.unwrap_or(path);
        self.file_diff(Sides::Objects, (old, old_path), (new, path), limit)
    }

    fn read_working_tree_diff(
        &self,
        path: &str,
        from: Option<&str>,
        staged: bool,
        limit: usize,
    ) -> Result<FileDiff, HistoryError> {
        let WorkingTreeSides {
            sides,
            old,
            old_path,
            new,
        } = self.working_tree_sides(path, from, staged)?;
        self.file_diff(sides, (old, old_path), (new, path), limit)
    }
}

/// A hunk of a working tree diff as its bytes, found by
/// [`Repository::find_working_tree_hunk`] to be written as a patch.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FoundHunk {
    /// The file's mode before, or `None` if the diff adds it.
    pub old: Option<FileMode>,
    /// The file's mode after, or `None` if the diff deletes it.
    pub new: Option<FileMode>,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    /// Each line's kind and bytes, with its newline if it has one.
    pub lines: Vec<(LineKind, Vec<u8>)>,
}

impl Repository {
    /// The hunk of the file's working tree diff, as
    /// [`ReadDiff::read_working_tree_diff`] reads it however long it is, that
    /// is `hunk`, or `None` if there's none: the file has changed since
    /// `hunk` was read.
    pub(crate) fn find_working_tree_hunk(
        &self,
        path: &str,
        from: Option<&str>,
        staged: bool,
        hunk: &Hunk,
    ) -> Result<Option<FoundHunk>, HistoryError> {
        let WorkingTreeSides {
            sides,
            old,
            old_path,
            new,
        } = match self.working_tree_sides(path, from, staged) {
            Ok(found) => found,
            Err(HistoryError::ChangeNotFound { .. }) => return Ok(None),
            Err(error) => return Err(error),
        };
        let mode = |entry: &Option<Entry>| entry.as_ref().map(|entry| entry.mode);
        let (old_mode, new_mode) = (mode(&old), mode(&new));
        let lines = self.diff_lines(
            sides,
            old.as_ref(),
            new.as_ref(),
            old_path,
            path,
            FindHunk {
                wanted: hunk,
                found: None,
            },
        )?;
        Ok(match lines {
            Lines::Text(found) => found.map(|found| FoundHunk {
                old: old_mode,
                new: new_mode,
                ..found
            }),
            _ => None,
        })
    }

    /// The two sides of the file's working tree diff, as
    /// [`ReadDiff::read_working_tree_diff`] reads them, and where they're
    /// read from: the old side with its path, then the new.
    fn working_tree_sides<'a>(
        &self,
        path: &'a str,
        from: Option<&'a str>,
        staged: bool,
    ) -> Result<WorkingTreeSides<'a>, HistoryError> {
        let index = self.gix.index_or_empty().map_err(HistoryError::from_gix)?;
        let in_index = index
            .entry_by_path_and_stage(path.into(), gix::index::entry::Stage::Unconflicted)
            // Marked with `git add --intent-to-add`: known to Git, but with
            // nothing staged yet.
            .filter(|entry| {
                !entry
                    .flags
                    .contains(gix::index::entry::Flags::INTENT_TO_ADD)
            })
            .and_then(|entry| {
                let kind = entry.mode.to_tree_entry_mode()?.kind();
                Some(Entry {
                    id: entry.id,
                    kind,
                    mode: file_mode(kind)?,
                })
            });
        let (old, old_path, new, sides) = if staged {
            let old_path = from.unwrap_or(path);
            let old = match self.gix.head_tree_id_or_empty() {
                Ok(tree) if !tree.is_empty_tree() => {
                    let tree = tree.object().map_err(HistoryError::from_gix)?.into_tree();
                    entry(&tree, old_path)?
                }
                Ok(_) => None,
                Err(error) => return Err(HistoryError::from_gix(error)),
            };
            (old, old_path, in_index, Sides::Objects)
        } else {
            let new = self.worktree_entry(path, in_index.as_ref())?;
            (in_index, path, new, Sides::Worktree)
        };
        if old.is_none() && new.is_none() {
            return Err(HistoryError::ChangeNotFound {
                path: path.to_owned(),
            });
        }
        Ok(WorkingTreeSides {
            sides,
            old,
            old_path,
            new,
        })
    }
}

/// What [`Repository::working_tree_sides`] finds.
struct WorkingTreeSides<'a> {
    sides: Sides,
    old: Option<Entry>,
    old_path: &'a str,
    new: Option<Entry>,
}

/// Where a diff's sides are read from.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Sides {
    /// Both from the object database.
    Objects,
    /// The old side from the object database, the new side from the working
    /// tree, whatever its [`Entry::id`].
    Worktree,
}

/// A file in a tree.
struct Entry {
    id: gix::ObjectId,
    kind: EntryKind,
    mode: FileMode,
}

/// The file at `path` in `tree`, if there is one. A folder there isn't one.
fn entry(tree: &gix::Tree<'_>, path: &str) -> Result<Option<Entry>, HistoryError> {
    let Some(found) = tree
        .lookup_entry(path.split('/'))
        .map_err(HistoryError::from_gix)?
    else {
        return Ok(None);
    };
    let kind = found.mode().kind();
    Ok(file_mode(kind).map(|mode| Entry {
        id: found.object_id(),
        kind,
        mode,
    }))
}

/// The kind of file an entry of `kind` is, or `None` for a folder.
fn file_mode(kind: EntryKind) -> Option<FileMode> {
    match kind {
        EntryKind::Blob => Some(FileMode::File),
        EntryKind::BlobExecutable => Some(FileMode::Executable),
        EntryKind::Link => Some(FileMode::Symlink),
        EntryKind::Commit => Some(FileMode::Submodule),
        EntryKind::Tree => None,
    }
}

impl Repository {
    /// The file at `path` in the working tree, if there is one, as Git would
    /// stage it. Its ID is that of `in_index`, the file in the index, which
    /// is only used to read its line endings as Git would, or, for a
    /// submodule, that of the commit it has checked out.
    fn worktree_entry(
        &self,
        path: &str,
        in_index: Option<&Entry>,
    ) -> Result<Option<Entry>, HistoryError> {
        let file = self
            .root()
            .join(gix::path::from_bstr(gix::bstr::BStr::new(path)));
        let metadata = match std::fs::symlink_metadata(&file) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(HistoryError::from_gix(error)),
        };
        let id = in_index.map_or_else(|| gix::ObjectId::null(self.gix.object_hash()), |e| e.id);
        let kind = if metadata.is_dir() {
            if in_index.is_none_or(|e| e.mode != FileMode::Submodule) {
                return Ok(None);
            }
            // A submodule that isn't checked out has no commit to show.
            let Some(head) = gix::open(&file)
                .ok()
                .and_then(|submodule| submodule.head_id().ok().map(|id| id.detach()))
            else {
                return Ok(None);
            };
            return Ok(Some(Entry {
                id: head,
                kind: EntryKind::Commit,
                mode: FileMode::Submodule,
            }));
        } else if metadata.is_symlink() {
            EntryKind::Link
        } else if self.executable(&metadata) {
            EntryKind::BlobExecutable
        } else if !self.file_modes_count()
            && in_index.is_some_and(|e| e.kind == EntryKind::BlobExecutable)
        {
            // Where Git doesn't read the executable bit, it keeps the index's.
            EntryKind::BlobExecutable
        } else {
            EntryKind::Blob
        };
        Ok(file_mode(kind).map(|mode| Entry { id, kind, mode }))
    }

    /// Whether Git reads files' executable bits here, as `core.fileMode`
    /// says.
    fn file_modes_count(&self) -> bool {
        cfg!(unix)
            && self
                .gix
                .config_snapshot()
                .boolean("core.fileMode")
                .unwrap_or(true)
    }

    fn executable(&self, metadata: &std::fs::Metadata) -> bool {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            self.file_modes_count() && metadata.permissions().mode() & 0o111 != 0
        }
        #[cfg(not(unix))]
        {
            let _ = metadata;
            false
        }
    }

    /// The diff from `old` at its path to `new` at its, read from `sides`.
    fn file_diff(
        &self,
        sides: Sides,
        (old, old_path): (Option<Entry>, &str),
        (new, new_path): (Option<Entry>, &str),
        limit: usize,
    ) -> Result<FileDiff, HistoryError> {
        let side = |entry: &Option<Entry>, path: &str| {
            entry.as_ref().map(|entry| DiffSide {
                path: path.to_owned(),
                mode: entry.mode,
            })
        };
        Ok(FileDiff {
            old: side(&old, old_path),
            new: side(&new, new_path),
            content: self.content(sides, old.as_ref(), new.as_ref(), old_path, new_path, limit)?,
        })
    }

    fn content(
        &self,
        sides: Sides,
        old: Option<&Entry>,
        new: Option<&Entry>,
        old_path: &str,
        new_path: &str,
        limit: usize,
    ) -> Result<DiffContent, HistoryError> {
        Ok(
            match self.diff_lines(sides, old, new, old_path, new_path, Hunks::new(limit))? {
                Lines::Unchanged => DiffContent::Text { hunks: Vec::new() },
                Lines::Text(content) => content,
                Lines::Binary { old_size, new_size } => DiffContent::Binary { old_size, new_size },
                Lines::Submodule { old, new } => DiffContent::Submodule { old, new },
            },
        )
    }

    /// Diffs `old`'s lines and `new`'s, giving each hunk to `hunks`, unless
    /// there are no lines to diff.
    fn diff_lines<C: ConsumeHunk>(
        &self,
        sides: Sides,
        old: Option<&Entry>,
        new: Option<&Entry>,
        old_path: &str,
        new_path: &str,
        hunks: C,
    ) -> Result<Lines<C::Out>, HistoryError> {
        let submodule = |entry: Option<&Entry>| {
            entry
                .filter(|entry| entry.mode == FileMode::Submodule)
                .map(|entry| CommitId(entry.id))
        };
        if old.is_some_and(|e| e.mode == FileMode::Submodule)
            || new.is_some_and(|e| e.mode == FileMode::Submodule)
        {
            return Ok(Lines::Submodule {
                old: submodule(old),
                new: submodule(new),
            });
        }
        // A working tree file's ID is only its index version's.
        if let (Some(old), Some(new)) = (old, new)
            && old.id == new.id
            && sides == Sides::Objects
        {
            return Ok(Lines::Unchanged);
        }

        let roots = match sides {
            Sides::Objects => WorktreeRoots::default(),
            Sides::Worktree => WorktreeRoots {
                old_root: None,
                new_root: Some(self.root().to_path_buf()),
            },
        };
        let mut cache = self
            .gix
            .diff_resource_cache(Mode::ToGit, roots)
            .map_err(HistoryError::from_gix)?;
        let null = gix::ObjectId::null(self.gix.object_hash());
        for (entry, path, kind) in [
            (old, old_path, ResourceKind::OldOrSource),
            (new, new_path, ResourceKind::NewOrDestination),
        ] {
            // A side that isn't there is a null ID, which reads as missing.
            let (id, mode) = entry.map_or((null, EntryKind::Blob), |e| (e.id, e.kind));
            cache
                .set_resource(id, mode, path.into(), kind, &self.gix.objects)
                .map_err(HistoryError::from_gix)?;
        }
        let prepared = cache.prepare_diff().map_err(HistoryError::from_gix)?;
        let algorithm = match prepared.operation {
            Operation::InternalDiff { algorithm } => algorithm,
            // The resource cache is made to diff internally even then.
            Operation::ExternalCommand { .. } => Default::default(),
            Operation::SourceOrDestinationIsBinary => {
                let size = |data: Data<'_>| match data {
                    Data::Missing => None,
                    Data::Buffer { buf, .. } => Some(buf.len() as u64),
                    Data::Binary { size } => Some(size),
                };
                return Ok(Lines::Binary {
                    old_size: size(prepared.old.data),
                    new_size: size(prepared.new.data),
                });
            }
        };

        // Lines keep their endings, so a last line that gained or lost its
        // newline is changed, as `git diff` has it.
        let input = InternedInput::new(prepared.old.intern_source(), prepared.new.intern_source());
        let diff = diff_with_slider_heuristics(algorithm, &input);
        let out = UnifiedDiff::new(&diff, &input, hunks, ContextSize::symmetrical(CONTEXT))
            .consume()
            .map_err(HistoryError::from_gix)?;
        Ok(Lines::Text(out))
    }
}

/// What [`Repository::diff_lines`] finds.
enum Lines<T> {
    /// Both sides are the same object.
    Unchanged,
    /// What the hunks were made into.
    Text(T),
    Binary {
        old_size: Option<u64>,
        new_size: Option<u64>,
    },
    Submodule {
        old: Option<CommitId>,
        new: Option<CommitId>,
    },
}

/// A hunk as [`Hunk`] has it, from its header and its lines as the diff
/// gives them, each with its newline if it has one.
fn hunk(header: &HunkHeader, lines: &[(DiffLineKind, &[u8])]) -> Hunk {
    // A side with no lines starts at the line before the hunk, as `git
    // diff` numbers it: `@@ -0,0 +1,3 @@` for a new file.
    let start = |start: u32, len: u32| {
        if len == 0 {
            start.saturating_sub(1)
        } else {
            start
        }
    };
    Hunk {
        old_start: start(header.before_hunk_start, header.before_hunk_len),
        old_lines: header.before_hunk_len,
        new_start: start(header.after_hunk_start, header.after_hunk_len),
        new_lines: header.after_hunk_len,
        lines: lines
            .iter()
            .map(|&(kind, line)| {
                let (line, no_newline) = match line.strip_suffix(b"\n") {
                    Some(line) => (line, false),
                    None => (line, true),
                };
                DiffLine {
                    kind: line_kind(kind),
                    text: text(line.as_bstr()),
                    no_newline,
                }
            })
            .collect(),
    }
}

fn line_kind(kind: DiffLineKind) -> LineKind {
    match kind {
        DiffLineKind::Context => LineKind::Context,
        DiffLineKind::Add => LineKind::Added,
        DiffLineKind::Remove => LineKind::Removed,
    }
}

/// Finds the hunk that is `wanted`, keeping its bytes.
struct FindHunk<'a> {
    wanted: &'a Hunk,
    found: Option<FoundHunk>,
}

impl ConsumeHunk for FindHunk<'_> {
    type Out = Option<FoundHunk>;

    fn consume_hunk(
        &mut self,
        header: HunkHeader,
        lines: &[(DiffLineKind, &[u8])],
    ) -> std::io::Result<()> {
        if self.found.is_some() || lines.len() != self.wanted.lines.len() {
            return Ok(());
        }
        let found = hunk(&header, lines);
        if found == *self.wanted {
            self.found = Some(FoundHunk {
                old: None,
                new: None,
                old_start: found.old_start,
                old_lines: found.old_lines,
                new_start: found.new_start,
                new_lines: found.new_lines,
                lines: lines
                    .iter()
                    .map(|&(kind, line)| (line_kind(kind), line.to_vec()))
                    .collect(),
            });
        }
        Ok(())
    }

    fn finish(self) -> Option<FoundHunk> {
        self.found
    }
}

/// Collects hunks until there are more than `limit` lines, then only counts.
struct Hunks {
    limit: usize,
    hunks: Vec<Hunk>,
    lines: usize,
    added: usize,
    removed: usize,
}

impl Hunks {
    fn new(limit: usize) -> Self {
        Self {
            limit,
            hunks: Vec::new(),
            lines: 0,
            added: 0,
            removed: 0,
        }
    }
}

impl ConsumeHunk for Hunks {
    type Out = DiffContent;

    fn consume_hunk(
        &mut self,
        header: HunkHeader,
        lines: &[(DiffLineKind, &[u8])],
    ) -> std::io::Result<()> {
        self.lines += lines.len();
        for (kind, _) in lines {
            match kind {
                DiffLineKind::Add => self.added += 1,
                DiffLineKind::Remove => self.removed += 1,
                DiffLineKind::Context => {}
            }
        }
        if self.lines > self.limit {
            self.hunks = Vec::new();
            return Ok(());
        }
        self.hunks.push(hunk(&header, lines));
        Ok(())
    }

    fn finish(self) -> DiffContent {
        if self.lines > self.limit {
            DiffContent::TooLarge {
                lines: self.lines,
                added: self.added,
                removed: self.removed,
            }
        } else {
            DiffContent::Text { hunks: self.hunks }
        }
    }
}
