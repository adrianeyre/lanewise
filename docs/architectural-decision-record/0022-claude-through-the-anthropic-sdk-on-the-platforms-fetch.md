# Claude through the Anthropic SDK, on the platform's `fetch`

The PRD says the Anthropic adapter uses the official SDK. It lists models with the Models API and sends each version's Effort as `output_config.effort`, only at the levels that model supports, leaving thinking at its adaptive default. It gets the Suggestion as structured output through `output_config.format` with a JSON Schema (§8.3). The app only ever calls a Model Provider with the user's own API key (§8.2). This ADR records how the adapter (`app/src/ai/anthropic.ts`) drives `@anthropic-ai/sdk` through the connection ADR 0020 hands it, what it sends, what it leaves out, and how each way a request can go wrong is told to the user.

## The SDK is given everything it would otherwise look for

The SDK reads a good deal from wherever it runs: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS` and `ANTHROPIC_LOG`. It also adds headers of its own about the OS, the runtime, the SDK and its retries. None of those should ever decide where a user's key goes, or what goes with it. So each request builds a client with everything set:

- `apiKey` is the user's key from the connection. Without one the adapter fails before the SDK is made, so it never looks for credentials of its own.
- `authToken` is `null`.
- `baseURL` is `https://api.anthropic.com`.
- `fetch` is the connection's, so the Desktop App's requests go through Tauri's HTTP plugin, with its scope and no redirects (ADR 0020).
- `logLevel` is `"off"`.
- `dangerouslyAllowBrowser` is `true`, since the webview looks like a browser to the SDK. The key is the user's own, and the request is made from the shell.

The SDK merges `ANTHROPIC_CUSTOM_HEADERS` into every request whatever it's given. So the `fetch` it's handed passes on only four headers (`ANTHROPIC_HEADERS`): `accept`, `content-type`, `anthropic-version` and `x-api-key`. Nothing else the SDK or an environment adds reaches Anthropic. The tests stub every one of those variables with values of their own and check that none of them shows in any request.

## Models are listed with the Models API, every page

`listModels` asks `GET /v1/models` for 1,000 models at a time. The SDK asks for each later page from the last one's `last_id` while it `has_more`. `anthropicModels` (ADR 0021) reads each model's `display_name`, `created_at` and the levels its `capabilities.effort` reports, and `describeModels` groups them with the catalog's `anthropic` section.

## A Suggestion is one Messages API request, with a JSON Schema

`suggest` sends one `POST /v1/messages`:

- `model` is the version chosen, the API's own model ID.
- `system` is `SUGGESTION_INSTRUCTIONS` and the one user message `suggestionPrompt(request)`, so exactly what the First-use disclosure lists is sent (ADR 0020).
- `output_config.format` is `{ type: "json_schema", schema: SUGGESTION_SCHEMA }`.
- `output_config.effort` is the Effort chosen, as the API names it: Low, Medium and High as `low`, `medium` and `high`, Extra high as `xhigh` and Maximum as `max`. `selectionFor` only ever chooses a level the version's `capabilities.effort` listed, so a level the model doesn't take is never sent. With none chosen, or a version under Other versions, `effort` is left out and the model's own default applies.
- `max_tokens` is 16,000: far more than one Conflict Hunk's answer needs, with room for thinking, and short of what the SDK allows a request that isn't streamed.

Nothing is said about thinking. The models that take adaptive thinking use it by default, and the Effort chosen is what tells them how much to do. There are no server-side fallbacks either: the user chose the model, so a Suggestion never quietly comes from another one.

The adapter uses `messages.create` rather than `messages.parse`. `parse` reads the JSON before the answer's `stop_reason` can be looked at, so a refusal or an answer cut short would fail as bad JSON. Instead the adapter checks why the model stopped, joins the answer's text blocks and parses them itself, then checks the result with `readSuggestion`, as every adapter does. A structured output that parses isn't trusted until it's read as a Suggestion.

## Every failure is told by the SDK's typed error classes

`ModelProviderFailure` gains three kinds, and `aiWords.ts` says each in plain words:

- **`unavailable`**: Anthropic is overloaded or failing (`InternalServerError`: 500, 529 and the rest of 5xx), with what it said.
- **`rejected`**: Anthropic turned the request down (400, 403, 404, 413 and any other status), with the API's own message, such as a model the key can't use.
- **`declined`**: the model stopped for a refusal, with its `stop_details.explanation` where it gave one. Lanewise says the model declined to make a Suggestion for this Conflict Hunk, and to resolve it by hand or choose another model.

The rest map to the kinds ADR 0020 set out:

- `AuthenticationError` (401) is the key being refused.
- `RateLimitError` (429) and a 402, Anthropic's billing error, are rate limiting.
- `APIConnectionError` and `APIConnectionTimeoutError` mean Anthropic couldn't be reached.
- Any other `AnthropicError`, and an answer that stopped at `max_tokens` or at the model's context window, is an unexpected response. Each has words of its own, saying what to change.

An abort, `APIUserAbortError`, is thrown on as it is, since nothing failed. The SDK tries a failure that may pass (408, 409, 429, 5xx and a connection failing) twice more, honouring `retry-after` and `x-should-retry`, before the adapter sees it.

## The tests mock the HTTP layer, and one script sends a real request by hand

`anthropic.test.ts` runs the real SDK against a fake `fetch` that answers as Anthropic's API does, so nothing reaches Anthropic. It covers paging, the headers and environment, the request body at every Effort, each stop reason, each error status, a retry after a 529 and an abort, and a Suggestion asked for end to end through `requestSuggestion` with the bundled catalog.

`pnpm try:anthropic` (`app/scripts/trySuggestion.ts`, which ADR 0023 widens to Gemini) sends one real request, for the owner to check what a mock can't. It lists models, then asks the newest, or the one `--model` names, at the `--effort` given, for a Suggestion for a small Conflict Hunk. It reads the key only from `LANEWISE_ANTHROPIC_API_KEY`, never `ANTHROPIC_API_KEY`, so a key or gateway that happens to be set is never used, and it refuses to run without one. It isn't a test file, so CI never runs it.

## Consequences

- Anthropic is the first Model Provider in `MODEL_PROVIDERS`, so Settings offers it. Gemini's adapter is ADR 0023. The OpenAI-compatible adapter, with presets for OpenAI, xAI, Meta and local servers, is ADR 0024.
- The UI bundles the SDK, about 191 kB (49 kB compressed), though it only runs for AI. It isn't in the main chunk: `MODEL_PROVIDERS` describes each Model Provider from `modelProviderDetails.ts`, which imports no SDK, and loads its adapter, with its SDK, the first time it lists models or asks for a Suggestion, so the first screen never waits for it (ADR 0005).
- A new SDK release may add headers or read new variables. The header allow-list keeps any new header out, and the tests check exactly which headers are sent, but a variable that changes something else would need its own option set here.
- An Effort Anthropic's API names that `ANTHROPIC_EFFORTS` doesn't know isn't offered until it's added there.

## Still to check by hand

- `pnpm try:anthropic` with the owner's own key returns a Suggestion, with and without `--effort`, and `--model` for a model without Effort (Claude Haiku 4.5).
- In the Desktop App with a real key: models are listed and a Suggestion is asked for through the HTTP plugin, with no CORS error, and a wrong key says it was refused.
- With a screen reader (NVDA, VoiceOver), each failure's words are read where they're shown.
