//! What the commands that run `git` for as long as the network takes share:
//! each runs on a thread of its own, is followed by a long poll for its
//! progress, and can be cancelled (ADR 0012). A clone is one; a fetch, pull
//! or push is another (ADR 0013).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use lanewise_core::{Cancel, Progress};
use serde::Serialize;

/// How often a run's progress wakes a long poll at most: often enough to
/// look live, and seldom enough not to redraw the UI for every object.
/// A new phase, or one finishing, always does.
pub(crate) const PROGRESS_EVERY: Duration = Duration::from_millis(100);

/// How long a finished run's outcome is kept for its long poll to give, in
/// case the UI missed it.
const KEPT_FOR: Duration = Duration::from_secs(60);

/// One progress update from `git`, such as `Receiving objects: 45%
/// (450/1000)`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitProgress {
    /// What Git is doing, in its own words and language: `Receiving objects`.
    pub phase: String,
    /// Whether the Host reported it, rather than the local `git`.
    pub remote: bool,
    pub done: u64,
    /// How many there are to do, if Git knows.
    pub total: Option<u64>,
    /// Git's own percentage, when it gives one.
    pub percent: Option<u8>,
    /// Whether the phase is done.
    pub finished: bool,
}

impl From<Progress> for GitProgress {
    fn from(progress: Progress) -> Self {
        Self {
            phase: progress.phase,
            remote: progress.remote,
            done: progress.done,
            total: progress.total,
            percent: progress.percent,
            finished: progress.finished,
        }
    }
}

/// Where a run is, as its long poll gives it.
pub(crate) trait RunState: Clone {
    /// A run just started, with no progress yet.
    fn started() -> Self;

    /// The latest progress, if the run is still going, to replace.
    fn progress(&mut self) -> Option<&mut Option<GitProgress>>;
}

/// The runs of one kind started, each kept until [`KEPT_FOR`] after it
/// finished, and each with `A`, what it's about.
pub(crate) struct Runs<A, S> {
    next: AtomicU64,
    runs: Mutex<Vec<Arc<Run<A, S>>>>,
}

impl<A, S: RunState> Runs<A, S> {
    pub(crate) const fn new() -> Self {
        Self {
            next: AtomicU64::new(1),
            runs: Mutex::new(Vec::new()),
        }
    }

    pub(crate) fn start(&self, about: A) -> Arc<Run<A, S>> {
        let run = self.started(about);
        self.kept().push(Arc::clone(&run));
        run
    }

    /// Starts a run unless `busy` says one of those kept is still going,
    /// which it gives instead.
    pub(crate) fn start_unless(
        &self,
        about: A,
        busy: impl Fn(&A) -> bool,
    ) -> Result<Shared<A, S>, Shared<A, S>> {
        let mut runs = self.kept();
        if let Some(running) = runs
            .iter()
            .find(|run| busy(&run.about) && run.kept().finished.is_none())
        {
            return Err(Arc::clone(running));
        }
        let run = self.started(about);
        runs.push(Arc::clone(&run));
        Ok(run)
    }

    pub(crate) fn find(&self, id: u64) -> Option<Arc<Run<A, S>>> {
        self.kept().iter().find(|run| run.id == id).cloned()
    }

    /// The last run `about` matches that's still going.
    pub(crate) fn running(&self, about: impl Fn(&A) -> bool) -> Option<Arc<Run<A, S>>> {
        self.kept()
            .iter()
            .rev()
            .find(|run| about(&run.about) && run.kept().finished.is_none())
            .cloned()
    }

    fn started(&self, about: A) -> Arc<Run<A, S>> {
        Arc::new(Run {
            id: self.next.fetch_add(1, Ordering::Relaxed),
            about,
            cancel: Cancel::new(),
            kept: Mutex::new(Kept {
                generation: 1,
                state: S::started(),
                woke: Instant::now(),
                finished: None,
            }),
            changed: Condvar::new(),
        })
    }

    /// The runs, without any that finished more than [`KEPT_FOR`] ago.
    fn kept(&self) -> MutexGuard<'_, Vec<Arc<Run<A, S>>>> {
        let mut runs = self.runs.lock().unwrap_or_else(PoisonError::into_inner);
        runs.retain(|run| {
            run.kept()
                .finished
                .is_none_or(|finished| finished.elapsed() < KEPT_FOR)
        });
        runs
    }
}

/// A run, as the thread running it and its long polls each hold it.
pub(crate) type Shared<A, S> = Arc<Run<A, S>>;

/// One run.
pub(crate) struct Run<A, S> {
    pub(crate) id: u64,
    pub(crate) about: A,
    pub(crate) cancel: Cancel,
    kept: Mutex<Kept<S>>,
    /// Wakes the long polls waiting on it.
    changed: Condvar,
}

struct Kept<S> {
    generation: u64,
    state: S,
    /// When the long polls were last woken.
    woke: Instant,
    finished: Option<Instant>,
}

