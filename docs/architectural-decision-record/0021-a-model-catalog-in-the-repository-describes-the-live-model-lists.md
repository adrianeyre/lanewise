# A model catalog in the repository describes the live model lists

The PRD says the user picks a model, then its version, newest first and newest by default, then an Effort from the levels that model supports. The lists come live from each Model Provider's model-list API, with a Refresh models action, and nothing is hard-coded, so new models appear without a release (§8.2). Claude's and Gemini's APIs give names and, for Claude, Effort levels. OpenAI's, xAI's and Meta's give little more than an ID. So a model catalog in `adrianeyre/lanewise` maps model ID patterns to a model, a version and its Effort levels. Lanewise ships with a copy and refreshes it from the repository. A model missing from it appears under Other versions with only the Model Provider's default Effort (§8.3). This ADR records the catalog's shape, how it's fetched and trusted, and how a live list and the catalog become the picker.

## The catalog is JSON with a schema, and Lanewise checks every copy as strictly

`catalog/models.json` has a section for each Model Provider adapter: `anthropic`, `gemini`, `openai`, `xai`, `meta` and `local`, for servers on the user's computer. Each section holds exclusion patterns, for image, speech, embedding and other models that can't be chatted with, and families. A family is a model, such as Claude Opus or Gemini Flash, with its versions newest first. Each version has:

- a pattern matched against the whole model ID
- examples of IDs it matches
- a name, for lists that give none
- its Effort levels, least first, and the Model Provider's default among them, or `null` where there's none, or the default isn't a level, such as Gemini 2.5's dynamic thinking
- for Gemini 2.5, the token budget each level is sent as

`catalog/models.schema.json` is its JSON Schema (draft 2020-12). `catalog/README.md` says how to add a model.

`parseCatalog` (`app/src/ai/modelCatalog.ts`) reads a copy and refuses it whole if anything is wrong. It checks what the schema checks, and what a schema can't say: levels in order, the default among them, a budget for each level and no other, and each family's ID used once. A copy in any format but 1 is refused too, so a later shape never half-works in an older Lanewise. The tests validate the repository's catalog against the schema with Ajv, check that broken copies are refused by both, and check that each version's examples resolve to that version, not an earlier one, and aren't excluded. Ajv is a devDependency only: the app itself doesn't need a schema validator.

The bundled copy is imported at build time. It's checked when the app starts, and the tests make sure it passes.

## It's fetched once a run, and again on Refresh models, falling back to the bundled copy

`fetchCatalog` fetches `https://raw.githubusercontent.com/adrianeyre/lanewise/main/catalog/models.json` through the platform's `fetch`, with nothing sent: no API key, no headers and nothing about the user's repositories. It's only fetched when models are listed, so only with AI on and a Model Provider's First-use disclosure accepted. While AI is off, Lanewise makes no request at all, and Settings' note on AI says the catalog is fetched from GitHub once it's on. The bundled copy is used instead if the fetch fails, as it does offline, or takes more than 10 seconds, isn't JSON, or isn't a catalog this Lanewise reads.

`catalogSource` keeps the fetch for the run: Settings holds one source for as long as the app is open, and each Refresh models fetches afresh, then lists the models. A fetched copy isn't kept in local storage, so a run offline starts from the bundled copy again. The Cookie Policy's list of what's kept doesn't change.

The URL is in the HTTP plugin's scope in `desktop/capabilities/default.json`, as exactly that file, not the whole host.

## A live list and the catalog become the picker

An adapter's `listModels` now returns what the API says (`ListedModel`): each ID, and its name, release date and Effort levels where the API gives them, `null` where it doesn't. Each adapter names its section as `catalog`. `modelLists.ts` reads each API's answer:

- **`anthropicModels`** reads `GET /v1/models`: the display name, `created_at`, and the levels `capabilities.effort` reports, where `xhigh` and `max` become Extra high and Maximum.
- **`geminiModels`** reads `models.list`: the models that can `generateContent`, without their `models/` prefix, with their display name. A model that reports `thinking: false` takes no Effort.
- **`openAiModels`** reads the OpenAI-compatible `GET /models`, as OpenAI, xAI, Meta and local servers answer it: an ID and a creation time.

Each of the first two says where its next page starts. Asking for each page in turn comes with the adapters: Anthropic's is ADR 0022, Gemini's is ADR 0023, and the OpenAI-compatible adapter's, whose `GET /models` isn't paged, is ADR 0024.

`describeModels` groups a list into the section's families. Excluded IDs are dropped, and each ID goes to the first version whose pattern it matches. Families keep the catalog's order. Versions are ordered as the catalog orders them, then newest release first, then by ID with numbers compared as numbers, so `v10` comes before `v9`. Where the Model Provider gives a name or levels, they're used: Claude and Gemini keep their own names, and Claude its own levels. Otherwise the catalog's are used, and the catalog's default holds only if it's among the levels offered. Two versions named alike, such as a snapshot and its alias, have their IDs added to tell them apart.

An ID no version matches is put in a model of its own, Other versions, last and newest first, with `efforts: null`: Settings says the catalog doesn't describe it yet and that the Model Provider's default Effort is used, and `selectionFor` never sends it another. That holds even for a Claude model whose API reports levels, as the PRD says. `other-versions` is reserved, so no family can take its ID.

A chosen Effort that has a budget is sent with it: `ModelSelection` carries `budget`, for the Gemini adapter to send as `thinkingBudget`. The Effort select shows the model's own levels in plain words, Off, Minimal, Low, Medium, High, Extra high and Maximum, and "{Model Provider}'s default", with the level where the catalog knows it. It's never one Lanewise scale mapped onto every model. The model, version and Effort are native selects and Refresh models a button, so each is reached with Tab and chosen with the arrow keys, Enter or Space.

## Consequences

- A new model is described by a change to `catalog/models.json` on `main`, with no release. Until then it's still offered, under Other versions.
- A catalog pattern that's too broad would describe a model wrongly. The examples tests catch a pattern that swallows a later version's IDs, but not one that swallows a model no example names.
- The levels and defaults are taken from each Model Provider's documentation as of September 2026. Some aren't documented, so the catalog records its best reading: `null` for GPT-6 Astra's and Muse Spark's defaults, GPT-5.6's levels following GPT-5.5's, and Gemini 3.1 Flash-Lite's following 3.5 Flash-Lite's. The adapters (M6) are where a wrong level would first show, as the Model Provider refusing it.
- An older Lanewise reading a later format keeps its bundled copy, so it describes new models as Other versions rather than failing.
- Anyone who can merge to `main` can change what every running Lanewise shows in the picker. The catalog can only describe models a Model Provider's own list returns, with the user's own key. It can't add a host or change where requests go, since the HTTP plugin's scope is fixed at build time.

## Still to check by hand

- In the Desktop App: the catalog is fetched through the HTTP plugin with no CORS error. With the network off, models from a local server are still described, by the bundled copy.
- With a screen reader (NVDA, VoiceOver), the Model, Version and Effort selects are read with their labels, and choosing with the arrow keys works in each. jsdom can't press keys in a native select.
