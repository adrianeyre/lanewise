# An Evaluation corpus replayed from real merges, measured by hand with the owner's own key

PRD §14 asks that a majority of Suggestions on the Evaluation corpus match or nearly match the merge commit, and that low Confidence flags the ones that don't. The corpus is built by replaying real merges from open-source repositories, with what each merge commit has as ground truth. The harness runs by hand with the owner's own API key and never in CI. This ADR records how the corpus is made (`app/scripts/eval/buildCorpus.ts`) and how the harness measures it (`app/scripts/eval/evaluate.ts`). `eval/README.md` says how to run both.

## The corpus is replayed with `git merge-tree` and committed

Git doesn't keep a merge's conflicts, so each merge is replayed. `git merge-tree --write-tree --name-only` merges its two parents without a working tree or index, in a bare clone. With `merge.conflictStyle=diff3`, it writes the Base between the sides, as the Conflicts page reads it (ADR 0018). The conflicted files it writes are then read with `conflictHunks`, the same function the Conflicts page uses, so the corpus holds Conflict Hunks as the app finds them.

Each Conflict Hunk's ground truth is found by diffing the conflicted file against the merge commit's (`git diff --histogram -U0`). The lines that diff leaves unchanged are paired up. A Conflict Hunk is kept only where the line before its `<<<<<<<` and the line after its `>>>>>>>` are both unchanged, or are the file's start or end. Its ground truth is then exactly what lies between them in the merge commit. Any other Conflict Hunk is left out rather than guessed at: a ground truth that might be wrong would mis-score a right Suggestion. Also left out are Conflict Hunks committed with their Conflict Markers, those with a side or ground truth over 80 lines, binary files, generated files such as lockfiles, and files over 20,000 lines. Each kept Conflict Hunk records how the merge resolved it: as Ours, Theirs, one then the other, or written anew. That way the report can show where Suggestions do well and where they don't.

The repositories are listed in `eval/repositories.json`, each pinned to a commit, and their merges are replayed newest first from it. There are 3 Conflict Hunks at most from one merge and 20 from one repository, so no one merge or repository outweighs the rest. The six chosen (flask, click, werkzeug, sphinx, express and tokio) are permissively licensed. Between them they cover Python, JavaScript and Rust, code and prose, and hold 120 Conflict Hunks.

The corpus is committed in `eval/corpus/` rather than fetched each run. At about a megabyte, it's small because each file keeps only its Conflict Hunks and as much context round them as Settings can send (200 lines). Committing it means every run measures the same Conflict Hunks, and changes to it are reviewed like code. Each repository's licence is copied beside its file, and `eval/corpus/README.md`, which `corpusReadme` generates, credits each one with the commit it was read back from. A test checks that the committed corpus matches the list and that each Conflict Hunk is found again in its file. It also checks that the README is the one the corpus would generate.

## The harness asks as the AI Suggestion Widget does

Each Suggestion is asked for through the app's own pipeline and nothing else, so the evaluation measures what users get. `suggestionRequest` builds each request from the conflicted file, with the paths and both sides' subjects. The Model Provider's adapter sends it with the model and Effort chosen, as Settings resolves them (`selectionFor`, with the bundled model catalog). `checkSuggestion` checks each answer. The requests go one at a time, as ADR 0026 has them. A failure that `failsOnlyThisRequest` says is that Conflict Hunk's own is recorded and the run goes on. Any other failure stops the run, as would Ctrl-C.

A Suggestion is an **exact match** if its lines equal the ground truth, less the trailing newline `putSuggestion` drops. It's a **near match** if they're equal once each line is trimmed, runs of whitespace are made one space and blank lines are left out. Otherwise it's a **mismatch**. How well Confidence flags the mismatches is reported as a table of Confidence against match. It also says how many mismatches were low, how many matches were low anyway, and how many of the low ones were mismatches. This is shown for both the Confidence the user would see and the one the model reported, since `checkSuggestion` can make a Suggestion low on its own.

## It's run by hand, with its cost shown first

The harness never runs in CI or in a test. It refuses where `CI` or `GITHUB_ACTIONS` is set and where stdin isn't a terminal. It isn't a test file, and nothing in `pnpm test` calls a real Model Provider: its tests use the fake Model Provider, and a local Git repository made for each test. The key is read only from the Model Provider's `LANEWISE_…_API_KEY` variable, never from one an SDK reads by itself. The table of those variables (`app/scripts/providers.ts`) is shared with the `try:` scripts.

Before anything is sent but the model-list request, which costs nothing, it prints the model version, Effort and context it will ask with. It also prints an estimate of the tokens and their cost at the prices given, and waits for `yes`. Prices aren't built in, since they change and differ by model. A cloud Model Provider needs `--input-price` and `--output-price`, and the script says where they're published. The estimate counts about 3 characters to a token. It allows for as much thinking as the model's token budget or Effort permits, with a default counted as High, so it errs high.

## Consequences

- The corpus measures what Git's replay can recover. Merges resolved by rebasing or squashing leave no merge commit and aren't in it. A Conflict Hunk whose surroundings the merge also changed is left out, so the corpus leans towards Conflict Hunks resolved in place.
- A Suggestion that means the same as the ground truth but is written differently is a mismatch. Exact and near matches are a floor on how often Suggestions are right, not a measure of it.
- Replaying with a newer Git could split or join Conflict Hunks differently. The corpus records the Git it was made with, and remaking it is a reviewed change.
- The results in `eval/results/` aren't committed, since each run spends the owner's money and their results are theirs to share.

## Still to check by hand

- Running the evaluation (#40): with a real Model Provider and the owner's own key, the estimate is close to what's charged, Ctrl-C stops partway and reports, and the results are read against PRD §14.
- Running `pnpm eval:corpus` from scratch on Windows and macOS gives the same corpus.
