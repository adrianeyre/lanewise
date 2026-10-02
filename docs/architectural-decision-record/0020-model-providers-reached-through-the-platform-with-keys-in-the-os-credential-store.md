# Model Providers are reached through the platform, with API keys in the OS credential store

The PRD says keys are kept in the OS credential store, never in plain text config, that AI is opt-in and off by default with a clear first-use disclosure of what's sent to which Model Provider, and that the user chooses a Model Provider, model, version and effort globally and can override them per repository (§8.2). A Suggestion is asked for with a Conflict Hunk's three versions, 20 lines of context each side, the file's path and both commit subjects (§8.1). This ADR records the Model Provider abstraction every adapter sits behind, where API keys are kept and when they leave it, how requests reach a Model Provider without CORS, and how the First-use disclosure gates everything. The adapters themselves, and the model catalog, come with §8.3.

## One abstraction, handed its connection

A Model Provider (`ModelProvider` in `app/src/ai/modelProvider.ts`) has an ID, a name, the host it sends to, the page where the user makes an API key, or none for one on this computer, and two operations:

- **`listModels`** lists the models the user can choose, live from the Model Provider's API. The model catalog then groups them into models and versions, newest first, with each version's Effort levels and default Effort (ADR 0021).
- **`suggest`** takes a `SuggestionRequest` and a model, version and Effort, and returns a Suggestion: an explanation, the Resolution text and a Confidence.

An adapter never makes a request by itself or reads a key. Each call is handed a `Connection`: the platform's `fetch`, the user's API key and an abort signal. So an adapter can be tested against a fake `fetch`, and the tests use a fake Model Provider (`app/src/test/fakeModelProvider.ts`) served by one, never a real API. A failure is a `ModelProviderError`: the key was refused, the Model Provider is limiting requests, it couldn't be reached, or it answered with something that isn't a Suggestion. `readSuggestion` checks what comes back before anything sees it.

