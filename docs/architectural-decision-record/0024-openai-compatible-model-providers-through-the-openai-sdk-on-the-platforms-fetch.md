# OpenAI-compatible Model Providers through the OpenAI SDK, on the platform's `fetch`

The PRD says OpenAI (ChatGPT models), xAI (Grok), Meta (Muse Spark) and local servers such as Ollama, LM Studio and llama.cpp, where Llama runs, are reached by one adapter on the official `openai` SDK's Chat Completions, set up by a preset for each. Each preset has its own base URL, API-key page and Effort levels (§8.3). Local inference is an external OpenAI-compatible server the user runs, with no bundled runtime (§12). The app only ever calls a Model Provider with the user's own API key (§8.2). This ADR records how the adapter (`app/src/ai/openAiCompatible.ts`) drives `openai` through the connection ADR 0020 hands it, as ADR 0022 and ADR 0023 drive Anthropic's and Google's SDKs. It covers the presets, what is sent and left out, how the Suggestion is held to its JSON Schema by servers that can and can't do that, and how each failure is told to the user.

## Four presets, one adapter

`openAiCompatibleModelProvider(preset)` makes a Model Provider from an `OpenAiPreset`, and `MODEL_PROVIDERS` offers four, each named by its model catalog section (ADR 0021):

| ID | Name | API | Key |
| --- | --- | --- | --- |
| `openai` | OpenAI (ChatGPT models) | `https://api.openai.com/v1` | required |
| `xai` | xAI (Grok) | `https://api.x.ai/v1` | required |
| `meta` | Meta (Muse Spark), preview, US only | `https://api.meta.ai/v1` | required |
| `local` | Local server (Ollama, LM Studio or llama.cpp) | the base URL the user sets, `http://localhost:11434/v1` (Ollama's) until then | optional |

The cloud presets' APIs are always in one place. Their names and API-key pages are the ones Settings already links to for consumer subscriptions (`CLOUD_MODEL_PROVIDERS`). Settings lists them after Anthropic, Gemini coming between xAI and Meta, and Local last.

## A Model Provider on this computer, with an optional key

Local is the first Model Provider whose key is optional and whose API the user places, so `ModelProvider` gains two fields, and every adapter sets them:

- `key`: `"required"` or `"optional"`. It replaces the earlier rule that a Model Provider with no `apiKeyPage` took no key. A local server usually takes none, but LM Studio and `llama-server --api-key` can ask for one. `connect` (`requests.ts`) always reads the credential store. For an optional key it connects without one when none is kept, or when there's no store to keep one in. A store that refuses or fails is still said to, since the user may have kept a key the server needs. Settings lists an optional-key Model Provider's models as soon as it's disclosed. It shows the field as "API key (optional)" and never asks for a key before listing.
- `defaultBaseUrl`: where the API is until the user sets it, or `null` for an API that's always in one place. `AiSettings` gains `baseUrls`, set by Model Provider ID. `connect` hands the adapter `Connection.baseUrl` only for a Model Provider with a `defaultBaseUrl`, so a cloud Model Provider is never given one, whatever local storage holds.

A base URL is only ever on this computer. `localBaseUrl` (`aiSettings.ts`) takes plain `http` to `localhost` or `127.0.0.1`, with a port it names, and no user, query or fragment. It drops a trailing slash. That is exactly what the Desktop App's HTTP scope allows (`http://localhost:*`, `http://127.0.0.1:*`, ADR 0020). So a key kept for a local server can never be sent elsewhere, and a URL the scope would refuse is turned down in Settings instead, where it can be fixed. The same check runs three times: when the setting is read from local storage, when it's saved, and in the adapter before each request. Settings' Base URL field names Ollama's, LM Studio's (`http://localhost:1234/v1`) and llama.cpp's (`http://localhost:8080/v1`) URLs, turns anything else down with an alert, and lists the models afresh from the new one once it's saved.

The First-use disclosure names Local "on this computer", rather than a host. It says what's sent goes to the base URL the user set, with a key only if one's kept, and it doesn't say the Model Provider bills the user.

## The SDK is given everything it would otherwise look for

The SDK reads `OPENAI_API_KEY`, `OPENAI_ADMIN_KEY`, `OPENAI_BASE_URL`, `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID`, `OPENAI_WEBHOOK_SECRET`, `OPENAI_LOG` and `OPENAI_CUSTOM_HEADERS`. It sends `OpenAI-Organization` and `OpenAI-Project` headers when it has them. Each request builds a client with everything set:

- `apiKey` is the user's key. For a local server with no key kept, it's a placeholder the SDK needs before it will make a request. The placeholder is never sent (see below). A cloud preset without a key fails before the SDK is made, so it never looks for credentials of its own.
- `adminAPIKey`, `organization`, `project` and `webhookSecret` are `null`, and `logLevel` is `off`.
- `baseURL` is the preset's API, or the local server's checked base URL.
- `fetch` is the connection's, so the Desktop App's requests go through Tauri's HTTP plugin, with its scope and no redirects.
- `dangerouslyAllowBrowser` is `true`, since the webview looks like a browser to the SDK, though the request is made from the shell.

The SDK adds `user-agent`, `x-stainless-*` headers about itself, its runtime and its retries, and any `OPENAI_CUSTOM_HEADERS`. So the `fetch` it's handed passes on only three headers (`OPENAI_HEADERS`): `accept`, `content-type` and `authorization`. It drops `authorization` whenever the connection has no key of the user's, so the placeholder goes nowhere. The tests stub every variable above and check that none of them, and no `stainless` header, shows in any request.

## Models are listed with `GET /models`

`listModels` asks `GET {base}/models`, which none of these APIs pages. `openAiModels` (ADR 0021) keeps each model's ID and, where it's given, when it was made. The catalog's sections do the rest: `exclude` leaves out image, speech and embedding models, and each version's `efforts` say which Effort levels it takes. A model the catalog doesn't know, as most on a local server are, is offered under Other versions with only the default Effort.

## A Suggestion is one Chat Completions request, held to the schema as far as the server can

`suggest` sends `POST {base}/chat/completions`:

- The model is the version chosen, the API's own model ID.
- A `system` message with the instructions and one `user` message with `suggestionPrompt(request)`, so exactly what the First-use disclosure lists is sent (ADR 0020).
- `reasoning_effort` is the Effort chosen, as the catalog README names it: Off as `none`, Minimal, Low, Medium and High as themselves, Extra high as `xhigh` and Maximum as `max`. With no Effort chosen, or a version under Other versions, it's left out and the model's default applies. `selectionFor` only ever chooses an Effort the catalog lists for the version, so a level the model doesn't take is never sent.
- `max_tokens` and `max_completion_tokens` are left out, as for Gemini. Reasoning counts against them, so a lower limit could cut an answer short at a high Effort.

How the answer is held to `SUGGESTION_SCHEMA` depends on what the model and server take. Three ways are tried in order (`OUTPUT_MODES`):

1. **`jsonSchema`**: `response_format` is `{type: "json_schema", json_schema: {name: "suggestion", strict: true, schema: SUGGESTION_SCHEMA}}`, with `SUGGESTION_INSTRUCTIONS` as the system message. OpenAI, xAI, Meta, Ollama, llama.cpp and LM Studio all take it for models that support it.
2. **`jsonObject`**: `response_format` is `{type: "json_object"}`. The instructions add `JSON_INSTRUCTIONS`: answer with a JSON object alone that the schema, given in full, allows.
3. **`instructions`**: no `response_format` at all, with the same added instructions, for a server that offers neither.

The adapter steps down to the next way in two cases:

- The Model Provider turns the request down with a 400 or 422 whose `param` or message is about `response_format`, `json_schema`, `json_object`, a schema or structured output. OpenAI does this for a model without structured output, and LM Studio does it for `json_object`.
- The answer isn't JSON at all, as from a server that ignores `response_format`.

In the first two ways, the whole answer must be JSON. The only things stripped are a `<think>` block a local reasoning model shows first and a Markdown code block wrapped round it. Otherwise a server that ignored `response_format` could pass off a stray `{ … }` from code in its prose. In the third way, the object is taken from its first `{` to its last `}`, whatever surrounds it. Whichever way it came, the answer is checked by `readSuggestion`, as every adapter's is. JSON that isn't a Suggestion fails as an unexpected response and isn't asked again, since the model did answer in JSON.

The way that worked is remembered, for each base URL and model, for the rest of the run. A model that can't take a JSON Schema is asked for a JSON object at once the next time, rather than being turned down first on every Suggestion. It's kept in memory only. A server may be upgraded between runs, so each run starts again from the strictest way.

## Every failure is told by the SDK's error class

- **`AuthenticationError`** (401) is the key being refused. **`RateLimitError`** (429) is rate limiting, which is also how OpenAI says an account is out of credit.
- **`InternalServerError`** (500 or above) is **`unavailable`**, with the API's message.
- Any other **`APIError`** (400, 403, 404, 422 and the rest) is **`rejected`**. Its message is the body's `error.message`, as OpenAI, xAI, Meta, Ollama and llama.cpp give it, or `error` itself where that's a string, as LM Studio gives it, or else the SDK's own message. A 403 is rejected, not the key refused: it's how OpenAI says a model isn't open to the account, and how Meta says its preview isn't offered in a country.
- **`APIConnectionTimeoutError`** is unreachable, saying it didn't answer in time. Any other **`APIConnectionError`** is unreachable with its cause. For a local server it says nothing answered at the base URL and to check the server is running.
- Another **`OpenAIError`**, or an answer that says it's JSON and isn't, is an unexpected response.
- An abort is thrown on as the SDK's `APIUserAbortError`, since nothing failed.

An answer can also say it didn't finish:

- A `message.refusal`, which structured output uses to decline, is **`declined`** with the refusal as its explanation. `finish_reason: "content_filter"` is **`declined`** with none.
- `finish_reason: "length"` is an unexpected response saying a lower Effort may leave it room.
- No choice at all is an unexpected response saying it gave no answer.

The SDK retries 408, 409, 429 and 5xx, and a request that can't be made, twice by default, with its own backoff, and follows `x-should-retry` and `retry-after`. The adapter leaves those at the default, as Anthropic's does.

## The tests mock the HTTP layer, and one script sends a real request by hand

`openAiCompatible.test.ts` runs the real SDK against a fake `fetch` that answers as the Chat Completions API does, for every preset, so nothing reaches a Model Provider or a server on this computer. It covers:

- each preset's URL, headers and environment
- a local server with no key sending no `authorization`, one with a kept key, and a custom base URL
- a base URL off this computer being refused before anything is sent
- each preset's models, described by the bundled catalog
- `reasoning_effort` at every Effort, and only where the catalog allows it, end to end through `requestSuggestion`
- stepping down from a JSON Schema to a JSON object to instructions, and remembering which worked
- refusals, content filtering and answers cut short
- each error class, a retry and an abort

`ModelProviderSettings.test.tsx` covers the Base URL field and the optional key, each checked with `expectNoAxeViolations`. `requests.test.ts` covers `connect`'s optional key and base URL.

`pnpm try:openai`, `pnpm try:xai` and `pnpm try:meta` (`app/scripts/trySuggestion.ts`) each send one real request with the owner's own key. The key is read only from `LANEWISE_OPENAI_API_KEY`, `LANEWISE_XAI_API_KEY` or `LANEWISE_META_API_KEY`, never from `OPENAI_API_KEY` or `XAI_API_KEY`. `pnpm try:local [--base-url …]` asks a server on this computer, with `LANEWISE_LOCAL_API_KEY` only if it's set. The script logs each request's URL and the `response_format` it asked for, without its headers, so the owner can see how a server was held to the schema. It isn't a test file, so CI never runs it.

## Consequences

- `MODEL_PROVIDERS` now has all six Model Providers the PRD names, so §8.3's adapters are complete.
- `openai` is a dependency of the UI. The SDK is about 348 kB (75 kB compressed), and, like Anthropic's and Google's, is only loaded the first time one of the four presets lists models or asks for a Suggestion, not with the main chunk (ADR 0022). Its optional `undici` and `ws` peers are resolved by pnpm from other packages. The Credits now follow a peer pnpm links beside a package, so they match `pnpm list --prod`. The UI never imports `undici`, which the SDK only needs for workload identity over mutual TLS.
- One adapter serves four presets. A Model Provider that differs from OpenAI's Chat Completions in a way that matters needs a preset option, or its own adapter as Gemini has. A new preset needs a catalog section, a key page and an HTTP-scope entry (ADR 0020).
- A model's structured-output support is found by asking, not listed in the catalog. A model that can't take a JSON Schema costs one refused request per run before it's asked for a JSON object.
- Local servers name models in their own ways, such as `llama3.3:70b` in Ollama and `meta-llama/llama-3.3-70b-instruct` in LM Studio. The catalog's `local` section matches the common ones. The rest are offered under Other versions.

## Still to check by hand

- `pnpm try:openai`, `pnpm try:xai` and `pnpm try:meta`, each with the owner's own key, return a Suggestion:
  - with and without `--effort`
  - with a JSON Schema, which the log shows
  - for a GPT-5.x model at Off (sent as `none`), and at Extra high (sent as `xhigh`)
- A wrong key for each says it was refused.
- Meta outside the US says why it was turned down.
- `pnpm try:local` returns a Suggestion from Ollama, LM Studio and llama.cpp, each at its own base URL, for a Llama and a gpt-oss model. The log shows the way that worked for each.
- In the Desktop App: each cloud preset lists models and asks for a Suggestion through the HTTP plugin, with no CORS error. A local server at a custom base URL does the same, and one that's stopped says nothing answered there.
