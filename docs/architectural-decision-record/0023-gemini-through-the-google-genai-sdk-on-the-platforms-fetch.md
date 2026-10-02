# Gemini through the Google Gen AI SDK, on the platform's `fetch`

The PRD says the Gemini adapter uses the official `@google/genai` SDK, not Google's OpenAI-compatible layer, which is a beta and silently ignores settings it doesn't take. It lists models with the native models API. It sends each version's Effort as `thinkingConfig.thinkingLevel` on models that take levels, and as a `thinkingBudget` on older ones. It gets the Suggestion as structured output with a JSON Schema (§8.3). The app only ever calls a Model Provider with the user's own API key (§8.2). This ADR records how the adapter (`app/src/ai/gemini.ts`) drives `@google/genai` through the connection ADR 0020 hands it, in the same way ADR 0022 drives Anthropic's SDK: what it sends, what it leaves out, and how each way a request can go wrong is told to the user.

## The SDK is given everything it would otherwise look for

The SDK's Node build reads `GOOGLE_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_GEMINI_BASE_URL` and `GOOGLE_VERTEX_BASE_URL`. With Vertex AI switched on, it would send requests to Google Cloud under a project instead. The web build, which the UI bundles, reads none of them. Either way, each request builds a client with everything set:

- `apiKey` is the user's key from the connection. Without one the adapter fails before the SDK is made, so it never looks for credentials of its own.
- `vertexai` is `false`, so the Gemini API is always the one asked.
- `apiVersion` is `v1beta`, the SDK's own default and the version that takes `responseJsonSchema` and `thinkingLevel`.
- `httpOptions.baseUrl` is `https://generativelanguage.googleapis.com`, which the Desktop App's HTTP plugin scope already allows (ADR 0020).
- `httpOptions.fetch` is the connection's, so the Desktop App's requests go through Tauri's HTTP plugin, with its scope and no redirects.

The SDK adds `user-agent` and `x-goog-api-client` headers about itself and its runtime. So the `fetch` it's handed passes on only two headers (`GEMINI_HEADERS`): `content-type` and `x-goog-api-key`. The key goes in that header, never in the URL. The tests stub every variable above with values of their own and check that none of them shows in any request. They run the SDK's Node build, the one that reads them.

## Models are listed with the models API, every page

`listModels` asks `GET /v1beta/models` for 1,000 models at a time, and the SDK's pager asks for each later page with the last one's `nextPageToken`. `geminiModels` (ADR 0021) keeps only models whose methods include `generateContent`, so embedding, image and other models that can't chat are left out before the catalog's exclusions are applied. The API calls that list `supportedGenerationMethods`. The SDK hands it on as `supportedActions`, so both names are read. Each model keeps its `displayName`, its `version` and whether it `thinking`: a model that doesn't think takes no Effort.

`ListedModel` gains a `version` for this: the Model Provider's own version where it gives one, as Gemini does (`001`, `3.5`), or else `null`. When two listed versions share a name, `describeModels` tells them apart by that version where each has a different one, and by their IDs otherwise.

## A Suggestion is one `generateContent` request, with a JSON Schema

`suggest` sends one `POST /v1beta/models/{version}:generateContent`:

- The model is the version chosen, the API's own model ID.
- `systemInstruction` is `SUGGESTION_INSTRUCTIONS`, and the one user turn is `suggestionPrompt(request)`, so exactly what the First-use disclosure lists is sent (ADR 0020).
- `generationConfig.responseMimeType` is `application/json` and `responseJsonSchema` is `SUGGESTION_SCHEMA`: the same JSON Schema every adapter sends. The older `responseSchema`, an OpenAPI subset, isn't used.
- `generationConfig.thinkingConfig` is the Effort chosen, in one of two ways, as the model catalog says (ADR 0021):
  - A version the catalog gives `budgets`, such as Gemini 2.5 Pro, Flash and Flash-Lite, gets `thinkingBudget`: the token budget `selectionFor` carries for that Effort. Off on 2.5 Flash is a budget of 0.
  - Any other version gets `thinkingLevel`: Minimal, Low, Medium and High as `MINIMAL`, `LOW`, `MEDIUM` and `HIGH`.
  - With no Effort chosen, a version under Other versions, or an Effort Gemini has no level for, `thinkingConfig` is left out and the model's own default applies. `selectionFor` only ever chooses an Effort the catalog lists for the version, so a level the model doesn't take is never sent.
- `maxOutputTokens` is left out. The model's own limit is far more than one Conflict Hunk's answer needs, with its thinking, and Gemini counts thinking against it, so a lower one could cut an answer short at a high Effort.

