# The model catalog

`models.json` describes the models each Model Provider's live model list returns: which model and version each model ID is, and the Effort levels it takes (PRD §8.3, ADR 0021). The live lists decide which models exist. The catalog only describes them, so a model it doesn't know is still offered, under Other versions, with only the Model Provider's default Effort.

Lanewise is built with this copy, and each run fetches the one on `main` from `https://raw.githubusercontent.com/adrianeyre/lanewise/main/catalog/models.json`, so a change here reaches everyone without a release. A copy that can't be fetched, or that's wrong anywhere, is ignored for the one Lanewise was built with.

`models.schema.json` is its JSON Schema. `app/src/ai/modelCatalog.test.ts` checks the catalog against it, and checks what the schema can't say.

## Its shape

Under `providers`, each Model Provider's section is named by its adapter's `catalog`: `anthropic`, `gemini`, `openai`, `xai`, `meta` and `local`, for servers on the user's computer.

- **`exclude`**: patterns for model IDs that can't be chatted with, such as image, speech and embedding models. They aren't offered at all.
- **`families`**: the models the picker offers, in order. Each has an `id`, kept in Settings as the model chosen, so it must never change, and a `name`.
- **`versions`**: each model's versions, newest first. Each has:
  - `match`: a regular expression for the model IDs that are this version, matched against the whole ID, so it needs no `^` or `$`. A model ID is the first version, in any family, whose pattern it matches. Several IDs can match one version, such as a dated snapshot and its alias, and the newest of them comes first.
  - `examples`: model IDs this version is. The tests check that each is matched by this version and by none before it.
  - `name`: the version's name, where the Model Provider's list gives none. Claude's and Gemini's lists give their own.
  - `efforts`: the Effort levels it takes, least first, from `off`, `minimal`, `low`, `medium`, `high`, `extraHigh` and `maximum`. They're shown as Off, Minimal, Low, Medium, High, Extra high and Maximum. Empty where it takes none. Where the Model Provider's list reports its own levels, as Anthropic's does, those are offered instead.
  - `defaultEffort`: the Model Provider's own default among `efforts`. It's `null` where the model takes none, or where the default isn't one of the levels, such as Gemini 2.5 Flash's dynamic thinking.
  - `budgets`: for a model that takes a token budget rather than a level, such as Gemini 2.5, the budget each of `efforts` is sent as, for each of them and no other.

Each level is written as the Model Provider's API names it:

| Effort | Anthropic `effort` | Gemini `thinkingLevel` | OpenAI-compatible `reasoning_effort` |
| --- | --- | --- | --- |
| `off` | | | `none` |
| `minimal` | | `minimal` | `minimal` |
| `low` | `low` | `low` | `low` |
| `medium` | `medium` | `medium` | `medium` |
| `high` | `high` | `high` | `high` |
| `extraHigh` | `xhigh` | | `xhigh` |
| `maximum` | `max` | | `max` |

## Adding a model

Add a version to its family, above the older ones, with its Model Provider's documented levels and default, and an example of its ID. Add a family for a new model. A model left out isn't lost: it's offered under Other versions until it's added. Keep `format` at `1` unless the shape changes in a way an older Lanewise couldn't read. That older Lanewise then keeps the copy it was built with.