What's sent is built in one place, `suggestionRequest.ts`: the Conflict Hunk's Base, Ours and Theirs, as many lines of context above and below as Settings says (20 by default, up to 200, never past the file's ends), the path and both commit subjects. `suggestionPrompt` puts exactly those in the prompt, so the First-use disclosure (`sentForASuggestion` in `aiWords.ts`) names everything that goes, and nothing else of the file does.

Nothing here applies a Suggestion. `requestSuggestion` only returns one. Showing it, and accepting, editing or rejecting it, is the AI Suggestion Widget on the Conflicts page (§8.1, ADR 0025).

## API keys are kept by `keyring`, and read only for a request

Keys are kept in the OS credential store through the `keyring` crate: Keychain on macOS, Credential Manager on Windows and the Secret Service on Linux. Each is kept under the service `com.adrianeyre.lanewise.model-provider`, with the Model Provider's ID as the user name. The `commands` crate carries four commands (`commands/src/model_provider.rs`):

- `modelProviderKeyStored` says whether a key is kept, without reading it out. This is all Settings ever asks.
- `modelProviderKey` reads the key out. Only `connect` in `app/src/ai/requests.ts` calls it, for the request about to be made, once AI is on and the First-use disclosure for that Model Provider has been accepted. The key isn't kept in the UI afterwards.
- `saveModelProviderKey` keeps a key, trimmed, refusing an empty one.
- `forgetModelProviderKey` deletes it, and succeeds when there was none.

An `ApiKey` prints as `ApiKey(hidden)`, so it can't reach a log through `Debug`. A credential store failure says whether there's no store (a Linux desktop without a Secret Service), whether the user or the OS refused access, or what else went wrong. A key that couldn't be decoded is said to be unreadable, never with `keyring`'s own error, since that error holds the bytes read. Nothing about AI is kept in local storage but the choices below, and the Cookie Policy says so.

The commands reach the store through a `KeyStore` trait, so the Rust tests use one in memory and never touch the real OS credential store. The UI tests use a fake command handler (`fakeKeyStore`).

## Requests go through the platform's `fetch`, so CORS never applies

The `Platform` has a `fetch`. In the Desktop App it's Tauri's HTTP plugin (`tauri-plugin-http`), which makes the request from Rust, so the webview's CORS rules don't apply and no Model Provider has to allow Lanewise's origin. The plugin's scope in `desktop/capabilities/default.json` allows only the Model Providers' APIs (`api.anthropic.com`, `api.openai.com`, `api.x.ai`, `generativelanguage.googleapis.com` and `api.meta.ai`) and `localhost` and `127.0.0.1` on any port, for a Model Provider the user runs on this computer. Redirects are never followed (`maxRedirections: 0`), so a request carrying an API key can't be sent on to a host it wasn't meant for.

In Web Mode, the browser can't make these requests itself, so `serve` will forward them, with the same list of hosts (PRD §7.12, P1). Until then the unavailable platform's `fetch` fails.

## AI is off until the user accepts the First-use disclosure for each Model Provider

AI's Settings are kept in local storage under `lanewise.model-provider` (`aiSettings.ts`): whether AI is on, the Model Providers whose First-use disclosure was accepted, the lines of context, the global choice, each repository set apart with its own, and the base URL set for a local server (ADR 0024). Whatever can't be read is left at its default, which is off, so a damaged value never turns AI on.

Each choice names a Model Provider and, optionally, a model, a version and an Effort. With no version the newest is used, and with no Effort the Model Provider's default for that version. A version no longer listed gives way to the newest, and an Effort the version doesn't take gives way to its default. A repository set apart, by its root, uses its own choice in full; every other repository uses the global one.

Every change in Settings goes through one gate: if it would send Conflict Hunks to a Model Provider whose disclosure hasn't been accepted, turning AI on or choosing a new one, for every repository or one set apart, the First-use disclosure is shown first. It names the Model Provider and its host, and lists what's sent. The change is made only when the user accepts it, and Cancel leaves everything as it was. AI can't be turned on before a Model Provider is chosen, since the disclosure would have none to name: Settings asks for one first. `listModels` and `requestSuggestion` check the same settings again before they send anything, so nothing is listed or asked while AI is off or before the disclosure was accepted.

Settings also says plainly that consumer subscriptions (Claude Pro or Max, ChatGPT Plus, SuperGrok, Gemini Advanced and Meta AI) can't be used by other apps, that API usage is billed separately, and links to each cloud Model Provider's API-key page.

## Consequences

- The adapters come with PRD §8.3 (M6). The first, Anthropic's, is ADR 0022, Gemini's is ADR 0023, and the OpenAI-compatible adapter's, whose local server takes an optional key at a base URL the user sets, is ADR 0024. While `MODEL_PROVIDERS` is empty, Settings says no Model Provider can be chosen in this version of Lanewise. The model catalog, which describes the models their lists return, is ADR 0021.
- An adapter for another cloud Model Provider needs its API's host added to the HTTP plugin's scope, and to Web Mode's forwarding.
- A key kept in the OS credential store stays there when Lanewise is uninstalled, as the credential store's own entries do, until the user forgets it in Settings or in the credential store.
- On Linux, keeping a key needs a running Secret Service (GNOME Keyring or KWallet). Without one, Settings says the credential store isn't available.
- The Confidence checks, downgrading a Suggestion to low when it still has Conflict Markers, is empty or drops lines only one side has, are `checkSuggestion` in `confidence.ts`, run on every Suggestion the AI Suggestion Widget shows (§8.1, ADR 0025).

## Still to check by hand

- In the Desktop App on each OS: saving, replacing and forgetting an API key shows in Keychain Access, Credential Manager and Seahorse under `com.adrianeyre.lanewise.model-provider`, and a Linux session without a Secret Service says the credential store isn't available.
- In the Desktop App, with an adapter (ADR 0022): models are listed through the HTTP plugin with no CORS error, a host outside the scope is refused, and a redirect isn't followed.
- Both themes and Windows' high-contrast mode show the First-use disclosure's border, the checkboxes and their focus. With a screen reader (NVDA, VoiceOver), focus moves to the disclosure and it's read with its name, what's sent and its buttons.