The adapter doesn't use the SDK's `response.text`, which warns about and joins whatever parts there are. It checks why Gemini stopped, then joins the text parts of the first candidate, leaving out any marked `thought`, and parses them itself. It checks the result with `readSuggestion`, as every adapter does. A structured output that parses isn't trusted until it's read as a Suggestion.

## Every failure is told by the status of the SDK's `ApiError`

The SDK throws one class, `ApiError`, for any status that isn't OK. Its message is the API's JSON error, so the adapter reads that body for Gemini's own message and reasons:

- A 400 with the reason `API_KEY_INVALID`, which is how Gemini says a key isn't one, and a 401, are the key being refused.
- A 429, Gemini's `RESOURCE_EXHAUSTED`, is rate limiting: too many requests, or a quota or spend limit reached.
- A 500 or above is **`unavailable`**, with what Gemini said, such as the model being overloaded.
- Any other status (400, 403, 404 and the rest) is **`rejected`**, with the API's own message, such as a model that isn't there.
- A request that can't be made is Gemini being unreachable, and an answer that isn't JSON is an unexpected response.

An answer can also say it didn't finish:

- A prompt Gemini blocks (`promptFeedback.blockReason`), or an answer stopped for `SAFETY`, `RECITATION`, `BLOCKLIST`, `PROHIBITED_CONTENT` or `SPII`, is **`declined`**. The Gemini API gives no explanation of its own: `finishMessage` and `blockReasonMessage` are Vertex AI's alone. So the adapter says in plain words what each reason means, and Lanewise says the model declined to make a Suggestion for this Conflict Hunk, and to resolve it by hand or choose another model.
- An answer stopped at `MAX_TOKENS` is an unexpected response that says a lower Effort may leave it room. Any other reason is an unexpected response that names it.

An abort is thrown on as it is, since nothing failed. The SDK doesn't retry unless asked, so the adapter asks for two retries, as many as Anthropic's SDK makes. The first comes about a second after the failure, and each after that waits twice as long, with jitter. The SDK retries 408, 429, 500, 502, 503 and 504, and a request that can't be made. It never retries a status that won't change, and it stops at an abort.

## The tests mock the HTTP layer, and one script sends a real request by hand

`gemini.test.ts` runs the real SDK against a fake `fetch` that answers as the Gemini API does, so nothing reaches Google. It covers:

- paging, and keeping only models that take `generateContent`
- the headers and environment
- the request body at every Effort, as a level and as a budget
- each finish and block reason
- each error status, including a key Gemini says is invalid
- a retry after a 503, none after a 400, and an abort
- a Suggestion asked for end to end through `requestSuggestion` with the bundled catalog, at an Effort sent as a budget and one sent as a level

`pnpm try:anthropic` and `pnpm try:gemini` (`app/scripts/trySuggestion.ts`) each send one real request, for the owner to check what a mock can't. The script lists the Model Provider's models and describes them with the bundled catalog, as Settings does, so Gemini 2.5's Effort goes as its budget. It then asks the newest version of the first model, or the one `--model` names, at the `--effort` given, for a Suggestion for a small Conflict Hunk. It reads the key only from `LANEWISE_ANTHROPIC_API_KEY` or `LANEWISE_GEMINI_API_KEY`, never from a variable an SDK knows, so a key or gateway that happens to be set is never used, and it refuses to run without one. It isn't a test file, so CI never runs it.

## Consequences

- Gemini is the second Model Provider in `MODEL_PROVIDERS`, so Settings offers it. The OpenAI-compatible adapter, with presets for OpenAI, xAI, Meta and local servers, is ADR 0024.
- The UI bundles the SDK's web build, about 373 kB (67 kB compressed), though it only runs for AI. Like Anthropic's, it's only loaded the first time the adapter lists models or asks for a Suggestion, not with the main chunk (ADR 0022).
- The tests run the SDK's Node build and the UI ships its web build. They share the request code, and the Node build is the one that reads the environment.
- A new SDK release may add headers or read new variables. The header allow-list keeps any new header out, and the tests check exactly which headers are sent, but a variable that changes something else would need its own option set here.
- A new thinking level needs adding to `THINKING_LEVELS` and to the catalog's efforts. A new model that takes budgets needs its budgets in the catalog, or else it is sent a level.

## Still to check by hand

- `pnpm try:gemini` with the owner's own key returns a Suggestion:
  - with and without `--effort`
  - for a Gemini 3 model at a level
  - for Gemini 2.5 Flash at Off and High, sent as a budget
- A wrong key says it was refused.
- In the Desktop App with a real key: models are listed and a Suggestion is asked for through the HTTP plugin, with no CORS error.
