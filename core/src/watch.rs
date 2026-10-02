//! Watching a working tree for the changes that change its status: its
//! files, and the index, refs and config in its Git folder (PRD §7.3). The
//! config has the remotes and each branch's Upstream (ADR 0014).

use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use gix::index::entry::Mode;
use gix::worktree::stack::state::ignore::Source;
use notify::{Event, EventKind, RecursiveMode, Watcher as _};

use crate::Repository;

/// How long the files must be still before a change counts: a checkout or
/// a build writes many files at once, and they're one change.
const QUIET: Duration = Duration::from_millis(100);
/// The longest a change waits for the files to be still, so a working tree
/// that never is still refreshes all the same.
const MOST_WAIT: Duration = Duration::from_millis(500);

/// Every watcher's generations are from this one count, so no two
/// watchers, such as one and the one that replaces it, share one.
static GENERATIONS: AtomicU64 = AtomicU64::new(1);

/// Watches a working tree until it's dropped. Each change to a file Git
/// doesn't ignore, or to the index, refs or config, is a new generation: a
/// number unlike any before it.
pub struct Watcher {
    shared: Arc<Shared>,
    _watcher: notify::RecommendedWatcher,
}

struct Shared {
    generation: Mutex<u64>,
    changed: Condvar,
}

impl Shared {
    fn change(&self) {
        let mut generation = self.generation.lock().unwrap_or_else(|e| e.into_inner());
        *generation = GENERATIONS.fetch_add(1, Ordering::Relaxed);
        self.changed.notify_all();
    }
}

/// The working tree couldn't be watched.
#[derive(Debug, thiserror::Error)]
#[error("the working tree could not be watched: {message}")]
pub struct WatchError {
    pub message: String,
}

impl Watcher {
    /// Starts watching `repository`'s working tree, and its Git folder if
    /// that's elsewhere.
    pub fn watch(repository: &Repository) -> Result<Self, WatchError> {
        let failed = |error: notify::Error| WatchError {
            message: error.to_string(),
        };
        let shared = Arc::new(Shared {
            generation: Mutex::new(GENERATIONS.fetch_add(1, Ordering::Relaxed)),
            changed: Condvar::new(),
        });
        let (events, received) = mpsc::channel();
        let mut watcher = notify::recommended_watcher(move |event| {
            // Once the watcher is dropped, no one is listening.
            let _ = events.send(event);
        })
        .map_err(failed)?;
        let places = Places::of(repository);
        for folder in places.watched() {
            watcher
                .watch(&folder, RecursiveMode::Recursive)
                .map_err(failed)?;
        }
        let gix = repository.gix.clone().into_sync();
        thread::spawn({
            let shared = Arc::clone(&shared);
            move || debounce(places, gix.to_thread_local(), received, &shared)
        });
        Ok(Self {
            shared,
            _watcher: watcher,
        })
    }

    /// The generation the working tree is at now.
    pub fn generation(&self) -> u64 {
        *self
            .shared
            .generation
            .lock()
            .unwrap_or_else(|e| e.into_inner())
    }

    /// Waits until the working tree is at a generation other than `seen`,
    /// or `timeout` passes, and returns the one it's at then.
    pub fn wait_for_change(&self, seen: u64, timeout: Duration) -> u64 {
        let generation = self
            .shared
            .generation
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let (generation, _) = self
            .shared
            .changed
            .wait_timeout_while(generation, timeout, |generation| *generation == seen)
            .unwrap_or_else(|e| e.into_inner());
        *generation
    }
}