impl<A, S: RunState> Run<A, S> {
    fn kept(&self) -> MutexGuard<'_, Kept<S>> {
        self.kept.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Keeps Git's latest progress, waking the long polls if it's a new
    /// phase or one finishing, or if they haven't been woken for
    /// [`PROGRESS_EVERY`].
    pub(crate) fn progressed(&self, progress: Progress) {
        let mut kept = self.kept();
        let Some(last) = kept.state.progress() else {
            return;
        };
        let moved_on = last.as_ref().is_none_or(|last| {
            last.phase != progress.phase
                || last.remote != progress.remote
                || last.finished != progress.finished
        });
        *last = Some(progress.into());
        if moved_on || kept.woke.elapsed() >= PROGRESS_EVERY {
            self.wake(&mut kept);
        }
    }

    pub(crate) fn finish(&self, state: S) {
        let mut kept = self.kept();
        kept.state = state;
        kept.finished = Some(Instant::now());
        self.wake(&mut kept);
    }

    fn wake(&self, kept: &mut Kept<S>) {
        kept.generation += 1;
        kept.woke = Instant::now();
        self.changed.notify_all();
    }

    /// The generation and state of the run: now, or once it has moved on
    /// from `seen`, or after `longest` as it was.
    pub(crate) fn report(&self, seen: Option<u64>, longest: Duration) -> (u64, S) {
        let mut kept = self.kept();
        if let Some(seen) = seen {
            kept = self
                .changed
                .wait_timeout_while(kept, longest, |kept| kept.generation == seen)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
        (kept.generation, kept.state.clone())
    }
}

#[cfg(test)]
mod tests {
    use std::thread;

    use super::*;

    #[derive(Clone, Debug, PartialEq, Eq)]
    enum State {
        Running { progress: Option<GitProgress> },
        Done,
    }

    impl RunState for State {
        fn started() -> Self {
            Self::Running { progress: None }
        }

        fn progress(&mut self) -> Option<&mut Option<GitProgress>> {
            match self {
                Self::Running { progress } => Some(progress),
                Self::Done => None,
            }
        }
    }

    fn progress(phase: &str, done: u64, finished: bool) -> Progress {
        Progress {
            phase: phase.into(),
            remote: false,
            done,
            total: Some(100),
            percent: Some(done as u8),
            finished,
        }
    }

    #[test]
    fn progress_wakes_long_polls_for_a_new_phase_or_a_finished_one_and_otherwise_now_and_then() {
        let runs = Runs::<(), State>::new();
        let run = runs.start(());
        let generation = |run: &Run<(), State>| run.kept().generation;
        let start = generation(&run);

        run.progressed(progress("Receiving objects", 1, false));
        assert_eq!(generation(&run), start + 1);
        run.progressed(progress("Receiving objects", 2, false));
        assert_eq!(generation(&run), start + 1, "too soon to wake again");
        // The latest is kept all the same, for the next report.
        assert_eq!(
            run.report(None, Duration::ZERO).1,
            State::Running {
                progress: Some(progress("Receiving objects", 2, false).into())
            }
        );
        run.progressed(progress("Receiving objects", 100, true));
        assert_eq!(generation(&run), start + 2);
        run.progressed(progress("Resolving deltas", 1, false));
        assert_eq!(generation(&run), start + 3);
        thread::sleep(PROGRESS_EVERY);
        run.progressed(progress("Resolving deltas", 2, false));
        assert_eq!(generation(&run), start + 4);

        run.finish(State::Done);
        run.progressed(progress("Resolving deltas", 3, false));
        assert_eq!(
            run.report(Some(start), Duration::ZERO),
            (start + 5, State::Done)
        );
    }

    #[test]
    fn a_long_poll_answers_when_the_run_moves_on() {
        let runs = Runs::<(), State>::new();
        let run = runs.start(());
        let seen = run.report(None, Duration::ZERO).0;
        let finishing = Arc::clone(&run);
        let finisher = thread::spawn(move || {
            thread::sleep(Duration::from_millis(50));
            finishing.finish(State::Done);
        });

        let report = run.report(Some(seen), Duration::from_secs(10));
        finisher.join().unwrap();

        assert_eq!(report.1, State::Done);
        assert_ne!(report.0, seen);
        assert_eq!(
            run.report(Some(report.0), Duration::from_millis(10)),
            report,
            "with nothing new, it answers as it was"
        );
    }

    #[test]
    fn one_run_at_a_time_for_the_same_thing_and_found_while_it_runs() {
        let runs = Runs::<&str, State>::new();
        let started = |about| runs.start_unless(about, |kept| *kept == about).ok();
        let first = started("a").expect("nothing is running for a");
        let other = started("b").expect("nothing is running for b");

        let busy = runs.start_unless("a", |kept| *kept == "a").err();
        assert_eq!(busy.map(|run| run.id), Some(first.id));
        assert_eq!(
            runs.running(|about| *about == "a").map(|run| run.id),
            Some(first.id)
        );
        assert!(runs.find(other.id).is_some());

        first.finish(State::Done);
        assert!(runs.running(|about| *about == "a").is_none());
        // Finished, it's still found by its number, for its outcome.
        assert!(runs.find(first.id).is_some());
        assert!(started("a").is_some());
    }
}
