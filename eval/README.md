# The Suggestion evaluation

PRD §14 asks that a majority of Suggestions on the Evaluation corpus match or nearly match their ground truth, and that low Confidence flags the ones that don't. This folder holds that corpus and the results of measuring it. The scripts are in `app/scripts/eval/`, and ADR 0027 says why they work as they do.

- `repositories.json`: the open-source repositories the corpus comes from, each pinned to a commit, with its licence and how many of its merges to replay.
- `corpus/`: the Evaluation corpus, one JSON file per repository with its licence beside it, and a README crediting each one. It's made by `pnpm eval:corpus` and committed; don't edit it by hand.
- `results/`: what each run of the harness wrote. It isn't committed.
- `.repositories/`: the bare clones `pnpm eval:corpus` replays merges in. It isn't committed.

## Making the corpus

```sh
pnpm eval:corpus [--only <repository>] [--cache <folder>]
```

This clones each repository in `repositories.json` bare into `.repositories/`, or fetches it again if the commit it's pinned to is missing. Then it replays up to that many of its merges, newest first from that commit, with `git merge-tree --write-tree` and the Base shown (`merge.conflictStyle=diff3`). This regenerates the conflicts each merge had, which Git never kept.

Each Conflict Hunk is kept with its ground truth, the lines the merge commit has in its place. A Conflict Hunk is kept only where:

- the lines just before and after its Conflict Markers are unchanged in the merge commit, or are the file's start or end, so its place is certain;
- its ground truth has no Conflict Markers left in it;
- each side and its ground truth has at most 80 lines;
- the file is text, isn't generated (such as a lockfile), and has at most 20,000 lines.

At most 3 Conflict Hunks come from one merge and 20 from one repository, and a Conflict Hunk met again in a later merge is kept once. Each file keeps its Conflict Hunks with as many lines round them as the most context Settings allows (200). The corpus reads the same each time it's made from the same commits with the same Git.

A repository added to `repositories.json` has to allow its files to be copied under a licence named in its `licence` and `licenceFile`, which is copied beside it.

## Running the evaluation

The harness is run by hand, in a terminal, with your own API key. It never runs in CI or in a test, and refuses to where `CI` or `GITHUB_ACTIONS` is set, or where it has no terminal to ask in.

```sh
LANEWISE_ANTHROPIC_API_KEY=sk-ant-… pnpm eval:suggestions anthropic --input-price <dollars> --output-price <dollars> [options]
LANEWISE_GEMINI_API_KEY=AIza… pnpm eval:suggestions gemini --input-price … --output-price … [options]
LANEWISE_OPENAI_API_KEY=sk-… pnpm eval:suggestions openai --input-price … --output-price … [options]
LANEWISE_XAI_API_KEY=xai-… pnpm eval:suggestions xai --input-price … --output-price … [options]
LANEWISE_META_API_KEY=… pnpm eval:suggestions meta --input-price … --output-price … [options]
pnpm eval:suggestions local [--base-url http://localhost:11434/v1] [options]
```

The key is read only from that Model Provider's `LANEWISE_…_API_KEY` variable, never from `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or any other variable an SDK knows. That way a key or gateway that happens to be set can't be used by mistake. A local server is sent `LANEWISE_LOCAL_API_KEY` only if it's set.

| Option | What it does |
| --- | --- |
| `--model <id>` | The model version to ask. Without it, the newest version of the first model the model catalog describes. |
| `--effort <level>` | `off`, `minimal`, `low`, `medium`, `high`, `extraHigh` or `maximum`. A version that doesn't take it gets its default, as Settings has it. Without it, the model's default. |
| `--context <lines>` | The lines of context sent before and after each Conflict Hunk, 0 to 200. Without it, 20, as Settings has it. |
| `--only <repository>` | Only the Conflict Hunks from that repository. |
| `--limit <count>` | Only the first `count` Conflict Hunks, taken from each repository in turn. |
| `--input-price`, `--output-price` | The Model Provider's price for the model, in US dollars per million tokens in and out. A cloud Model Provider needs them, and the script says where they're published. |
| `--base-url <url>` | For `local`: the server on this computer, with its port. |

It first reads the Model Provider's model list, which costs nothing. Then it prints what it would ask: how many Suggestions, from which model version, at which Effort, with how much context. It also prints an estimate of the tokens and what they'd cost. It sends nothing more until you type `yes`.

The estimate counts about 3 characters to a token. Input is each request's instructions, schema and prompt. Output is an answer as long as both sides with a margin, plus the most the model may think: its token budget, or 512 to 32,768 tokens by Effort, with a model's default counted as High. That makes it high rather than low. A Model Provider's own tokenizer and prices decide what's actually charged.

Each Suggestion is asked for as the AI Suggestion Widget asks for it (ADR 0025): with the same request, prompt, Model Provider adapter and checks, one at a time. A failure that's that Conflict Hunk's own, such as an answer that couldn't be read, is recorded and the run goes on. Any other failure, such as a refused key or a rate limit, would fail the rest too, so the run stops there and the rest aren't asked. Ctrl-C stops it the same way, and what came back is still reported.

## What's reported

The report is printed and written to `results/`, as Markdown beside a JSON file that holds every Suggestion. It gives:

- how many Suggestions were an **exact match** for their ground truth, line for line; a **near match**, equal once each line is trimmed, runs of spaces made one and blank lines left out; or a **mismatch**, with the Conflict Hunks that got no Suggestion or weren't asked;
- whether that's the majority PRD §14 asks for;
- **how well Confidence flagged the mismatches**: Confidence against exact, near and mismatch, how many mismatches were low, how many matches were low too, and how many of the low ones were mismatches. This is given once as the Suggestion is shown, after `checkSuggestion`'s checks, and once as the model reported it, with how many the checks made low;
- the same by how the merge resolved each Conflict Hunk (Ours, Theirs, both, or written anew) and by repository.

## Credits

Every Conflict Hunk in `corpus/` is the work of its repository's authors, copied under that repository's licence, which is kept beside its file. `corpus/README.md` lists each repository, its licence and the commit its merges were read back from.