/// Counts changes as the working tree settles, until the watcher is gone.
fn debounce(
    places: Places,
    gix: gix::Repository,
    received: mpsc::Receiver<notify::Result<Event>>,
    shared: &Shared,
) {
    let mut filter = Filter {
        places,
        gix: &gix,
        excludes: None,
    };
    while let Ok(event) = received.recv() {
        if !filter.counts(event) {
            continue;
        }
        let started = Instant::now();
        let mut quiet_from = started;
        loop {
            let until = (quiet_from + QUIET).min(started + MOST_WAIT);
            let Some(wait) = until
                .checked_duration_since(Instant::now())
                .filter(|wait| !wait.is_zero())
            else {
                break;
            };
            match received.recv_timeout(wait) {
                Ok(event) => {
                    if filter.counts(event) {
                        quiet_from = Instant::now();
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
        }
        shared.change();
    }
}

/// Where a repository's working tree and Git folders are, each as it is
/// and as the file system names it, which may differ, as `/var` and
/// `/private/var` do on macOS.
struct Places {
    root: Vec<PathBuf>,
    git_dirs: Vec<PathBuf>,
}

impl Places {
    fn of(repository: &Repository) -> Self {
        let both = |path: &Path| {
            let mut paths = vec![path.to_path_buf()];
            if let Ok(canonical) = path.canonicalize()
                && canonical != path
            {
                paths.push(canonical);
            }
            paths
        };
        let mut git_dirs = both(repository.gix.git_dir());
        if repository.gix.common_dir() != repository.gix.git_dir() {
            git_dirs.extend(both(repository.gix.common_dir()));
        }
        Self {
            root: both(repository.root()),
            git_dirs,
        }
    }

    /// The folders to watch: the working tree, and each Git folder outside
    /// it.
    fn watched(&self) -> Vec<PathBuf> {
        let mut folders = vec![self.root[0].clone()];
        for git_dir in &self.git_dirs {
            if !self.root.iter().any(|root| git_dir.starts_with(root))
                && !folders.iter().any(|folder| git_dir.starts_with(folder))
                && git_dir.is_dir()
            {
                folders.push(git_dir.clone());
            }
        }
        folders
    }
}

/// Which changes count: not reads, not what Git ignores, and in the Git
/// folder only the index, refs and config.
struct Filter<'repo> {
    places: Places,
    gix: &'repo gix::Repository,
    /// The ignore rules, read when first needed and again once a
    /// `.gitignore` file or the index has changed.
    excludes: Option<gix::AttributeStack<'repo>>,
}

impl Filter<'_> {
    fn counts(&mut self, event: notify::Result<Event>) -> bool {
        // An error, or events the watcher lost, may hide a change.
        let Ok(event) = event else {
            return true;
        };
        if event.need_rescan() || event.paths.is_empty() {
            return true;
        }
        if matches!(event.kind, EventKind::Access(_)) {
            return false;
        }
        let mut counts = false;
        for path in &event.paths {
            counts |= self.path_counts(path);
        }
        counts
    }

    fn path_counts(&mut self, path: &Path) -> bool {
        if let Some(in_git_dir) = within(&self.places.git_dirs, path) {
            let in_git_dir = slashed(&in_git_dir);
            let in_git_dir = in_git_dir.as_slice();
            // Git writes a file as a lock, then renames it into place.
            if in_git_dir.ends_with(b".lock") {
                return false;
            }
            let counts = matches!(
                in_git_dir,
                b"index" | b"HEAD" | b"packed-refs" | b"info/exclude" | b"config"
            ) || in_git_dir.starts_with(b"refs/");
            if matches!(in_git_dir, b"index" | b"info/exclude") {
                self.excludes = None;
            }
            return counts;
        }
        let Some(in_root) = within(&self.places.root, path) else {
            return false;
        };
        // A linked worktree's `.git` is a file naming its Git folder.
        if in_root.components().next() == Some(Component::Normal(".git".as_ref())) {
            return false;
        }
        if in_root.file_name() == Some(".gitignore".as_ref()) {
            self.excludes = None;
            return true;
        }
        !self.ignored(&in_root, path.is_dir())
    }

    /// Whether Git ignores the file at `path` in the working tree, or the
    /// folder it's in, and it isn't tracked all the same. If that can't be
    /// read, it isn't. `is_dir` is whether it's a folder, as a pattern such
    /// as `target/` only matches one.
    fn ignored(&mut self, path: &Path, is_dir: bool) -> bool {
        let Ok(index) = self.gix.index_or_empty() else {
            return false;
        };
        if index
            .entry_by_path(slashed(path).as_slice().into())
            .is_some()
        {
            return false;
        }
        if self.excludes.is_none() {
            self.excludes = self
                .gix
                .excludes(&index, None, Source::WorktreeThenIdMappingIfNotSkipped)
                .ok();
        }
        let Some(excludes) = &mut self.excludes else {
            return false;
        };
        let mut folders: Vec<&Path> = path.ancestors().skip(1).collect();
        // The last is the working tree's top folder, as `""`.
        folders.pop();
        folders.reverse();
        let excluded = |excludes: &mut gix::AttributeStack<'_>, path: &Path, mode| {
            excludes
                .at_path(path, mode)
                .is_ok_and(|platform| platform.is_excluded())
        };
        folders
            .into_iter()
            .any(|folder| excluded(excludes, folder, Some(Mode::DIR)))
            || excluded(excludes, path, is_dir.then_some(Mode::DIR))
    }
}

/// `path` from inside whichever of `folders` it's in, if any.
fn within(folders: &[PathBuf], path: &Path) -> Option<PathBuf> {
    folders
        .iter()
        .find_map(|folder| path.strip_prefix(folder).ok())
        .map(Path::to_path_buf)
}

/// A relative path as Git has it, with `/` between folders.
fn slashed(path: &Path) -> Vec<u8> {
    gix::path::to_unix_separators_on_windows(gix::path::into_bstr(path))
        .into_owned()
        .into()
}
